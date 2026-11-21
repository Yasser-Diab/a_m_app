import {useEffect,useRef,useState} from 'react';
import {Field} from '../certificates/shared.jsx';
import {ErrorMessage} from './shared.jsx';

export default function ReportEditor({endpoint,request,options,t,canEdit,onSaved,onCancel}){
  const [source,setSource]=useState(null),[error,setError]=useState(null),[busy,setBusy]=useState(false),[label,setLabel]=useState(''),[value,setValue]=useState(''),[reset,setReset]=useState(false);
  const frame=useRef(null),selected=useRef(null),dirty=useRef(false);
  useEffect(()=>{const controller=new AbortController();request(endpoint+'/report',{method:'POST',body:options,signal:controller.signal})
    .then(data=>{if(!controller.signal.aborted)setSource(data);}).catch(cause=>{if(!controller.signal.aborted)setError(cause);});return()=>controller.abort();},[endpoint,request]);
  function ready(){
    const doc=frame.current?.contentDocument;if(!doc?.body)return;
    doc.body.contentEditable='false';doc.body.dataset.editorReady='true';doc.body.spellcheck=false;
    doc.querySelectorAll('h1,h2,h3,h4,h5,h6,p,dt,dd,th,td,figcaption,header strong,header small,.signatures>div').forEach(field=>{
      field.contentEditable=canEdit?'true':'false';field.tabIndex=canEdit?0:-1;
    });
    const style=doc.createElement('style');style.textContent='[contenteditable="true"]:hover{outline:1px dashed #9ab7c3}[contenteditable="true"]:focus{outline:2px solid #d78a27;background:#fff8e9}';doc.head.append(style);
    doc.body.addEventListener('input',()=>{dirty.current=true;});
    doc.body.addEventListener('click',event=>{selected.current=event.target.closest('dl > div')||event.target.closest('tr,h1,h2,h3,h4,p,figure,.signoff,div');});
    doc.body.addEventListener('paste',event=>{event.preventDefault();const text=event.clipboardData.getData('text/plain'),selection=doc.getSelection();
      if(selection?.rangeCount){const range=selection.getRangeAt(0);range.deleteContents();const node=doc.createTextNode(text);range.insertNode(node);range.setStartAfter(node);range.collapse(true);selection.removeAllRanges();selection.addRange(range);dirty.current=true;}});
  }
  function addField(){
    if(!label.trim()&&!value.trim())return;const doc=frame.current?.contentDocument;if(!doc)return;
    const dl=doc.createElement('dl'),field=doc.createElement('div'),dt=doc.createElement('dt'),dd=doc.createElement('dd');dt.textContent=label;dd.textContent=value;
    for(const node of [dt,dd]){node.contentEditable='true';node.tabIndex=0;}field.append(dt,dd);dl.append(field);
    const at=selected.current?.closest('section');(at||doc.body).append(dl);dirty.current=true;setLabel('');setValue('');field.scrollIntoView({block:'nearest'});
  }
  async function save(clear=false){
    setBusy(true);setError(null);
    try{
      const body=frame.current?.contentDocument?.body;if(!body&&!clear)throw new Error(t('انتظر تحميل التقرير.','Wait for the report to load.'));
      const result=await request(endpoint+'/report-edits',{method:'POST',body:{...options,version:source.edit_version,document_ref:source.document_ref,...(clear?{reset:true}:{html:body.innerHTML})}});
      dirty.current=false;onSaved(result);
    }catch(cause){setError(cause);}finally{setBusy(false);}
  }
  return <section className="ops-report-editor pc-stack" aria-label={t('تحرير التقرير','Edit report')}>
    <p>{t('عدّل النص مباشرة داخل التقرير. تُحفظ التعديلات لهذا المستند فقط.','Edit text directly in the report. Changes are saved for this document only.')}</p>
    <ErrorMessage error={error}/>{source&&<>
      <div className="pc-form"><Field label={t('اسم الحقل الجديد','New field label')}><input disabled={!canEdit||busy} value={label} onChange={event=>setLabel(event.target.value)}/></Field>
        <Field label={t('قيمة الحقل','Field value')}><input disabled={!canEdit||busy} value={value} onChange={event=>setValue(event.target.value)}/></Field></div>
      <div className="pc-toolbar"><button type="button" disabled={!canEdit||busy} onClick={addField}>{t('إضافة حقل','Add field')}</button>
        <button type="button" disabled={!canEdit||busy} onClick={()=>{if(selected.current){selected.current.remove();selected.current=null;dirty.current=true;}}}>{t('حذف الحقل المحدد','Delete selected field')}</button>
        <button type="button" disabled={!canEdit||busy} onClick={()=>setReset(true)}>{t('استعادة التقرير الأصلي','Reset to current data')}</button>
        <button type="button" className="primary" disabled={!canEdit||busy} onClick={()=>save()}>{t('حفظ تعديلات التقرير','Save report edits')}</button>
        <button type="button" onClick={onCancel}>{t('إغلاق المحرر','Close editor')}</button></div>
      {reset&&<div className="pc-panel" role="alertdialog" aria-label={t('استعادة التقرير الأصلي','Reset report')}><p>{t('إزالة التعديلات المحفوظة وإعادة إنشاء التقرير من بياناته الحالية؟','Remove the saved edits and regenerate the report from current data?')}</p>
        <div className="pc-toolbar"><button type="button" disabled={busy} onClick={()=>save(true)}>{t('تأكيد الاستعادة','Confirm reset')}</button><button type="button" onClick={()=>setReset(false)}>{t('إلغاء','Cancel')}</button></div></div>}
      <iframe ref={frame} className="ops-report-edit-frame" title={t('التقرير القابل للتحرير','Editable report')} sandbox="allow-same-origin" srcDoc={source.html} onLoad={ready}/>
    </>}
  </section>;
}
