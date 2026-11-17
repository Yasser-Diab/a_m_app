const {parse,fail,today,idOf,lookup} = require("../certificate-access.cjs");
const {calculateItem} = require("../calculations.cjs");
const {STATUS,unitLabel} = require("../domain.cjs");
const {getProject} = require("../certificate-projects.cjs");
const {getChange,record} = require("./core.cjs");

function isAdjustment(db,documentId) {
  return Boolean(documentId && db.get("SELECT 1 FROM ops_changes WHERE adjustment_id=?",[documentId]));
}

function waitingForEarlierAdjustment(db,change) {
  return Boolean(db.get(`SELECT 1 FROM ops_changes c LEFT JOIN documents d ON d.id=c.adjustment_id
    WHERE c.item_id=? AND c.id<? AND c.status='approved' AND (d.id IS NULL OR d.status<>'approved')`,
  [change.item_id,change.id]));
}

function prepareAdjustment(db,state,change,user,allocate) {
  if (change.status!=="approved") fail(409,"Approve the operational change before creating an adjustment");
  if (change.adjustment_id) return status(db,change.adjustment_id);
  if (waitingForEarlierAdjustment(db,change)) fail(409,"Post the previous approved adjustment for this item first");
  const source=db.get("SELECT * FROM documents WHERE id=? AND deleted_at IS NULL AND status='approved'",[change.source_document_id||state.boq_id]);
  if (!source) fail(409,"The source invoice must remain approved and available");
  const project=getProject(db,state.project_id);
  const {number,reference}=allocate();
  const original=parse(db.get("SELECT original FROM ops_items WHERE id=?",[change.item_id]).original)?.line;
  const language=source.report_language==="ar"?"ar":"en";
  const ar=language==="ar";
  const title=(ar?"تسوية معتمدة ":"Invoice adjustment ") + source.operation_no+" / "+change.code;
  const ref=(ar?"مستند المصدر ":"Source document ")+source.operation_no+" · "+(ar?"مراجعة ":"Revision ")+change.id;
  const documentId=db.run(`INSERT INTO documents(document_type,document_no,operation_no,status,party_id,party_role,party_category,
    customer_name,search_party_name,project,title,entry_date,discount_type,discount_value,notes,report_language)
    VALUES ('invoice',?,?,'draft',?,'customer',?,?,?,?,?,?,?,?,?,?)`,
  [number,reference,project.customer_id,source.party_category,source.customer_name,source.search_party_name,project.name,title,today(),
    source.discount_type==="rate"?"rate":"none",source.discount_type==="rate"?source.discount_value:0,ref,language]).lastInsertRowid;
  const flags=["vat_enabled","vat_terms_only","social_insurance_enabled","stamp_enabled","works_insurance_enabled",
    "final_insurance_enabled","contractor_tax_enabled"];
  const completion=Number(original?.completion_ratio)||100;
  function addLine(values,sign) {
    if (!values || values.removed) return;
    const rate=Number(values.rate)||0;
    const quantity=Number(values.quantity)||0;
    const originalValue=sign===-1 && change.base_version===0 && original ? original.gross_total : undefined;
    const dimensions=[values.width_mm,values.height_mm,values.depth_mm].filter((value)=>value!=null);
    const dimensionsText=dimensions.length ? " · "+(ar?"الأبعاد (مم) ":"Dimensions (mm) ")+dimensions.join(" × ") : "";
    const description=(sign<0 ? ar?"عكس البند السابق · ":"Reverse prior line · " : ar?"البند المعدل · ":"Revised line · ") + values.description + dimensionsText;
    const input={description,unit_code:values.unit_code || values.unit,total_quantity:quantity,rate,item_count:quantity,
      building_unit_price:originalValue ?? quantity*rate,ops_adjustment_sign:sign,completion_ratio:completion,
      ...Object.fromEntries(flags.map((flag)=>[flag,Number(original?.[flag]||0)]))};
    const result=calculateItem(input);
    const row={...input,...result,unit:unitLabel(result.unit_code),accounting_status:STATUS.INVOICE,document_status:"draft",document_id:documentId,
      serial:number,operation_no:reference,party_id:project.customer_id,party_role:"customer",party_category:source.party_category,
      project:project.name,customer_name:source.customer_name,customer_display_name:source.customer_name,
      search_party_name:source.search_party_name,entry_date:today(),glass_spec:values.glass,profile_spec:values.profile,color:values.finish,
      work_type:original?.work_type || change.code,notes:ref,created_by:user.display_name};
    const columns=Object.keys(row);
    db.run(`INSERT INTO work_items(${columns.join(",")}) VALUES (${columns.map(()=>"?").join(",")})`,Object.values(row));
  }
  addLine(change.prior,-1);
  addLine(change.proposed,1);
  if (!db.get("SELECT 1 FROM work_items WHERE document_id=?",[documentId])) fail(400,"There are no adjustment lines for this revision");
  db.run("UPDATE ops_changes SET adjustment_id=? WHERE id=?",[documentId,change.id]);
  record(db,user,state.project_id,"invoice_adjustment_prepared",change.id,{source_id:source.id,adjustment_id:documentId});
  return status(db,documentId);
}

function status(db,id) {
  const row=db.get("SELECT id,operation_no,status,title,notes FROM documents WHERE id=?",[id]);
  const raw=db.get(`SELECT SUM(net_total * CASE WHEN COALESCE(completion_ratio,0)<=0 THEN 1
    WHEN completion_ratio<=1 THEN completion_ratio ELSE completion_ratio/100.0 END) AS total
    FROM work_items WHERE document_id=? AND deleted_at IS NULL`,[id]);
  const amount=db.get("SELECT discount_type,discount_value FROM documents WHERE id=?",[id]);
  const total=Number(raw?.total)||0;
  return {...row,total:Number((total*(amount.discount_type==="rate"?1-Number(amount.discount_value||0)/100:1)).toFixed(2))};
}

function postAdjustment(db,state,change,user) {
  if (!change.adjustment_id || change.status!=="approved") fail(409,"Prepare and review the adjustment first");
  const adjustment=status(db,change.adjustment_id);
  if (adjustment.status==="approved") return adjustment;
  if (adjustment.status!=="draft") fail(409,"This adjustment is unavailable for approval");
  db.run("UPDATE documents SET status='approved',updated_at=CURRENT_TIMESTAMP WHERE id=?",[adjustment.id]);
  db.run("UPDATE work_items SET document_status='approved',updated_at=CURRENT_TIMESTAMP WHERE document_id=?",[adjustment.id]);
  record(db,user,state.project_id,"invoice_adjustment_posted",change.id,{adjustment_id:adjustment.id,total:adjustment.total});
  return status(db,adjustment.id);
}

const unitKey=(value)=>{
  const key=lookup(value);
  if (/^(عدد|قطعه|pcs|pc|ea|each|count|panel|panels|لوح)$/.test(key)) return "count";
  if (/^(m²|m2|م²|م2|sqm|متر مربع)$/.test(key)) return "sqm";
  if (/^(lm|l m|م ط|متر طولي)$/.test(key)) return "lm";
  return key;
};

function approvedClaims(db,projectId,excludeId,cutoff) {
  const records=db.all(`SELECT r.id,r.revises_id,r.status,r.type,r.snapshot_json
    FROM cert_revisions r WHERE r.project_id=? AND r.id IS NOT ? AND r.status IN ('issued','approved')
    AND (? IS NULL OR r.work_to<=?) ORDER BY r.work_to,r.id`,[projectId,excludeId,cutoff,cutoff]);
  const replaced=new Set(records.filter((row)=>row.revises_id).map((row)=>row.revises_id));
  const result=new Map();
  for (const row of records) {
    if (replaced.has(row.id) || row.type==="void") continue;
    const lines=parse(row.snapshot_json)?.lines || db.all("SELECT data_json FROM cert_lines WHERE revision_id=?",[row.id]).map(({data_json})=>parse(data_json));
    for (const line of lines) {
      if (!line.ops_item_id || line.carried_forward) continue;
      const amount=Number(line.billed_quantity ?? line.quantity);
      if (!Number.isFinite(amount) || amount<=0) continue;
      const key=line.ops_item_id+":"+unitKey(line.unit);
      const previous=result.get(key)||0;
      result.set(key,line.recognition==="cumulative"?Math.max(previous,amount):previous+amount);
    }
  }
  return result;
}

function reconcile(db,projectId,{lines=[],revisionId=null,cutoff=null}={}) {
  if (!db.get("SELECT 1 FROM ops_projects WHERE project_id=?",[projectId])) return [];
  const items=db.all("SELECT id,code,commercial FROM ops_items WHERE active=1 AND project_id=? ORDER BY id",[projectId]);
  const loaded=new Map(db.all(`SELECT oi.item_id,SUM(ll.quantity) AS amount,
    SUM(CASE WHEN oi.quantity=(SELECT SUM(value) FROM json_each(oi.quantities) WHERE key NOT IN ('frames','screens')) THEN ll.quantity ELSE 0 END) AS comparable_amount
    FROM ops_load_lines ll
    JOIN ops_order_items oi ON oi.id=ll.order_item_id JOIN ops_orders o ON o.id=oi.order_id JOIN ops_loads b ON b.id=ll.load_id
    WHERE o.project_id=? AND ll.kind NOT IN ('frames','screens') AND (? IS NULL OR b.loading_date<=?) GROUP BY oi.item_id`,[projectId,cutoff,cutoff])
    .map((row)=>[row.item_id,row]));
  const confirmations=db.all(`SELECT c.item_id,c.stage,c.unit,SUM(c.quantity) AS amount FROM ops_confirmations c
    JOIN ops_items i ON i.id=c.item_id WHERE i.project_id=? AND (? IS NULL OR c.confirmed_on<=?)
    GROUP BY c.item_id,c.stage,c.unit`,[projectId,cutoff,cutoff]);
  const claims=approvedClaims(db,projectId,revisionId,cutoff);
  return items.flatMap((item)=>{
    const commercial=parse(item.commercial);
    const unit=commercial.unit;
    const matchedUnit=unitKey(unit);
    const previous=claims.get(item.id+":"+matchedUnit)||0;
    const sameItem=lines.filter((row)=>idOf(row.ops_item_id)===item.id && !row.carried_forward);
    const matching=sameItem.filter((row)=>unitKey(row.unit)===matchedUnit);
    const requested=matching.reduce((a,row)=>a+(Number(row.billed_quantity ?? row.quantity)||0),0);
    const cumulative=matching.length && matching.every((row)=>row.recognition==="cumulative");
    const additional=cumulative?Math.max(0,requested-previous):requested;
    const loading=loaded.get(item.id);
    const countLoaded=loading?.amount||0;
    const contractConfirmed=confirmations.filter((row)=>row.item_id===item.id && unitKey(row.unit)===matchedUnit);
    const installed=contractConfirmed.filter(({stage})=>stage==="installed").reduce((sum,row)=>sum+row.amount,0);
    const claimable=contractConfirmed.filter(({stage})=>stage==="claimable").reduce((sum,row)=>sum+row.amount,0);
    const actual=contractConfirmed.some(({stage})=>stage==="claimable")?claimable:installed;
    const countUnit=matchedUnit==="count";
    const directlyComparable=countUnit && loading?.amount===loading?.comparable_amount;
    const delta=actual-previous-additional;
    const unclaimed=Math.max(0,actual-previous);
    const operationalExcess=directlyComparable && countLoaded ? Math.max(0,previous+additional-countLoaded):null;
    const warning={
      excess:additional?Math.max(0,-delta):0,
      duplicate:previous>0 && cumulative && requested<=previous ? requested :
        previous>0 && additional>0 ? Math.max(0,Math.min(previous,additional,previous+additional-actual)) : 0,
      loaded_unclaimed:directlyComparable ? Math.max(0,countLoaded-previous-additional):null,
      incomplete:matching.length>0 && additional>0 && actual===0,
      unit_mismatch:sameItem.length>matching.length,
      loading_excess:operationalExcess,
    };
    return [{id:item.id,code:item.code,description:commercial.description,unit,loaded:countLoaded,installed,claimable,confirmed:actual,
      previous,current:requested,unclaimed,warning}];
  });
}

module.exports = {isAdjustment,prepareAdjustment,postAdjustment,status,reconcile,waitingForEarlierAdjustment};
