const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const path = require("node:path");
const os = require("node:os");
const {createServer} = require("../server/index.cjs");
const {dimensions, estimatedArea, fieldsFor, configuration,loadingQuantities,perimeterDescription,cleanTechnical} = require("../server/project-operations/specifications.cjs");
const {PDFDocument} = require("pdf-lib");

async function main() {
  for (let mask=0;mask<16;mask++) {
    const sides=["right","left","top","bottom"].filter((_,index)=>mask&(1<<index));
    const result=perimeterDescription(sides,"ar");
    assert.ok(result.startsWith(sides.length===4?"ببار كامل":sides.length===1?"ببار ":"بدون بار"));
    assert.ok(perimeterDescription(sides,"en"));
  }
  assert.equal(perimeterDescription(["left","top","bottom"],"ar"),"بدون بار يمين");
  assert.equal(perimeterDescription(["right","left"],"ar"),"بدون بار علوي وسفلي");
  const sliding={tags:["sliding"]};
  assert.equal(loadingQuantities("windows",sliding,{leaves:2,screen:"ضلفة مستقلة"},5).screens,5);
  assert.equal(loadingQuantities("windows",sliding,{leaves:2,screen:"ضلفة مستقلة",screen_leaves:2},5).screens,10);
  assert.equal(loadingQuantities("windows",sliding,{leaves:2,screen:"لا"},5).screens,undefined);
  const temp=await fs.mkdtemp(path.join(process.env.AM_TEST_TEMP||os.tmpdir(),"easycommercial-operations-"));
  const server=await createServer({dataDir:temp,dbPath:path.join(temp,"operations.db"),port:0});
  const http=await server.listen(0,"127.0.0.1");
  const origin="http://127.0.0.1:"+http.address().port+"/api";
  const nativeFetch=global.fetch;
  global.fetch=(target,options)=>String(target).startsWith(origin)
    ? nativeFetch(target,options) : Promise.resolve(Response.json({has_access:true}));
  const db=server.database;
  const password=crypto.randomBytes(16).toString("hex");
  let activeToken;
  async function api(route,method="GET",body,expected=200,token=activeToken) {
    const response=await fetch(origin+route,{method,headers:{"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
    const isPdf=response.headers.get("content-type")?.startsWith("application/pdf");
    const data=isPdf?Buffer.from(await response.arrayBuffer()):await response.json();
    assert.equal(response.status,expected,`${method} ${route}: ${JSON.stringify(data).slice(0,500)}`);
    return data;
  }
  const ops="/project-operations";
  const cert="/certificates";
  try {
    db.run("INSERT OR REPLACE INTO app_settings(key,value) VALUES(?,?)",
      ["company_profile",JSON.stringify({free_access_until:"2099-01-01T00:00:00Z"})]);
    db.run("INSERT OR REPLACE INTO app_settings(key,value) VALUES(?,?)",["report_branding",JSON.stringify({
      companyNameEn:"El-Handasia Group For Architectural Designs",companyNameAr:"المجموعة الهندسية للتصميمات المعمارية",companyAbbreviation:"HGAD"})]);
    const pin=crypto.createHash("sha256").update(password).digest("hex");
    for (const [name,role] of [["ops-manager","manager"],["ops-viewer","user"],["engineer","user"]])
      db.run("INSERT INTO users(username,display_name,role,pin_hash) VALUES(?,?,?,?)",[name,name,role,pin]);
    const login=async(username)=>(await api("/auth/login","POST",{username,password})).user;
    const manager=await login("ops-manager");
    const viewer=await login("ops-viewer");
    activeToken=manager.certificate_session;
    const customer=await api(cert+"/customers","POST",{name:"Operations customer"},201);
    const project=await api(cert+"/projects","POST",{customer_id:customer.id,name:"Operations project",address:"10 Site Road"},201);
    const unrelated=await api(cert+"/projects","POST",{customer_id:customer.id,name:"Other project"},201);
    const scope=ops+"/projects/"+project.id;
    const oldCustomers=db.get("SELECT COUNT(*) AS count FROM parties").count;
    const oldProjects=db.get("SELECT COUNT(*) AS count FROM cert_projects").count;
    assert.equal((await api(scope)).operations,null);
    await api(scope,"POST",{boq_id:900},400);
    const boq=db.run(`INSERT INTO documents(document_type,document_no,operation_no,status,party_id,party_role,project,customer_name,report_language)
      VALUES ('price_offer',900,'BOQ-900','draft',?,'customer',?,?,'en')`,[customer.id,project.name,customer.display_name]).lastInsertRowid;
    const sourceId=db.run(`INSERT INTO work_items(document_id,party_id,project,description,item_count,width_cm,height_cm,total_quantity,quantity,unit,
      unit_code,rate,gross_total,net_total) VALUES (?,?,?,'Window assembly',100,120,140,100,100,'Pcs','count',500,50000,50000)`,
    [boq,customer.id,project.name]).lastInsertRowid;
    await api(scope,"POST",{boq_id:boq},400);
    await api("/documents/"+boq,"PUT",{status:"approved"});
    const info=await api(scope);
    assert.equal(info.project.address,"10 Site Road");
    assert.equal(info.boqs[0].id,boq);
    assert.match(info.boqs[0].approval_date,/^\d{4}-\d{2}-\d{2}$/);
    assert.equal((await api(ops+"/projects/"+unrelated.id)).boqs.length,0);
    await api(scope,"POST",{boq_id:boq});
    await api(scope,"POST",{boq_id:boq});
    assert.equal(db.get("SELECT COUNT(*) AS count FROM parties").count,oldCustomers);
    assert.equal(db.get("SELECT COUNT(*) AS count FROM cert_projects").count,oldProjects);
    const list=await api(scope+"/items");
    assert.equal(list.total,1);
    const initial=list.items[0];
    assert.equal(initial.source_line_id,sourceId);
    assert.equal(initial.original.width_mm,1200);
    assert.equal(initial.original.original_value,50000);
    assert.equal(initial.commercial.quantity,100);
    const originalRecord=db.get("SELECT * FROM work_items WHERE id=?",[sourceId]);
    const cat=await api(ops+"/catalogue");
    assert.equal(cat.categories.reduce((sum,row)=>sum+row.systems.length,0),163);
    const feature=(category,system,key)=>fieldsFor(category,configuration(db,category,system),{}).some((field)=>field.key===key);
    assert.ok(feature("windows","windows-8","tracks"));
    assert.equal(feature("windows","windows-8","hinge"),false);
    assert.ok(feature("windows","windows-2","hinge"));
    assert.equal(feature("windows","windows-2","tracks"),false);
    assert.ok(feature("windows","windows-4","tilt_arm_45"));
    assert.ok(feature("doors","doors-13","motor"));
    assert.ok(feature("curtain_walls","curtain_walls-7","spider"));
    assert.ok(feature("doors","doors-1","glass_type"));
    assert.ok(feature("windows","windows-8","outside_glass"));
    assert.ok(fieldsFor("glass",configuration(db,"glass","glass-1"),{glazing:"Double"}).some(({key})=>key==="inside_glass"));
    assert.ok(fieldsFor("windows",configuration(db,"windows","windows-8"),{hinge:"Previously entered hinge"},true).some(({key})=>key==="hinge"));
    const extension=await api(ops+"/catalogue","POST",{category:"windows",en:"Site window",tags:["sliding"],
      fields:[{key:"edge_code",en:"Edge code",type:"text"}]});
    assert.ok(feature("windows",extension.id,"extra_edge_code"));
    assert.deepEqual(dimensions({width_mm:1200,height_mm:1400,subframe:{status:"deducted",sides:{left:{deduction:50}}}}),
      {width:1200,height:1400});
    assert.equal(estimatedArea({width_mm:1200,height_mm:1400,quantity:100}),168);
    const itemPath=scope+"/items/"+initial.id;
    await api(itemPath,"PATCH",{version:1,code:initial.code,category:"windows",system:"windows-8",
      technical:{quantity:100,width_mm:1200,height_mm:1400,leaves:1,slide_direction:"Left",viewing:"Invalid"}},400);
    const specs={quantity:100,width_mm:1200,height_mm:1400,leaves:1,viewing:"Inside",slide_direction:"Left",
      profile:"Series 100",hinge:"Hidden irrelevant hinge",tag:"W-01",rubber_bar:true,screen:"ضلفة مستقلة",perimeter:["left","top","bottom"],
      subframe:{status:"not_deducted",sides:{left:{width:50,depth:100,deduction:50},
        top:{width:50,depth:50,deduction:25},bottom:{width:50,depth:50,deduction:30}}}};
    let item=await api(itemPath,"PATCH",{version:1,code:initial.code,category:"windows",system:"windows-8",technical:specs});
    assert.deepEqual(item.manufacturing_dimensions,{width:1150,height:1345});
    assert.equal(item.technical.hinge,undefined);
    assert.equal(item.commercial.quantity,100);
    const requested=await api(itemPath+"/changes","POST",{values:{description:"Revised window assembly",quantity:120,width_mm:1225,rate:550},
      reason:"Approved variation"});
    const changePath=scope+"/changes/"+requested.id;
    await api(changePath+"/adjustment","POST",{},409);
    assert.deepEqual(db.get("SELECT * FROM work_items WHERE id=?",[sourceId]),originalRecord);
    const reviewed=await api(changePath+"/review","POST",{status:"approved"});
    assert.ok(reviewed.adjustment_id);
    assert.deepEqual(db.get("SELECT * FROM work_items WHERE id=?",[sourceId]),originalRecord);
    const adjustment=await api(changePath+"/adjustment","POST",{});
    assert.equal(adjustment.id,reviewed.adjustment_id);
    assert.equal(adjustment.status,"draft");
    assert.equal(adjustment.total,16000);
    assert.equal((await api(changePath+"/adjustment","POST",{})).id,adjustment.id);
    await api("/documents/"+adjustment.id,"PUT",{status:"approved"},409);
    const invoice=await api("/documents/invoice?document_id="+adjustment.id);
    assert.equal(invoice.totals.net_total,16000);
    const statement="/documents/statement?party_id="+customer.id+"&project="+encodeURIComponent(project.name);
    assert.equal((await api(statement)).totals.debit,50000);
    await api(changePath+"/post","POST",{});
    assert.equal((await api(statement)).totals.debit,66000);
    const reduction=await api(itemPath+"/changes","POST",{values:{description:"Revised window assembly",quantity:100,rate:550},
      reason:"Reduction"});
    await api(scope+"/changes/"+reduction.id+"/review","POST",{status:"approved"});
    const credit=await api(scope+"/changes/"+reduction.id+"/adjustment","POST",{});
    assert.equal(credit.total,-11000);
    await api(scope+"/changes/"+reduction.id+"/post","POST",{});
    assert.equal((await api(statement)).totals.credit,11000);
    item=await api(itemPath);
    assert.equal(item.original.quantity,100);
    assert.equal(item.commercial.rate,550);
    assert.equal(item.commercial.width_mm,1225);

    await api(scope+"/people","POST",{user_id:manager.id,position:"Loading lead"});
    await api(scope+"/people","POST",{user_id:db.get("SELECT id FROM users WHERE username='engineer'").id,position:"Project engineer"});
    const representative=await api(scope+"/people","POST",{name:"Client representative",company:"Client Company",
      position:"Inspector",mobile:"PRIVATEMOBILE01234",email:"privacy@example.test",details:"private details"});
    assert.equal(representative.mobile,"PRIVATEMOBILE01234");
    await api(scope+"/people","POST",{name:"Consultant",company:"Consulting Co",position:"Technical reviewer"});
    const team=await api(scope+"/people");
    assert.equal(team.length,4);
    const drawing=await api(itemPath+"/drawings","POST",{name:"opening.png",mime:"image/png",
      base64:"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGx0AAAAASUVORK5CYII="});
    assert.equal(drawing.item_version,item.version);
    if (process.env.AM_OPERATIONS_TEST_PDF) {
      const drawingPdf=await PDFDocument.create();
      drawingPdf.addPage([300,150]).drawText("Opening section PDF",{x:20,y:80});
      await api(itemPath+"/drawings","POST",{name:"section.pdf",mime:"application/pdf",
        base64:Buffer.from(await drawingPdf.save()).toString("base64")});
    }

    const order=await api(scope+"/orders","POST",{reference:"PO-10",items:[{item_id:item.id,quantity:100}]});
    const orderPath=scope+"/orders/"+order.id;
    let ready=await api(orderPath);
    assert.equal(ready.balances[0].required,100);
    const orderItemId=ready.items[0].id;
    await api(orderPath,"PATCH",{status:"released"},409);
    const mark=await api(orderPath+"/report","POST",{kind:"manufacturing",classification:"materials",drawings:true,watermark:true});
    assert.match(mark.html,/#d5a1a1/);
    assert.ok(!/class="watermark"/.test(mark.html));
    assert.match(mark.html,/opening\.png/);
    assert.match(mark.html,/Client representative/);
    assert.match(mark.html,/Manufacturing after deduction mm/);
    assert.doesNotMatch(mark.html,/privacy@example\.test|PRIVATEMOBILE01234|private details/);
    await api(orderPath+"/report","POST",{kind:"manufacturing",classification:"manufacturing"},409);
    const parts=Object.fromEntries(cat.approvalParts.map((part)=>[part,{decision:"approved",reference:"ENG-04"}]));
    await api(itemPath+"/approvals","POST",{version:item.version,parts});
    const checklist={measurements:"compliant",profile:"compliant",finish:"compliant",glass:"compliant",opening:"compliant",
      accessories:"compliant",fixing:"compliant",packaging:"compliant"};
    const qc=(stage,data={})=>api(orderPath+"/inspections","POST",{order_item_id:orderItemId,stage,checklist,result:"passed",
      release:"approved",inspection_date:"2026-11-16",...data});
    await qc("survey");
    await api(orderPath,"PATCH",{status:"released"});
    const manufacture=await api(orderPath+"/report","POST",{kind:"manufacturing",classification:"manufacturing",drawings:false,watermark:false});
    assert.match(manufacture.html,/#90bc94/);
    assert.doesNotMatch(manufacture.html,/class="watermark"|<figure>/);
    await qc("pre_shipment",{result:"failed",release:"rejected",defects:"Frame indentation",corrective_action:"Replace member",
      correction_owner:"Project engineer"});
    const batch=(reference,amount)=>{
      return {reference,loading_date:"2026-11-16",responsible:{loading:team[0].id},
        lines:[{order_item_id:orderItemId,kind:"sliding",quantity:amount},{order_item_id:orderItemId,kind:"frames",quantity:amount},
          {order_item_id:orderItemId,kind:"screens",quantity:amount}]};
    };
    await api(orderPath+"/loading","POST",batch("LOAD-1",40),409);
    await api(orderPath+"/inspections","POST",{order_item_id:orderItemId,stage:"pre_shipment",checklist,result:"passed",
      release:"approved",inspection_date:"2026-11-16"},400);
    await qc("pre_shipment",{corrective_action:"New member checked",closed_on:"2026-11-16"});
    assert.equal((await api(orderPath+"/loading","POST",batch("LOAD-1",40))).balances[0].remaining,60);
    await api(orderPath+"/loading","POST",batch("LOAD-1",40),409);
    const report=await api(orderPath+"/report","POST",{kind:"loading",people:{loading:team[0].id}});
    assert.ok(report.html.includes("Total frames")&&report.html.includes("Total leaves"));
    assert.ok(report.html.includes("1200 × 1400")&&report.html.includes("Frames")&&report.html.includes('dir="ltr">60'));
    assert.ok(!report.html.includes("Quality inspections")&&!report.html.includes("Pre-shipment"));
    if (process.env.AM_OPERATIONS_TEST_PDF) {
      const materials=await api(orderPath+"/pdf","POST",{kind:"manufacturing",locale:"ar",classification:"materials",drawings:true,watermark:true});
      const without=await api(orderPath+"/pdf","POST",{kind:"manufacturing",locale:"ar",classification:"materials",drawings:false});
      const loaded=await api(orderPath+"/pdf","POST",{kind:"loading",people:{loading:team[0].id}});
      const pdf=await PDFDocument.load(materials);
      assert.ok(pdf.getPageCount()>(await PDFDocument.load(without)).getPageCount());
      assert.deepEqual(pdf.getPage(pdf.getPageCount()-1).getSize(),{width:300,height:150});
      await fs.writeFile(path.join(process.env.AM_OPERATIONS_TEST_PDF,"manufacturing-ar.pdf"),materials);
      await fs.writeFile(path.join(process.env.AM_OPERATIONS_TEST_PDF,"loading-en.pdf"),loaded);
    }

    const claims=await api(scope+"/claims");
    assert.equal(claims[0].warning.loaded_unclaimed,40);
    assert.equal(claims[0].confirmed,0);
    await api(itemPath+"/confirm","POST",{stage:"installed",reference:"INSTALL-1",quantity:40,confirmed_on:"2026-11-16"});
    const claim={project_id:project.id,header:{work_to:"2026-11-16",locale:"en"},
      lines:[{ops_item_id:item.id,description:"First claim",mode:"count",unit:"Pcs",count:45,quantity:45,rate:550}]};
    assert.equal((await api(cert+"/projects/"+project.id+"/operational-quantities","POST",claim))[0].warning.excess,5);
    const draft=await api(cert,"POST",claim,201);
    const balance=draft.operational_quantities[0];
    assert.equal(balance.current,45);
    assert.equal(balance.warning.loading_excess,5);
    assert.equal(balance.warning.excess,5);
    await api(cert+"/"+draft.id+"/action","POST",{version:draft.version,action:"approve",command_key:crypto.randomUUID()});
    const duplicate=await api(cert+"/projects/"+project.id+"/operational-quantities","POST",
      {...claim,lines:[{...claim.lines[0],recognition:"cumulative"}]});
    assert.equal(duplicate[0].warning.duplicate,45);
    assert.equal((await api(orderPath+"/loading","POST",batch("LOAD-2",35))).balances[0].remaining,25);
    assert.equal((await api(orderPath+"/loading","POST",batch("LOAD-3",25))).balances[0].remaining,0);
    ready=await api(orderPath);
    assert.equal(ready.loads.length,3);
    assert.equal(ready.balances[0].loaded,100);
    await api(orderPath,"PATCH",{status:"shipped"});

    const grants={capabilities:["ops_view"],project_ids:[project.id]};
    await api(cert+"/admin/users/"+viewer.id,"PUT",grants);
    await api(scope,"GET",undefined,200,viewer.certificate_session);
    await api(ops+"/projects/"+unrelated.id,"GET",undefined,404,viewer.certificate_session);
    await api(scope+"/items","POST",{},403,viewer.certificate_session);
    assert.equal((await api(scope+"/people","GET",undefined,200,viewer.certificate_session))
      .find(({id})=>id===representative.id).email,undefined);

    function seedBoq(partyId,name,serial,number,type,descriptions) {
      const id=db.run(`INSERT INTO documents(document_type,document_no,operation_no,status,party_id,party_role,project,customer_name)
        VALUES (?,?,?,'draft',?,'customer',?,?)`,[type,serial,number,partyId,name,"Fixture"]).lastInsertRowid;
      descriptions.forEach((description,index)=>db.run(`INSERT INTO work_items(document_id,party_id,project,description,item_count,width_cm,height_cm,
        total_quantity,quantity,unit,unit_code,rate,gross_total,net_total) VALUES (?,?,?,?,1,?,150,1,1,'Pcs','count',350,350,350)`,
      [id,partyId,name,description,110+index*10]));
      return id;
    }
    const discoveredDoc=seedBoq(customer.id,"East Beach",4331,"004331","invoice",["Repeat slider","Repeat slider","Repeat Slider"]);
    const otherDoc=seedBoq(customer.id,"Dunes",4332,"QUO-4332","price_offer",["Repeat slider","Repeat slider plus"]);
    const discovery=await api(ops+"/projects?q="+encodeURIComponent("٠٠٤٣٣١"));
    assert.equal(discovery.items[0].name,"East Beach");
    assert.equal(discovery.items[0].id,null);
    assert.equal(discovery.items[0].matched_document.id,discoveredDoc);
    assert.equal(discovery.items[0].matched_document.status,"draft");
    assert.equal((await api(ops+"/projects?q=QUO-4332")).items[0].matched_document.id,otherDoc);
    assert.equal((await api(ops+"/projects?q=004331","GET",undefined,200,viewer.certificate_session)).total,0);
    const resolved=await api(ops+"/resolve-project","POST",{document_id:discoveredDoc,project:"East Beach"});
    assert.equal((await api(ops+"/resolve-project","POST",{document_id:discoveredDoc,project:"East Beach"})).id,resolved.id);
    const resolvedPath=ops+"/projects/"+resolved.id;
    let native=await api(resolvedPath);
    assert.equal(native.boqs.length,0);
    assert.equal((await api(ops+"/projects?q="+native.project.code)).items[0].id,resolved.id);
    await api("/documents/"+discoveredDoc,"PUT",{status:"approved"});
    const award=await api(resolvedPath,"POST",{boq_id:discoveredDoc});
    assert.equal(award.award_reference,customer.code+"-"+native.project.code+"-ASG");
    const foundRows=(await api(resolvedPath+"/items")).items;
    assert.equal(foundRows.length,3);
    const [first,second,near]=foundRows;
    const groupPath=resolvedPath+"/specification-groups?boq_id="+discoveredDoc;
    const groups=await api(groupPath);
    assert.deepEqual(groups.map(({count})=>count),[2,1]);
    assert.deepEqual((await api(groupPath+"&item_id="+first.id)).rows.map(({id})=>id),[first.id,second.id]);
    const technical={tag:"W01",leaves:2,profile:"System A",lock_left:"Hook",lock_right:"Latch",central_lock_handle:"Must be ignored"};
    const apply={rows:[{id:first.id,version:first.version,category:"windows",system:"windows-8",technical}],source_id:first.id,apply_matches:true};
    assert.equal((await api(resolvedPath+"/specifications","POST",apply)).applied,1);
    let lines=(await api(resolvedPath+"/items")).items;
    assert.equal(lines[0].technical.central_lock_handle,undefined);
    assert.equal(lines[1].technical.lock_left,"Hook");
    assert.equal(lines[1].technical.lock_right,"Latch");
    assert.equal(lines[1].technical.width_mm,second.technical.width_mm);
    assert.equal(lines[1].technical.tag,undefined);
    assert.equal(lines[2].id,near.id);
    assert.equal(lines[2].system,"");
    await api(resolvedPath+"/specifications","POST",{rows:[{id:first.id,version:lines[0].version,
      technical:{leaves:4,central_lock_handle:"Double-sided pull handle"}}]});
    await api(resolvedPath+"/specifications","POST",{rows:[{id:first.id,version:lines[0].version,technical:{profile:"Stale edit"}}]},409);
    const firstSaved=(await api(resolvedPath+"/items/"+first.id)).technical;
    assert.equal(firstSaved.central_lock_handle,"Double-sided pull handle");
    assert.equal(firstSaved.profile,"System A");
    await api("/documents/"+otherDoc,"PUT",{status:"approved"});
    const dunes=await api(ops+"/resolve-project","POST",{document_id:otherDoc,project:"Dunes"});
    const dunesPath=ops+"/projects/"+dunes.id;
    await api(dunesPath,"POST",{boq_id:otherDoc});
    const nextProjectLines=(await api(dunesPath+"/items")).items;
    assert.equal(nextProjectLines[0].technical.central_lock_handle,"Double-sided pull handle");
    assert.equal(nextProjectLines[0].technical.width_mm,1100);
    assert.equal(nextProjectLines[0].technical.tag,undefined);
    assert.equal(nextProjectLines[1].system,"");
    const otherCustomer=await api(cert+"/customers","POST",{name:"Other customer"},201);
    const isolatedDoc=seedBoq(otherCustomer.id,"East Beach",4333,"004333","invoice",["Repeat slider"]);
    await api("/documents/"+isolatedDoc,"PUT",{status:"approved"});
    const isolated=await api(ops+"/resolve-project","POST",{document_id:isolatedDoc,project:"East Beach"});
    await api(ops+"/projects/"+isolated.id,"POST",{boq_id:isolatedDoc});
    assert.equal((await api(ops+"/projects/"+isolated.id+"/items")).items[0].system,"");
    const extraDoc=seedBoq(customer.id,"East Beach",4334,"004334","invoice",["Repeat slider"]);
    await api("/documents/"+extraDoc,"PUT",{status:"approved"});
    await api(resolvedPath+"/boqs","POST",{boq_id:extraDoc});
    assert.equal((await api(resolvedPath+"/items?boq_id="+extraDoc)).items.length,1);
    assert.equal((await api(resolvedPath)).linked_boqs.length,2);
    const lead=await api(resolvedPath+"/people","POST",{user_id:manager.id,position:"Factory supervisor",responsibility:"loading",signature_usage:"both"});
    const client=await api(resolvedPath+"/people","POST",{name:"Client engineer",company:"Client",signature_usage:"both",email:"hidden@fixture.test"});
    const requestOrder={command_key:crypto.randomUUID(),items:[{item_id:first.id,quantity:1}]};
    const generated=await api(resolvedPath+"/orders","POST",requestOrder);
    assert.equal(generated.reference,award.award_reference.replace(/ASG$/,"WO-0001"));
    assert.equal((await api(resolvedPath+"/orders","POST",requestOrder)).id,generated.id);
    const sourced=await api(resolvedPath+"/orders","POST",{items:[{item_id:second.id,quantity:1}]});
    assert.equal(sourced.reference,award.award_reference.replace(/ASG$/,"WO-0002"));
    const signoffs=await api(resolvedPath+"/orders/"+generated.id+"/report","POST",{kind:"manufacturing",classification:"materials"});
    assert.ok(!signoffs.html.includes("Company sign-off"));
    assert.ok(signoffs.html.includes('<h3>Customer</h3>'));
    assert.ok(signoffs.html.includes(lead.name)&&signoffs.html.includes(client.name));
    assert.ok(signoffs.html.includes("Double-sided pull handle"));
    assert.ok(!signoffs.html.includes("hidden@fixture.test"));
    const generatedQc=await api(resolvedPath+"/orders/"+generated.id+"/inspections","POST",{
      order_item_id:(await api(resolvedPath+"/orders/"+generated.id)).items[0].id,stage:"survey",result:"passed",release:"approved",checklist});
    assert.equal(generatedQc.reference,award.award_reference.replace(/ASG$/,"QC-0001"));
    await api(resolvedPath+"/people/"+client.id,"PATCH",{signature_usage:"all"});
    const service=await api(resolvedPath+"/orders","POST",{
      kind:"maintenance",command_key:crypto.randomUUID(),assignee_id:lead.id,instructions:"Replace worn rollers",
      items:[{item_id:near.id,quantity:1},{item_id:first.id,quantity:1}],
    });
    assert.equal(service.reference,award.award_reference.replace(/ASG$/,"MT-0001"));
    const servicePath=resolvedPath+"/orders/"+service.id;
    await api(servicePath,"PATCH",{status:"released"},409);
    const completion=await api(servicePath+"/complete","POST",{completed_on:"2026-11-17",completion_notes:"Rollers replaced"});
    assert.equal(completion.status,"closed");
    assert.equal(completion.service.completed_on,"2026-11-17");
    assert.equal(completion.inspections.length,0);
    assert.equal(completion.balances.length,0);
    const serviceReport=await api(servicePath+"/report","POST",{kind:"maintenance"});
    assert.ok(serviceReport.html.includes("Maintenance Report")&&serviceReport.html.includes("Rollers replaced"));
    assert.ok(serviceReport.html.includes(client.name)&&!serviceReport.html.includes("hidden@fixture.test"));
    const old=await api(resolvedPath+"/items/"+first.id);
    const rowEdit=(item,fields)=>({
      id:item.id,version:item.version,technical:fields,
      base:{technical:Object.fromEntries(Object.keys(fields).map((key)=>[key,item.technical[key]??null]))},
    });
    const editPath=resolvedPath+"/specifications";
    await api(editPath,"POST",{rows:[rowEdit(old,{color:"Bronze",profile:"Workshop section"})],remember:false});
    await api(editPath,"POST",{rows:[rowEdit(old,{width_mm:"1120"})],remember:false});
    const merged=await api(resolvedPath+"/items/"+first.id);
    assert.equal(merged.technical.width_mm,1120);
    assert.equal(merged.technical.color,"Bronze");
    const sameValue=await api(editPath,"POST",{rows:[rowEdit(old,{width_mm:"1120"})],remember:false});
    assert.equal(sameValue.saved,1);
    const overwrite=rowEdit(old,{profile:"Supervisor section"});
    const sibling=await api(resolvedPath+"/items/"+second.id);
    const collision=await api(editPath,"POST",{rows:[rowEdit(sibling,{height_mm:1550}),overwrite]},409);
    assert.deepEqual(collision.specification_conflicts[0].fields,[{key:"profile",current:"Workshop section",technical:true}]);
    assert.equal((await api(resolvedPath+"/items/"+second.id)).technical.height_mm,sibling.technical.height_mm);
    overwrite.base.technical.profile=collision.specification_conflicts[0].fields[0].current;
    await api(editPath,"POST",{rows:[overwrite],remember:false});
    assert.equal((await api(resolvedPath+"/items/"+first.id)).technical.profile,"Supervisor section");
    const manual=await api(resolvedPath+"/people","POST",{side:"company",name:"Workshop coordinator",position:"Custom workshop title",
      responsibility:"Special site coordination",signature_usage:"all",signature_label:"Workshop handover"});
    assert.equal(manual.side,"company");
    assert.equal(manual.user_id,null);
    assert.equal(manual.responsibility,"Special site coordination");
    assert.equal(manual.signature_label,"Workshop handover");
    const groupDoc=seedBoq(customer.id,"Compact project",4400,"004400","invoice",["Identical opening","Identical opening"]);
    await api("/documents/"+groupDoc,"PUT",{status:"approved"});
    const compactProject=await api(ops+"/resolve-project","POST",{document_id:groupDoc,project:"Compact project"});
    const compactPath=ops+"/projects/"+compactProject.id;
    await api(compactPath,"POST",{boq_id:groupDoc});
    const manualCompany=await api(compactPath+"/people","POST",{side:"company",name:"Workshop foreman",position:"Workshop supervisor",
      signature_usage:"all",responsibility:"loading",signature_label:"Factory handover"});
    await api(compactPath+"/people","POST",{side:"client",name:"Receiving engineer",position:"Client engineer",
      signature_usage:"all",responsibility:"reviewer",email:"private@client.example"});
    const compactItems=(await api(compactPath+"/items")).items;
    await api(compactPath+"/specifications","POST",{rows:compactItems.map((row)=>({id:row.id,version:row.version,category:"windows",system:"windows-8",
      technical:{leaves:2,profile:"TEMPO 84",glazing:"Double",coating_direction:"داخل الكتلة",screen:"بليسيه",lock_left:"DCL",lock_right:"KNG",
        glass_type:"Tempered",infill:"6 mm reflective + 12 mm argon + 6 mm clear",glass_color:"GREEN",glass_thickness:24,
        layers:2,outside_glass:"Reflective tempered",outside_thickness:6,spacer_thickness:12,cavity:"Argon",
        inside_glass:"Clear tempered",inside_thickness:6,rubber_bar:false,panel_counts:{sliding:2},divider_width:0,
        depth_mm:50,drawing_ref:"DWG-OPENING-01",site_notes:"Confirm site access",workshop_notes:"Protect finished faces",
        measurement_status:"معتمد",material_status:"معتمد"}})),remember:false});
    const compactOrder=await api(compactPath+"/orders","POST",{items:compactItems.map(({id})=>({item_id:id,quantity:1}))});
    const compactEndpoint=compactPath+"/orders/"+compactOrder.id;
    const currentCompact=await api(compactPath+"/items/"+compactItems[0].id);
    await api(compactPath+"/items/"+currentCompact.id,"PATCH",{...currentCompact,
      technical:{...currentCompact.technical,viewing:"Inside"}});
    const compactReport=await api(compactEndpoint+"/report","POST",{kind:"manufacturing",classification:"materials",locale:"ar"});
    assert.equal((await api(compactEndpoint)).items[0].specification.technical.viewing,"Inside");
    assert.equal((compactReport.html.match(/class="work-group"/g)||[]).length,1);
    assert.equal((compactReport.html.match(/TEMPO 84/g)||[]).length,1);
    assert.ok(compactReport.html.includes("التسكيك")&&compactReport.html.includes("تسكيك شمال DCL - تسكيك يمين KNG"));
    assert.ok(compactReport.html.includes("داخل الكتلة")&&compactReport.html.includes("السلك"));
    for (const detail of ["نوع الزجاج","سيكوريت","تكوين الزجاج / الحشو","6 mm reflective + 12 mm argon + 6 mm clear",
      "Reflective tempered","Clear tempered","أرجون","DWG-OPENING-01","Confirm site access","Protect finished faces","الربر بار","المكونات لكل فتحة"])
      assert.ok(compactReport.html.includes(detail),"Report omitted "+detail);
    assert.ok(compactReport.html.includes('dir="ltr">0</bdi>'));
    assert.ok(!compactReport.html.includes("مقاس التصنيع"));
    assert.ok(!compactReport.html.includes("وجهة الرؤية")&&!compactReport.html.includes("حالة اعتماد المقاس")&&!compactReport.html.includes("حالة اعتماد الخامات"));
    const sparseOrder=structuredClone((await api(compactEndpoint)).items);
    sparseOrder[0].specification.technical.perimeter=["right","left","top","bottom"];
    sparseOrder[0].specification.technical.screen_material="Fiberglass";
    db.run("UPDATE ops_order_items SET specification=? WHERE id=?",[JSON.stringify(sparseOrder[0].specification),sparseOrder[0].id]);
    const combined=await api(compactEndpoint+"/report","POST",{kind:"manufacturing",classification:"materials",locale:"en",measurement_watermark:true});
    assert.equal((combined.html.match(/class="work-group"/g)||[]).length,1);
    assert.ok(combined.html.includes("Item 1 of 1")&&combined.html.includes("Specified for openings")&&combined.html.includes("MEASUREMENTS UNAPPROVED"));
    const different=structuredClone(sparseOrder[1].specification);
    different.technical.profile="A different section";
    db.run("UPDATE ops_order_items SET specification=? WHERE id=?",[JSON.stringify(different),sparseOrder[1].id]);
    const split=await api(compactEndpoint+"/report","POST",{kind:"manufacturing",classification:"materials",locale:"en"});
    assert.equal((split.html.match(/class="work-group"/g)||[]).length,2);
    assert.ok(split.html.includes("Item 1 of 2")&&split.html.includes("Item 2 of 2")&&split.html.includes("break-before:page"));
    for (const row of sparseOrder) db.run("UPDATE ops_order_items SET specification=? WHERE id=?",[JSON.stringify(row.specification),row.id]);
    for (const stage of cat.approvalParts) await api(compactEndpoint+"/approvals","POST",{stage,approved:true});
    await api(compactEndpoint+"/approvals","POST",{stage:"manufacturing",approved:true});
    await api(compactEndpoint+"/approvals","POST",{stage:"pre_shipment",approved:true});
    const fullOrder=await api(compactEndpoint);
    assert.equal(fullOrder.stage_approvals.every(({approved})=>approved),true);
    const measurementMarked=await api(compactEndpoint+"/report","POST",{kind:"manufacturing",classification:"manufacturing",locale:"en",measurement_watermark:true});
    assert.ok(measurementMarked.html.includes("MEASUREMENTS APPROVED"));
    assert.equal(fullOrder.balances.filter(({kind})=>kind==="frames").reduce((sum,row)=>sum+row.required,0),2);
    assert.equal(fullOrder.balances.filter(({kind})=>kind==="sliding").reduce((sum,row)=>sum+row.required,0),4);
    const firstOrderItem=fullOrder.items[0];
    await api(compactEndpoint+"/approvals","POST",{stage:"glass",approved:false,order_item_id:firstOrderItem.id});
    assert.equal((await api(compactEndpoint)).stage_approvals.find(({stage})=>stage==="glass").approved,false);
    await api(compactEndpoint+"/report","POST",{kind:"manufacturing",classification:"manufacturing"},409);
    await api(compactEndpoint+"/approvals","POST",{stage:"glass",approved:true,order_item_id:firstOrderItem.id});
    const signed=await api(compactEndpoint+"/report","POST",{kind:"manufacturing",classification:"manufacturing"});
    assert.ok(!signed.html.includes("Approved")&&!signed.html.includes("Approval status"));
    const approvalStatus=await api(compactEndpoint+"/report","POST",{kind:"approvals",locale:"en"});
    assert.ok(approvalStatus.html.includes("Approval Status")&&approvalStatus.html.includes("Approved"));
    const manifest=await api(compactEndpoint+"/report","POST",{kind:"loading",locale:"ar"});
    assert.ok(manifest.html.includes("1100 × 1500")&&manifest.html.includes("1200 × 1500"));
    assert.ok(manifest.html.includes("الحلوق")&&manifest.html.includes("الضلف"));
    assert.ok(manifest.html.includes("أمر تحميل")&&manifest.html.includes("ضلف سلك"));
    const numberedLoading=await api(compactEndpoint);
    assert.match(numberedLoading.loading_reference,/-LO-\d{4}$/);
    const sameLoading=await api(compactEndpoint+"/report","POST",{kind:"loading",locale:"en"});
    assert.ok(sameLoading.html.includes("Loading Order "+numberedLoading.loading_reference));
    assert.ok(!manifest.html.includes("اجتاز")&&!manifest.html.includes("قبل الشحن"));
    await api(compactEndpoint+"/approvals","POST",{stage:"pre_shipment",approved:false});
    const withFrames={command_key:crypto.randomUUID(),loading_date:"2026-01-10",responsible:{loading:manualCompany.id},
      lines:[{order_item_id:firstOrderItem.id,kind:"sliding",quantity:2},{order_item_id:firstOrderItem.id,kind:"frames",quantity:1},
        {order_item_id:firstOrderItem.id,kind:"screens",quantity:1}]};
    await api(compactEndpoint+"/loading","POST",withFrames,409);
    await api(compactEndpoint+"/approvals","POST",{stage:"pre_shipment",approved:true});
    const dispatch=await api(compactEndpoint+"/loading","POST",withFrames);
    assert.equal(dispatch.reference,numberedLoading.loading_reference);
    assert.equal(dispatch.balances.find(({kind,order_item_id})=>kind==="screens"&&order_item_id===firstOrderItem.id).loaded,1);
    const nextLoading=await api(compactEndpoint+"/report","POST",{kind:"loading",locale:"en"});
    const afterLoading=await api(compactEndpoint);
    assert.notEqual(afterLoading.loading_reference,numberedLoading.loading_reference);
    assert.ok(nextLoading.html.includes(afterLoading.loading_reference));
    assert.equal(dispatch.balances.filter(({kind})=>kind==="frames").reduce((sum,row)=>sum+row.loaded,0),1);
    const claimComparison=await api(compactPath+"/claims");
    assert.equal(claimComparison[0].loaded,2);
    assert.equal(claimComparison[0].warning.loading_excess,null);
    if (process.env.AM_OPERATIONS_TEST_PDF) {
      for (const [name,opts] of [["compact-order-ar",{kind:"manufacturing",classification:"manufacturing",locale:"ar"}],
        ["loading-sizes-ar",{kind:"loading",locale:"ar"}],["approval-status-en",{kind:"approvals",locale:"en"}]]) {
        const file=await api(compactEndpoint+"/pdf","POST",opts);
        await fs.writeFile(path.join(process.env.AM_OPERATIONS_TEST_PDF,name+".pdf"),file);
      }
      const response=await fetch(origin+compactEndpoint+"/pdf",{method:"POST",headers:{"Content-Type":"application/json",
        Authorization:"Bearer "+activeToken},body:JSON.stringify({kind:"loading",locale:"en"})});
      assert.ok(response.headers.get("content-disposition").includes("Operations customer - "+afterLoading.loading_reference+" - Loading.pdf"));
      await response.arrayBuffer();
    }
    const reportOptions=await api(ops+"/report-options");
    assert.ok(reportOptions.projects.some(row=>row.id===compactProject.id));
    const progressReport=await api(ops+"/reports/progress?include_completed=1");
    const compactProgress=progressReport.items.find(row=>row.id===compactProject.id);
    assert.ok(compactProgress);assert.equal(compactProgress.counts.items,2);
    const takeoff=await api(ops+"/reports/quantities?mode=project&project_id="+compactProject.id);
    assert.equal(takeoff.items.length,2);assert.equal(takeoff.totals.count,2);
    const loadedTakeoff=await api(ops+"/reports/quantities?mode=loading&project_id="+compactProject.id+"&from=2000-01-01&to=2099-01-01");
    assert.equal(loadedTakeoff.totals.count,1);assert.equal(loadedTakeoff.totals.components.frames,1);
    assert.equal(loadedTakeoff.totals.components.screens,1);assert.equal(loadedTakeoff.totals.components.sliding,2);
    const excluded=await api(ops+"/reports/quantities?mode=loading&project_id="+compactProject.id+"&from=1999-01-01&to=1999-12-31");
    assert.equal(excluded.total,0);
    const nextOpening=fullOrder.items[1];
    await api(compactEndpoint+"/loading","POST",{command_key:crypto.randomUUID(),loading_date:"2026-02-01",responsible:{loading:manualCompany.id},
      lines:[{order_item_id:nextOpening.id,kind:"frames",quantity:1},{order_item_id:nextOpening.id,kind:"sliding",quantity:2}]});
    const partial=await api(ops+"/reports/quantities?mode=loading&project_id="+compactProject.id+"&from=2026-02-01&to=2026-02-28");
    assert.equal(partial.totals.count,0);assert.equal(partial.totals.components.frames,1);assert.equal(partial.totals.components.sliding,2);
    await api(compactEndpoint+"/loading","POST",{command_key:crypto.randomUUID(),loading_date:"2026-03-01",responsible:{loading:manualCompany.id},
      lines:[{order_item_id:nextOpening.id,kind:"screens",quantity:1}]});
    const completedLater=await api(ops+"/reports/quantities?mode=loading&project_id="+compactProject.id+"&from=2026-03-01&to=2026-03-01");
    assert.equal(completedLater.totals.count,1);assert.equal(completedLater.totals.components.screens,1);
    const entireLoading=await api(ops+"/reports/quantities?mode=loading&project_id="+compactProject.id+"&from=2026-01-01&to=2026-03-01");
    assert.equal(entireLoading.totals.count,2);assert.equal(entireLoading.totals.components.frames,2);
    const beforeMixed=db.get("SELECT commercial FROM ops_items WHERE id=?",[compactItems[1].id]).commercial;
    db.run("UPDATE ops_items SET commercial=? WHERE id=?",[JSON.stringify({...JSON.parse(beforeMixed),unit:"m²",quantity:7}),compactItems[1].id]);
    const mixed=await api(ops+"/reports/quantities?mode=project&project_id="+compactProject.id);
    assert.equal(mixed.totals.quantities.length,2);assert.equal(mixed.totals.quantities.find(row=>row.unit==="m²").quantity,7);
    db.run("UPDATE ops_items SET commercial=? WHERE id=?",[beforeMixed,compactItems[1].id]);
    await api(ops+"/reports/quantities?mode=loading&from=2026-12-01&to=2026-01-01","GET",undefined,400);
    const restricted=await api(ops+"/reports/progress?include_completed=1","GET",undefined,200,viewer.certificate_session);
    assert.ok(restricted.items.every(row=>row.id===project.id));
    await api(ops+"/reports/quantities?mode=project&project_id="+compactProject.id,"GET",undefined,404,viewer.certificate_session);
    const stateBeforeSignatures=(await api(compactPath)).operations;
    const savedSignatures=await api(compactPath+"/signatures","PATCH",{version:stateBeforeSignatures.version,kind:"manufacturing",signatures:[
      {name:"",title:"Workshop release",side:"company"},{name:"Named receiver",title:"",company:"Client organization",side:"client"}]});
    const signatureOrder=await api(compactEndpoint+"/report","POST",{kind:"manufacturing",classification:"materials",locale:"en"});
    assert.ok(signatureOrder.html.includes("Workshop release")&&signatureOrder.html.includes("Named receiver"));
    assert.ok(!signatureOrder.html.includes("private@client.example"));
    const loadSignatures=await api(compactPath+"/signatures","PATCH",{version:savedSignatures.version,kind:"loading",signatures:[{name:"Loading signatory",title:"Dispatch",side:"company"}]});
    const signatureLoading=await api(compactEndpoint+"/report","POST",{kind:"loading",locale:"en"});
    assert.ok(signatureLoading.html.includes("Loading signatory"));assert.ok(!signatureLoading.html.includes("Named receiver"));
    await api(compactPath,"PATCH",{version:loadSignatures.version,details:{address:"Updated site"}});
    assert.equal((await api(compactPath)).operations.details.report_signatures.loading[0].name,"Loading signatory");
    const stillOther=(await api(resolvedPath)).operations.details.report_signatures;
    assert.equal(stillOther?.loading,undefined);
    if(process.env.AM_OPERATIONS_TEST_PDF)for(const locale of ["ar","en"])for(const kind of ["progress","quantities"]){
      const bytes=await api(ops+"/reports/"+kind+"/pdf","POST",{locale,include_completed:"1",mode:"project",...(kind==="quantities"?{project_id:compactProject.id}:{})});
      await fs.writeFile(path.join(process.env.AM_OPERATIONS_TEST_PDF,"management-"+kind+"-"+locale+".pdf"),bytes);
    }
    const refreshDoc=seedBoq(customer.id,"Source refresh project",5500,"005500","invoice",["Refresh slider","Removed opening"]);
    await api('/documents/'+refreshDoc,'PUT',{status:'approved'});
    const refreshProject=await api(ops+'/resolve-project','POST',{document_id:refreshDoc,project:'Source refresh project'});
    const refreshPath=ops+'/projects/'+refreshProject.id;
    await api(refreshPath,'POST',{boq_id:refreshDoc});
    const beforeRefresh=(await api(refreshPath+'/items')).items;
    for(const item of beforeRefresh)await api(refreshPath+'/items/'+item.id,'PATCH',{version:item.version,code:item.code,category:'windows',system:'windows-8',
      technical:{...item.technical,leaves:2,profile:'Customer series',infill:'Clear tempered',vent_opening:true,vent_size:'250',rubber_bar:false,lock_left:'Left latch',lock_right:'Right latch'},remember:true});
    const customerDefaults=db.all('SELECT * FROM ops_customer_specs WHERE customer_id=? ORDER BY description',[customer.id]);
    const openOrder=await api(refreshPath+'/orders','POST',{items:beforeRefresh.map(item=>({item_id:item.id,quantity:1}))});
    const openPath=refreshPath+'/orders/'+openOrder.id;
    const signState=(await api(refreshPath)).operations;
    await api(refreshPath+'/signatures','PATCH',{version:signState.version,kind:'manufacturing',signatures:[{name:'Source signatory',side:'company'}]});
    const sourceLines=db.all('SELECT * FROM work_items WHERE document_id=? ORDER BY id',[refreshDoc]);
    db.run('UPDATE work_items SET item_count=2,width_cm=135,rate=420,total_quantity=2,quantity=2 WHERE id=?',[sourceLines[0].id]);
    db.run("UPDATE work_items SET deleted_at=CURRENT_TIMESTAMP WHERE id=?",[sourceLines[1].id]);
    db.run(`INSERT INTO work_items(document_id,party_id,project,description,item_count,width_cm,height_cm,total_quantity,quantity,unit,unit_code,rate)
      VALUES (?,?,?,'Refresh slider',1,160,170,1,1,'Pcs','count',430)`,[refreshDoc,customer.id,'Source refresh project']);
    let sourcePreview=await api(refreshPath+'/source-refresh?document_id='+refreshDoc);
    assert.equal(sourcePreview.updated,1);assert.equal(sourcePreview.added,1);assert.equal(sourcePreview.removed,1);assert.equal(sourcePreview.refreshable_orders,1);
    await api(refreshPath+'/source-refresh','POST',{...sourcePreview,document_id:refreshDoc},400);
    await api(refreshPath+'/source-refresh','POST',{...sourcePreview,document_id:refreshDoc,confirm:true,fingerprint:'stale'},409);
    const refreshed=await api(refreshPath+'/source-refresh','POST',{...sourcePreview,document_id:refreshDoc,confirm:true});
    assert.equal(refreshed.refreshable_orders,1);
    let refreshedItems=(await api(refreshPath+'/items')).items;
    assert.equal(refreshedItems.filter(item=>item.active).length,2);
    const refreshedOriginal=refreshedItems.find(item=>item.id===beforeRefresh[0].id);
    assert.equal(refreshedOriginal.commercial.rate,420);assert.equal(refreshedOriginal.technical.quantity,2);assert.equal(refreshedOriginal.technical.width_mm,1350);
    assert.equal(refreshedOriginal.original.width_mm,1100);
    let updatedOrder=await api(openPath);
    assert.equal(updatedOrder.items.length,2);assert.equal(updatedOrder.items.reduce((sum,item)=>sum+item.quantity,0),3);
    assert.ok(updatedOrder.items.every(item=>item.specification.technical.profile==='Customer series'));
    assert.deepEqual(db.all('SELECT * FROM ops_customer_specs WHERE customer_id=? ORDER BY description',[customer.id]),customerDefaults);
    assert.equal((await api(refreshPath)).operations.details.report_signatures.manufacturing[0].name,'Source signatory');
    const tilted=configuration(db,'windows','windows-4'),slider=configuration(db,'windows','windows-8');
    for(const system of [tilted,slider]){
      assert.ok(fieldsFor('windows',system,{}).some(field=>field.key==='vent_opening'));
      assert.ok(!fieldsFor('windows',system,{}).some(field=>field.key==='vent_size'));
      assert.ok(fieldsFor('windows',system,{vent_opening:true}).some(field=>field.key==='vent_size'));
      assert.ok(!fieldsFor('windows',system,{vent_opening:true}).some(field=>field.key==='vent_position'));
      const withFixed=fieldsFor('windows',system,{vent_opening:true,fixed_panels:1});
      assert.deepEqual(withFixed.find(field=>field.key==='vent_position').options,['Right','Left','Centre','In leaf']);
    }
    assert.equal(cleanTechnical(db,'windows',tilted,{vent_opening:true,vent_size:'250',fixed_panels:1,vent_position:'Centre'}).vent_position,'Centre');
    assert.equal(cleanTechnical(db,'windows',tilted,{vent_opening:false,vent_size:'250'}).vent_size,undefined);
    const sparse=db.all('SELECT id,specification FROM ops_order_items WHERE order_id=?',[openOrder.id]);
    for(const row of sparse){const spec=JSON.parse(row.specification);spec.technical={quantity:1,leaves:2,vent_opening:true,vent_size:'250',rubber_bar:false,divider_width:0};
      spec.commercial.profile='Do not restore a cleared profile';spec.commercial.glass='Do not restore cleared infill';
      db.run('UPDATE ops_order_items SET specification=? WHERE id=?',[JSON.stringify(spec),row.id]);}
    const sparseReport=await api(openPath+'/report','POST',{kind:'manufacturing',classification:'materials',locale:'en'});
    for(const missing of ['Do not restore','Perimeter','Width mm','Height mm','Glass type','Infill','Vent position'])assert.ok(!sparseReport.html.includes(missing),missing);
    assert.ok(sparseReport.html.includes('Vent size (mm)')&&sparseReport.html.includes('250')&&sparseReport.html.includes('Rubber bar'));
    for(const row of sparse){const item=updatedOrder.items.find(item=>item.id===row.id);db.run('UPDATE ops_order_items SET specification=? WHERE id=?',[JSON.stringify(item.specification),row.id]);}
    for(const stage of [...cat.approvalParts,'manufacturing','pre_shipment'])await api(openPath+'/approvals','POST',{stage,approved:true});
    updatedOrder=await api(openPath);
    const loadItem=updatedOrder.items[0];
    const dispatcher=await api(refreshPath+'/people','POST',{side:'company',name:'Refresh dispatcher',position:'Dispatch',responsibility:'loading'});
    await api(openPath+'/loading','POST',{command_key:crypto.randomUUID(),responsible:{loading:dispatcher.id},lines:Object.entries(loadItem.quantities).map(([kind,quantity])=>({order_item_id:loadItem.id,kind,quantity}))});
    const history=db.get('SELECT specification FROM ops_order_items WHERE id=?',[loadItem.id]).specification;
    db.run('UPDATE work_items SET item_count=3,width_cm=140 WHERE id=?',[sourceLines[0].id]);
    sourcePreview=await api(refreshPath+'/source-refresh?document_id='+refreshDoc);
    assert.equal(sourcePreview.historical_orders,1);assert.equal(sourcePreview.refreshable_orders,0);
    await api(refreshPath+'/source-refresh','POST',{...sourcePreview,document_id:refreshDoc,confirm:true});
    assert.equal(db.get('SELECT specification FROM ops_order_items WHERE id=?',[loadItem.id]).specification,history);
    const keepDoc=seedBoq(customer.id,'Source refresh project',5501,'005501','price_offer',['Keep this opening']);
    await api('/documents/'+keepDoc,'PUT',{status:'approved'});await api(refreshPath+'/boqs','POST',{boq_id:keepDoc});
    const keepItem=(await api(refreshPath+'/items?boq_id='+keepDoc)).items[0];
    await api(refreshPath+'/items/'+keepItem.id,'PATCH',{version:keepItem.version,code:keepItem.code,category:'windows',system:'windows-8',technical:{...keepItem.technical,leaves:2}});
    const mixedOrder=await api(refreshPath+'/orders','POST',{items:[{item_id:beforeRefresh[0].id,quantity:1},{item_id:keepItem.id,quantity:1}]});
    const changeToRemove=await api(refreshPath+'/items/'+beforeRefresh[0].id+'/changes','POST',{values:{rate:450},reason:'Delete linked adjustment with source'});
    const reviewedRemoval=await api(refreshPath+'/changes/'+changeToRemove.id+'/review','POST',{status:'approved'});
    const defaultsBeforeDeletion=db.all('SELECT * FROM ops_customer_specs WHERE customer_id=? ORDER BY description',[customer.id]);
    const deleteBody={requester_user_id:manager.id};
    await api('/documents/'+refreshDoc,'DELETE',deleteBody,409);
    const currentState=(await api(refreshPath)).operations;
    await api(refreshPath,'PATCH',{version:currentState.version,details:{...currentState.details,status:'موقوف'}});
    db.run('UPDATE users SET can_change_status=1 WHERE id=?',[viewer.id]);
    await api('/documents/'+refreshDoc,'DELETE',deleteBody,403,viewer.certificate_session);
    const deletedSource=await api('/documents/'+refreshDoc,'DELETE',deleteBody);
    assert.ok(deletedSource.removed.document_ids.includes(refreshDoc)&&deletedSource.removed.document_ids.includes(reviewedRemoval.adjustment_id));
    assert.equal(db.get('SELECT id FROM documents WHERE id=?',[refreshDoc]),null);
    assert.equal(db.get('SELECT id FROM documents WHERE id=?',[reviewedRemoval.adjustment_id]),null);
    assert.equal(db.get('SELECT id FROM work_items WHERE document_id=?',[refreshDoc]),null);
    assert.equal(db.get('SELECT id FROM ops_items WHERE source_document_id=?',[refreshDoc]),null);
    assert.equal(db.get('SELECT id FROM ops_orders WHERE id=?',[openOrder.id]),null);
    assert.equal((await api(refreshPath+'/orders/'+mixedOrder.id)).items.length,1);
    assert.equal((await api(refreshPath)).operations.boq_id,keepDoc);
    assert.ok(db.get('SELECT id FROM documents WHERE id=?',[keepDoc]));
    assert.deepEqual(db.all('SELECT * FROM ops_customer_specs WHERE customer_id=? ORDER BY description',[customer.id]),defaultsBeforeDeletion);
    await api('/documents/'+keepDoc,'DELETE',deleteBody);
    assert.equal((await api(refreshPath)).operations,null);assert.ok(db.get('SELECT id FROM cert_projects WHERE id=?',[refreshProject.id]));
    assert.ok(db.get("SELECT id FROM ops_audit WHERE action='source_document_deleted' AND entity_id=?",[refreshDoc]));
    assert.equal(db.all("PRAGMA foreign_key_check").length,0);
    console.log("Project Operations integration, discovery, bulk specifications, customer defaults, locks, generated references, sign-offs, finance and loading passed");
  } finally {
    global.fetch=nativeFetch;
    await new Promise((resolve)=>http.close(resolve));
    server.close();
    await fs.rm(temp,{recursive:true,force:true});
  }
}
main().catch((error)=>{console.error(error);process.exitCode=1;});
