const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {createHash} = require("node:crypto");
const {createServer} = require("../server/index.cjs");
const {CAPABILITIES, importLegacyCertificates} = require("../server/certificates.cjs");

async function main() {
  const dataDir = fs.mkdtempSync(path.join(process.env.AM_TEST_TEMP || os.tmpdir(),"am-progress-certificate-"));
  const app = await createServer({dataDir,dbPath:path.join(dataDir,"test.db"),port:0});
  const httpServer = await new Promise((resolve) => {
    const server = app.app.listen(0,"127.0.0.1",() => resolve(server));
  });
  const nativeFetch = global.fetch;
  global.fetch = (target, options) => {
    const url = new URL(typeof target === "string" || target instanceof URL ? target : target.url);
    return url.hostname === "127.0.0.1" && Number(url.port) === httpServer.address().port
      ? nativeFetch(target,options)
      : Promise.resolve(Response.json({has_access:true}));
  };
  const db = app.database;
  let issuedId;
  try {
    const base = "http://127.0.0.1:" + httpServer.address().port + "/api";
    const password = "controlled-fixture";
    const hash = createHash("sha256").update(password).digest("hex");
    db.transaction(() => {
      db.run("INSERT OR REPLACE INTO app_settings (key,value) VALUES (?,?)",
        ["company_profile",JSON.stringify({free_access_until:"2099-01-01T00:00:00.000Z"})]);
      db.run("INSERT INTO users (username,display_name,role,pin_hash) VALUES (?,?,?,?)",["manager","Manager","manager",hash]);
      db.run("INSERT INTO users (username,display_name,role,pin_hash) VALUES (?,?,?,?)",["viewer","Viewer","user",hash]);
      db.run("INSERT INTO users (username,display_name,role,pin_hash) VALUES (?,?,?,?)",["settings-admin","Settings Admin","admin",hash]);
    });

    const api = async (route,token = "",method = "GET",body,expected = 200) => {
      const response = await fetch(base + route,{method,
        headers:{"Content-Type":"application/json",...(token ? {Authorization:"Bearer " + token} : {})},
        body:body === undefined ? undefined : JSON.stringify(body)});
      const input = await response.json();
      assert.equal(response.status,expected,method + " " + route + " " + JSON.stringify(input));
      return input;
    };
    const login = async (name) => (await api("/auth/login","","POST",{username:name,password})).user;
    const manager = await login("manager");
    const viewer = await login("viewer");
    const settingsAdmin = await login("settings-admin");
    const token = manager.certificate_session;
    const viewToken = viewer.certificate_session;
    const cert = "/certificates";

    assert.ok(token);
    const managerAccess = await api(cert + "/access",token);
    assert.equal(managerAccess.can_admin,true);
    assert.equal(managerAccess.can_delete_documents,true);
    assert.equal(managerAccess.inherited_from_role,true);
    assert.equal(managerAccess.all_projects,true);
    assert.equal(managerAccess.allow_project_creation,true);
    assert.deepEqual(managerAccess.capabilities,CAPABILITIES);
    const settingsAccess = await api(cert + "/access",settingsAdmin.certificate_session);
    assert.equal(settingsAccess.can_admin,true);
    assert.equal(settingsAccess.can_delete_documents,false);
    assert.deepEqual(settingsAccess.capabilities,[]);
    await api(cert + "?requester_user_id=" + manager.id,"","GET",undefined,401);
    await api(cert,viewToken,"GET",undefined,403);
    await api(cert + "/admin/users",viewToken,"GET",undefined,403);
    await api(cert + "/admin/users/" + manager.id,token,"PUT",{capabilities:CAPABILITIES,all_projects:true},409);
    assert.equal(db.get("SELECT user_id FROM cert_access WHERE user_id=?",[manager.id]),null);
    const grants = await api(cert + "/admin/users",token);
    assert.deepEqual(grants[manager.id].explicit_grant.capabilities,[]);
    assert.equal(grants[manager.id].inherited_from_role,true);

    const customer = await api(cert + "/customers",token,"POST",{name:"مقاولات تجريبية",category:"corporate"},201);
    assert.match(customer.code,/^CL\d+$/);
    assert.equal((await api(cert + "/customers",token,"POST",{name:"مقاولات تجريبية"})).id,customer.id);
    const directory = await api("/parties?q=" + customer.code,token);
    assert.equal(directory.find(({id}) => id === customer.id).code,customer.code);
    const shared = await api("/parties",token,"POST",{base_name:"Shared customer",requester_user_id:manager.id},201);
    assert.match(shared.code,/^CL\d+$/);
    assert.notEqual(shared.code,customer.code);
    await api("/parties/" + shared.id,token,"DELETE",{requester_user_id:manager.id});
    const newCustomer = await api(cert + "/customers",token,"POST",{name:"Replacement customer"},201);
    assert.notEqual(newCustomer.code,shared.code);
    await api(cert + "/customers",token,"POST",{name:"Conflicting customer",code:customer.code.toLowerCase()},409);
    const project = await api(cert + "/projects",token,"POST",
      {customer_id:customer.id,name:"Project 200",contract_ref:"M-1"},201);
    const other = await api(cert + "/projects",token,"POST",{customer_id:customer.id,name:"Second project"},201);
    const scope = cert + "/projects/" + project.id;
    assert.match(project.code,/^PRJ\d+$/);
    assert.notEqual(other.code,project.code);
    await api(cert + "/projects",token,"POST",{customer_id:newCustomer.id,name:"Conflicting project",code:project.code.toLowerCase()},409);
    const master = await api(scope,token,"PATCH",{name:"Renamed Project",address:"20 Project Street",contract_date:"2026-01-02"});
    assert.equal(master.code,project.code);
    assert.equal(master.address,"20 Project Street");
    assert.equal(master.contract_date,"2026-01-02");
    assert.equal((await api(cert + "/projects?q=Project+200",token))[0].id,project.id);
    assert.equal((await api(cert + "/projects?q=20+Project+Street",token))[0].id,project.id);
    const location = await api(scope + "/locations",token,"POST",{name:"Building 2"},201);
    const foreign = await api(cert + "/projects/" + other.id + "/locations",token,"POST",{name:"Building 10"},201);
    const viewerGrant = {capabilities:["view"],project_ids:[project.id]};
    const userRoute = "/users/" + viewer.id;
    await api(userRoute,"","PUT",{requester_user_id:manager.id,certificate_grant:viewerGrant},403);
    await api(userRoute,viewToken,"PUT",{requester_user_id:manager.id,certificate_grant:viewerGrant},403);
    await api(userRoute,token,"PUT",{requester_user_id:settingsAdmin.id,certificate_grant:viewerGrant},403);
    const updatedViewer = await api(userRoute,token,"PUT",{
      requester_user_id:manager.id,display_name:"Updated Viewer",certificate_grant:viewerGrant,
    });
    assert.equal(updatedViewer.display_name,"Updated Viewer");
    assert.deepEqual(updatedViewer.certificate_grant.project_ids,[project.id]);
    await api(userRoute,token,"PUT",{requester_user_id:manager.id,display_name:"Invalid Update",
      certificate_grant:{capabilities:["view"],project_ids:[-1]}},400);
    assert.equal(db.get("SELECT display_name FROM users WHERE id=?",[viewer.id]).display_name,"Updated Viewer");
    assert.deepEqual((await api(cert+"/admin/users/"+viewer.id,token)).project_ids,[project.id]);

    const promoted = await api(userRoute,token,"PUT",{requester_user_id:manager.id,role:"manager",
      certificate_grant:{capabilities:CAPABILITIES,all_projects:true}});
    assert.equal(promoted.certificate_grant.inherited_from_role,true);
    assert.deepEqual(promoted.certificate_grant.explicit_grant.project_ids,[project.id]);
    assert.equal((await api(cert + "/projects",viewToken)).length,2);
    await api(userRoute,viewToken,"PUT",{requester_user_id:viewer.id,is_active:false});
    await api(cert + "/access",viewToken,"GET",undefined,401);
    assert.equal(db.get("SELECT actor_id FROM cert_audit WHERE action='manager_role_access_changed' ORDER BY id DESC LIMIT 1").actor_id,viewer.id);
    await api(userRoute,token,"PUT",{requester_user_id:manager.id,role:"user",is_active:true});
    const demotedAccess = await api(cert + "/access",viewToken);
    assert.equal(demotedAccess.inherited_from_role,false);
    assert.equal(demotedAccess.can_admin,false);
    assert.deepEqual(demotedAccess.capabilities,["view"]);
    assert.equal((await api(cert + "/projects",viewToken)).length,1);
    await api(cert + "/projects/" + other.id,viewToken,"GET",undefined,404);
    await api(scope + "/collections",viewToken,"GET",undefined,403);
    await api(scope,viewToken,"PATCH",{address:"Outside permissions"},403);
    await api("/users/" + viewer.id,"","PUT",{requester_user_id:manager.id,password:"changed"},403);

    const signatures = [{name:"",title:"Project Manager"},{name:"Site Engineer",title:""}];
    const savedSettings = await api(scope + "/settings",token,"PUT",{expected_version:0,effective_at:"2026-01-01",
      settings:{minimum_area:1.25,signatures:[...signatures,{}]},rules:[{category:"vat",rate:10},{category:"advance_recovery",rate:10}]});
    assert.deepEqual(savedSettings.settings.signatures,signatures);
    const date = "2026-10-10";
    await api(scope + "/collections",token,"POST",{kind:"receipt",amount:50,received_at:date},201);
    await api(scope + "/collections",token,"POST",{kind:"advance",amount:100,received_at:date},201);
    const header = {locale:"en",work_to:date,collection_cutoff:date};
    const lines = [{id:"row1",mode:"area",description:"Windows",work_type:"Aluminum",width:100,height:100,
      dimension_unit:"cm",count:2,rate:100,location_id:location.id}];
    await api(cert,token,"POST",{project_id:project.id,header,lines:[{...lines[0],location_id:foreign.id}]},400);
    let draft = await api(cert,token,"POST",{project_id:project.id,header,lines},201);
    issuedId = draft.id;
    const record = cert + "/" + issuedId;
    assert.equal(draft.totals.current,250);
    assert.equal(draft.totals.current_payable,200);
    assert.equal(draft.totals.advance_recovery,25);
    assert.equal((await api(record,viewToken)).receipts,undefined);
    await api(record,viewToken,"PUT",{version:draft.version},403);
    await api(record,token,"PUT",{version:draft.version-1},409);

    const stage = await api(record + "/import/stage",token,"POST",{rows:[["Steel","Railing","2","m","12.50"]],
      mapping:{work_type:0,description:1,quantity:2,unit:3,rate:4}});
    draft = await api(record + "/import/commit",token,"POST",{batch_id:stage.batch_id,version:draft.version});
    assert.equal(draft.totals.current,275);
    assert.equal((await api(record + "/import/commit",token,"POST",{batch_id:stage.batch_id,version:1})).version,draft.version);
    const action = (name,version,reason,command_key) => api(record + "/action",token,"POST",
      {action:name,version,reason,command_key});
    draft = await action("submit",draft.version);
    const lateReceipt = await api(scope + "/collections",token,"POST",{kind:"receipt",amount:5,received_at:date},201);
    await api(record + "/action",token,"POST",{action:"approve",version:draft.version},409);
    draft = await action("return",draft.version,"Confirm late receipt");
    draft = await action("submit",draft.version);
    draft = await action("approve",draft.version);
    const afterApproval = await api(scope + "/collections",token,"POST",{kind:"receipt",amount:1,received_at:date},201);
    const issued = await Promise.all([
      action("issue",draft.version,undefined,"issue-request"),
      action("issue",draft.version,undefined,"issue-request"),
    ]);
    for (const result of issued) {
      assert.equal(result.status,"issued");
      assert.equal(result.official_number,1);
      assert.equal(result.totals.ordinary_collections,55);
    }
    await api(scope + "/collections",token,"POST",{kind:"reversal",reverses_id:afterApproval.id,received_at:date},201);
    const second = await api(cert,token,"POST",{project_id:project.id,header,
      lines:[{...lines[0],mode:"direct",quantity:3,unit:"m",rate:100,recognition:"cumulative"}]},201);
    assert.equal(second.totals.previous,275);
    assert.equal(second.totals.current,50);
    assert.equal(second.totals.cumulative,325);
    assert.equal(second.totals.last_current,275);
    assert.equal(second.lines[0].previous_progress,83.33);
    assert.equal(Number(second.lines[0].current_progress.toFixed(2)),16.67);
    const report = await api(cert + "/reports?project_id=" + project.id + "&work_cutoff=" + date + "&collection_cutoff=" + date,viewToken);
    assert.equal(report.totals.cumulative,275);
    assert.equal(report.totals.ordinary_collections,55);
    const siteReport = await api(cert + "/reports?project_id=" + project.id + "&location_id=" + location.id +
      "&work_cutoff=" + date + "&collection_cutoff=" + date,viewToken);
    assert.equal(siteReport.totals.cumulative,250);
    assert.equal(siteReport.totals.cumulative_payable,null);
    assert.equal(siteReport.totals.unapplied_collections,55);

    await api(scope + "/collections",token,"POST",{kind:"reversal",reverses_id:lateReceipt.id,received_at:date},201);
    assert.equal((await api(record,token)).totals.ordinary_collections,55);
    assert.equal((await api(scope + "/collections?cutoff=" + date,token)).ordinary_collections,50);
    const pending = await api(scope + "/collections",token,"POST",
      {kind:"receipt",amount:40,received_at:date,status:"pending"},201);
    const entry = scope + "/collections/" + pending.id + "/action";
    await api(entry,token,"POST",{action:"allocate",command_key:"allocate-pending",allocated_at:"2026-10-12",
      allocations:[{location_id:location.id,amount:15}]});
    await api(entry,token,"POST",{action:"allocate",command_key:"allocate-pending",allocated_at:"2026-10-12",
      allocations:[{location_id:location.id,amount:15}]});
    await api(entry,token,"POST",{action:"allocate",allocated_at:"2026-10-12",
      allocations:[{location_id:location.id,amount:26}]},400);
    await api(entry,token,"POST",{action:"clear",cleared_at:"2026-10-13"});
    assert.equal((await api(scope + "/collections?cutoff=2026-10-11",token)).allocations.length,0);
    assert.equal((await api(scope + "/collections?cutoff=2026-10-14",token)).allocations.length,1);

    const reportPath = "/documents/statement?" + new URLSearchParams({
      party_id:customer.id, project:project.name, report_language:"en",
    });
    assert.equal((await api(reportPath)).statementRows.length,0);
    const payment = {certificate_project_id:project.id, certificate_location_id:location.id, kind:"advance",
      amount:77, entry_date:date, note:"PAY-77", command_key:"payments-advance-77"};
    await api("/payments",viewToken,"POST",payment,403);
    const posted = await api("/payments",token,"POST",payment,201);
    assert.equal((await api("/payments",token,"POST",payment,201)).id,posted.id);
    await api("/payments",token,"POST",{party_id:customer.id,base_party_name:customer.name || customer.display_name,
      project:project.name,amount:23,entry_date:date},201);
    const paymentList = (await api("/payments?party_id=" + customer.id,token)).rows;
    assert.equal(paymentList.filter((row) => row.collection_amount === 77 && row.kind === "advance").length,1);
    assert.equal(paymentList.filter((row) => row.collection_amount === 23).length,1);
    const mergedCollections = await api(scope + "/collections?cutoff=" + date,token);
    assert.equal(mergedCollections.ordinary_collections,113);
    assert.ok(mergedCollections.advances.some((row) => row.id === posted.id && row.principal === 77));
    const statement = await api(reportPath,token);
    assert.equal(statement.totals.debit,302.5);
    assert.equal(statement.totals.credit,290);
    assert.equal(statement.totals.net_total,12.5);
    assert.equal(statement.statementRows.find((row) => row.document_type === "progress_certificate").description,"Certificate No. 1");
    assert.equal(statement.statementRows.filter((row) => row.credit === 77).length,1);
    const updatedNameStatement = await api("/documents/statement?" + new URLSearchParams({
      party_id:customer.id,project:master.name,report_language:"en",
    }),token);
    assert.deepEqual(updatedNameStatement.totals,statement.totals);
    const advanceRoute = scope + "/collections/" + posted.id;
    await api(advanceRoute,viewToken,"PATCH",{amount:78},403);
    await api(advanceRoute,token,"PATCH",{amount:78,reference:"PAY-78"});
    assert.ok((await api("/payments?party_id=" + customer.id,token)).rows.some((row) => row.collection_amount === 78 && row.can_edit_receipt));
    assert.equal((await api(reportPath,token)).totals.credit,291);

    importLegacyCertificates(db,{fingerprint:"b".repeat(64), source_name:"Test.xlsb",
      customers:[{source_id:"legacy-customer",name:"Legacy Test Customer"}],
      projects:[{source_id:"legacy-project",customer_source_id:"legacy-customer",name:"Legacy Project"}],
      certificates:[{source_id:"legacy-certificate",project_source_id:"legacy-project",source_number:"9",work_to:date,
        lines:[{source_sheet:"old",source_row:1,description:"Legacy work",mode:"direct",quantity:2,unit:"m",rate:100,progress:0.6,amount:120}]},
      {source_id:"legacy-certificate-2",project_source_id:"legacy-project",source_number:"10",work_to:date,
        lines:[{source_sheet:"old",source_row:2,description:"Legacy work",mode:"direct",quantity:2,unit:"m",rate:100,progress:0.4,amount:80}]}],
      receipts:[{source_id:"legacy-receipt",project_source_id:"legacy-project",source_number:"9",kind:"advance",date,amount:50},
      {source_id:"legacy-receipt-2",project_source_id:"legacy-project",source_number:"10",kind:"receipt",date:"2026-10-11",amount:25}],
    });
    const imported = (await api(cert + "?status=unapproved&q=Legacy+Project",token)).items;
    const legacy = imported.find((item) => item.legacy_number === "9");
    assert.equal(legacy.legacy_number,"9");
    const legacyRoute = cert + "/" + legacy.id;
    const legacyDetail = await api(legacyRoute,token);
    assert.equal(legacyDetail.lines[0].progress,60);
    assert.equal(legacyDetail.totals.advance_receipts,50);
    assert.equal(legacyDetail.totals.cumulative_payable,70);
    const nextLegacy = await api(cert + "/" + imported.find((item) => item.legacy_number === "10").id,token);
    assert.equal(nextLegacy.lines[0].previous_progress,60);
    assert.equal(nextLegacy.lines[0].current_progress,40);
    assert.equal(nextLegacy.totals.previous,120);
    assert.equal(nextLegacy.totals.current,80);
    assert.equal(nextLegacy.totals.cumulative,200);
    assert.equal(nextLegacy.totals.cumulative_payable,125);
    const legacyStatement = await api("/documents/statement?customer=Legacy+Test+Customer&report_language=en",token);
    assert.equal(legacyStatement.totals.debit,200);
    assert.equal(legacyStatement.totals.credit,75);
    const original = db.get("SELECT snapshot_json FROM cert_revisions WHERE id=?",[legacy.id]).snapshot_json;
    await api(legacyRoute + "/action",token,"POST",{action:"revise",reason:"Draft test",version:legacyDetail.version},409);
    const edited = await api(legacyRoute,token,"PUT",{
      version:legacyDetail.version,lines:[{...legacyDetail.lines[0], description:"Edited legacy work"}],
    });
    assert.equal(edited.id,legacy.id);
    assert.equal(edited.totals.current,120);
    assert.equal(edited.lines[0].description,"Edited legacy work");
    assert.equal(db.get("SELECT snapshot_json FROM cert_revisions WHERE id=?",[legacy.id]).snapshot_json,original);
    const approved = await api(legacyRoute + "/action",token,"POST",{action:"approve",version:edited.version});
    assert.equal(approved.status,"approved");
    const legacyPaymentsPath = cert + "/projects/" + legacy.project_id + "/collections";
    const legacyReceipt = (await api(legacyPaymentsPath,token)).receipts.find((entry) => entry.kind === "advance");
    assert.equal(legacyReceipt.amount,50);
    await api(legacyPaymentsPath + "/" + legacyReceipt.id,token,"DELETE",undefined,409);
    await api(legacyRoute,token,"PUT",{version:approved.version,lines:[]},422);
    const correction = await api(legacyRoute + "/action",token,"POST",{action:"revise", reason:"Correct an item",version:approved.version});
    assert.equal(correction.totals.current,0);
    assert.equal(correction.totals.previous,120);
    assert.equal(correction.lines[0].description,"Edited legacy work");
    const stillPosted = await api("/documents/statement?customer=Legacy+Test+Customer&report_language=en",token);
    assert.equal(stillPosted.totals.debit,200);
    await api(cert + "/admin/users/" + settingsAdmin.id,token,"PUT",{capabilities:CAPABILITIES,all_projects:true});
    await api(advanceRoute,settingsAdmin.certificate_session,"DELETE",undefined,403);
    await api(advanceRoute,token,"DELETE");
    assert.equal((await api(reportPath,token)).totals.credit,213);
    await api(legacyRoute,settingsAdmin.certificate_session,"DELETE",{version:approved.version},403);
    const removed = await api(legacyRoute,token,"DELETE",{version:approved.version});
    assert.equal(removed.revisions,2);
    await api(legacyRoute,token,"GET",undefined,404);
    await api(cert + "/" + correction.id,token,"GET",undefined,404);
    assert.equal(db.get("SELECT COUNT(*) AS n FROM cert_legacy_records WHERE revision_id=?",[legacy.id]).n,0);
    assert.equal((await api("/documents/statement?customer=Legacy+Test+Customer&report_language=en",token)).totals.credit,75);
    const legacyPaymentRoute = legacyPaymentsPath + "/" + legacyReceipt.id;
    await api(legacyPaymentRoute,token,"PATCH",{amount:55,reference:"Updated workbook advance"});
    assert.ok((await api(legacyPaymentsPath,token)).receipts.some((entry) => entry.id === legacyReceipt.id && entry.amount === 55));
    await api(legacyPaymentRoute,token,"DELETE");
    assert.equal((await api(legacyPaymentsPath,token)).receipts.some((entry) => entry.id === legacyReceipt.id),false);

    const secondProject = cert + "/projects/" + other.id;
    const rule = await api(secondProject + "/settings",token,"PUT",{expected_version:0,effective_at:"2026-01-01",
      settings:{group_by:"unit",show_group_subtotals:true,show_building_subtotals:true,show_unit_subtotals:true},rules:[{category:"advance_recovery",rate:25}]});
    assert.equal(rule.settings.group_by,"unit");
    assert.equal(rule.settings.show_building_subtotals,true);
    assert.equal(rule.settings.show_unit_subtotals,true);
    const recoverable = await api(secondProject + "/collections",token,"POST",{kind:"advance",amount:100,received_at:date},201);
    db.run("INSERT INTO cert_series (project_id,reference,next_number) VALUES (?,'',4)",[other.id]);
    const multiPlace = await api(cert,token,"POST",{header,project_id:other.id,lines:[
      {description:"Work A",mode:"direct",quantity:1,unit:"m",rate:120,building_unit:"Tower 1",floor_apartment:"Apartment 3"},
      {description:"Work B",mode:"direct",quantity:1,unit:"m",rate:160,building_unit:"Tower 1",floor_apartment:"Apartment 4"},
      {description:"Work C",mode:"direct",quantity:1,unit:"m",rate:120,building_unit:"Tower 2",floor_apartment:"Apartment 3"},
    ]},201);
    assert.equal(multiPlace.certificate_number,1);
    assert.equal((await api(cert + "?project_id=" + other.id,token)).items[0].certificate_number,1);
    assert.equal(multiPlace.totals.advance_recovery,100);
    assert.equal(multiPlace.totals.advance_remaining,0);
    assert.equal(multiPlace.header.group_by,"unit");
    assert.equal(multiPlace.report_options.show_building_subtotals,true);
    assert.equal(multiPlace.report_options.show_unit_subtotals,true);
    assert.deepEqual(multiPlace.lines.map((line) => [line.building_unit,line.floor_apartment]),[
      ["Tower 1","Apartment 3"],["Tower 1","Apartment 4"],["Tower 2","Apartment 3"],
    ]);
    const toApprove = cert + "/" + multiPlace.id + "/action";
    const approvedMulti = await api(toApprove,token,"POST",{action:"approve",version:multiPlace.version});
    await api(secondProject + "/collections/" + recoverable.id,token,"DELETE",undefined,409);
    assert.equal(db.get("SELECT amount_minor FROM cert_advance_recoveries WHERE advance_id=?",[recoverable.id]).amount_minor,10000);
    const clearedDraft = await api(cert,token,"POST",{header,project_id:other.id,lines:[
      {description:"Follow-up work",mode:"direct",quantity:10,unit:"m",rate:100},
    ]},201);
    assert.equal(clearedDraft.totals.advance_recovery,0);
    await api(cert + "/" + multiPlace.id,token,"DELETE",{version:approvedMulti.version});
    assert.equal(db.get("SELECT 1 FROM cert_receipts WHERE id=?",[recoverable.id]) != null,true);
    assert.equal((await api(cert + "/" + clearedDraft.id,token)).totals.advance_recovery,100);
    const backdatedProject=await api(cert+"/projects",token,"POST",{customer_id:customer.id,name:"Backdated recovery",contract_date:"2026-03-01"},201);
    const backdatedScope=cert+"/projects/"+backdatedProject.id;
    const currentDate=new Date().toISOString().slice(0,10);
    await api(backdatedScope+"/settings",token,"PUT",{expected_version:0,effective_at:currentDate,
      rules:[{category:"advance_recovery",rate:40}],settings:{}});
    await api(backdatedScope+"/collections",token,"POST",{kind:"advance",amount:1015415,received_at:"2026-03-10"},201);
    await api(backdatedScope+"/collections",token,"POST",{kind:"receipt",amount:849640,received_at:"2026-05-19"},201);
    const backdatedHeader={work_from:"2026-04-07",work_to:"2026-06-01",collection_cutoff:"2026-06-01"};
    const backdatedDraft=await api(cert,token,"POST",{project_id:backdatedProject.id,header:backdatedHeader,
      lines:[{description:"Work",mode:"direct",quantity:1,unit:"Pcs",rate:600008.56}]},201);
    assert.equal(backdatedDraft.rule_version,1);
    assert.equal(backdatedDraft.totals.advance_recovery,240003.42);
    assert.equal(backdatedDraft.totals.ordinary_collections,849640);
    assert.equal(backdatedDraft.totals.cumulative_payable,-489634.86);
    await api(backdatedScope+"/settings",token,"PUT",{expected_version:1,effective_at:currentDate,
      rules:[{category:"advance_recovery",rate:50}],settings:{}});
    assert.equal((await api(cert+"/"+backdatedDraft.id,token)).totals.advance_recovery,240003.42);
    const refreshed=await api(cert+"/"+backdatedDraft.id,token,"PUT",{version:backdatedDraft.version,refresh_rules:true,header:backdatedHeader});
    assert.equal(refreshed.rule_version,2);
    assert.equal(refreshed.totals.advance_recovery,300004.28);
    db.run("UPDATE cert_revisions SET rules_version=NULL WHERE id=?",[backdatedDraft.id]);
    assert.equal((await api(cert+"/"+backdatedDraft.id,token)).totals.advance_recovery,300004.28);
    const frozenProject=await api(cert+"/projects",token,"POST",{customer_id:customer.id,name:"Frozen advance recovery",contract_date:"2026-03-01"},201);
    const frozenScope=cert+"/projects/"+frozenProject.id;
    await api(frozenScope+"/collections",token,"POST",{kind:"advance",amount:1015415,received_at:"2026-03-10"},201);
    const frozenDraft=await api(cert,token,"POST",{project_id:frozenProject.id,
      header:{work_to:"2026-05-01",collection_cutoff:"2026-05-01"},
      lines:[{description:"Approved work",mode:"direct",quantity:1,unit:"Pcs",rate:600008.56}]},201);
    const frozen=await api(cert+"/"+frozenDraft.id+"/action",token,"POST",{action:"approve",version:frozenDraft.version});
    const frozenBytes=db.get("SELECT snapshot_json FROM cert_revisions WHERE id=?",[frozen.id]).snapshot_json;
    await api(frozenScope+"/settings",token,"PUT",{expected_version:0,effective_at:currentDate,
      rules:[{category:"advance_recovery",rate:40}],settings:{}});
    const stale=await api(cert+"/"+frozen.id,token);
    assert.equal(stale.totals.cumulative_payable,600008.56);
    assert.deepEqual(stale.advance_recovery_correction,{rate:40,amount:240003.42,payable:360005.14});
    const correctionBody={action:"revise",recover_advance:true,version:frozen.version,reason:"Apply configured advance recovery",command_key:"recovery-fix"};
    const recoveryFix=await api(cert+"/"+frozen.id+"/action",token,"POST",correctionBody);
    assert.equal((await api(cert+"/"+frozen.id+"/action",token,"POST",correctionBody)).id,recoveryFix.id);
    assert.equal(recoveryFix.certificate_number,frozen.certificate_number);
    assert.equal(recoveryFix.header.work_to,"2026-05-01");
    assert.equal(recoveryFix.header.collection_cutoff,"2026-05-01");
    assert.deepEqual(recoveryFix.validation,[]);
    assert.equal(recoveryFix.totals.current,0);
    assert.equal(recoveryFix.totals.cumulative,600008.56);
    assert.equal(recoveryFix.totals.advance_recovery,240003.42);
    assert.equal(recoveryFix.totals.cumulative_payable,360005.14);
    assert.equal(recoveryFix.totals.advance_remaining,775411.58);
    const approvedFix=await api(cert+"/"+recoveryFix.id+"/action",token,"POST",{action:"approve",version:recoveryFix.version});
    assert.equal(approvedFix.totals.cumulative_payable,360005.14);
    assert.equal(db.get("SELECT SUM(amount_minor) AS amount FROM cert_advance_recoveries WHERE certificate_id=?",[approvedFix.id]).amount,24000342);
    assert.equal(db.get("SELECT snapshot_json FROM cert_revisions WHERE id=?",[frozen.id]).snapshot_json,frozenBytes);
    assert.equal((await api(cert+"/"+frozen.id,token)).advance_recovery_correction,null);
    const numberedProject=await api(cert+"/projects",token,"POST",{customer_id:customer.id,name:"Sequential certificates"},201);
    const numberedHeader={work_to:"2026-06-01",collection_cutoff:"2026-06-01"};
    const numberedLine={id:"stable-opening",identity:"stable-opening",mode:"direct",recognition:"cumulative",description:"Opening",unit:"Pcs",quantity:1,rate:100};
    const one=await api(cert,token,"POST",{project_id:numberedProject.id,header:numberedHeader,lines:[numberedLine]},201);
    const two=await api(cert,token,"POST",{project_id:numberedProject.id,header:{...numberedHeader,work_to:"2026-07-01"},
      lines:[{...numberedLine,quantity:2}]},201);
    assert.equal(one.certificate_number,1);assert.equal(two.certificate_number,2);
    assert.equal((await api(cert+"/"+one.id,token)).certificate_number,1);
    const approvedOne=await api(cert+"/"+one.id+"/action",token,"POST",{action:"approve",version:one.version});
    const nextValuation=await api(cert+"/"+two.id,token);
    assert.equal(nextValuation.baseline.id,one.id);
    assert.equal(nextValuation.totals.previous,100);assert.equal(nextValuation.totals.current,100);
    assert.equal(nextValuation.totals.cumulative,200);
    const approvedTwo=await api(cert+"/"+two.id+"/action",token,"POST",{action:"approve",version:two.version});
    const numberedStatement=await api("/documents/statement?party_id="+customer.id+"&report_language=en",token);
    assert.equal(numberedStatement.statementRows.find(row=>row.document_id==="certificate-"+two.id).document_no,2);
    const sameNumber=await api(cert+"/"+two.id+"/action",token,"POST",{action:"revise",version:approvedTwo.version,reason:"Correct opening"});
    assert.equal(sameNumber.certificate_number,2);
    const changedTwo=await api(cert+"/"+sameNumber.id,token,"PUT",{version:sameNumber.version,
      header:{work_to:"2026-07-01",collection_cutoff:"2026-07-01"},lines:[{...numberedLine,quantity:3}]});
    await api(cert+"/"+sameNumber.id+"/action",token,"POST",{action:"approve",version:changedTwo.version});
    const issuedOne=await api(cert+"/"+one.id+"/action",token,"POST",{action:"issue",version:approvedOne.version});
    const issuedTwo=await api(cert+"/"+two.id+"/action",token,"POST",{action:"issue",version:approvedTwo.version});
    assert.equal(issuedOne.official_number,1);assert.equal(issuedTwo.official_number,2);
    const more=await Promise.all(["2026-08-01","2026-09-01"].map(work_to=>api(cert,token,"POST",{
      project_id:numberedProject.id,header:{...numberedHeader,work_to},lines:[{...numberedLine,quantity:3}]},201)));
    assert.deepEqual(more.map(({certificate_number})=>certificate_number).sort(),[3,4]);
    assert.equal(more[0].totals.previous,300);
    const percentProject=await api(cert+"/projects",token,"POST",{customer_id:customer.id,name:"Cumulative percentage updates"},201);
    const percentLine={identity:"same-opening",description:"Window",mode:"direct",quantity:10,unit:"Pcs",rate:100,recognition:"cumulative",progress:80};
    const percentFirst=await api(cert,token,"POST",{project_id:percentProject.id,header:{work_to:"2026-01-01"},lines:[percentLine]},201);
    const percentApproved=await api(cert+"/"+percentFirst.id+"/action",token,"POST",{action:"approve",version:percentFirst.version});
    const originalPercentSnapshot=db.get("SELECT snapshot_json FROM cert_revisions WHERE id=?",[percentFirst.id]).snapshot_json;
    const revisionCount=db.get("SELECT COUNT(*) AS n FROM cert_revisions").n;
    const carry=await api(cert+"/projects/"+percentProject.id+"/carry-forward?work_to=2026-02-01",token);
    assert.equal(db.get("SELECT COUNT(*) AS n FROM cert_revisions").n,revisionCount);
    assert.equal(carry.lines.length,1);assert.equal(carry.lines[0].previous_progress,80);assert.equal(carry.lines[0].current,0);
    const percentSecond=await api(cert,token,"POST",{project_id:percentProject.id,header:{work_to:"2026-02-01"},
      lines:carry.lines.map(line=>({...line,carried_forward:false,recognition:"cumulative",progress:95}))},201);
    assert.equal(percentSecond.totals.previous,800);assert.equal(percentSecond.totals.current,150);assert.equal(percentSecond.totals.cumulative,950);
    assert.equal(percentSecond.lines[0].previous_progress,80);assert.equal(percentSecond.lines[0].current_progress,15);
    await api(cert+"/"+percentSecond.id+"/action",token,"POST",{action:"approve",version:percentSecond.version});
    const lastCarry=await api(cert+"/projects/"+percentProject.id+"/carry-forward?work_to=2026-03-01",token);
    const percentFinal=await api(cert,token,"POST",{project_id:percentProject.id,header:{work_to:"2026-03-01"},
      lines:lastCarry.lines.map(line=>({...line,carried_forward:false,recognition:"cumulative",progress:100}))},201);
    assert.equal(percentFinal.totals.previous,950);assert.equal(percentFinal.totals.current,50);assert.equal(percentFinal.totals.cumulative,1000);
    assert.equal(db.get("SELECT snapshot_json FROM cert_revisions WHERE id=?",[percentFirst.id]).snapshot_json,originalPercentSnapshot);
    await api("/auth/logout",viewToken,"POST",{user_id:viewer.id});
    await api(cert + "/access",viewToken,"GET",undefined,401);
    assert.equal(db.get("PRAGMA foreign_key_check"),null);

    if (process.env.AM_CERTIFICATE_TEST_RENDER === "1") {
      for (let attempt = 0; attempt < 80 && db.get("SELECT pdf_status FROM cert_revisions WHERE id=?",[issuedId]).pdf_status === "pending"; attempt++) {
        await new Promise((resolve) => setTimeout(resolve,250));
      }
      const bytes = async () => {
        const download = await fetch(base + record + "/pdf",{headers:{Authorization:"Bearer " + token}});
        assert.equal(download.status,200,await (download.ok ? Promise.resolve("") : download.text()));
        return Buffer.from(await download.arrayBuffer());
      };
      const archived = await bytes();
      assert.equal(archived.subarray(0,5).toString(),"%PDF-");
      db.run("UPDATE parties SET display_name=? WHERE id=?",["Renamed customer",customer.id]);
      assert.deepEqual(await bytes(),archived);
      const version = (await api(record,token)).version;
      await api(record + "/documents",settingsAdmin.certificate_session,"DELETE",{version},403);
      assert.ok((await api(record + "/documents",token,"DELETE",{version})).files > 0);
      assert.equal((await api(record,token)).pdf_status,null);
    }
    await api(cert + "/admin/feature",token,"PUT",{enabled:false});
    await api(cert,token,"GET",undefined,403);
    console.log("Certificate workflow, scoped access, valuation and idempotency passed.");
  } finally {
    // Let any issued artifact worker release the scratch database before closing it.
    for (let attempt = 0; issuedId && attempt < 80 && db.get(
      "SELECT 1 FROM cert_pdf_artifacts WHERE certificate_id=? AND status='pending'",[issuedId]); attempt++) {
      await new Promise((resolve) => setTimeout(resolve,250));
    }
    await new Promise((resolve) => httpServer.close(resolve));
    global.fetch = nativeFetch;
    app.close();
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
}

main().catch((error) => {console.error(error);process.exitCode = 1;});
