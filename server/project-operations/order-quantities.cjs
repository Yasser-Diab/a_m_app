const round=value=>Math.round((value+Number.EPSILON)*1e6)/1e6;
function unitKey(value){
  const original=String(value||'').trim(),key=original.toLowerCase();
  if(['m²','m2','sqm','sq.m','م²','م2','area','متر مربع'].includes(key))return 'm²';
  if(['m','lm','l.m','م','م.ط','linear','متر طولي'].includes(key))return 'l.m';
  if(['pcs','pc','piece','pieces','عدد','count','وحدة','وحده'].includes(key))return 'Pcs';
  if(['kg','كجم'].includes(key))return 'kg';
  if(['m³','m3','م³','م3'].includes(key))return 'm³';
  if(['t','ton','tons','طن'].includes(key))return 'ton';
  if(['fixed','lump sum','مقطوعية','مقطوعيه'].includes(key))return 'Lump sum';
  return original;
}
const unitName=(value,locale)=>locale==='ar'?({'m²':'م²','l.m':'م.ط',Pcs:'عدد',kg:'كجم','m³':'م³',ton:'طن','Lump sum':'مقطوعية'}[value]||value):value;
function orderQuantities(order){
  const quantities=new Map();let count=0;
  for(const item of order.items||[]){
    const ordered=Number(item.quantity),spec=item.specification||{},technical=spec.technical||{},commercial=spec.commercial||{};
    if(!Number.isFinite(ordered)||ordered<0)continue;
    count+=ordered;
    const sourceCount=Number(technical.quantity),sourceQuantity=commercial.quantity==null||commercial.quantity===''?null:Number(commercial.quantity);
    const unit=unitKey(commercial.unit||commercial.unit_code);
    if(!unit||sourceQuantity==null||!Number.isFinite(sourceQuantity)||!Number.isFinite(sourceCount)||sourceCount<=0)continue;
    // Use the approved measurement basis, scaled to this order's openings.
    // Manufacturing dimensions and loading components do not redefine BOQ quantities.
    quantities.set(unit,(quantities.get(unit)||0)+sourceQuantity*ordered/sourceCount);
  }
  return {count:round(count),quantities:[...quantities].map(([unit,quantity])=>({unit,quantity:round(quantity)}))};
}
module.exports={unitKey,unitName,orderQuantities};
