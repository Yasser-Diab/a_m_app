import {useEffect,useState} from 'react';
import {Dialog,useResource} from '../certificates/shared.jsx';
import {SignatureInput} from '../signature-directory.jsx';
import {ErrorMessage,Table,Text,useAction} from './shared.jsx';
export const approvalStages={measurement:['المقاسات','Measurements'],profile:['القطاعات','Profiles'],glass:['الزجاج','Glass'],accessories:['الإكسسوارات','Accessories'],finish:['التشطيب','Finish'],details:['التفاصيل','Details'],drawing:['الرسومات','Drawings'],manufacturing:['التصنيع','Manufacturing'],pre_shipment:['الشحن','Shipment']};
export default function ApprovalReview({endpoint,request,t,close,saved,stage,approved=true,itemId}){
 const preview=useResource(request,endpoint+'/review-changes'),options=useResource(request,'/approval-options');
 const [name,setName]=useState(''),[title,setTitle]=useState(''),[reason,setReason]=useState(''),[selected,setSelected]=useState(stage?[stage]:[]);
 useEffect(()=>{if(options.data)setName(value=>value||options.data.name||'');},[options.data]);
 useEffect(()=>{if(!approved&&stage)setSelected([]);else if(preview.data?.rows.some(row=>!row.metadata_only))setSelected(preview.data.stages.filter(row=>!row.approved).map(row=>row.stage));},[preview.data,approved,stage]);
 const renew=Boolean(preview.data?.rows.length||preview.data?.edit_window.correction_required||!stage),action=useAction(request,async result=>{await saved?.(result);close();});
 return <Dialog t={t} wide title={renew?t('مراجعة التعديلات وتجديد الاعتمادات','Review changes and renew approvals'):t('مسؤول الاعتماد','Approval signatory')} onClose={()=>!action.busy&&close()}>
  <form className="pc-stack" onSubmit={event=>{event.preventDefault();const body={approver_name:name,approver_title:title,reason,note:reason};
    action.run(endpoint+(renew?'/review-changes':'/approvals'),'POST',renew?{...body,correction:preview.data.edit_window.correction_required,versions:preview.data.rows.map(row=>({id:row.id,version:row.version})),stages:selected,withdraw_stages:!approved&&stage?[stage]:[],order_item_id:itemId}:{...body,stage,approved,order_item_id:itemId});}}>
   <ErrorMessage error={preview.error||options.error||action.error}/>
   {preview.pending&&<p role="status">{t('جارٍ مراجعة التعديلات…','Reviewing changes…')}</p>}
   {preview.data?.rows.length>0&&<><p>{t('تبقى الشحنات السابقة محفوظة. لا تتطلب تغييرات الوصف وحدها إعادة اعتماد التصنيع.','Earlier shipments remain saved. Description-only changes preserve manufacturing approvals.')}</p><Table headers={[t('الفتحة','Opening'),t('نوع التعديل','Change')]} rows={preview.data.rows.map(row=>[row.id,[row.description,row.metadata_only?t('وصف / بيانات تعريفية','Description / identification'):t('مواصفات فنية — تتطلب المراجعة','Technical specifications — review required')]])}/></>}
   <div className="pc-form"><SignatureInput t={t} label={t('اسم المعتمد','Approving person')} value={name} options={options.data?.people||[]} onChange={(value,person)=>{setName(value);if(person?.title)setTitle(person.title);}}/><SignatureInput t={t} title label={t('المنصب','Job title')} value={title} options={options.data?.titles||[]} onChange={setTitle}/></div>
   {renew&&<div className="ops-approval-checks">{Object.entries(approvalStages).map(([key,names])=><label className="pc-check" key={key}><input type="checkbox" checked={selected.includes(key)} onChange={event=>setSelected(event.target.checked?[...selected,key]:selected.filter(value=>value!==key))}/>{t(...names)}</label>)}</div>}
   <Text label={preview.data?.edit_window.correction_required?t('سبب مستند التصحيح','Correction document reason'):t('ملاحظات','Notes')} required={preview.data?.edit_window.correction_required} value={reason} onChange={setReason}/>
   <div className="pc-toolbar"><button type="submit" className="primary" disabled={action.busy||preview.pending||!preview.data||!name.trim()}>{renew?t('حفظ التعديلات والاعتمادات','Save changes and approvals'):approved?t('تأكيد الاعتماد','Confirm approval'):t('إلغاء الاعتماد','Withdraw approval')}</button><button type="button" disabled={action.busy} onClick={close}>{t('إلغاء','Cancel')}</button></div>
  </form>
 </Dialog>;
}
