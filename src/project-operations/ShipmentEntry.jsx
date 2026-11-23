import {useEffect,useState} from 'react';
import {Dialog,localDate,newKey} from '../certificates/shared.jsx';
import {ErrorMessage,Text,Pick,Suggest,display,panelNames,useAction} from './shared.jsx';
import {PdfOutput} from './OperationsReports.jsx';
import ShipmentGrid from './ShipmentGrid.jsx';
import {technicalText,openingDescription} from './terminology.js';

export default function ShipmentEntry(props){
  const {order,endpoint,request,t,people,reload,close,confirm,can}=props;
  const [prepared,setPrepared]=useState(null),[error,setError]=useState(null),[amounts,setAmounts]=useState({}),[result,setResult]=useState(null);
  const [extra,setExtra]=useState(null),[extraBusy,setExtraBusy]=useState(false);
  const [data,setData]=useState(()=>({loading_date:localDate(),notes:'',driver_name:'',vehicle_plate:'',command_key:newKey(),responsible:{}}));
  useEffect(()=>{const controller=new AbortController();request(endpoint+'/shipment-preparation',{method:'POST',body:{},signal:controller.signal}).then(value=>{
    setPrepared(value);setData(old=>({...old,reference:value.loading_reference,...value.loading_transport,
      responsible:Object.fromEntries(people.filter(person=>person.responsibility).map(person=>[person.responsibility,person.id]))}));
  }).catch(cause=>{if(!controller.signal.aborted)setError(cause);});return()=>controller.abort();},[endpoint,request]);
  const action=useAction(request,value=>{setResult(value);reload();});
  const parts=(prepared?.parts||[]).map(part=>({...part,component:part.label||display(panelNames,part.kind,t),
    size:part.order_item_id?(t('ar','en')==='ar'?`${part.height_mm??'—'} × ${part.width_mm??'—'}`:`${part.width_mm??'—'} × ${part.height_mm??'—'}`):'',
    unit:part.unit==='Pcs'?t('عدد','Pcs'):technicalText(part.unit,t('ar','en'))})).sort((a,b)=>(a.order_item_id||Number.MAX_SAFE_INTEGER)-(b.order_item_id||Number.MAX_SAFE_INTEGER)||(({frames:0,sliding:1,hinged:2,fixed:3,other:4,screens:5,sliding_blades:6})[a.kind]??7)-(({frames:0,sliding:1,hinged:2,fixed:3,other:4,screens:5,sliding_blades:6})[b.kind]??7));
  const responsible=people.map(person=>[String(person.id),person.name+(person.position?' · '+person.position:'')]);
  const supplied=data.responsible.loading,person=people.find(person=>person.id===Number(supplied));
  const set=(key,value)=>setData(old=>({...old,[key]:value}));
  return <Dialog t={t} wide title={t('تأكيد شحنة السيارة','Confirm vehicle shipment')} onClose={()=>{
    if(!result&&Object.values(amounts).some(value=>Number(value)>0)&&!window.confirm(t('إغلاق جدول الشحنة دون تأكيد التحميل؟','Close the shipment table without confirming the loading?')))return;close();
  }}>
    {!prepared&&!error&&<p role="status">{t('جارٍ تحميل مكونات الأمر…','Loading order parts…')}</p>}<ErrorMessage error={error||action.error}/>
    {prepared&&<form className="pc-stack" onSubmit={event=>{event.preventDefault();action.run(endpoint+(confirm?'/shipment':'/loading'),'POST',{
      ...data,parts:parts.filter(part=>Number(amounts[part.part_id])>0).map(part=>({part_id:part.part_id,quantity:amounts[part.part_id]})),
    });}}>
      <fieldset disabled={action.busy||Boolean(result)} className="pc-stack"><div className="pc-form">
        <label>{t('رقم أمر التحميل','Loading order no.')}<input readOnly dir="ltr" value={data.reference||''}/></label>
        <Text type="date" label={t('تاريخ الشحنة','Shipment date')} value={data.loading_date} required onChange={value=>set('loading_date',value)}/>
        <Text label={t('رقم السيارة','Vehicle license plate')} value={data.vehicle_plate} onChange={value=>set('vehicle_plate',value)}/>
        <Text label={t('اسم السائق','Driver name')} value={data.driver_name} onChange={value=>set('driver_name',value)}/>
        <Suggest label={t('مسؤول التحميل','Loading lead')} required value={person?responsible.find(([id])=>id===String(person.id))?.[1]:supplied||''} items={responsible} onChange={value=>set('responsible',{...data.responsible,loading:responsible.find(([,name])=>name===value)?.[0]||value})}/>
        <Text label={t('ملاحظات','Notes')} value={data.notes} onChange={value=>set('notes',value)}/>
      </div>
      <p className="pc-caption">{t('حدد الفتحة لتحميل كل مكوناتها المتبقية، أو حدد أجزاءها واكتب كمية التحميل. إذن التسليم يضم محتويات هذه السيارة فقط.',
        'Select an opening to load all its remaining parts, or select individual parts and enter quantities. The Delivery Note contains only this vehicle’s load.')}</p>
      <ShipmentGrid {...{parts,amounts,t}} onChange={setAmounts} disabled={action.busy||Boolean(result)} onInsert={can('edit')?opening=>setExtra({id:newKey(),label:'',unit:'Pcs',quantity:'',order_item_id:opening,per_opening:Boolean(opening)}):undefined}/>
      <button className="primary" type="submit" disabled={!Object.values(amounts).some(value=>Number(value)>0)&&(!confirm||parts.some(part=>part.remaining>0))}>
        {confirm?t('تأكيد الشحنة','Confirm shipment'):t('حفظ التحميل','Save loading')}</button></fieldset>
    </form>}
    {result&&<div className="pc-stack"><p role="status">{t('تم حفظ الشحنة. إذن التسليم التالي يحتوي على الأجزاء المحملة على هذه السيارة فقط.','Shipment saved. The Delivery Note below contains only the parts loaded on this vehicle.')}</p>
      {can('export')&&<PdfOutput {...props} kind="loading" filters={{}} endpoint={'/api/project-operations'+endpoint+'/shipments/'+result.id+'/pdf'}/>}
      <button type="button" onClick={close}>{t('إغلاق','Close')}</button></div>}
    {extra&&<Dialog t={t} title={t('إضافة جزء للفتحة','Add opening part')} onClose={()=>!extraBusy&&setExtra(null)}><form className="pc-stack" onSubmit={async event=>{
      event.preventDefault();setExtraBusy(true);setError(null);try{
        await request(endpoint+'/loading-settings',{method:'PATCH',body:{...prepared.loading_settings,enabled:true,version:prepared.loading_settings_version,rows:[...prepared.loading_settings.rows,extra]}});
        setPrepared(await request(endpoint+'/shipment-preparation',{method:'POST',body:{}}));setExtra(null);reload();
      }catch(cause){setError(cause);}finally{setExtraBusy(false);}
    }}><fieldset disabled={extraBusy} className="pc-stack">
      <Pick label={t('الفتحة المرتبطة','Related opening')} placeholder={t('عام للأمر','General order item')} value={extra.order_item_id||''} items={prepared.items.map(item=>[item.id,openingDescription(item.specification)+' · '+(item.specification.technical.tag||'')+' '+item.specification.technical.width_mm+' × '+item.specification.technical.height_mm])} onChange={value=>setExtra({...extra,order_item_id:value?Number(value):null,per_opening:Boolean(value)})}/>
      <Text label={t('اسم الجزء','Part description')} required value={extra.label} onChange={value=>setExtra({...extra,label:value})}/>
      <Text label={t('الوحدة','Unit')} required value={extra.unit} onChange={value=>setExtra({...extra,unit:value})}/>
      <Text label={t('الكمية','Quantity')} type="number" min={0.0001} step="any" required value={extra.quantity} onChange={value=>setExtra({...extra,quantity:value})}/>
      <label><input type="checkbox" checked={extra.per_opening} disabled={!extra.order_item_id} onChange={event=>setExtra({...extra,per_opening:event.target.checked})}/>{t('لكل فتحة','Per opening')}</label>
      <ErrorMessage error={error}/><button type="submit" className="primary">{t('حفظ الجزء','Save part')}</button></fieldset></form></Dialog>}
  </Dialog>;
}
