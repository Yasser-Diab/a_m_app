const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const ExcelJS=require('exceljs');
const {createServer}=require('../server/index.cjs');

async function main(){
  const temp=fs.mkdtempSync(path.join(process.env.AM_TEST_TEMP||os.tmpdir(),'easycommercial-contractor-reports-'));
  const app=await createServer({dataDir:temp,dbPath:path.join(temp,'test.db'),port:0}),http=await app.listen(0,'127.0.0.1');
  const origin='http://127.0.0.1:'+http.address().port,realFetch=global.fetch;
  global.fetch=(url,options)=>String(url).startsWith(origin)?realFetch(url,options):Promise.resolve(Response.json({has_access:true}));
  const api=async(route,body)=>{
    const response=await realFetch(origin+route,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
    const type=response.headers.get('content-type')||'';
    const data=type.includes('application/json')?await response.json():type.includes('text/html')?await response.text():Buffer.from(await response.arrayBuffer());
    assert.equal(response.ok,true,typeof data==='object'&&!Buffer.isBuffer(data)?JSON.stringify(data):route);return data;
  };
  try{
    const customer='مقاول الاختبار الأول',project='مشروع الاختبار الأول';
    const work=async(name,site,type,description,rate)=>{
      const batch=await api('/api/entries/batch',{rows:[{client_row_id:site+type,data:{document_type:'contractor_certificate',document_status:'approved',
        party_role:'contractor',party_category:'individual',customer_name:name,base_party_name:name,project:site,entry_date:'2026-11-21',
        certificate_no:'1',work_type:type,description,building_unit:'واجهتين',unit_code:'count',total_quantity:1,rate,completion_ratio:100}}]});
      return batch.rows[0];
    };
    const selected=await work(customer,project,'إيجار سقالات','إيجار السقالات عن شهر أكتوبر\nيشمل الفك والتركيب',92500);
    const second=await work(customer,'مشروع ثان','تشطيبات','أعمال تشطيب الواجهة',7500);
    const unrelated=await work('مقاول الاختبار الثاني',project,'فك كلادينج','مقاول آخر',2000);
    const pay=async(name,site,amount,note,role='contractor',partyId)=>api('/api/payments',{party_id:partyId,party_role:role,party_category:'individual',
      customer_name:name,base_party_name:name,project:site,entry_date:'2026-11-21',amount,payment_type:role==='contractor'?'out':'in',note});
    const firstPayment=await pay(customer,project,1500,'Selected contractor first project','contractor',selected.party_id);
    const secondPayment=await pay(customer,'مشروع ثان',250,'Selected contractor second project','contractor',selected.party_id);
    await pay('مقاول الاختبار الثاني',project,800,'UNRELATED CONTRACTOR PAYMENT','contractor',unrelated.party_id);
    await pay(customer,project,900,'SAME NAME CUSTOMER COLLECTION','customer');
    await pay('عميل آخر',project,100,'UNRELATED CUSTOMER COLLECTION','customer');
    const root='/api/documents/contractor',documentQuery='document_id='+selected.document_id;
    for(const identity of [documentQuery,'operation_no='+encodeURIComponent(selected.operation_no),'serial='+selected.serial,'party_id='+selected.party_id]){
      const report=await api(root+'?'+identity);
      assert.deepEqual(report.paymentRows.map(row=>row.id).sort((a,b)=>a-b),[firstPayment.id,secondPayment.id].sort((a,b)=>a-b),identity);
      assert.equal(report.totals.credit,1750);assert.ok(report.rows.every(row=>row.party_id===selected.party_id));
      assert.equal(report.totals.net_total,report.totals.real_net_total-1750);
      const filtered=await api(root+'?'+identity+'&projects='+encodeURIComponent(JSON.stringify([project])));
      assert.deepEqual(filtered.paymentRows.map(row=>row.id),[firstPayment.id]);assert.equal(filtered.totals.credit,1500);
    }
    const staleParty=await api(root+'?'+documentQuery+'&party_id='+unrelated.party_id);
    assert.deepEqual(staleParty.paymentRows.map(row=>row.id),[firstPayment.id,secondPayment.id]);
    const invalid=await api(root+'?document_id=not-a-real-document');assert.equal(invalid.paymentRows.length,0);
    for(const locale of ['ar','en'])for(const modern of [0,1])for(const filterProject of [false,true]){
      const query=documentQuery+'&report_language='+locale+'&modern_certificate='+modern+(filterProject?'&projects='+encodeURIComponent(JSON.stringify([project])):'');
      const html=await api(root+'/html?'+query);
      assert.ok(html.includes('إيجار السقالات عن شهر أكتوبر'));assert.ok(html.includes('يشمل الفك والتركيب'));
      assert.ok(html.includes(locale==='ar'?'نوع الأعمال':'Work type'));assert.ok(html.includes('إيجار سقالات'));
      assert.ok(!html.includes('UNRELATED CONTRACTOR PAYMENT'));assert.ok(!html.includes('SAME NAME CUSTOMER COLLECTION'));
      const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await api(root+'/xlsx?'+query));
      const values=workbook.worksheets[0].getSheetValues().flat();assert.ok(values.includes('إيجار سقالات'));
      assert.ok(values.includes('إيجار السقالات عن شهر أكتوبر\nيشمل الفك والتركيب'));assert.ok(!values.includes('UNRELATED CONTRACTOR PAYMENT'));
    }
    if(process.env.AM_CONTRACTOR_QA_HOOK)await require(process.env.AM_CONTRACTOR_QA_HOOK)({origin,api,app,selected,second,project,customer});
    assert.equal(app.database.get('PRAGMA foreign_key_check'),null);
    console.log('Contractor report scope, cleared project filters, document/serial identities, role isolation and descriptions in bilingual legacy/modern HTML and XLSX passed.');
  }finally{global.fetch=realFetch;await new Promise(resolve=>http.close(resolve));app.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
