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
  const cumulative_lines=db.all(`SELECT part_id,SUM(quantity) quantity FROM (
    SELECT l.order_item_id||':'||l.kind part_id,l.quantity FROM ops_load_lines l JOIN ops_loads b ON b.id=l.load_id WHERE b.order_id=? AND b.id<=?
    UNION ALL SELECT l.part_id,l.quantity FROM ops_load_parts l JOIN ops_loads b ON b.id=l.load_id WHERE b.order_id=? AND b.id<=?
  ) GROUP BY part_id`,[current.id,id,current.id,id]);
  return {...batch,...data,cumulative_lines,reference:data.document_reference||batch.reference};
}
function shipmentRows(data){
  const actual=new Map(data.lines.map(line=>[line.part_id,Number(line.quantity)])),rows=[];
  const cumulative=new Map((data.cumulative_lines||data.parts.map(part=>({part_id:part.part_id,quantity:Number(part.loaded||0)+Number(actual.get(part.part_id)||0)}))).map(line=>[line.part_id,Number(line.quantity)]));
  for(const item of data.items){
    const parts=data.parts.filter(part=>part.order_item_id===item.id&&part.required>0),count=Number(item.quantity);
    if(!(count>0)||!parts.some(part=>actual.get(part.part_id)>0))continue;
    const quantity=Math.min(count,Math.max(...parts.map(part=>Math.ceil((Number(actual.get(part.part_id)||0)-1e-8)/(part.required/count)))));
    const remaining=parts.filter(part=>(cumulative.get(part.part_id)||0)<part.required-1e-8);
    // Each component contributes equally by completion ratio; unlike units are never added together.
    const progress=parts.length?Math.min(100,parts.reduce((sum,part)=>sum+Math.min(1,(cumulative.get(part.part_id)||0)/part.required),0)/parts.length*100):0;
    rows.push({item,quantity,unit:'openings',progress,complete:remaining.length===0,remaining});
  }
  for(const part of data.parts.filter(part=>!part.order_item_id&&actual.get(part.part_id)>0))
    rows.push({...part,quantity:actual.get(part.part_id),progress:Math.min(100,(cumulative.get(part.part_id)||0)/part.required*100)});
  const hasTags=rows.some(part=>String(part.item?.specification.technical.tag||'').trim()),serials=new Map();
  return rows.map(part=>{const key=part.item?.id||part.part_id;if(!serials.has(key))serials.set(key,String(serials.size+1));
    return {...part,tag:hasTags?String(part.item?.specification.technical.tag||'').trim():serials.get(key)};});
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
    const hasSize=!Array.isArray(data.manual_signatures)||group.rows.some(part=>part.item);
    const body=group.rows.map((part,index)=>{
      const key=part.item?.id||part.part_id;if(!serials.has(key))serials.set(key,String(serials.size+1));
      const tech=part.item?.specification.technical||{};
      const remaining=[...new Set((Array.isArray(part.remaining)?part.remaining:[]).map(component=>component.label||({frames:t('الحلوق','Frames'),sliding:t('الضلف','Leaves'),hinged:t('الضلف','Leaves'),other:t('الضلف','Leaves'),sliding_blades:t('السكاكين','Sliding blades'),fixed:t('الثوابت','Fixed panels'),screens:t('ضلف السلك','Flyscreen leaves')})[component.kind]||component.kind))];
      return '<tbody class="opening-band-'+index%2+'">'+row([
        hasTags?part.tag:serials.get(key),part.item?openingDescription(part.item.specification):part.label,
        ...(hasSize?[part.item?dimensionPair([tech.width_mm||'—',tech.height_mm||'—'],locale):'']:[]),
        format(part.quantity),part.item?t('عدد','Pcs'):unitName(unitKey(part.unit),locale),format(part.progress)+'%',remaining.length?t('متبقي: ','Remaining: ')+remaining.join(t(' و',' and ')):'',
      ])+'</tbody>';
    }).join('');
    const subtotal=group.rows.filter(part=>part.item).reduce((sum,part)=>sum+part.quantity,0);
    return (groups.length>1?'<h3>'+t(`${groupIndex+1} من ${groups.length}`,`${groupIndex+1} of ${groups.length}`)+'</h3>':'')+'<table class="loading-sheet delivery-sheet"><colgroup>'+(hasSize?[8,29,16,8,7,11,21]:[8,45,8,7,11,21]).map(width=>'<col style="width:'+width+'%">').join('')+'</colgroup><thead>'+row(['Tag',t('البيان','Description'),...(hasSize?[t('المقاس مم','Size mm')]:[]),t('الكمية','Quantity'),t('الوحدة','Unit'),t('نسبة التحميل','Loading progress'),t('ملاحظات','Notes')],'th')+'</thead>'+body+'</table>'+
      (groups.filter(group=>group.items.length).length>1&&group.items.length?'<div class="group-subtotal">'+grid([[t('إجمالي','Total'),format(subtotal)+' '+t('فتحة','openings')]])+'</div>':'');
  }).join('');
  const openings=rows.filter(part=>part.item).reduce((sum,part)=>sum+part.quantity,0),generalTotals=new Map();
  for(const part of rows.filter(part=>!part.item)){const unit=unitKey(part.unit);generalTotals.set(unit,(generalTotals.get(unit)||0)+part.quantity);}
  const html=projectBlock(db,project,customer,state,order,locale,branding)+'<section class="loading">'+tables+'</section>'+(Array.isArray(data.manual_signatures)&&data.notes?'<section>'+grid([[t('ملاحظات','Notes'),data.notes]])+'</section>':'')+
    '<section>'+grid([...(openings?[[t('إجمالي','Total'),format(openings)+' '+t('فتحة','openings')]]:[]),...[...generalTotals].map(([unit,amount])=>[Array.isArray(data.manual_signatures)?t('إجمالي','Total'):t('إجمالي الإضافات','Total general items'),format(amount)+' '+unitName(unit,locale)])])+'</section>'+
    loadingTransportBlock(order,locale)+(Array.isArray(data.manual_signatures)?'<div class="signoffs">'+require('./loading-orders.cjs').signatureBlock(data.manual_signatures,locale)+'</div>':signatures(db,project.id,order,'delivery',locale));
  return {html:wrap({locale,branding,title:t('إذن تسليم ','Delivery Note ')+data.reference,color:'#7992a3',body:html}),reference:data.reference,customer};
}
module.exports={shipmentData,shipmentRows,shipmentReport};
