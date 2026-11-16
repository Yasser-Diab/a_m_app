const {lookup, parse} = require("./certificate-access.cjs");
const {allocationLedger} = require("./certificate-ledger.cjs");
const {customerReceipts} = require("./commercial-ledger.cjs");
const {getProfile, getProject, getCustomer, projectLocations} = require("./certificate-projects.cjs");
const {money, toMinor} = require("./certificate-valuation.cjs");
const {certificateLocationFields} = require("./document-locations.cjs");

function legacySnapshot(database, row, useEdits = false) {
  const source = parse(row.snapshot_json);
  const workflow = database.get("SELECT edited_json,approved_at FROM cert_legacy_workflow WHERE revision_id=?", [row.id]);
  const edited = workflow?.edited_json && (useEdits || workflow.approved_at) ? parse(workflow.edited_json) : null;
  return {...source, ...edited, approval_at:workflow?.approved_at ?? null};
}

function legacyLines(snapshot, locations) {
  return snapshot.lines.map((line) => {
    const progress = line.progress === "" || line.progress == null ? 100 : Number(line.progress);
    const location = locations.get(lookup(line.location));
    return {
      ...line,
      progress: !Number.isFinite(progress) ? 100 : !snapshot.edited && progress >= 0 && progress <= 1 ? progress * 100 : progress,
      location_id:line.location_id ?? location?.id ?? null,
      dimension_unit:line.dimension_unit || (["area","linear"].includes(line.mode) ? "cm" : ""),
      agreed_amount:line.agreed_amount ?? (line.mode === "lump" ? money(toMinor(Number(line.quantity || 1) * Number(line.rate || 0))) : null),
    };
  });
}

const workKey = (line) => JSON.stringify([
  ...Object.values(certificateLocationFields(line)).map(lookup), lookup(line.work_type), lookup(line.work_item), lookup(line.description),
  lookup(line.unit), Number(line.rate ?? line.agreed_amount ?? 0), Number(line.billed_quantity ?? line.quantity ?? 0),
]);

function legacyCertificateInput(database, row, {useEdits = true} = {}) {
  const frozen = database.get("SELECT approved_json FROM cert_legacy_workflow WHERE revision_id=?", [row.id])?.approved_json;
  if (frozen) return parse(frozen);
  const snapshot = legacySnapshot(database, row, useEdits);
  const {header} = snapshot;
  const project = getProject(database, row.project_id);
  const customer = getCustomer(database, project.customer_id);
  const locations = new Map(projectLocations(database, project.id).map((location) => [lookup(location.name),location]));
  const current = legacyLines(snapshot, locations);
  const number = Number(row.legacy_number);
  const numbered = /^\d+$/.test(row.legacy_number || "");
  const previous = database.all(`SELECT * FROM cert_revisions WHERE project_id=? AND series_key=? AND status='historical' AND id<>?
    ORDER BY work_to,id`,[row.project_id,row.series_key,row.id]).filter((candidate) =>
    numbered && /^\d+$/.test(candidate.legacy_number || "") ? Number(candidate.legacy_number) < number :
      candidate.work_to < row.work_to || (candidate.work_to === row.work_to && candidate.id < row.id));
  const latest = previous.reduce((best, candidate) => !best || (numbered ?
    Number(candidate.legacy_number) > Number(best.legacy_number) : candidate.work_to >= best.work_to) ? candidate : best, null);
  const prior = new Map();
  const comparable = Boolean(latest);
  for (const period of previous) {
    for (const line of legacyLines(legacySnapshot(database, period), locations)) {
      const key = workKey(line);
      if (!prior.has(key)) prior.set(key,{...line, previous:0, previous_progress:0, last_current:0});
      const record = prior.get(key);
      record.previous = money((toMinor(record.previous) || 0) + (toMinor(line.current) || 0));
      record.previous_progress += line.progress;
      if (period.id === latest?.id) record.last_current = money((toMinor(record.last_current) || 0) + (toMinor(line.current) || 0));
    }
  }
  const lines = current.map((line) => {
    const key = workKey(line);
    const before = prior.get(key);
    prior.delete(key);
    return {...line, previous:before?.previous ?? 0, previous_progress:before?.previous_progress ?? 0,
      last_current:comparable ? before?.last_current ?? 0 : null, current_progress:line.progress,
      cumulative_progress:(before?.previous_progress ?? 0) + line.progress,
      cumulative:money((toMinor(before?.previous) || 0) + (toMinor(line.current) || 0))};
  });
  for (const before of prior.values()) lines.push({...before, carried_forward:true,
    progress:0, current_progress:0, cumulative_progress:before.previous_progress, current:0, cumulative:before.previous});
  const rollup = (key) => money(lines.reduce((sum,line) => sum + (toMinor(line[key]) || 0),0));
  const previousWork = rollup("previous");
  const currentWork = rollup("current");
  const totals = {...snapshot.totals, previous:previousWork,current:currentWork,cumulative:rollup("cumulative"),
    last_current:comparable ? rollup("last_current") : null};
  const groups = new Map();
  for (const line of lines) {
    const key = line.work_type || "";
    if (!groups.has(key)) groups.set(key,{work_type:key,previous:0,current:0,cumulative:0,last_current:0});
    const group = groups.get(key);
    for (const field of ["previous","current","cumulative","last_current"])
      group[field] += toMinor(line[field]) || 0;
  }
  totals.groups = [...groups.values()].map(({work_type,...values}) => ({work_type,
    ...Object.fromEntries(Object.entries(values).map(([key,value]) => [key,money(value)]))}));
  const cutoff = header.collection_cutoff || header.work_to;
  if (!cutoff) return {...snapshot,project,customer,lines,totals,legacy:true};

  const linkedNumber = (payment) => /^\d+$/.test(payment.certificate_number ?? "") ? Number(payment.certificate_number) : null;
  const {imported} = customerReceipts(database, project);
  const applicable = (payment) => !numbered || linkedNumber(payment) == null || linkedNumber(payment) <= number;
  const related = imported.filter((payment) => numbered && linkedNumber(payment) != null && applicable(payment));
  const effectiveCutoff = header.collection_cutoff ? cutoff :
    related.reduce((max,payment) => payment.received_at > max ? payment.received_at : max,cutoff);
  const previousCutoff = latest ? legacySnapshot(database,latest).header.work_to : null;
  const previousEffectiveCutoff = previousCutoff && (!header.collection_cutoff ?
    related.filter((payment) => linkedNumber(payment) < number).reduce((max,payment) => payment.received_at > max ? payment.received_at : max,previousCutoff) :
    (previousCutoff < cutoff ? previousCutoff : cutoff));
  const profile = getProfile(database,project.id,cutoff);
  const ledger = allocationLedger(database,project.id,profile,effectiveCutoff,{
    workCutoff:header.work_to,includeImported:applicable,
    includeReceipt:(payment) => payment.source === "historical" && linkedNumber(payment) != null || payment.received_at <= cutoff,
  });
  const preceding = previousEffectiveCutoff && allocationLedger(database,project.id,profile,previousEffectiveCutoff,{
    workCutoff:latest.work_to,
    includeImported:(payment) => !numbered || linkedNumber(payment) == null || linkedNumber(payment) < number,
    includeReceipt:(payment) => payment.source === "historical" && linkedNumber(payment) != null || payment.received_at <= previousCutoff,
  });
  const ordinaryBefore = preceding?.ordinary_minor || 0;
  const advanceBefore = preceding?.advance_principal_minor || 0;
  const advance = ledger.advance_principal_minor;
  const collected = ledger.ordinary_minor;
  Object.assign(totals,{
    previous_earned:money((toMinor(previousWork) || 0) - advanceBefore),
    current_earned:money((toMinor(currentWork) || 0) - (advance - advanceBefore)),
    cumulative_earned:money((toMinor(totals.cumulative) || 0) - advance),
    previous_collections:money(ordinaryBefore),current_collections:money(collected-ordinaryBefore),ordinary_collections:money(collected),
    previous_advance_receipts:money(advanceBefore),current_advance_receipts:money(advance-advanceBefore),advance_receipts:money(advance),
    current_payable:money((toMinor(currentWork) || 0) - (advance-advanceBefore) - (collected-ordinaryBefore)),
    cumulative_payable:money((toMinor(totals.cumulative) || 0) - advance - collected),
  });
  const receipts = ledger.entries.filter((entry) => ledger.recognizedAmounts.has(entry.id)).map((entry) => ({
    id:entry.id, kind:entry.kind, received_at:entry.received_at, status:entry.status,
    amount:money(ledger.recognizedAmounts.get(entry.id)), method:entry.method, reference:entry.reference,
  }));
  return {...snapshot, project, customer, header:{...header, collection_cutoff:effectiveCutoff},
    status:snapshot.approval_at ? "approved" : "unapproved", legacy:true, lines, totals, receipts,
    rule_settings:profile.settings, baseline:latest ? {id:latest.id, official_number:latest.legacy_number, work_to:latest.work_to} : null};
}

module.exports = {legacySnapshot, legacyLines, legacyCertificateInput};
