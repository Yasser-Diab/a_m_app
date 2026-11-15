const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {createHash} = require("node:crypto");
const {createServer} = require("../server/index.cjs");
const {CAPABILITIES} = require("../server/certificates.cjs");

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
    const token = manager.certificate_session;
    const viewToken = viewer.certificate_session;
    const cert = "/certificates";

    assert.ok(token);
    assert.equal((await api(cert + "/access",token)).can_admin,true);
    await api(cert + "?requester_user_id=" + manager.id,"","GET",undefined,401);
    await api(cert,viewToken,"GET",undefined,403);
    await api(cert + "/admin/users/" + manager.id,token,"PUT",{capabilities:CAPABILITIES,all_projects:true});

    const customer = await api(cert + "/customers",token,"POST",{name:"مقاولات تجريبية",category:"corporate"},201);
    assert.equal((await api(cert + "/customers",token,"POST",{name:"مقاولات تجريبية"})).id,customer.id);
    const project = await api(cert + "/projects",token,"POST",
      {customer_id:customer.id,name:"Project 200",contract_ref:"M-1"},201);
    const other = await api(cert + "/projects",token,"POST",{customer_id:customer.id,name:"Second project"},201);
    const scope = cert + "/projects/" + project.id;
    const location = await api(scope + "/locations",token,"POST",{name:"Building 2"},201);
    const foreign = await api(cert + "/projects/" + other.id + "/locations",token,"POST",{name:"Building 10"},201);
    await api(cert + "/admin/users/" + viewer.id,token,"PUT",{capabilities:["view"],project_ids:[project.id]});
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
    const issued = await Promise.all([
      action("issue",draft.version,undefined,"issue-request"),
      action("issue",draft.version,undefined,"issue-request"),
    ]);
    for (const result of issued) {
      assert.equal(result.status,"issued");
      assert.equal(result.official_number,1);
    }
    const second = await api(cert,token,"POST",{project_id:project.id,header,
      lines:[{...lines[0],mode:"direct",quantity:3,unit:"m",rate:100,recognition:"cumulative"}]},201);
    assert.equal(second.totals.previous,275);
    assert.equal(second.totals.current,50);
    assert.equal(second.totals.cumulative,325);
    assert.equal(second.totals.last_current,275);
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
