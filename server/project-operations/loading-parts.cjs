const {parse,str,idOf,fail}=require('../certificate-access.cjs');

function extraBalances(db,current,items,cutoff=null){
  const settings=parse(current.loading_settings,{enabled:false,rows:[]});
  if(!settings.enabled)return [];
  const loaded=new Map(db.all(`SELECT p.part_id,SUM(p.quantity) quantity FROM ops_load_parts p JOIN ops_loads b ON b.id=p.load_id
    WHERE b.order_id=? AND (? IS NULL OR b.id<=?) GROUP BY p.part_id`,[current.id,cutoff,cutoff]).map(row=>[row.part_id,row.quantity]));
  return settings.rows.map((row,index)=>{
    const item=items.find(item=>item.id===Number(row.order_item_id)),tech=item?.specification.technical||{};
    const part_id='extra:'+(row.id||'legacy-'+index),required=Number(row.quantity)*(row.per_opening&&item?item.quantity:1),quantity=loaded.get(part_id)||0;
    return {part_id,kind:part_id,order_item_id:item?.id||null,description:item?require('./customer-defaults.cjs').openingDescription(item.specification):row.label,
      width_mm:tech.width_mm,height_mm:tech.height_mm,label:row.label,unit:row.unit,required,loaded:quantity,remaining:Math.max(0,Math.round((required-quantity)*1e6)/1e6),custom:true};
  });
}
function cleanExtraRows(db,current,rows,items){
  const seen=new Set(),result=rows.map((row,index)=>{
    const id=str(row.id,80)||'legacy-'+index,order_item_id=idOf(row.order_item_id),label=str(row.label,500),unit=str(row.unit,60),quantity=Number(row.quantity);
    if(!/^[a-zA-Z0-9_-]+$/.test(id)||seen.has(id)||!label||!unit||!Number.isFinite(quantity)||quantity<=0||quantity>1e9)fail(400,'Each loading row needs a unique identity, description, unit and positive quantity');
    if(order_item_id&&!items.some(item=>item.id===order_item_id))fail(400,'Choose an opening from this work order');
    seen.add(id);return {id,label,unit,quantity,order_item_id,per_opening:Boolean(order_item_id&&row.per_opening)};
  });
  const proposed=extraBalances(db,{...current,loading_settings:JSON.stringify({enabled:true,rows:result})},items);
  const before=extraBalances(db,{...current,loading_settings:JSON.stringify({...parse(current.loading_settings,{}),enabled:true})},items);
  for(const old of before)if(old.loaded>0){
    const next=proposed.find(row=>row.part_id===old.part_id);
    if(!next||next.required<old.loaded||next.order_item_id!==old.order_item_id||next.unit!==old.unit)fail(409,'Loaded additional parts must retain their opening, unit and confirmed quantities');
  }
  return result;
}
module.exports={extraBalances,cleanExtraRows};
