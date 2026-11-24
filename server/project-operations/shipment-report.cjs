const {parse,fail}=require('../certificate-access.cjs');
const {getProject,getCustomer}=require('../certificate-projects.cjs');
const {wrap,grid,row,dimensionPair,projectBlock,loadingTransportBlock,signatures,panelLabels,specificationGroups,groupSubtotal}=require('./reports.cjs');
const {openingDescription}=require('./customer-defaults.cjs');
const {unitKey,unitName}=require('./order-quantities.cjs');

function shipmentData(db,current,id){
  const batch=db.get('SELECT * FROM ops_loads WHERE id=? AND order_id=?',[id,current.id]);
  if(!batch)fail(404,'Shipment not found');
  let data=parse(batch.shipment_data,{});
  if(!data.items){
    const order=require('./production.cjs').orderDetails(db,current);
    data={items:order.items,parts:order.parts,lines:db.all('SELECT *,order_item_id||\':\'||kind AS part_id FROM ops_load_lines WHERE load_id=?',[id]),transport:{}};
  }
  return {...batch,...data,reference:data.document_reference||batch.reference};
}
function shipmentRows(data){
  const actual=new Map(data.lines.map(line=>[line.part_id,Number(line.quantity)])),rows=[];
  for(const item of data.items){
    const parts=data.parts.filter(part=>part.order_item_id===item.id&&part.required>0),count=Number(item.quantity);
    if(!parts.some(part=>actual.get(part.part_id)>0))continue;
    const complete=count>0?Math.min(count,...parts.map(part=>Math.floor(((actual.get(part.part_id)||0)+1e-8)/(part.required/count)))):0;
    if(complete>0)rows.push({item,complete:true,quantity:complete,unit:'openings',progress:100});
    const remaining=parts.map(part=>({...part,quantity:Math.max(0,(actual.get(part.part_id)||0)-complete*part.required/count)})).filter(part=>part.quantity>1e-8);
    const denominator=parts.reduce((sum,part)=>sum+part.required,0)*(count-complete)/count;
    const progress=denominator>0?Math.min(100,remaining.reduce((sum,part)=>sum+part.quantity,0)/denominator*100):100;
    for(const part of remaining)rows.push({...part,item,progress});
  }
  for(const part of data.parts.filter(part=>!part.order_item_id&&actual.get(part.part_id)>0))
    rows.push({...part,quantity:actual.get(part.part_id),progress:Math.min(100,actual.get(part.part_id)/part.required*100)});
  const hasTags=rows.some(part=>String(part.item?.specification.technical.tag||'').trim());
  const serials=new Map();
  return rows.map(part=>{
    const key=part.item?.id||part.part_id;
    if(!serials.has(key))serials.set(key,String(serials.size+1));
    return {...part,tag:hasTags?String(part.item?.specification.technical.tag||'').trim():serials.get(key)};
  });
}
function shipmentReport(db,state,current,id,locale,branding,overrideData){
  locale=locale==='en'?'en':'ar';const t=(ar,en)=>locale==='ar'?ar:en;
  const data=overrideData||shipmentData(db,current,id),rows=shipmentRows(data),project=getProject(db,current.project_id),customer=getCustomer(db,project.customer_id);
  const order={...current,items:data.items,loading_reference:data.reference,loading_transport:data.transport,loads:[{responsible:parse(data.responsible,{})}]};
  const format=value=>new Intl.NumberFormat('en-US',{maximumFractionDigits:4}).format(value);
  const groups=specificationGroups(data.items).map(group=>({items:group.items,rows:rows.filter(part=>group.items.some(item=>item.id===part.item?.id))})).filter(group=>group.rows.length);
  const general=rows.filter(part=>!part.item);if(general.length)groups.push({items:[],rows:general});
  const hasTags=rows.some(part=>String(part.item?.specification.technical.tag||'').trim()),serials=new Map();
  const tables=groups.map((group,groupIndex)=>{
    let previous,band=-1;
    const body=group.rows.map((part,index)=>{
      const key=part.item?.id||part.part_id;
      if(!serials.has(key))serials.set(key,String(serials.size+1));
      const tag=hasTags?part.tag:serials.get(key);
      const begin=key!==previous;if(begin){previous=key;band++;}
      const tech=part.item?.specification.technical||{};
      const text=part.complete?t('فتحة كاملة','Complete opening'):part.label||t(...(panelLabels[part.kind]||['بند','Item']));
      return (begin?(index?'</tbody>':'')+'<tbody class="opening-band-'+band%2+'">':'')+row([
        tag,part.item?openingDescription(part.item.specification):part.label,part.item?dimensionPair([tech.width_mm||'—',tech.height_mm||'—'],locale):'',
        text,format(part.quantity),part.complete?t('فتحة','Opening'):unitName(unitKey(part.unit),locale),format(part.progress)+'%',
      ]);
    }).join('');
    const complete=group.rows.filter(part=>part.complete).map(part=>({...part.item,quantity:part.quantity}));
    const partial=new Set(group.rows.filter(part=>part.item&&!part.complete).map(part=>part.item.id)).size;
    return '<h3>'+t(`المجموعة ${groupIndex+1} من ${groups.length}`,`Group ${groupIndex+1} of ${groups.length}`)+'</h3><table class="loading-sheet delivery-sheet"><colgroup>'+[10,29,16,15,11,8,11].map(width=>'<col style="width:'+width+'%">').join('')+'</colgroup><thead>'+row(['Tag',t('وصف الفتحة','Opening description'),t('المقاس مم','Size mm'),t('المكون','Component'),
      t('الكمية المحملة','Loaded quantity'),t('الوحدة','Unit'),t('نسبة التحميل','Loading progress')],'th')+'</thead>'+body+'</tbody></table>'+
      (groups.filter(group=>group.items.length).length>1&&group.items.length?groupSubtotal(complete,locale,{partial,shipment:true}):'');
  }).join('');
  const totals=new Map();for(const part of rows){const unit=unitKey(part.unit);totals.set(unit,(totals.get(unit)||0)+part.quantity);}
  const completeArea=rows.filter(part=>part.complete).reduce((sum,part)=>{const tech=part.item.specification.technical;return sum+(tech.width_mm>0&&tech.height_mm>0?part.quantity*tech.width_mm*tech.height_mm/1e6:0);},0);
  const html=projectBlock(db,project,customer,state,order,locale,branding)+'<section class="loading">'+grid([
    [t('تاريخ الشحنة','Shipment date'),data.loading_date],[t('البيان','Contents'),t('المحمّل على هذه السيارة فقط','Only the load on this vehicle')],
  ])+tables+'</section>'+
    '<section>'+grid([...(completeArea?[[t('مساحة الفتحات المحملة كاملة م²','Complete opening area m²'),format(completeArea)]]:[]),...[...totals].map(([unit,amount])=>[t('إجمالي المحمّل ','Total loaded ')+(unit==='openings'?t('فتحات','openings'):unitName(unit,locale)),format(amount)])])+'</section>'+
    loadingTransportBlock(order,locale)+signatures(db,project.id,order,'delivery',locale);
  return {html:wrap({locale,branding,title:t('إذن تسليم ','Delivery Note ')+data.reference,color:'#7992a3',body:html}),reference:data.reference,customer};
}
module.exports={shipmentData,shipmentRows,shipmentReport};
