import {useState} from 'react';
import {Dialog,queryString} from '../certificates/shared.jsx';
import {ErrorMessage,Pick} from './shared.jsx';

export default function SourceRefresh({ctx,path,request,can,t,reload,documentId}){
  const [selected,setSelected]=useState(''),[preview,setPreview]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(null),[message,setMessage]=useState('');
  if(!can('edit'))return null;
  const id=documentId||selected||ctx.operations.boq_id;
  async function inspect(){
    setBusy(true);setError(null);setMessage('');
    try{setPreview(await request(path+'/source-refresh'+queryString({document_id:id})));}catch(cause){setError(cause);}finally{setBusy(false);}
  }
  async function confirm(){
    setBusy(true);setError(null);
    try{
      const result=await request(path+'/source-refresh',{method:'POST',body:{document_id:preview.source.id,version:preview.version,fingerprint:preview.fingerprint,confirm:true}});
      setPreview(null);setMessage(t(`تم تحديث ${result.updated+result.added} بند و${result.refreshable_orders} أمر تشغيل.`,`Updated ${result.updated+result.added} items and ${result.refreshable_orders} work orders.`));reload();
    }catch(cause){setError(cause);}finally{setBusy(false);}
  }
  return <div className="pc-stack">
    <div className="pc-toolbar">{!documentId&&ctx.linked_boqs.length>1&&<Pick label={t('المصدر المراد تحديثه','Source to refresh')} value={id} placeholder="" onChange={setSelected}
      items={ctx.linked_boqs.map(source=>[source.id,(source.document_type==='invoice'?t('فاتورة','Invoice'):t('عرض سعر','Quotation'))+' '+source.operation_no])}/>}
      <button type="button" disabled={busy} onClick={inspect}>{t('تحديث من الفاتورة / عرض السعر','Refresh from invoice / quotation')}</button>
    </div>{!preview&&<ErrorMessage error={error}/>} {message&&<p role="status">{message}</p>}
    {preview&&<Dialog t={t} title={t('تحديث بيانات التشغيل من المصدر','Refresh operations from source')} onClose={()=>{if(!busy){setPreview(null);setError(null);}}}>
      <p>{t(`سيتم استبدال بيانات البنود المستوردة من ${preview.source.reference} وتحديث أوامر التشغيل المفتوحة المرتبطة بها.`,
        `Replace imported item data from ${preview.source.reference} and refresh its open work orders.`)}</p>
      <p>{t(`تحديث: ${preview.updated} · إضافة: ${preview.added} · حذف من العمل الجاري: ${preview.removed} · أوامر: ${preview.refreshable_orders}`,
        `Update: ${preview.updated} · Add: ${preview.added} · Remove from current work: ${preview.removed} · Orders: ${preview.refreshable_orders}`)}</p>
      <p>{t('تبقى مواصفات العميل المحفوظة وتوقيعات المشروع كما هي. يلزم اعتماد المقاسات والمواصفات المحدثة مجددًا.',
        'Saved customer specifications and project signatures are preserved. Updated measurements and specifications need approval again.')}</p>
      {preview.historical_orders>0&&<p>{t(`يُحتفظ بسجل ${preview.historical_orders} أمر مغلق أو بدأ تحميله؛ ولن تتغير كميات التحميل المؤكدة.`,
        `${preview.historical_orders} closed or partly loaded orders remain in history; confirmed loading quantities are preserved.`)}</p>}
      <ErrorMessage error={error}/><div className="pc-toolbar"><button type="button" className="primary" disabled={busy} onClick={confirm}>{t('تأكيد الاستبدال والتحديث','Confirm replacement and refresh')}</button>
        <button type="button" disabled={busy} onClick={()=>{setPreview(null);setError(null);}}>{t('إلغاء','Cancel')}</button></div>
    </Dialog>}
  </div>;
}
