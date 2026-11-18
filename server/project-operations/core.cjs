const {accessFor, scopeSql, inScope, encode, parse, fail, str, idOf, date, lookup} = require("../certificate-access.cjs");
const {getProject, getCustomer, createProject, projectLookupKeys} = require("../certificate-projects.cjs");
const {configuration,cleanTechnical,categories,estimatedArea,dimensions,number} = require("./specifications.cjs");
const {awardReference}=require("./references.cjs");

function authorizeOperations(db, req, capability = "ops_view", projectId = null) {
  const access = accessFor(db,req);
  if (!access.capabilities.includes("ops_view") || !access.capabilities.includes(capability))
    fail(403,"Project Operations permission is required");
  if (projectId !== null && (!projectId || !inScope(access,projectId))) fail(404,"Project not found");
  return access;
}

function record(db,user,projectId,action,id,details=null) {
  db.run("INSERT INTO ops_audit(project_id,actor_id,actor_name,action,entity_id,details) VALUES (?,?,?,?,?,?)",
    [projectId,user.id,user.display_name || user.username,action,id,details===null?null:encode(details)]);
}

function pageOptions(query) {
  const page = Math.max(1, Math.min(1e7,Math.trunc(Number(query.page)||1)));
  return {page,limit:50,offset:(page-1)*50};
}

function sourceProjects(db,documentId=null,customerId=null) {
  return db.all(`SELECT DISTINCT d.id,d.document_no,d.operation_no,d.document_type,d.status,d.title,
      party.id AS customer_id,party.display_name AS customer,TRIM(COALESCE(NULLIF(TRIM(wi.project),''),d.project)) AS name
    FROM documents d LEFT JOIN work_items wi ON wi.document_id=d.id AND wi.deleted_at IS NULL
      AND COALESCE(wi.collection_amount,0)=0
    JOIN parties party ON party.id=COALESCE(d.party_id,wi.party_id) AND party.role='customer'
    WHERE d.deleted_at IS NULL AND d.document_type IN ('price_offer','invoice') AND (? IS NULL OR d.id=?)
      AND (? IS NULL OR party.id=?)
      AND TRIM(COALESCE(NULLIF(TRIM(wi.project),''),d.project,''))<>''
      AND NOT EXISTS(SELECT 1 FROM ops_changes oc WHERE oc.adjustment_id=d.id)
    ORDER BY d.entry_date DESC,d.id DESC`,[documentId,documentId,customerId,customerId]);
}

function projectChoices(db,access,query) {
  const scope=scopeSql(access,"cp.id");
  const {page,limit,offset}=pageOptions(query);
  const typed=str(query.q,160);
  const key=lookup(typed);
  const numeric=key.replace(/^0+(?=\d)/,"");
  const numberSearch=/^\d+$/.test(numeric);
  const choices=db.all(`SELECT cp.id,cp.name,cp.alternate_name,cp.code,cp.created_at,cp.customer_id, p.display_name AS customer,
    json_extract(cp.raw_json,'$.name_history') AS name_history, op.boq_id IS NOT NULL AS configured,
    op.award_reference FROM cert_projects cp JOIN parties p ON p.id=cp.customer_id
    LEFT JOIN ops_projects op ON op.project_id=cp.id WHERE ${scope.clause}`,scope.params);
  const matchesByName=new Map();
  for (const choice of choices) {
    choice.sources=[];
    for (const name of projectLookupKeys(choice)) {
      const mapKey=choice.customer_id+":"+name;
      const projects=matchesByName.get(mapKey)||[];
      projects.push(choice);
      matchesByName.set(mapKey,projects);
    }
  }
  for (const source of sourceProjects(db)) {
    const mapKey=source.customer_id+":"+lookup(source.name);
    let matches=matchesByName.get(mapKey);
    if (!matches && access.all_projects && access.capabilities.includes("ops_edit")) {
      const discovered={id:null,key:mapKey,name:source.name,customer:source.customer,configured:false,sources:[]};
      choices.push(discovered);
      matches=[discovered];
      matchesByName.set(mapKey,matches);
    }
    for (const result of matches||[]) {
      if (!result.sources.some(({id})=>id===source.id)) result.sources.push(source);
    }
  }
  const found=choices.flatMap((choice)=>{
    const {sources,...entry}=choice;
    const documentMatch=numberSearch? sources.find((doc)=>[doc.operation_no,doc.document_no]
      .some((number)=>lookup(number).replace(/^0+(?=\d)/,"")===numeric)):
      (key?sources.find((doc)=>lookup(doc.operation_no).includes(key)):null);
    const nameMatch=!key||[choice.customer,choice.award_reference,...projectLookupKeys(choice)].some((value)=>lookup(value).includes(key));
    if (!nameMatch&&!documentMatch) return [];
    return [{...entry,matched_document:documentMatch||null,source_document:documentMatch||sources.find(({status})=>status==="approved")||sources[0],
      has_approved_source:sources.some(({status})=>status==="approved")}];
  }).sort((a,b)=>Number(Boolean(b.matched_document))-Number(Boolean(a.matched_document))||
    String(b.created_at||"").localeCompare(String(a.created_at||""))||Number(b.id||0)-Number(a.id||0));
  return {items:found.slice(offset,offset+limit),total:found.length,page,limit};
}

function resolveProject(db,access,body) {
  if (!access.all_projects) fail(403,"Company-wide project permission is required");
  const source=sourceProjects(db,idOf(body.document_id)||-1).find((row)=>lookup(row.name)===lookup(body.project));
  if (!source) fail(404,"The invoice or quotation project could not be found");
  const existing=db.all(`SELECT id,name,alternate_name,code,json_extract(raw_json,'$.name_history') AS name_history
    FROM cert_projects WHERE customer_id=?`,[source.customer_id]).filter((project)=>projectLookupKeys(project).has(lookup(source.name)));
  if (existing.length>1) fail(409,"More than one project uses this name. Search by its project code.");
  return existing[0]||createProject(db,{customer_id:source.customer_id,name:source.name,raw:{host_seeded:true}},access.user.id);
}

function operation(db,id) {
  const row=db.get("SELECT * FROM ops_projects WHERE project_id=?",[id]);
  if (!row) fail(404,"Set up operations for this project first");
  return {...row,details:parse(row.details,{}),boq_snapshot:parse(row.boq_snapshot)};
}

function eligibleBoqs(db, project) {
  const keys=projectLookupKeys(project);
  const matches=sourceProjects(db,null,project.customer_id).filter((source)=>source.status==="approved" && keys.has(lookup(source.name)));
  return [...new Map(matches.map((source)=>[source.id,{...source,approval_date:
    db.get("SELECT approved_on FROM ops_source_approvals WHERE document_id=?",[source.id])?.approved_on}])).values()];
}

const detailText = ["owner","main_contractor","consultant","location","address","building","contract_ref","quotation_ref",
  "finishing","drawing_ref","drawing_revision","status","notes","site_phone","approval_party"];
function projectDetails(input) {
  const result=Object.fromEntries(detailText.map((key)=>[key,str(input[key],2000)]));
  result.start_date=date(input.start_date,true);
  result.delivery_date=date(input.delivery_date,true);
  result.report_signatures=cleanReportSignatures(input.report_signatures);
  if (result.start_date && result.delivery_date && result.delivery_date < result.start_date) fail(400,"Delivery date precedes the start date");
  return result;
}

function cleanReportSignatures(input={}) {
  return Object.fromEntries(["manufacturing","loading","maintenance"].filter(kind=>Array.isArray(input?.[kind])).map(kind=>[kind,
    input[kind].map(value=>{const person=value&&typeof value==="object"?value:{};return {name:str(person.name,200),title:str(person.title,200),company:str(person.company,200),
      side:person.side==="client"?"client":"company"};}).filter(person=>person.name||person.title)]));
}

function saveReportSignatures(db,state,body,user) {
  if(Number(body.version)!==state.version) fail(409,"Reload the project before saving signatures");
  const kind=str(body.kind);
  if(!["manufacturing","loading","maintenance"].includes(kind)||!Array.isArray(body.signatures)) fail(400,"Choose a report and its signatures");
  const report_signatures={...state.details.report_signatures,...cleanReportSignatures({[kind]:body.signatures})};
  const details={...state.details,report_signatures};
  db.run("UPDATE ops_projects SET details=?,version=version+1 WHERE project_id=?",[encode(details),state.project_id]);
  record(db,user,state.project_id,"report_signatures_updated",state.project_id,{kind,before:state.details.report_signatures?.[kind],after:report_signatures[kind]});
  return operation(db,state.project_id);
}

function itemValues(row) {
  return {
    description:row.description || row.statement_text || "",
    unit:row.unit || row.unit_code || "",
    unit_code:row.unit_code,
    quantity:row.quantity,
    rate:row.rate,
    width_mm:row.width_cm==null?null:Number(row.width_cm)*10,
    height_mm:row.height_cm==null?null:Number(row.height_cm)*10,
    depth_mm:null,
    profile:row.profile_spec,
    glass:row.glass_spec,
    finish:row.color,
    original_value:row.gross_total,
    removed:false,
  };
}

const openingFields=new Set(["building","floor","room","tag","drawing_ref","quantity","width_mm","height_mm","depth_mm",
  "site_notes","workshop_notes","measurement_status","material_status","manufacturing_status","priority","required_date","responsible","subframe"]);
const descriptionKey=(description)=>String(description||"");

function reusableTechnical(technical) {
  const result=Object.fromEntries(Object.entries(technical).filter(([key])=>!openingFields.has(key)));
  if (result.integrated?.spec) result.integrated={...result.integrated,spec:reusableTechnical(result.integrated.spec)};
  return result;
}

function rememberSpecification(db,customerId,item) {
  const description=descriptionKey(item.commercial.description);
  if (!description.trim() || !item.system) return false;
  db.run(`INSERT INTO ops_customer_specs(customer_id,description,category,system,technical) VALUES (?,?,?,?,?)
    ON CONFLICT(customer_id,description) DO UPDATE SET category=excluded.category,system=excluded.system,technical=excluded.technical`,
  [customerId,description,item.category,item.system,encode(reusableTechnical(item.technical))]);
  return true;
}

function setup(db,project,boqId,user,reviewDate) {
  if (db.get("SELECT 1 FROM ops_project_boqs WHERE project_id=? AND document_id=?",[project.id,boqId]))
    return operation(db,project.id);
  const boq=eligibleBoqs(db,project).find(({id})=>id===boqId);
  if (!boq) fail(400,"Select an existing approved BOQ for this project");
  if (reviewDate && !boq.approval_date) boq.approval_date=date(reviewDate);
  const keys=projectLookupKeys(project);
  const rows=db.all(`SELECT wi.*,COALESCE(NULLIF(wi.project,''),d.project) AS effective_project
    FROM work_items wi JOIN documents d ON d.id=wi.document_id WHERE wi.document_id=? AND wi.deleted_at IS NULL
      AND COALESCE(wi.collection_amount,0)=0 AND COALESCE(d.party_id,wi.party_id)=? ORDER BY wi.id`,
    [boq.id,project.customer_id]).filter((row)=>keys.has(lookup(row.effective_project)));
  if (!rows.length) fail(400,"The approved BOQ contains no work lines for this project");
  if (db.get(`SELECT 1 FROM ops_items WHERE project_id<>? AND source_line_id IN (
    SELECT value FROM json_each(?))`,[project.id,encode(rows.map(({id})=>id))]))
    fail(409,"Some BOQ lines already belong to another project. Check the project code and BOQ.");
  if (!db.get("SELECT 1 FROM ops_projects WHERE project_id=?",[project.id]))
    db.run("INSERT INTO ops_projects(project_id,boq_id,boq_snapshot,created_by,award_reference) VALUES (?,?,?,?,?)",
      [project.id,boq.id,encode(boq),user.id,awardReference(db,project)]);
  db.run("INSERT INTO ops_project_boqs(project_id,document_id,snapshot) VALUES (?,?,?)",[project.id,boq.id,encode(boq)]);
  const defaults=new Map(db.all("SELECT * FROM ops_customer_specs WHERE customer_id=?",[project.customer_id])
    .map((entry)=>[entry.description,entry]));
  const insert=db.db.prepare(`INSERT INTO ops_items(project_id,source_line_id,code,original,commercial,technical,category,system,source_document_id,defaults_applied)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  let filled=0;
  try {
    for (const row of rows) {
      const values=itemValues(row);
      const saved=defaults.get(descriptionKey(values.description));
      const standard=parse(saved?.technical,{});
      const technical={...standard,building:row.building_unit || "",room:row.floor_apartment || "",
        profile:row.profile_spec || standard.profile || "",infill:row.glass_spec || standard.infill || "",
        color:row.color || standard.color || "",width_mm:values.width_mm,height_mm:values.height_mm,
        quantity:Number.isInteger(row.item_count) && row.item_count>0 ? row.item_count : null};
      if (saved) filled++;
      insert.run([project.id,row.id,"BOQ-"+row.id,encode({values,line:row}),encode(values),encode(technical),
        saved?.category||"",saved?.system||"",boq.id,saved?1:0]);
    }
  } finally { insert.free(); }
  record(db,user,project.id,"boq_imported",boq.id,{count:rows.length,defaults_applied:filled,reference:boq.operation_no});
  return operation(db,project.id);
}

function changeProjectDetails(db,state,body,user) {
  if (Number(body.version)!==state.version) fail(409,"Reload the project before saving");
  const details=projectDetails({...body.details,report_signatures:body.details?.report_signatures??state.details.report_signatures});
  db.run("UPDATE ops_projects SET details=?,version=version+1 WHERE project_id=?",[encode(details),state.project_id]);
  record(db,user,state.project_id,"project_updated",state.project_id,{before:state.details,after:details});
  return operation(db,state.project_id);
}

function hydrateItem(row) {
  const commercial=parse(row.commercial,{});
  const technical=parse(row.technical,{});
  return {...row,commercial,technical,original:parse(row.original)?.values || null,
    estimated_area:estimatedArea(technical),manufacturing_dimensions:dimensions(technical)};
}

function getItem(db,projectId,id) {
  const item=db.get("SELECT * FROM ops_items WHERE project_id=? AND id=?",[projectId,id]);
  if (!item) fail(404,"Operational item not found");
  return hydrateItem(item);
}

function itemPage(db,projectId,query) {
  const {page,limit,offset}=pageOptions(query);
  const typed="%"+str(query.q,120)+"%";
  const category=str(query.category);
  const source=idOf(query.boq_id);
  const args=[projectId,source,source,category,category,typed,typed,typed];
  const where=`WHERE project_id=? AND (? IS NULL OR source_document_id=?) AND (?='' OR category=?) AND
    (code LIKE ? OR json_extract(commercial,'$.description') LIKE ? OR json_extract(technical,'$.tag') LIKE ?)`;
  const items=db.all(`SELECT * FROM ops_items ${where} ORDER BY id LIMIT ? OFFSET ?`,[...args,limit,offset]).map(hydrateItem);
  return {items,total:db.get(`SELECT COUNT(*) AS n FROM ops_items ${where}`,args).n,page,limit};
}

function specificationGroups(db,projectId,query) {
  const source=idOf(query.boq_id);
  if (!db.get("SELECT 1 FROM ops_project_boqs WHERE project_id=? AND document_id=?",[projectId,source]))
    fail(404,"The BOQ is not linked to this project");
  const description="COALESCE(json_extract(commercial,'$.description'),'')";
  const itemId=idOf(query.item_id);
  if (!itemId) {
    return db.all(`SELECT MIN(id) AS id,${description} AS description,COUNT(*) AS count
      FROM ops_items WHERE project_id=? AND source_document_id=? AND active=1
      GROUP BY ${description},CASE WHEN TRIM(${description})='' THEN id END ORDER BY MIN(id)`,[projectId,source]);
  }
  const item=getItem(db,projectId,itemId);
  if (!item.active||item.source_document_id!==source) fail(404,"The item is not in this BOQ");
  const match=descriptionKey(item.commercial.description);
  const rows=match.trim()?db.all(`SELECT id,code,category,system,version,technical,defaults_applied
    FROM ops_items WHERE project_id=? AND source_document_id=? AND active=1 AND ${description}=? ORDER BY id`,
  [projectId,source,match]).map((row)=>({...row,technical:parse(row.technical,{})})): [item];
  return {description:match,rows};
}

function valuesEqual(left,right) {
  if (left==null||left==="") return right==null||right==="";
  if (right==null||right==="") return false;
  if ((typeof left==="number"&&typeof right==="string")||(typeof right==="number"&&typeof left==="string"))
    return String(right).trim()!==""&&String(left).trim()!==""&&Number(left)===Number(right);
  return encode(left)===encode(right);
}

function specificationConflicts(item,patch) {
  if (Number(patch.version)===item.version) return [];
  if (!patch.base||typeof patch.base!=="object") fail(409,"Reload the item before saving");
  const fields=[];
  for (const key of ["category","system"])
    if (Object.hasOwn(patch,key)&&!valuesEqual(item[key],patch.base[key])&&!valuesEqual(item[key],patch[key]))
      fields.push({key,current:item[key]??null});
  for (const [key,next] of Object.entries(patch.technical||{})) {
    const current=item.technical[key];
    if (!valuesEqual(current,patch.base.technical?.[key])&&!valuesEqual(current,next))
      fields.push({key,current:current??null,technical:true});
  }
  return fields;
}

function selection(db,category,id) {
  const kind=str(category);
  if (!categories.has(kind)) fail(400,"Select a work category");
  const system=configuration(db,kind,str(id));
  if (!system) fail(400,"Select a system");
  return {kind,system};
}

function updateItem(db,item,body,user,allowIncomplete=false) {
  if (Number(body.version)!==item.version) fail(409,"Reload the item before saving");
  if (!item.active) fail(409,"This item is awaiting approval or was removed");
  const kind=str(body.category);
  if (kind && !categories.has(kind)) fail(400,"Select a work category");
  const system=configuration(db,kind,str(body.system));
  if (!system&&!allowIncomplete) fail(400,"Select a system");
  const code=str(body.code,100);
  if (!code) fail(400,"Enter an item code");
  if (db.get("SELECT 1 FROM ops_items WHERE project_id=? AND code=? COLLATE NOCASE AND id<>?",[item.project_id,code,item.id]))
    fail(409,"This item code is already used");
  const technical=cleanTechnical(db,kind,system,body.technical);
  const category=kind, systemId=system?.id||"";
  if (code===item.code&&category===item.category&&systemId===item.system&&encode(item.technical)===encode(technical)) return item;
  db.run("UPDATE ops_items SET code=?,category=?,system=?,technical=?,defaults_applied=0,version=version+1 WHERE id=?",
    [code,category,systemId,encode(technical),item.id]);
  record(db,user,item.project_id,"specification_updated",item.id,{before:{...item,original:undefined},
    after:{code,category,system:systemId,technical}});
  return getItem(db,item.project_id,item.id);
}

function saveSpecifications(db,projectId,body,user) {
  const project=getProject(db,projectId);
  const rows=body.rows||[];
  if (!Array.isArray(rows)||rows.length>2500||new Set(rows.map((row)=>idOf(row?.id))).size!==rows.length)
    fail(400,"Provide distinct BOQ rows");
  const inputs=rows.map((row)=>({row,current:getItem(db,projectId,idOf(row.id))}));
  const conflicts=inputs.flatMap(({row,current})=>{
    const fields=specificationConflicts(current,row);
    return fields.length?[{id:current.id,code:current.code,version:current.version,fields}]:[];
  });
  if (conflicts.length) fail(409,"Some of the specifications you edited changed before saving",{specification_conflicts:conflicts});
  const updated=inputs.map(({row,current})=>{
    return updateItem(db,current,{version:current.version,code:current.code,
      category:row.category??current.category,system:row.system??current.system,
      technical:{...current.technical,...row.technical}},user,true);
  });
  const variants=new Map();
  for (const item of updated.filter((entry)=>entry.system)) {
    const key=descriptionKey(item.commercial.description);
    const selected=variants.get(key)||{item,keys:new Set()};
    selected.keys.add(encode([item.category,item.system,reusableTechnical(item.technical)]));
    variants.set(key,selected);
  }
  let remembered=0;
  if (body.remember!==false)
    for (const {item,keys} of variants.values())
      if (keys.size===1 && rememberSpecification(db,project.customer_id,item)) remembered++;
  let applied=0;
  const sourceId=idOf(body.source_id);
  if (sourceId) {
    const source=getItem(db,projectId,sourceId);
    if (!source.active||!source.system||!descriptionKey(source.commercial.description).trim()) fail(400,"Choose a configured BOQ row");
    if (body.apply_matches) {
      const match=descriptionKey(source.commercial.description);
      const candidates=db.all(`SELECT * FROM ops_items WHERE project_id=? AND id<>? AND active=1 AND source_document_id IS ?
        AND json_extract(commercial,'$.description')=?`,[projectId,sourceId,source.source_document_id,match]);
      for (const raw of candidates) {
        const target=hydrateItem(raw);
        const locationFields=Object.fromEntries(Object.entries(target.technical).filter(([key])=>openingFields.has(key)));
        const saved=updateItem(db,target,{...target,category:source.category,system:source.system,
          technical:{...reusableTechnical(source.technical),...locationFields}},user);
        if (saved.version!==target.version) applied++;
      }
    }
    if (body.remember!==false && rememberSpecification(db,project.customer_id,source)) remembered++;
  }
  return {saved:updated.length,applied,remembered};
}

function cleanCommercial(input,before={}) {
  const value={...before,description:str(input.description ?? before.description,3000),unit:str(input.unit ?? before.unit,60),
    unit_code:str(input.unit_code ?? before.unit_code,30),removed:input.removed===true};
  if (!value.description || !value.unit) fail(400,"Description and contractual unit are required");
  for (const key of ["quantity","rate","width_mm","height_mm","depth_mm"])
    value[key]=number(Object.hasOwn(input,key)?input[key]:before[key],key.replaceAll("_"," "));
  if (value.quantity == null || value.rate == null) fail(400,"Enter the contractual quantity and rate");
  for (const key of ["profile","glass","finish"]) value[key]=str(input[key] ?? before[key],1000);
  return value;
}

function submitChange(db,item,body,user) {
  const reason=str(body.reason,2000);
  if (!reason) fail(400,"Enter the reason for the proposed change");
  if (db.get("SELECT 1 FROM ops_changes WHERE item_id=? AND status='pending'",[item.id]))
    fail(409,"This item already has a pending change");
  if (!item.active && item.original !== null) fail(409,"Removed items are historical records");
  const proposed=cleanCommercial(body.values || {},item.commercial);
  if (!item.active && proposed.removed) fail(400,"A proposed new item must contain work to add");
  const previous=body.previous_change_id ? db.get(`SELECT id FROM ops_changes WHERE id=? AND item_id=? AND status='returned'`,
    [idOf(body.previous_change_id),item.id]) : null;
  if (body.previous_change_id && !previous) fail(400,"The preceding revision was not returned");
  const prior=item.active?item.commercial:null;
  if (prior && encode(prior)===encode(proposed)) fail(400,"Update at least one contractual field");
  const id=db.run(`INSERT INTO ops_changes(item_id,status,prior,proposed,base_version,prior_change_id,reason,submitted_by)
    VALUES (?,'pending',?,?,?,?,?,?)`,
    [item.id,encode(prior),encode(proposed),item.financial_version,previous?.id || null,reason,user.id]).lastInsertRowid;
  record(db,user,item.project_id,"change_submitted",id,{item_id:item.id});
  return {id,status:"pending"};
}

function proposeItem(db,projectId,body,user) {
  const {kind,system}=selection(db,body.category,body.system);
  const code=str(body.code,100);
  if (!code) fail(400,"Enter an item code");
  if (db.get("SELECT 1 FROM ops_items WHERE project_id=? AND code=? COLLATE NOCASE",[projectId,code])) fail(409,"This item code is already used");
  const values=cleanCommercial(body.values || {});
  const specs=cleanTechnical(db,kind,system,body.technical);
  const source=idOf(body.source_document_id)||operation(db,projectId).boq_id;
  if (!db.get("SELECT 1 FROM ops_project_boqs WHERE project_id=? AND document_id=?",[projectId,source])) fail(400,"Choose a BOQ for this project");
  const id=db.run(`INSERT INTO ops_items(project_id,code,commercial,technical,category,system,source_document_id,active) VALUES (?,?,?,?,?,?,?,0)`,
    [projectId,code,encode(values),encode(specs),kind,system.id,source]).lastInsertRowid;
  return submitChange(db,getItem(db,projectId,id),body,user);
}

function getChange(db,projectId,id) {
  const row=db.get(`SELECT c.*,i.code,i.project_id,i.source_line_id,i.source_document_id,u.display_name AS submitter,v.display_name AS reviewer
    FROM ops_changes c JOIN ops_items i ON i.id=c.item_id LEFT JOIN users u ON u.id=c.submitted_by
    LEFT JOIN users v ON v.id=c.reviewed_by WHERE c.id=? AND i.project_id=?`,[id,projectId]);
  if (!row) fail(404,"Revision not found");
  return {...row,prior:parse(row.prior),proposed:parse(row.proposed)};
}

function changePage(db,projectId,query) {
  const {page,limit,offset}=pageOptions(query);
  const status=str(query.status,35);
  const where=`FROM ops_changes c JOIN ops_items i ON i.id=c.item_id WHERE i.project_id=? AND (?='' OR c.status=?)`;
  const params=[projectId,status,status];
  return {page,limit,total:db.get(`SELECT COUNT(*) AS n ${where}`,params).n,
    items:db.all(`SELECT c.id ${where} ORDER BY c.id DESC LIMIT ? OFFSET ?`,[...params,limit,offset])
      .map(({id})=>getChange(db,projectId,id))};
}

function reviewChange(db,projectId,id,body,user) {
  const change=getChange(db,projectId,id);
  if (change.status!=="pending") fail(409,"This revision was already reviewed");
  const status=str(body.status);
  const note=str(body.note,2000);
  if (!["approved","rejected","returned"].includes(status)) fail(400,"Select an approval decision");
  if (status!=="approved" && !note) fail(400,"Enter a review note");
  const item=getItem(db,projectId,change.item_id);
  if (item.financial_version!==change.base_version) fail(409,"The baseline has changed. Review and resubmit the change");
  if (status==="approved") {
    db.run(`UPDATE ops_items SET commercial=?,active=?,financial_version=financial_version+1,version=version+1 WHERE id=?`,
      [encode(change.proposed),change.proposed.removed?0:1,item.id]);
  }
  db.run(`UPDATE ops_changes SET status=?,review_note=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?`,[status,note,user.id,id]);
  record(db,user,projectId,"change_"+status,id,{item_id:item.id,note});
  return getChange(db,projectId,id);
}

function people(db,projectId,includeContacts=false) {
  return db.all(`SELECT a.id,a.user_id,a.contact_id,COALESCE(u.display_name,c.name) AS name,
    c.company,COALESCE(NULLIF(a.position,''),c.position,'') AS position,a.signature_usage,a.responsibility,a.side,a.signature_label
    ${includeContacts?",c.mobile,c.email,c.details":""}
    FROM ops_people a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN ops_contacts c ON c.id=a.contact_id
    WHERE a.project_id=? ORDER BY a.id`,[projectId]);
}

const responsibilityKeys=["loading","engineer","reviewer","approver"];

function updateAssignment(db,projectId,personId,body) {
  const person=db.get("SELECT * FROM ops_people WHERE project_id=? AND id=?",[projectId,personId]);
  if (!person) fail(404,"Assignment not found");
  const position=Object.hasOwn(body,"position")?str(body.position,180):person.position;
  const usage=Object.hasOwn(body,"signature_usage")?str(body.signature_usage):person.signature_usage;
  const role=Object.hasOwn(body,"responsibility")?str(body.responsibility):person.responsibility;
  const side=str(body.side||person.side||(person.user_id?"company":"client"));
  if (!["company","client"].includes(side)) fail(400,"Select the company or client side");
  const signatureLabel=Object.hasOwn(body,"signature_label")?str(body.signature_label,180):person.signature_label;
  if (db.get(`SELECT 1 FROM ops_people WHERE project_id=? AND user_id IS ? AND contact_id IS ? AND position=? AND id<>?`,
    [projectId,person.user_id,person.contact_id,position,person.id])) fail(409,"That person already has this assignment");
  if (role) db.run("UPDATE ops_people SET responsibility='' WHERE project_id=? AND responsibility=? AND id<>?",[projectId,role,personId]);
  db.run("UPDATE ops_people SET position=?,signature_usage=?,responsibility=?,side=?,signature_label=? WHERE id=?",
    [position,usage,role,side,signatureLabel,personId]);
  return people(db,projectId,true).find(({id})=>id===personId);
}

function addPerson(db,access,projectId,body) {
  const userId=idOf(body.user_id);
  let contactId=idOf(body.contact_id);
  if (userId && !db.get("SELECT id FROM users WHERE id=? AND is_active=1",[userId])) fail(404,"Employee not found");
  if (!userId && contactId && !contacts(db,access,{id:contactId}).length) fail(404,"Representative not found");
  if (!userId && !contactId) {
    const name=str(body.name,200);
    const company=str(body.company,200);
    if (!name) fail(400,"Enter the representative name");
    const identity=encode([lookup(company),lookup(name)]);
    const existing=db.get("SELECT id FROM ops_contacts WHERE identity=?",[identity]);
    if (existing && !contacts(db,access,{id:existing.id}).length) fail(409,"This representative is already registered");
    contactId=existing?.id || db.run(`INSERT INTO ops_contacts(name,company,position,mobile,email,details,identity) VALUES (?,?,?,?,?,?,?)`,
      [name,company,str(body.position,180),str(body.mobile,100),str(body.email,250),str(body.details,1000),identity]).lastInsertRowid;
  }
  const assignedContact=userId?null:contactId;
  const position=str(body.position,180);
  const existing=db.get("SELECT id FROM ops_people WHERE project_id=? AND user_id IS ? AND contact_id IS ? AND position=?",
    [projectId,userId,assignedContact,position]);
  if (existing) return updateAssignment(db,projectId,existing.id,body);
  const id=db.run("INSERT INTO ops_people(project_id,user_id,contact_id,position) VALUES (?,?,?,?)",
    [projectId,userId,assignedContact,position]).lastInsertRowid;
  record(db,access.user,projectId,"person_assigned",id,{user_id:userId,contact_id:assignedContact,position});
  return updateAssignment(db,projectId,id,body);
}

function contacts(db,access,query) {
  const scope=scopeSql(access,"a.project_id");
  const q="%"+str(query.q,120)+"%";
  return db.all(`SELECT c.id,c.name,c.company,c.position FROM ops_contacts c WHERE (? IS NULL OR c.id=?)
    AND (c.name LIKE ? OR c.company LIKE ?) AND (?=1 OR EXISTS(
      SELECT 1 FROM ops_people a WHERE a.contact_id=c.id AND ${scope.clause})) ORDER BY c.name LIMIT 60`,
    [idOf(query.id),idOf(query.id),q,q,access.all_projects?1:0,...scope.params]);
}

function dashboard(db,projectId) {
  const rows=db.all(`SELECT category,COUNT(*) AS items,COALESCE(SUM(json_extract(technical,'$.quantity')),0) AS quantity,
    COALESCE(SUM(json_extract(technical,'$.quantity')*json_extract(technical,'$.width_mm')*json_extract(technical,'$.height_mm')/1000000.0),0) AS estimated_area
    FROM ops_items WHERE project_id=? AND active=1 GROUP BY category`,[projectId]);
  const total=rows.reduce((a,r)=>({items:a.items+r.items,quantity:a.quantity+r.quantity,estimated_area:a.estimated_area+r.estimated_area}),
    {items:0,quantity:0,estimated_area:0});
  const approvals=db.get(`SELECT COUNT(CASE WHEN c.status='pending' THEN 1 END) AS pending_changes,
    COUNT(CASE WHEN c.status='approved' AND COALESCE(d.status,'draft')='draft' THEN 1 END) AS pending_finance
    FROM ops_changes c JOIN ops_items i ON i.id=c.item_id LEFT JOIN documents d ON d.id=c.adjustment_id WHERE i.project_id=?`,[projectId]);
  return {rows,total,...approvals};
}

function projectContext(db,id) {
  const project=getProject(db,id);
  const customer=getCustomer(db,project.customer_id);
  const publicCustomer={id:customer.id,name:customer.display_name,code:customer.code};
  const state=db.get("SELECT 1 FROM ops_projects WHERE project_id=?",[id]) ? operation(db,id) : null;
  const linked=db.all("SELECT document_id,snapshot FROM ops_project_boqs WHERE project_id=?",[id]);
  return {project,customer:publicCustomer,operations:state,boqs:eligibleBoqs(db,project),
    linked_boqs:linked.map(({document_id,snapshot})=>({...parse(snapshot),id:document_id})),dashboard:state?dashboard(db,id):null};
}

module.exports = {authorizeOperations,record,pageOptions,projectChoices,projectContext,operation,setup,changeProjectDetails,getItem,
  itemPage,specificationGroups,updateItem,saveSpecifications,rememberSpecification,resolveProject,proposeItem,submitChange,getChange,changePage,reviewChange,
  people,addPerson,updateAssignment,responsibilityKeys,contacts,dashboard,selection,saveReportSignatures,itemValues};
