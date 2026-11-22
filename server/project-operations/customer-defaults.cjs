const {parse,encode}=require('../certificate-access.cjs');

const openingFields=new Set(['building','floor','room','tag','drawing_ref','quantity','width_mm','height_mm','depth_mm',
  'site_notes','workshop_notes','measurement_status','material_status','manufacturing_status','priority','required_date','responsible','subframe',
  'panel_measurement_basis','fixed_width_mm','fixed_height_mm','leaf_width_mm','leaf_height_mm']);
const reusableTechnical=technical=>{
  const result=Object.fromEntries(Object.entries(normalizeLocks(technical)).filter(([key])=>!openingFields.has(key)));
  if(result.integrated?.spec)result.integrated={...result.integrated,spec:reusableTechnical(result.integrated.spec)};
  return result;
};
const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
function normalizeLocks(technical={}){
  const result={...technical};
  for(const side of ['right','left']){
    const values=[technical['lock_'+side],technical['interlock_'+side]].filter(value=>value!=null&&String(value).trim());
    if(values.length)result['lock_'+side]=[...new Set(values)].join(' / ');
    delete result['interlock_'+side];
  }
  return result;
}
const typeDefault=(db,customer,category,system)=>db.get(
  'SELECT * FROM ops_customer_type_specs WHERE customer_id=? AND category=? AND system=?',[customer,category,system]);
function sourceDefaults(db,customer){
  const exact=new Map(db.all('SELECT * FROM ops_customer_specs WHERE customer_id=?',[customer]).map(row=>[row.description,row]));
  const types=new Map(db.all('SELECT * FROM ops_customer_type_specs WHERE customer_id=?',[customer]).map(row=>[row.category+':'+row.system,row]));
  const ambiguous=new Set(db.all(`SELECT json_extract(i.commercial,'$.description') AS description FROM ops_items i JOIN cert_projects p ON p.id=i.project_id
    WHERE p.customer_id=? AND i.system<>'' AND i.active=1 GROUP BY json_extract(i.commercial,'$.description')
    HAVING COUNT(DISTINCT i.category||':'||i.system)>1`,[customer]).map(row=>row.description));
  return description=>{const saved=exact.get(description);return saved&&!ambiguous.has(description)?types.get(saved.category+':'+saved.system)||saved:null;};
}
function initializeDefaults(db,migrateOverrides){
  for(const row of db.all('SELECT * FROM ops_customer_specs ORDER BY rowid DESC'))
    db.run(`INSERT OR IGNORE INTO ops_customer_type_specs(customer_id,category,system,technical) VALUES(?,?,?,?)`,
      [row.customer_id,row.category,row.system,encode(reusableTechnical(parse(row.technical,{})))]);
  if(!migrateOverrides)return;
  for(const item of db.all(`SELECT i.*,p.customer_id FROM ops_items i JOIN cert_projects p ON p.id=i.project_id WHERE i.system<>''`)){
    const saved=typeDefault(db,item.customer_id,item.category,item.system);
    if(!saved)continue;
    const standard=parse(saved.technical,{}),technical=reusableTechnical(parse(item.technical,{}));
    const keys=Object.keys(technical).filter(key=>!same(technical[key],standard[key]));
    db.run('UPDATE ops_items SET specification_overrides=? WHERE id=?',[encode(keys),item.id]);
  }
}
const openingDescription=item=>String(item?.opening_description||item?.commercial?.description||item?.technical?.tag||item?.code||'');
module.exports={openingFields,reusableTechnical,typeDefault,sourceDefaults,initializeDefaults,same,openingDescription,normalizeLocks};
