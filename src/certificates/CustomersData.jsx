import {useCallback,useState} from 'react';
import {Combobox,Field,Problem,ProjectDetailsFields,queryString,useCertificateApi,useDebounce,useResource} from './shared.jsx';
import './certificates.css';
const fields=[['legal_name','الاسم القانوني / الضريبي','Registered / tax name'],['address','عنوان المقر الرئيسي','Head office address'],
  ['tax_no','رقم التسجيل الضريبي','Tax registration no.'],['commercial_registration','رقم السجل التجاري','Commercial registration no.'],
  ['vat_registration','رقم تسجيل القيمة المضافة','VAT registration no.'],['tax_office','المأمورية الضريبية','Tax office'],
  ['billing_address','عنوان المراسلات والفواتير','Billing address'],['phone','هاتف الشركة','Company phone'],['email','البريد الإلكتروني','Email'],
  ['website','الموقع الإلكتروني','Website'],['contact_name','مسؤول التواصل','Contact name'],['contact_position','وظيفة مسؤول التواصل','Contact position'],['notes','ملاحظات العميل','Customer notes']];
export default function CustomersData({api,session,access,uiLanguage}){
  const request=useCertificateApi(api,session),t=useCallback((ar,en)=>uiLanguage==='ar'?ar:en,[uiLanguage]);
  const [selected,setSelected]=useState(null),[search,setSearch]=useState(''),[revision,reload]=useState(0),q=useDebounce(search);
  const choices=useResource(request,'/customers'+queryString({q}),revision);
  const data=useResource(request,selected?'/customers/'+selected.id:null,revision);
  const projects=useResource(request,selected?'/projects'+queryString({customer_id:selected.id}):null,revision);
  const canEdit=access?.capabilities?.includes('create_master')&&Boolean(access.can_admin||access.user?.can_edit_company_settings||access.inherited_from_role);
  return <div className="pc-workspace" dir={uiLanguage==='ar'?'rtl':'ltr'}><section className="pc-panel pc-stack"><h2>{t('بيانات العملاء','Customers Data')}</h2>
    <Combobox label={t('العميل','Customer')} selected={selected} options={choices.data||[]} onSelect={setSelected} onSearch={setSearch}
      onClear={()=>{setSelected(null);setSearch('');}} t={t}/><Problem error={choices.error||data.error||projects.error} t={t}/>
    {data.data&&<CustomerForm key={data.data.id+':'+revision} data={data.data} {...{request,t,canEdit}} saved={()=>reload(value=>value+1)}/>}
    {!!projects.data?.length&&<section className="pc-stack"><h3>{t('مشروعات العميل','Customer projects')}</h3>
      {projects.data.map(project=><ProjectForm key={project.id} {...{project,request,t}} canEdit={access?.capabilities?.includes('manage_settings')}/>)}</section>}
  </section></div>;
}
function CustomerForm({data,request,t,canEdit,saved}){
  const [draft,setDraft]=useState(data),[busy,setBusy]=useState(false),[error,setError]=useState(null);
  return <form className="pc-stack" onSubmit={async event=>{event.preventDefault();setBusy(true);setError(null);
    try{await request('/customers/'+data.id,{method:'PUT',body:draft});saved();}catch(cause){setError(cause);}finally{setBusy(false);}}}>
    <p><bdi>{data.display_name}</bdi> · <bdi>{data.code}</bdi></p><fieldset disabled={!canEdit||busy}><div className="pc-form">
      {fields.map(([key,ar,en])=><Field key={key} label={t(ar,en)}><input dir="auto" value={draft[key]||''} onChange={event=>setDraft({...draft,[key]:event.target.value})}/></Field>)}
    </div></fieldset><Problem error={error} t={t}/>{canEdit&&<div><button type="submit" className="primary" disabled={busy}>{t('حفظ بيانات العميل','Save customer data')}</button></div>}
  </form>;
}
function ProjectForm({project,request,t,canEdit}){
  const [draft,setDraft]=useState(project),[error,setError]=useState(null),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false);
  return <details><summary><bdi>{project.name} · {project.code}</bdi></summary><form className="pc-stack" onSubmit={async event=>{
    event.preventDefault();setBusy(true);setError(null);try{setDraft(await request('/projects/'+project.id,{method:'PATCH',body:draft}));setSaved(true);}catch(cause){setError(cause);}finally{setBusy(false);}}}>
    <fieldset disabled={!canEdit||busy}><ProjectDetailsFields {...{draft,t}} onChange={(key,value)=>{setDraft({...draft,[key]:value});setSaved(false);}}/></fieldset>
    <Problem error={error} t={t}/>{canEdit&&<div><button type="submit" disabled={busy}>{t('حفظ بيانات المشروع','Save project details')}</button></div>}
    {saved&&<p role="status">{t('تم حفظ بيانات المشروع.','Project details saved.')}</p>}
  </form></details>;
}
