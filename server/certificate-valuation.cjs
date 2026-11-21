const {certificateLocationFields} = require("./document-locations.cjs");
const {isHold,ruleKey,applyHold,releaseCompletedWorks}=require('./certificate-retention-math.cjs');
const SCALE = 1_000_000_000_000n;
const MAX = 90_000_000_000;
const UNIT_FACTORS = {mm: 1_000_000_000n, cm: 10_000_000_000n, m: SCALE};
const MODES = new Set(["area", "linear", "count", "direct", "lump", "adjustment"]);

function decimal(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim().replace(/[٠-٩۰-۹]/g, (digit) =>
    String(digit.charCodeAt(0) - (digit.charCodeAt(0) <= 0x669 ? 0x660 : 0x6f0)))
    .replace(/٫/g, ".");
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(normalized);
  if (!match || (!match[2] && !match[3]) || !Number.isFinite(Number(normalized)) ||
      Math.abs(Number(normalized)) > MAX) return null;
  const frac = (match[3] || "").padEnd(13, "0");
  const minor = BigInt(match[2] || "0") * SCALE + BigInt(frac.slice(0, 12)) +
    (Number(frac[12]) >= 5 ? 1n : 0n);
  return match[1] === "-" ? -minor : minor;
}

function divide(value, divisor) {
  const magnitude = value < 0n ? -value : value;
  const rounded = (magnitude + divisor / 2n) / divisor;
  return value < 0n ? -rounded : rounded;
}

const multiply = (a, b) => divide(a * b, SCALE);
const moneyMinorBig = (value) => divide(value, SCALE / 100n);
const money = (minor) => Number(minor) / 100;
const numeric = (value) => Number(value) / Number(SCALE);
const minorNumber = (value) => Number(moneyMinorBig(value));

function toMinor(value) {
  const amount = decimal(value);
  return amount === null ? null : minorNumber(amount);
}

function positive(value) {
  return value !== null && value >= 0n;
}

function present(value) {
  return value !== null && value !== undefined && value !== "";
}

function quantityAt(value, scale) {
  const step = 10n ** BigInt(12 - scale);
  return divide(value, step) * step;
}

function progressAtAmount(line, value) {
  const base = line.mode === "lump" ? Number(line.agreed_amount) :
    Number(line.billed_quantity ?? line.quantity) * Number(line.rate);
  return Number.isFinite(base) && base > 0 ? Math.round(value / base * 10000) / 100 : null;
}

function workLocation(line) {
  const {building_unit,floor_apartment} = certificateLocationFields(line);
  return building_unit || floor_apartment ? [building_unit,floor_apartment].map((value) => value.toLowerCase()).join("\u0000") : line.location_id ?? null;
}

function calculateLine(line, before, settings, {correction=false}={}) {
  const errors = [];
  const complain = (field, message) => errors.push({field, message, line_id: line.id});
  const mode = line.mode;
  const recognition = line.recognition === "cumulative" ? "cumulative" : "incremental";
  const width = decimal(line.width);
  const height = decimal(line.height);
  const count = decimal(line.count);
  const quantity = decimal(line.quantity);
  const rate = decimal(line.rate);
  const progress = decimal(line.progress);
  const agreed = decimal(line.agreed_amount);
  const claim = decimal(line.claim_amount);
  const adjustment = decimal(line.adjustment_amount);
  const overridden = present(line.override_quantity);
  const override = decimal(line.override_quantity);
  const previous = BigInt(toMinor(before?.cumulative) || 0);
  let previousProgress = before ? before.cumulative_progress ?? progressAtAmount(before,money(previous)) : 0;
  const lastCurrent = before ? BigInt(toMinor(before.current) || 0) : null;
  let geometric = null;
  let unroundedBillable = null;
  let billed = null;
  let gross = 0n;
  const scale = Number.isInteger(settings.quantity_precision) ? settings.quantity_precision : 4;
  const completion = progress ?? 100n * SCALE;
  if (mode !== "adjustment" && present(line.progress) && (!positive(progress) || progress > 100n * SCALE))
    complain("progress", "Progress must be from 0 to 100");

  if (!correction&&before && (workLocation(before) !== workLocation(line) || before.work_type !== line.work_type))
    complain("identity", "Certified work identity must keep its location and work type");
  if (!line.description && !line.work_item) complain("description", "Work description is required");
  if (line.carried_forward) {
    return {line: {...line, previous: money(previous), current: 0, cumulative: money(previous),
      previous_progress:previousProgress, current_progress:0, cumulative_progress:previousProgress,
      last_current: lastCurrent === null ? null : money(lastCurrent), billed_quantity: before?.billed_quantity ?? before?.quantity ?? null,
      geometric_quantity: null}, errors};
  }

  if (mode === "area" || mode === "linear") {
    const factor = UNIT_FACTORS[line.dimension_unit];
    if (!factor) complain("dimension_unit", "Dimension unit must be mm, cm or m");
    if (!positive(width)) complain("width", mode === "area" ? "Width is required" : "Length is required");
    if (mode === "area" && !positive(height)) complain("height", "Height is required for area");
    if (mode === "linear" && present(line.height)) complain("height", "Remove height for a linear measurement");
    if (present(line.count) && !positive(count)) complain("count", "Count must be zero or greater");
    if (present(line.unit) && !["m2", "m²", "sqm", "م²", "م2", "متر مربع"].includes(line.unit) && mode === "area")
      complain("unit", "Area is billed in square metres");
    if (present(line.unit) && !["m", "lm", "م", "م.ط", "متر طولي"].includes(line.unit) && mode === "linear")
      complain("unit", "Length is billed in metres");
    if (factor && positive(width) && (mode === "linear" || positive(height))) {
      const piece = mode === "area"
        ? multiply(multiply(width, factor), multiply(height, factor))
        : multiply(width, factor);
      const minimum = mode === "area" ? decimal(settings.minimum_area) || 0n : 0n;
      const pieces = count === null ? SCALE : count;
      geometric = multiply(piece, pieces);
      unroundedBillable = multiply(piece < minimum ? minimum : piece, pieces);
      if (overridden) {
        if (!positive(override) || !line.reason) complain("override_quantity", "Quantity override requires a valid quantity and a reason");
        else unroundedBillable = override;
      }
    }
  } else if (mode === "direct" || mode === "count") {
    unroundedBillable = mode === "count" ? count ?? quantity : quantity;
    if (!positive(unroundedBillable)) complain("quantity", "Quantity must be zero or greater");
    if (mode === "direct" && !line.unit) complain("unit", "Quantity unit is required");
  } else if (mode === "lump") {
    if (present(line.claim_amount) && !positive(claim)) complain("claim_amount", "Claim amount must be zero or greater");
    if (claim === null && !positive(agreed))
      complain("agreed_amount", "Enter a claim amount or an agreed amount");
    if (claim !== null && progress !== null)
      complain("progress", "Select one claim basis, amount or percentage");
    gross = claim ?? divide(multiply(agreed ?? 0n, completion), 100n);
  } else if (mode === "adjustment") {
    if (adjustment === null) complain("adjustment_amount", "A signed adjustment amount is required");
    if (!line.reason) complain("reason", "An adjustment reason is required");
    if (!before) complain("identity", "Select the affected previously certified work");
    gross = adjustment ?? 0n;
  } else {
    complain("mode", "Select a supported entry mode");
  }

  if (unroundedBillable !== null) {
    const quantityScale = mode === "count" ? settings.count_precision ?? 0 : scale;
    billed = quantityAt(unroundedBillable, quantityScale);
    gross = divide(multiply(multiply(billed, rate ?? 0n), completion), 100n);
  }

  if (["area", "linear", "count", "direct"].includes(mode) && !positive(rate))
    complain("rate", "Unit rate must be zero or greater");
  if (!positive(agreed) && present(line.agreed_amount))
    complain("agreed_amount", "Agreed amount must be zero or greater");
  const settled = moneyMinorBig(gross);
  const current = recognition === "cumulative" && mode !== "adjustment" ? settled - previous : settled;
  if (!correction&&mode !== "adjustment" && current < 0n) complain("recognition", "A lower cumulative target requires an approved adjustment");
  if (mode === "lump" && agreed !== null && previous + current > moneyMinorBig(agreed))
    complain("progress", "Certified work would exceed the agreed amount");
  if (gross > BigInt(MAX) * SCALE || gross < -BigInt(MAX) * SCALE)
    complain("rate", "Calculated amount exceeds the supported limit");
  const applicable = mode !== "adjustment" && !(mode === "lump" && claim !== null);
  if (applicable && recognition === "cumulative" && before)
    previousProgress = progressAtAmount({...line,billed_quantity:billed == null ? null : numeric(billed)},money(previous));
  const currentProgress = applicable ? recognition === "cumulative" ?
    (previousProgress == null ? null : numeric(completion) - previousProgress) : numeric(completion) :
    progressAtAmount({...line,billed_quantity:billed == null ? null : numeric(billed)},money(current));
  const cumulativeProgress = currentProgress == null || previousProgress == null ? null : previousProgress + currentProgress;
  return {
    errors,
    line: {
      ...line,
      unit: mode === "area" ? "m²" : mode === "linear" ? "m" : mode === "count" ? line.unit || "pcs" : line.unit,
      previous: money(previous), current: money(current), cumulative: money(previous + current),
      previous_progress:previousProgress, current_progress:currentProgress, cumulative_progress:cumulativeProgress,
      last_current: lastCurrent === null ? null : money(lastCurrent),
      geometric_quantity: geometric === null ? null : numeric(geometric),
      billed_quantity: billed === null ? null : numeric(billed),
      exact_amount: numeric(gross),
    },
  };
}

function calculateValuation(lines, baseline, profile, ledger, {recoverAdvance=false,correction=false} = {}) {
  const prior = new Map((baseline?.lines || []).map((line) => [line.identity, line]));
  const ordered = lines.filter((line) => !line.carried_forward);
  const active = new Set(ordered.map((line) => line.identity));
  for (const [identity, before] of prior) {
    if (!active.has(identity)) ordered.push({
      ...before, carried_forward: true,
    });
  }

  const calculated = ordered.map((line) => calculateLine(line, prior.get(line.identity), profile.settings,{correction}));
  const projectComplete=calculated.length>0&&calculated.every(({line})=>line.cumulative_progress!=null&&Number(line.cumulative_progress)>=100);
  const errors = calculated.flatMap(({errors: problems}) => problems);
  const groups = new Map();
  let previous = 0n, current = 0n, lastCurrent = 0n;
  for (const {line} of calculated) {
    const key = line.work_type || "";
    const group = groups.get(key) || {work_type: key, previous: 0n, current: 0n, last_current: 0n};
    const priorValue = BigInt(toMinor(line.previous) || 0);
    const movement = BigInt(toMinor(line.current) || 0);
    const last = BigInt(toMinor(line.last_current) || 0);
    previous += priorValue;
    current += movement;
    lastCurrent += last;
    group.previous += priorValue;
    group.current += movement;
    group.last_current += last;
    groups.set(key, group);
  }

  let net = current;
  const components = [];
  const recoveries = [];
  const holds=new Map((baseline?.totals?.holds||[]).map(hold=>[hold.key,hold])),processedHolds=new Set();
  for (const [ruleIndex,rule] of profile.rules.entries()) {
    if (!rule.enabled || (recoverAdvance&&rule.category!=="advance_recovery")) continue;
    const priorWork=recoverAdvance?BigInt(toMinor(baseline?.totals?.current)||0):0n;
    const recoveryCapacity=net+(recoverAdvance?BigInt(toMinor(baseline?.totals?.current_earned)||0):0n);
    if (rule.category==="advance_recovery"&&recoveryCapacity<=0n) continue;
    let base = rule.basis === "running" ? net : current+priorWork;
    const completedRelease=releaseCompletedWorks(rule,projectComplete);
    const eligibleWork=completedRelease?calculated.reduce((sum,{line})=>sum+(Number(line.cumulative_progress)>=100?0n:BigInt(toMinor(line.current)||0)),0n):current;
    if(completedRelease)base=rule.basis==='running'&&current!==0n?
      divide(base*eligibleWork*(current<0n?-1n:1n),current<0n?-current:current):eligibleWork;
    let value = rule.amount == null
      ? divide(multiply(base * (SCALE / 100n), decimal(rule.rate) ?? 0n), 100n)
      : completedRelease&&eligibleWork<=0n?0n:decimal(rule.amount) || 0n;
    let delta = moneyMinorBig(value);
    if (rule.cap != null) {
      const cap = BigInt(toMinor(rule.cap) || 0);
      if (delta > cap) delta = cap;
      if (delta < -cap) delta = -cap;
    }
    if (rule.category === "advance_recovery") {
      if (recoverAdvance) delta-=BigInt(toMinor(baseline?.totals?.advance_recovery)||0);
      let target = delta > recoveryCapacity ? recoveryCapacity : delta;
      delta = 0n;
      for (const advance of ledger.advances) {
        if (target <= 0n) break;
        const available = BigInt(Math.min(advance.outstanding_minor, advance.available_minor));
        const used = available < target ? available : target;
        if (used <= 0n) continue;
        recoveries.push({advance_id: advance.id, amount_minor: Number(used)});
        delta += used;
        target -= used;
        advance.outstanding_minor -= Number(used);
        advance.available_minor -= Number(used);
      }
    }
    let retained=null;
    if(isHold(rule)){
      const key=ruleKey(rule,ruleIndex),priorHold=holds.get(key);
      retained=applyHold({rule,index:ruleIndex,prior:priorHold,lines:calculated.map(item=>item.line),delta,minor:toMinor,money,round:divide,projectComplete});
      delta=retained.delta;holds.set(key,retained.hold);processedHolds.add(key);
      if(rule.category==='works_insurance'&&!rule.collection_date&&delta===0n&&retained.balance===0n)continue;
    }
    const movement = rule.sign === "addition" && rule.category !== "advance_recovery" ? delta : -delta;
    components.push({category: rule.category, label: rule.label, basis: rule.basis, base: money(base),
      amount: money(movement), rate: rule.rate, rule_version: profile.version,
      ...(retained?{rule_key:retained.hold.key,previous:-money(retained.previous),cumulative:-money(retained.balance)}:{})});
    net += movement;
  }
  if(!recoverAdvance)for(const [key,hold]of holds){
    if(processedHolds.has(key)||hold.category!=='works_insurance'||hold.collection_date)continue;
    const result=applyHold({rule:{...hold,key,amount:null},index:hold.rule_index,prior:hold,lines:calculated.map(item=>item.line),delta:0n,minor:toMinor,money,round:divide,projectComplete});
    holds.set(key,result.hold);
    if(result.delta!==0n){net-=result.delta;components.push({category:hold.category,label:hold.label,basis:'work',base:0,amount:-money(result.delta),
      previous:-money(result.previous),cumulative:-money(result.balance),rule_key:key,rule_version:profile.version});}
  }

  const previousNet = BigInt(toMinor(baseline?.totals?.cumulative_earned) || 0);
  const rawCollected = BigInt(ledger.ordinary_minor);
  const currentCollected = BigInt(ledger.period_ordinary_minor);
  const advanceRecovery = BigInt(recoveries.reduce((sum, row) => sum + row.amount_minor, 0));
  const previousRecovery = BigInt(toMinor(baseline?.totals?.cumulative_advance_recovery) || 0);
  const releasedRecovery = BigInt(ledger.released_recovery_minor || 0);
  const periodReleased = BigInt(ledger.period_released_recovery_minor || 0);
  const order = new Map((profile.settings.work_types || []).map((value, index) => [value, index]));
  const rankedGroups = [...groups.values()].sort((a, b) =>
    (order.get(a.work_type) ?? Infinity) - (order.get(b.work_type) ?? Infinity));
  return {
    lines: calculated.map(({line}) => line),
    errors,
    recoveries,
    totals: {
      previous: money(previous), current: money(current), cumulative: money(previous + current),
      last_current: baseline ? money(lastCurrent) : null,
      previous_earned: money(previousNet), current_earned: money(net),
      cumulative_earned: money(previousNet + net),
      current_payable: money(net - currentCollected + periodReleased),
      cumulative_payable: money(previousNet + net - rawCollected + releasedRecovery),
      ordinary_collections: money(rawCollected), current_collections: money(currentCollected),
      previous_collections: money(rawCollected-currentCollected),
      ...(ledger.advance_principal_minor ? {advance_receipts:money(ledger.advance_principal_minor)} : {}),
      advance_recovery: money(advanceRecovery), cumulative_advance_recovery: money(previousRecovery + advanceRecovery),
      ...(ledger.advances.length ? {advance_remaining:money(ledger.advances.reduce((sum,advance) =>
        sum + Math.min(advance.outstanding_minor,advance.available_minor),0))} : {}),
      reversed_advance_recovery: money(releasedRecovery), current_reversed_advance_recovery: money(periodReleased), components,
      holds:[...holds.values()],
      groups: rankedGroups.map((group) => ({
        work_type: group.work_type, previous: money(group.previous), current: money(group.current),
        cumulative: money(group.previous + group.current), last_current: baseline ? money(group.last_current) : null,
      })),
    },
  };
}

module.exports = {calculateValuation, progressAtAmount, MODES, decimal, toMinor, money};
