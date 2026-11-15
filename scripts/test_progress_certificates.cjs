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
    assert.equal(managerAccess.inherited_from_role,true);
    assert.equal(managerAccess.all_projects,true);
    assert.equal(managerAccess.allow_project_creation,true);
    assert.deepEqual(managerAccess.capabilities,CAPABILITIES);
    const settingsAccess = await api(cert + "/access",settingsAdmin.certificate_session);
    assert.equal(settingsAccess.can_admin,true);
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
    assert.equal((await api(cert + "/customers",token,"POST",{name:"مقاولات تجريبية"})).id,customer.id);
    const project = await api(cert + "/projects",token,"POST",
      {customer_id:customer.id,name:"Project 200",contract_ref:"M-1"},201);
    const other = await api(cert + "/projects",token,"POST",{customer_id:customer.id,name:"Second project"},201);
    const scope = cert + "/projects/" + project.id;
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
    await api("/users/" + viewer.id,"","PUT",{requester_user_id:manager.id,password:"changed"},403);

    await api(scope + "/settings",token,"PUT",{expected_version:0,effective_at:"2026-01-01",
      settings:{minimum_area:1.25},rules:[{category:"vat",rate:10},{category:"advance_recovery",rate:10}]});
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
    await api(legacyRoute,token,"PUT",{version:approved.version,lines:[]},409);
    const correction = await api(legacyRoute + "/action",token,"POST",{action:"revise", reason:"Correct an item",version:approved.version});
    assert.equal(correction.totals.current,0);
    assert.equal(correction.totals.previous,120);
    assert.equal(correction.lines[0].description,"Edited legacy work");
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
