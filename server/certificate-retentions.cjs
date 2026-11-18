const {scopeSql,parse,idOf,lookup,today}=require('./certificate-access.cjs');
const {getProfile}=require('./certificate-projects.cjs');
const {allocationLedger}=require('./certificate-ledger.cjs');
const {withRetentionHistory}=require('./certificate-retention-history.cjs');
const {ruleKey}=require('./certificate-retention-math.cjs');
const {toMinor,money}=require('./certificate-valuation.cjs');
const {wrap,escape,row}=require('./project-operations/reports.cjs');
const categoryLabels={retention:['المحتجز','Retention'],works_insurance:['تأمينات الأعمال','Works retention'],final_insurance:['تأمين نهائي','Final retention']};

function retentionReport(db,access,query={}){
  const scope=scopeSql(access,'p.id'),project=idOf(query.project_id),customer=idOf(query.customer_id),q=lookup(query.q);
  const revisions=db.all(`SELECT r.id,r.project_id,r.series_key,r.location_id,r.snapshot_json,p.name AS project,p.code,p.currency,
    p.customer_id,c.display_name AS customer FROM cert_revisions r JOIN cert_projects p ON p.id=r.project_id
    JOIN parties c ON c.id=p.customer_id WHERE ${scope.clause} AND r.status IN ('approved','issued') AND r.snapshot_json IS NOT NULL
    AND (? IS NULL OR p.id=?) AND (? IS NULL OR p.customer_id=?)
    ORDER BY r.work_to DESC,COALESCE(r.root_id,r.id) DESC,r.revision DESC,r.id DESC`,[...scope.params,project,project,customer,customer]);
  const latest=new Map();
  for(const revision of revisions){const key=revision.project_id+':'+revision.series_key+':'+revision.location_id;if(!latest.has(key))latest.set(key,revision);}
  const groups=new Map();
  for(const revision of latest.values()){
    if(q&&![revision.project,revision.code,revision.customer].some(value=>lookup(value).includes(q)))continue;
    const snapshot=withRetentionHistory(db,parse(revision.snapshot_json,{}));
    const group=groups.get(revision.project_id)||{revision,holds:[],earned:0,recovered:0};
    group.earned+=toMinor(snapshot.totals?.cumulative_earned)||0;group.recovered+=toMinor(snapshot.totals?.cumulative_advance_recovery)||0;
    const profile=getProfile(db,revision.project_id),rules=new Map(profile.rules.map((rule,index)=>[ruleKey(rule,index),rule]));
    for(const hold of snapshot.totals?.holds||[]){const value=toMinor(hold.balance)||0;if(value<=0)continue;
      const current=rules.get(hold.key);
      group.holds.push({...hold,collection_date:current?current.collection_date||null:hold.collection_date,
        certificate_number:snapshot.official_number||snapshot.certificate_number||'',held_minor:value,revision_id:revision.id});}
    groups.set(revision.project_id,group);
  }
  const records=[];
  for(const {revision,holds,earned,recovered}of groups.values()){
    const ledger=allocationLedger(db,revision.project_id,getProfile(db,revision.project_id),today());
    const total=holds.reduce((sum,hold)=>sum+hold.held_minor,0);
    const cash=ledger.ordinary_minor+(ledger.advance_principal_minor||0);
    let covered=Math.min(total,Math.max(0,cash-(earned+recovered)));
    holds.sort((a,b)=>(a.collection_date||'9999').localeCompare(b.collection_date||'9999')||a.key.localeCompare(b.key));
    for(const hold of holds){const paid=Math.min(covered,hold.held_minor);covered-=paid;
      const outstanding=hold.held_minor-paid,due=Boolean(hold.collection_date&&hold.collection_date<=today()&&outstanding>0);
      if(query.status==='due'&&!due||query.status!=='all'&&outstanding===0)continue;
      if(query.date_from&&(!hold.collection_date||hold.collection_date<query.date_from)||query.date_to&&(!hold.collection_date||hold.collection_date>query.date_to))continue;
      records.push({project_id:revision.project_id,project:revision.project,code:revision.code,customer_id:revision.customer_id,customer:revision.customer,
        currency:revision.currency,...hold,label:hold.label||categoryLabels[hold.category]?.[query.locale==='en'?1:0]||(query.locale==='en'?'Refundable deduction':'استقطاع مسترد'),
        held:money(hold.held_minor),outstanding:money(outstanding),due});
    }
  }
  const totals={};for(const record of records){totals[record.currency]??={held:0,outstanding:0,due:0};const t=totals[record.currency];
    t.held+=record.held_minor;t.outstanding+=toMinor(record.outstanding);if(record.due)t.due+=toMinor(record.outstanding);}
  return {as_of:today(),records,totals:Object.entries(totals).map(([currency,t])=>({currency,...Object.fromEntries(Object.entries(t).map(([k,v])=>[k,money(v)]))}))};
}
function retentionNotices(db,access,locale='ar'){
  return retentionReport(db,access,{status:'due',locale}).records.map(record=>{
    const amount=new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(record.outstanding)+' '+record.currency;
    return {id:`retention:${today()}:${record.project_id}:${record.revision_id}:${record.key}:${record.collection_date}:${record.outstanding}`,
      source:'retention',project_id:record.project_id,event_type:'warning',in_app_enabled:true,windows_enabled:true,
      title:locale==='ar'?'استقطاع مستحق التحصيل':'Retention due for collection',
      message:`${record.customer} · ${record.project} (${record.code}) · ${record.label} · ${amount} · ${record.collection_date}`,
      style:{backgroundColor:'#fff0f0',color:'#b42318',borderColor:'#e6a0a0'}};
  });
}
function retentionHtml(data,{locale='ar',branding={}}={}){
  const t=(ar,en)=>locale==='ar'?ar:en,format=value=>new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(value);
  const title=t('الاستقطاعات المحتجزة — نسخة الشركة','Retentions — Company copy');
  const headers=[t('العميل','Customer'),t('المشروع','Project'),t('الاستقطاع','Deduction'),t('تاريخ التحصيل','Collection date'),t('المحتجز','Held'),t('المتبقي للتحصيل','Outstanding'),t('العملة','Currency')];
  const body=`<p>${t('الموقف في','As of')} <bdi dir="ltr">${escape(data.as_of)}</bdi></p><table><thead>${row(headers,'th')}</thead><tbody>${data.records.map(r=>row([r.customer,r.project+' · '+r.code,r.label,r.collection_date||'—',format(r.held),format(r.outstanding),r.currency])).join('')}</tbody></table>
    ${data.totals.map(total=>`<p><bdi dir="ltr">${escape(total.currency)}</bdi> · ${t('المتبقي للتحصيل','Outstanding')}: <bdi dir="ltr">${format(total.outstanding)}</bdi></p>`).join('')}`;
  return wrap({locale,branding,title,color:'#a8c5d5',body});
}
module.exports={retentionReport,retentionNotices,retentionHtml};
