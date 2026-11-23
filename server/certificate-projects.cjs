const crypto = require("node:crypto");
const {displayPartyName, stripPartyPrefix} = require("./domain.cjs");
const {decimal} = require("./certificate-valuation.cjs");
const {certificateLocationFields} = require("./document-locations.cjs");
const {audit, currency, date, encode, fail, idOf, lookup, parse, setting, setSetting, str, today} = require("./certificate-access.cjs");
const RULE_CATEGORIES = ["vat", "retention", "contractor_withholding", "engineering_stamp",
  "social_insurance", "works_insurance", "final_insurance", "other", "advance_recovery"];
const DEFAULT_SETTINGS = {minimum_area: 0, quantity_precision: 4, count_precision: 0,
  collections_basis: "received", work_types: [], work_items: [], output_mode: "auto"};

const codeCounter = (prefix) => `certificates_${prefix.toLowerCase()}_code_counter`;

function nextCode(table, prefix) {
  const suffix = `SUBSTR(TRIM(code),${prefix.length+1})`;
  return `(WITH RECURSIVE candidate(number) AS (
    SELECT MAX(COALESCE(MAX(CAST(${suffix} AS INTEGER)),0),
      COALESCE((SELECT CAST(value AS INTEGER) FROM app_settings WHERE key='${codeCounter(prefix)}'),0))+1 FROM ${table}
      WHERE UPPER(TRIM(code)) GLOB '${prefix}[0-9]*' AND ${suffix} NOT GLOB '*[^0-9]*' AND LENGTH(${suffix})<13
    UNION ALL
    SELECT number+1 FROM candidate WHERE EXISTS (
      SELECT 1 FROM ${table} WHERE TRIM(code) <> '' AND UPPER(TRIM(code)) = '${prefix}' || candidate.number)
  ) SELECT MAX(number) FROM candidate)`;
}

function initializeMasterCodes(database) {
  const customerNext = nextCode("cert_customer_profiles", "CL");
  const projectNext = nextCode("cert_projects", "PRJ");
  const reserve = (prefix, next) => `INSERT INTO app_settings(key,value) VALUES ('${codeCounter(prefix)}',${next})
    ON CONFLICT(key) DO UPDATE SET value=excluded.value;`;
  function fillCodes(rows, prefix, next, save) {
    let number = database.get(`SELECT ${next} AS next`).next;
    const codeKey = (row) => String(row.code ?? "").trim().toUpperCase();
    const occupied = new Set(rows.map(codeKey));
    const used = new Set();
    for (const row of rows) {
      const key = codeKey(row);
      if (key && !used.has(key)) {
        used.add(key);
      } else {
        let code;
        do { code = prefix + number++; } while (occupied.has(code));
        save(row.id, code);
        used.add(code);
      }
    }
    const counter = String(number - 1);
    if (setting(database,codeCounter(prefix)) !== counter) setSetting(database,codeCounter(prefix),counter);
  }
  fillCodes(database.all(`SELECT p.id,c.code FROM parties p LEFT JOIN cert_customer_profiles c ON c.customer_id=p.id
    WHERE p.role='customer' OR c.code IS NOT NULL ORDER BY p.id`), "CL", customerNext, (id, code) =>
    database.run(`INSERT INTO cert_customer_profiles(customer_id,code) VALUES (?,?)
      ON CONFLICT(customer_id) DO UPDATE SET code=excluded.code`, [id,code]));
  fillCodes(database.all("SELECT id,code FROM cert_projects ORDER BY id"), "PRJ", projectNext, (id,code) =>
    database.run("UPDATE cert_projects SET code=? WHERE id=?", [code,id]));
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cert_customer_code ON cert_customer_profiles(UPPER(TRIM(code))) WHERE TRIM(code) <> '';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cert_project_code ON cert_projects(UPPER(TRIM(code))) WHERE TRIM(code) <> '';
    CREATE TRIGGER IF NOT EXISTS cert_assign_customer_code AFTER INSERT ON parties WHEN NEW.role='customer'
    BEGIN
      ${reserve("CL",customerNext)}
      INSERT INTO cert_customer_profiles(customer_id,code)
        SELECT NEW.id,'CL' || value FROM app_settings WHERE key='${codeCounter("CL")}';
    END;
    CREATE TRIGGER IF NOT EXISTS cert_assign_project_code AFTER INSERT ON cert_projects WHEN COALESCE(TRIM(NEW.code),'')=''
    BEGIN
      ${reserve("PRJ",projectNext)}
      UPDATE cert_projects SET code='PRJ' || (SELECT value FROM app_settings WHERE key='${codeCounter("PRJ")}') WHERE id=NEW.id;
    END;
  `);
}

function getProject(database, id) {
  const project = database.get(`
    SELECT cp.id,cp.customer_id,cp.name,cp.alternate_name,cp.code,cp.address,cp.contract_ref,
           cp.contract_date,cp.currency,cp.created_at,json_extract(cp.raw_json,'$.name_history') AS name_history,
           json_extract(cp.raw_json,'$.customer_project_code') AS customer_project_code,
           COALESCE(json_extract(cp.raw_json,'$.workbook_project_missing'),0) AS historical_only,p.display_name AS customer_name
    FROM cert_projects cp JOIN parties p ON p.id=cp.customer_id WHERE cp.id=?
  `, [id]);
  if (!project) fail(404, "Project not found");
  return project;
}

function getCustomer(database, id) {
  const customer = database.get(`
    SELECT p.id,p.base_name AS name,p.display_name,p.category,p.address,p.tax_no,
      c.code,c.alternate_name,c.print_contact,json_extract(c.raw_json,'$.company_data.commercial_registration') AS registration_no
    FROM parties p LEFT JOIN cert_customer_profiles c ON c.customer_id=p.id
    WHERE p.id=? AND p.role='customer'
  `, [id]);
  if (!customer) fail(404, "Customer not found");
  return customer;
}

function createCustomer(database, input) {
  const name = stripPartyPrefix(str(input.name || input.display_name));
  const tax = str(input.tax_no);
  const normalized = lookup(name);
  if (!normalized) fail(400, "Customer name is required");
  if (tax) {
    const found = database.get("SELECT id FROM parties WHERE role='customer' AND tax_no=?", [tax]);
    if (found) return {id: found.id, created: false};
  }
  const named = database.get("SELECT id,tax_no FROM parties WHERE role='customer' AND search_name=?", [normalized]);
  if (named && (!tax || !named.tax_no || named.tax_no === tax)) return {id: named.id, created: false};
  const searchName = named ? normalized + " " + lookup(tax) : normalized;
  const kind = ["retail", "corporate"].includes(input.category) ? input.category : null;
  const saved = database.run(`
    INSERT INTO parties (role,category,base_name,display_name,search_name,address,tax_no)
    VALUES ('customer',?,?,?,?,?,?)
  `, [kind, name, str(input.display_name) || displayPartyName(name, kind ?? "unselected"),
    searchName, str(input.address), tax]);
  return {id: saved.lastInsertRowid, created: true};
}

function requestedCode(database, table, ownerColumn, owner, input, fromWorkbook) {
  const code = str(input);
  const collision = code && database.get(`SELECT 1 FROM ${table}
    WHERE TRIM(code) <> '' AND UPPER(TRIM(code))=UPPER(?) AND ${ownerColumn} IS NOT ?`, [code,owner]);
  if (collision && !fromWorkbook) fail(409, "This code is already assigned");
  return collision ? "" : code;
}

function saveCustomerProfile(database, customerId, input, {fromWorkbook = false} = {}) {
  const code = requestedCode(database,"cert_customer_profiles","customer_id",customerId,input.code,fromWorkbook);
  database.run(`
    INSERT INTO cert_customer_profiles (customer_id,code,alternate_name,print_contact,raw_json)
    VALUES (?,?,?,?,?) ON CONFLICT(customer_id) DO UPDATE SET
    code=COALESCE(NULLIF(excluded.code,''),cert_customer_profiles.code),
    alternate_name=COALESCE(NULLIF(excluded.alternate_name,''),cert_customer_profiles.alternate_name),
    print_contact=COALESCE(NULLIF(excluded.print_contact,''),cert_customer_profiles.print_contact),
    raw_json=COALESCE(cert_customer_profiles.raw_json,excluded.raw_json)
  `, [customerId, code, str(input.alternate_name), str(input.print_contact),
    input.raw ? encode(input.raw) : null]);
}

function customerData(database,id){
  const customer=getCustomer(database,id),party=database.get('SELECT phone,email,notes FROM parties WHERE id=?',[id]);
  const raw=parse(database.get('SELECT raw_json FROM cert_customer_profiles WHERE customer_id=?',[id])?.raw_json,{});
  return {...customer,...party,...raw.company_data};
}
function saveCustomerData(database,id,input,user){
  const before=customerData(database,id);
  const name=stripPartyPrefix(str(input.name??before.name));if(!name)fail(400,'Customer name is required');
  const oldCategory=['retail','corporate'].includes(before.category)?before.category:null;
  const category=Object.hasOwn(input,'category')?(['retail','corporate'].includes(input.category)?input.category:null):oldCategory;
  const tax=str(input.tax_no??before.tax_no),search=lookup(name);
  const other=database.get("SELECT id,tax_no FROM parties WHERE role='customer' AND search_name=? AND id<>?",[search,id]);
  if(other&&(!tax||!other.tax_no||other.tax_no===tax))fail(409,'Another customer already uses this name');
  const display=Object.hasOwn(input,'display_name')&&input.display_name!==before.display_name?str(input.display_name):
    (name===before.name||input.name===before.name)&&category===oldCategory?before.display_name:displayPartyName(name,category||'unselected');
  const raw=parse(database.get('SELECT raw_json FROM cert_customer_profiles WHERE customer_id=?',[id])?.raw_json,{});
  const keys=['legal_name','commercial_registration','vat_registration','tax_office','billing_address','contact_name','contact_position','website'];
  raw.company_data={...raw.company_data,...Object.fromEntries(keys.filter(key=>Object.hasOwn(input,key)).map(key=>[key,str(input[key],2000)]))};
  database.run('UPDATE parties SET address=?,tax_no=?,phone=?,email=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',
    [str(input.address??before.address,2000),tax,str(input.phone??before.phone),str(input.email??before.email),str(input.notes??before.notes,4000),id]);
  database.run('UPDATE parties SET base_name=?,display_name=?,search_name=?,category=? WHERE id=?',[name,display,other?search+' '+lookup(tax):search,category,id]);
  database.run("UPDATE documents SET customer_name=?,search_party_name=?,party_category=?,updated_at=CURRENT_TIMESTAMP WHERE party_id=?",[display,search,category||'unselected',id]);
  database.run("UPDATE work_items SET customer_name=?,customer_display_name=?,search_party_name=?,party_category=?,updated_at=CURRENT_TIMESTAMP WHERE party_id=?",[name,display,search,category||'unselected',id]);
  database.run(`INSERT INTO cert_customer_profiles(customer_id,raw_json) VALUES(?,?)
    ON CONFLICT(customer_id) DO UPDATE SET raw_json=excluded.raw_json`,[id,encode(raw)]);
  database.run('UPDATE cert_customer_profiles SET alternate_name=?,print_contact=? WHERE customer_id=?',
    [str(input.alternate_name??before.alternate_name),str(input.print_contact??before.print_contact),id]);
  audit(database,user,'customer_data_updated',{details:{customer_id:id,before,after:{name,display_name:display,category}}});
  return customerData(database,id);
}

function createProject(database, input, userId = null, {fromWorkbook = false} = {}) {
  const customer = getCustomer(database, idOf(input.customer_id));
  const name = str(input.name);
  const searchName = lookup(name);
  if (!searchName) fail(400, "Project name is required");
  const contract = str(input.contract_ref);
  const address = str(input.address);
  const existing = matchingProject(database, customer.id, searchName, contract, address);
  if (existing) return {id: existing.id, created: false};
  const code = requestedCode(database,"cert_projects","id",null,input.code,fromWorkbook);
  const record = database.run(`
    INSERT INTO cert_projects (customer_id,name,search_name,alternate_name,code,address,contract_ref,contract_date,currency,raw_json,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `, [customer.id, name, searchName, str(input.alternate_name), code, address, contract,
    date(input.contract_date, true), currency(input.currency), encode({...input.raw,customer_project_code:str(input.customer_project_code)}), userId]);
  return {id: record.lastInsertRowid, created: true};
}

function matchingProject(database, customerId, searchName, contract, address, excludeId = null) {
  return database.all(`SELECT id,search_name,json_extract(raw_json,'$.name_history') AS name_history FROM cert_projects
    WHERE customer_id=? AND id IS NOT ? AND COALESCE(contract_ref,'')=? AND COALESCE(address,'')=?`,
  [customerId,excludeId,contract,address]).find((row) =>
    row.search_name === searchName || parse(row.name_history,[]).some((name) => lookup(name) === searchName));
}

function projectLookupKeys(project) {
  return new Set([project.name,project.alternate_name,project.code,...parse(project.name_history,[])].map(lookup).filter(Boolean));
}

function updateProject(database, project, body) {
  const name = str(body.name ?? project.name);
  const searchName = lookup(name);
  if (!searchName) fail(400, "Project name is required");
  const alternateName = str(body.alternate_name ?? project.alternate_name);
  const address = str(body.address ?? project.address);
  const contract = str(body.contract_ref ?? project.contract_ref);
  const contractDate = date(body.contract_date ?? project.contract_date, true);
  if (matchingProject(database, project.customer_id, searchName, contract, address, project.id))
    fail(409, "A project already uses that name, address and contract for this customer");
  const current = database.get("SELECT raw_json FROM cert_projects WHERE id=?", [project.id]);
  const raw = parse(current.raw_json) ?? {};
  if(Object.hasOwn(body,'customer_project_code'))raw.customer_project_code=str(body.customer_project_code);
  const currentNames = new Set([searchName,lookup(alternateName),""]);
  const previousNames = [...parse(project.name_history,[]),project.name,project.alternate_name];
  raw.name_history = [...new Set(previousNames.filter((previous) => !currentNames.has(lookup(previous))))];
  if (project.historical_only && (address || searchName !== lookup(project.name))) delete raw.workbook_project_missing;
  database.run(`UPDATE cert_projects SET name=?,search_name=?,alternate_name=?,address=?,contract_ref=?,contract_date=?,currency=?,raw_json=? WHERE id=?`,
    [name,searchName,alternateName,address,contract,contractDate,currency(body.currency??project.currency),encode(raw),project.id]);
  if(name!==project.name){
    const aliases=projectLookupKeys(project);
    const ambiguous=database.all('SELECT id,name,alternate_name,code,raw_json FROM cert_projects WHERE customer_id=? AND id<>?',[project.customer_id,project.id])
      .some(other=>[other.name,other.alternate_name,...parse(other.raw_json,{}).name_history||[]].some(value=>aliases.has(lookup(value))));
    if(!ambiguous)for(const table of ['documents','work_items'])
      for(const row of database.all(`SELECT id,project FROM ${table} WHERE party_id=? AND project<>''`,[project.customer_id]))
        if(aliases.has(lookup(row.project)))database.run(`UPDATE ${table} SET project=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,[name,row.id]);
  }
  if(database.get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ops_projects'")){
    const state=database.get('SELECT details FROM ops_projects WHERE project_id=?',[project.id]);
    if(state){
      const details=parse(state.details,{}),before=encode(details);
      for(const [key,value,previous] of [['address',address,project.address],['contract_ref',contract,project.contract_ref]])
        if(Object.hasOwn(body,key)&&(value!==previous||!details[key]||details[key]===previous))details[key]=value;
      if(encode(details)!==before)database.run('UPDATE ops_projects SET details=?,version=version+1 WHERE project_id=?',[encode(details),project.id]);
    }
  }
  return getProject(database,project.id);
}

function projectLocations(database, projectId) {
  const all = database.all("SELECT id,parent_id,kind,name,code FROM cert_locations WHERE project_id=?", [projectId]);
  const byId = new Map(all.map((row) => [row.id, row]));
  const label = (row) => row.parent_id && byId.has(row.parent_id) ? label(byId.get(row.parent_id)) + " › " + row.name : row.name;
  return all.map((row) => ({...row, label: label(row)}))
    .sort((a,b) => a.label.localeCompare(b.label, "ar", {numeric:true}));
}

function projectEntrySuggestions(database, project) {
  const names = projectLookupKeys(project);
  const rows = database.all(`SELECT DISTINCT COALESCE(NULLIF(wi.project,''),d.project) AS project,
    wi.building_unit,wi.floor_apartment,wi.work_type,wi.description,wi.unit
    FROM documents d JOIN work_items wi ON wi.document_id=d.id
    WHERE d.party_id=? AND d.deleted_at IS NULL AND wi.deleted_at IS NULL
      AND d.document_type IN ('price_offer','invoice')
    ORDER BY wi.id DESC`,[project.customer_id]);
  return rows.filter((row) => names.has(lookup(row.project))).slice(0,500).map((row) => ({
    ...certificateLocationFields(row), work_type:row.work_type, description:row.description, unit:row.unit,
  }));
}

function createLocation(database, projectId, input) {
  const name = str(input.name);
  const keyed = lookup(name);
  const parentId = idOf(input.parent_id);
  const kind = str(input.kind) || "building";
  if (!keyed || !["block","building","floor","unit","site","other"].includes(kind)) fail(400, "Location name and type are required");
  if (parentId && !database.get("SELECT 1 FROM cert_locations WHERE id=? AND project_id=?", [parentId, projectId]))
    fail(400, "Parent location is outside this project");
  const old = database.get("SELECT id FROM cert_locations WHERE project_id=? AND parent_id IS ? AND search_name=? AND kind=?",
    [projectId, parentId, keyed, kind]);
  if (old) return {id: old.id, created: false};
  const record = database.run("INSERT INTO cert_locations (project_id,parent_id,kind,name,search_name,code) VALUES (?,?,?,?,?,?)",
    [projectId, parentId, kind, name, keyed, str(input.code)]);
  return {id: record.lastInsertRowid, created: true};
}

function getProfile(database, projectId, at = today(), version = null) {
  const row = version === null ? database.get(
    "SELECT * FROM cert_rule_versions WHERE project_id=? AND effective_at<=? ORDER BY effective_at DESC,version DESC LIMIT 1", [projectId, at])
    : database.get("SELECT * FROM cert_rule_versions WHERE project_id=? AND version=?", [projectId, version]);
  const company = parse(setting(database, "certificates_company_defaults", "{}"), {});
  const customer = database.get(`SELECT cp.settings_json FROM cert_customer_profiles cp
    JOIN cert_projects p ON p.customer_id=cp.customer_id WHERE p.id=?`, [projectId]);
  const client = parse(customer?.settings_json, {});
  const chosen = parse(row?.settings_json, {});
  return {version: row?.version || null, effective_at: row?.effective_at || null,
    rules: parse(row?.rules_json, client.rules ?? company.rules ?? []),
    settings: {...DEFAULT_SETTINGS, ...company.settings, ...client.settings, ...chosen},
    origins: {company: Boolean(company.settings || company.rules), customer: Boolean(customer?.settings_json), project: Boolean(row)}};
}

function cleanRules(input) {
  if (!Array.isArray(input) || input.length > 30) fail(400, "Enter up to 30 rules");
  let advanceRules = 0;
  const keys=new Set();
  return input.map((entry,index) => {
    const category = str(entry?.category);
    if (!RULE_CATEGORIES.includes(category)) fail(400, "Unknown financial rule");
    const rate = entry.rate == null || entry.rate === "" ? null : str(entry.rate, 40);
    const amount = entry.amount == null || entry.amount === "" ? null : str(entry.amount, 40);
    const cap = entry.cap == null || entry.cap === "" ? null : str(entry.cap, 40);
    for (const value of [rate, amount, cap]) {
      if (value !== null && (decimal(value) === null || decimal(value) < 0n))
        fail(400, "Rule amounts, caps and rates must be zero or greater");
    }
    if (rate !== null && decimal(rate) > decimal(100)) fail(400, "Percentage rate cannot exceed 100");
    if (category === "advance_recovery" && ++advanceRules > 1) fail(400, "Configure a single advance recovery rule");
    if (rate !== null && amount !== null) fail(400, "Choose a percentage or a fixed amount for each rule");
    const key=str(entry.key,100)||`${category}:${index}`;
    if(keys.has(key))fail(400,'Financial rules must have distinct identifiers');keys.add(key);
    return {key,category, label: str(entry.label), rate, amount, cap,
      collection_date:date(entry.collection_date,true),refundable:entry.refundable===true,
      release_on_project_completion:category==='works_insurance'&&entry.release_on_project_completion===true,
      basis: entry.basis === "running" ? "running" : "work",
      sign: entry.sign === "addition" || (category === "vat" && entry.sign !== "deduction") ? "addition" : "deduction",
      enabled: entry.enabled !== false};
  });
}

function cleanSettings(input = {}, base = {}) {
  const settings = {...base};
  for (const key of ["quantity_precision", "count_precision"]) {
    if (Object.hasOwn(input, key) && (input[key] === "inherit" || input[key] == null)) delete settings[key];
    else if (Object.hasOwn(input, key)) {
      const n = Number(input[key]);
      if (!Number.isInteger(n) || n < 0 || n > 6) fail(400, "Precision must be from 0 to 6");
      settings[key] = n;
    }
  }
  if (Object.hasOwn(input, "minimum_area")) {
    if (input.minimum_area === "inherit" || input.minimum_area == null) delete settings.minimum_area;
    else if (input.minimum_area === "disabled") settings.minimum_area = 0;
    else if (decimal(input.minimum_area) === null || decimal(input.minimum_area) < 0n) fail(400, "Minimum area must be zero or greater");
    else settings.minimum_area = str(input.minimum_area, 40);
  }
  for (const [key,choices] of [["collections_basis",["cleared","received"]],["output_mode",["auto","detail","cover","multi"]]]) {
    if (!Object.hasOwn(input,key)) continue;
    if (input[key] === "inherit" || input[key] == null || input[key] === "") delete settings[key];
    else if (!choices.includes(input[key])) fail(400,"Unsupported " + key.replace("_"," "));
    else settings[key] = input[key];
  }
  if (Array.isArray(input.work_types)) settings.work_types = [...new Set(input.work_types.map((value) => str(value)).filter(Boolean))].slice(0, 150);
  if (Array.isArray(input.signatures)) settings.signatures = input.signatures.slice(0, 6)
    .map((person) => ({name: str(person?.name, 100), title: str(person?.title, 100)})).filter(({name,title}) => name || title);
  for (const key of ["group_work_types", "show_group_subtotals", "show_building_subtotals", "show_unit_subtotals", "show_work_type_subtotals",
    "show_summary_building","show_summary_work_type","show_summary_quantities","show_detail_quantities","show_summary_rate","show_summary_progress"]) {
    if (Object.hasOwn(input, key)) settings[key] = input[key] === true;
  }
  if (["none","building","unit","work_type"].includes(input.group_by)) settings.group_by = input.group_by;
  if (Array.isArray(input.work_items)) settings.work_items = input.work_items.slice(0, 1000).map((item) => ({
    id: str(item.id, 100) || crypto.randomUUID(), work_type: str(item.work_type), description: str(item.description, 2000),
    work_item: str(item.work_item), unit: str(item.unit), rate: str(item.rate, 40),
  }));
  return settings;
}

function latestVersion(database, projectId) {
  return database.get("SELECT MAX(version) AS latest FROM cert_rule_versions WHERE project_id=?", [projectId]).latest || 0;
}

function saveProjectRules(database, projectId, body, user) {
  const latest = latestVersion(database, projectId);
  if (!Number.isSafeInteger(Number(body.expected_version)) || Number(body.expected_version) !== latest)
    fail(409, "Project rules changed. Reload before applying a new version", {expected_version: latest});
  const newest = latest ? getProfile(database, projectId, today(), latest) : getProfile(database, projectId);
  const inherited = latest ? parse(database.get("SELECT settings_json FROM cert_rule_versions WHERE project_id=? AND version=?",
    [projectId, latest]).settings_json, {}) : {};
  const rules = body.rules === undefined ? newest.rules : cleanRules(body.rules);
  const settings = cleanSettings({...body.settings, ...(Array.isArray(body.work_types) ? {work_types: body.work_types} : {})}, inherited);
  const at = date(body.effective_at, true) || today();
  database.run("INSERT INTO cert_rule_versions (project_id,version,effective_at,rules_json,settings_json,created_by) VALUES (?,?,?,?,?,?)",
    [projectId, latest + 1, at, encode(rules), encode(settings), user.id]);
  audit(database, user, "project_rules_versioned", {projectId, details: {version: latest + 1, effective_at: at}});
  return {...getProfile(database, projectId, today(), latest + 1), latest_version: latest + 1};
}

function checkedLocation(database, projectId, locationId) {
  if (locationId && !database.get("SELECT 1 FROM cert_locations WHERE project_id=? AND id=?", [projectId, locationId]))
    fail(400, "Location belongs to a different project");
  return locationId;
}

module.exports = {initializeMasterCodes, getProject, getCustomer, customerData,saveCustomerData,createCustomer, saveCustomerProfile, createProject, updateProject,
  projectLookupKeys, projectLocations, projectEntrySuggestions,
  createLocation, getProfile, cleanRules, cleanSettings, latestVersion, saveProjectRules, checkedLocation};
