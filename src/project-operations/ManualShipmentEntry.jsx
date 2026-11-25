import {useEffect,useMemo,useState} from 'react';
import {Dialog,newKey,localDate} from '../certificates/shared.jsx';
import {Text,ErrorMessage,useAction} from './shared.jsx';
import ShipmentGrid from './ShipmentGrid.jsx';
import ApprovalReview from './ApprovalReview.jsx';
import {PdfOutput} from './OperationsReports.jsx';
export default function ManualShipmentEntry(props){
 const {manualOrderId,noteId,request,t,reload,close,can}=props;
 const [prepared,setPrepared]=useState(null),[amounts,setAmounts]=useState({}),[error,setError]=useState(null),[result,setResult]=useState(null),[review,setReview]=useState(false);
 const [data,setData]=useState(()=>({command_key:newKey(),loading_date:localDate(),vehicle_plate:'',driver_name:'',loading_lead:'',notes:'',reason:''}));
 const endpoint='/loading-orders/'+manualOrderId;
 async function load(){const value=await request(noteId?'/delivery-notes/'+noteId:endpoint+'/shipment-preparation',{method:noteId?'GET':'POST',...(noteId?{}:{body:{}})});setPrepared(value);return value;}
 useEffect(()=>{let active=true;request(noteId?'/delivery-notes/'+noteId:endpoint+'/shipment-preparation',{method:noteId?'GET':'POST',...(noteId?{}:{body:{}})}).then(value=>{if(!active)return;setPrepared(value);if(noteId)setAmounts(value.amounts);setData(old=>({...old,loading_date:noteId?value.loading_date:old.loading_date,vehicle_plate:value.vehicle_plate||'',driver_name:value.driver_name||'',loading_lead:value.loading_lead||'',notes:value.notes||'',version:value.version,order_version:noteId?value.order.version:value.version}));}).catch(cause=>{if(active)setError(cause);});return()=>{active=false;};},[endpoint,noteId]);
 const parts=useMemo(()=>(prepared?.rows||[]).map(row=>({part_id:row.id,kind:'manual',custom:true,integer:row.work_integer,description:row.label,label:row.label,unit:({Pcs:t('عدد','Pcs'),kg:t('كجم','kg'),'m²':t('م²','m²'),'l.m':t('م.ط','l.m')})[row.unit]||row.unit,required:row.quantity,loaded:row.loaded,remaining:row.available})),[prepared]);
 const action=useAction(request,value=>{setResult(value);reload();});
 const set=(key,value)=>setData(old=>({...old,[key]:value}));
 return <Dialog t={t} wide title={t('تأكيد شحنة أمر التحميل اليدوي','Confirm manual order shipment')} onClose={()=>{if(!result&&Object.values(amounts).some(value=>Number(value)>0)&&!window.confirm(t('إغلاق دون حفظ كميات الشحنة؟','Close without saving shipment quantities?')))return;close();}}>
  <ErrorMessage error={error||action.error}/>{!prepared&&!error&&<p role="status">{t('جارٍ تحميل الكميات…','Loading quantities…')}</p>}
  {prepared&&<form className="pc-stack" onSubmit={event=>{event.preventDefault();action.run(noteId?'/delivery-notes/'+noteId:endpoint+'/shipments',noteId?'PATCH':'POST',{...data,correction:prepared.edit_window?.correction_required===true,items:Object.entries(amounts).filter(([,quantity])=>Number(quantity)>0).map(([row_id,quantity])=>({row_id,quantity}))});}}>
   <fieldset className="pc-stack" disabled={!can('load')||!can('release')||action.busy||Boolean(result)}><p><bdi>{noteId?prepared.order.reference:prepared.reference}</bdi></p><div className="pc-form">
    <Text type="date" required label={t('تاريخ الشحنة','Shipment date')} value={data.loading_date} onChange={value=>set('loading_date',value)}/>
    <Text label={t('رقم السيارة','Vehicle license plate')} value={data.vehicle_plate} onChange={value=>set('vehicle_plate',value)}/>
    <Text label={t('اسم السائق','Driver name')} value={data.driver_name} onChange={value=>set('driver_name',value)}/>
    <Text required label={t('مسؤول التحميل','Loading lead')} value={data.loading_lead} onChange={value=>set('loading_lead',value)}/>
    <Text label={t('ملاحظات','Notes')} value={data.notes} onChange={value=>set('notes',value)}/>
   </div>
   <p className="pc-caption">{t('حدد البنود لتحميل المتبقي أو أدخل كمية جزئية لكل بند. الكميات المرتبطة بأمر تشغيل تخصم من رصيده أيضًا.','Select items to load their available balance or enter partial quantities. Linked work components also consume their work-order balance.')}</p>
   {prepared.edit_window?.correction_required&&noteId&&<Text required label={t('سبب التصحيح','Correction reason')} value={data.reason} onChange={value=>set('reason',value)}/>}
   <ShipmentGrid {...{parts,amounts,t}} manual onChange={setAmounts} disabled={!can('load')||!can('release')||action.busy||Boolean(result)}/>
   <button type="submit" className="primary" disabled={!Object.values(amounts).some(value=>Number(value)>0)}>{noteId?t('حفظ إذن التسليم','Save Delivery Note'):t('تأكيد الشحنة وإنشاء إذن تسليم','Confirm shipment and create Delivery Note')}</button>
   </fieldset>
  </form>}
  {(error||action.error)&&prepared&&(prepared.work_order_id||prepared.order?.work_order_id)&&can('release')&&<button type="button" onClick={()=>setReview(true)}>{t('مراجعة التعديلات وتجديد الاعتمادات','Review changes and renew approvals')}</button>}
  {review&&<ApprovalReview {...{request,t}} endpoint={'/projects/'+prepared.project_id+'/orders/'+(prepared.work_order_id||prepared.order.work_order_id)} close={()=>setReview(false)} saved={async()=>{await load();setError(null);action.clearError();reload();}}/>}
  {result&&<div className="pc-stack"><p role="status">{t('تم حفظ الشحنة وإنشاء إذن التسليم.','Shipment saved and Delivery Note created.')}</p><PdfOutput {...props} kind="delivery" filters={{}} endpoint={'/api/project-operations/delivery-notes/'+result.id+'/pdf'}/><button type="button" onClick={close}>{t('إغلاق','Close')}</button></div>}
 </Dialog>;
}
