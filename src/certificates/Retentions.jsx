import {useCallback,useEffect,useState} from 'react';
import {Field,Money,Problem,queryString,useCertificateApi,useDebounce,useResource} from './shared.jsx';
import {PdfOutput} from '../project-operations/OperationsReports.jsx';
import './certificates.css';
export default function Retentions(props){
  const {api,session,access,uiLanguage,refreshKey}=props,t=useCallback((ar,en)=>uiLanguage==='ar'?ar:en,[uiLanguage]);
  const request=useCertificateApi(api,session),[search,setSearch]=useState(''),[status,setStatus]=useState('outstanding');
  const [from,setFrom]=useState(''),[to,setTo]=useState(''),[revision,reload]=useState(0),q=useDebounce(search);
  const filters={q,status,date_from:from,date_to:to,locale:uiLanguage},data=useResource(request,'/retentions'+queryString(filters),revision+':'+refreshKey);
  useEffect(()=>{const refresh=()=>reload(value=>value+1);window.addEventListener('easycommercial-finance-updated',refresh);
    return()=>window.removeEventListener('easycommercial-finance-updated',refresh);},[]);
  return <div className="pc-workspace" dir={uiLanguage==='ar'?'rtl':'ltr'}><section className="pc-panel pc-stack"><h2>{t('الاستقطاعات المحتجزة','Retentions')}</h2>
    <p className="pc-caption">{t('متابعة داخلية للشركة. تُخصم المبالغ المسددة من الرصيد المطلوب تحصيله.','Company follow-up. Amounts already paid reduce the outstanding balance.')}</p>
    <div className="pc-form"><Field label={t('بحث بالعميل أو المشروع أو رمزه','Search by customer, project or code')}><input value={search} onChange={event=>setSearch(event.target.value)}/></Field>
      <Field label={t('الحالة','Status')}><select value={status} onChange={event=>setStatus(event.target.value)}><option value="outstanding">{t('المتبقي للتحصيل','Outstanding')}</option>
        <option value="due">{t('مستحق الآن','Due now')}</option><option value="all">{t('الكل، بما فيه المسدد','All, including paid')}</option></select></Field>
      <Field label={t('من تاريخ التحصيل','Collection date from')}><input type="date" dir="ltr" value={from} onChange={event=>setFrom(event.target.value)}/></Field>
      <Field label={t('إلى تاريخ التحصيل','Collection date to')}><input type="date" dir="ltr" value={to} onChange={event=>setTo(event.target.value)}/></Field></div>
    <button type="button" onClick={()=>reload(value=>value+1)}>{t('تحديث','Refresh')}</button><Problem error={data.error} t={t}/>
    <div className="pc-cards">{data.data?.totals.map(total=><div key={total.currency}><span>{t('المتبقي للتحصيل','Outstanding')}</span><strong><Money value={total.outstanding} currency={total.currency} locale={uiLanguage}/></strong>
      <span style={{color:'#ef6d65'}}>{t('مستحق الآن','Due now')}: <Money value={total.due} currency={total.currency} locale={uiLanguage}/></span></div>)}</div>
    <div className="pc-table-scroll"><table className="pc-table"><thead><tr>{[t('العميل','Customer'),t('المشروع','Project'),t('الاستقطاع','Deduction'),t('تاريخ التحصيل','Collection date'),
      t('المحتجز','Held'),t('المتبقي للتحصيل','Outstanding')].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>
      {data.data?.records.map((r,i)=><tr key={r.revision_id+':'+r.key+':'+i} style={r.due?{color:'#ef6d65'}:undefined}><td>{r.customer}</td><td>{r.project}<small> · <bdi>{r.code}</bdi></small></td><td>{r.label}</td>
        <td><bdi dir="ltr">{r.collection_date||'—'}</bdi></td><td><Money value={r.held} currency={r.currency} locale={uiLanguage}/></td><td><Money value={r.outstanding} currency={r.currency} locale={uiLanguage}/></td></tr>)}
      {!data.pending&&!data.data?.records.length&&<tr><td colSpan="6">{t('لا توجد استقطاعات مطابقة.','No matching retentions.')}</td></tr>}</tbody></table></div>
    <PdfOutput {...props} {...{filters,t}} kind="retentions" reportType="retentions" endpoint="/api/certificates/retentions/pdf" can={cap=>access?.capabilities?.includes(cap)} disabled={!data.data?.records.length}/>
  </section></div>;
}
