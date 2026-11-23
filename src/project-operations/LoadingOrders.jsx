import {useState} from 'react';
import {Combobox,Dialog,Problem,localDate,newKey,queryString,useCertificateApi,useDebounce,useResource} from '../certificates/shared.jsx';
import {ErrorMessage,Page,Pick,SearchableTable,Table,Text,useAction,usePaged} from './shared.jsx';
import {PdfOutput} from './OperationsReports.jsx';
import {Report} from './Production.jsx';
import {parseSmartClipboardGrid,normalizeSmartNumericClipboardValue} from '../smart-table-clipboard.mjs';

export default function LoadingOrders(props){
  const {request,t,active,revision,reload,can}=props;
  const [search,setSearch]=useState(''),q=useDebounce(search),[selected,setSelected]=useState(null);
  const list=usePaged(request,active?'/loading-orders':null,{q},revision);
  const detail=useResource(request,selected?.kind==='manual'?'/loading-orders/'+selected.id:null,revision);
  return <section className="pc-panel pc-stack"><div className="pc-toolbar"><h2>{t('أوامر التحميل','Loading Orders')}</h2>
    {can('edit')&&<button type="button" className="primary" onClick={()=>setSelected({kind:'new'})}>{t('أمر تحميل يدوي جديد','New manual loading order')}</button>}</div>
    <Text label={t('بحث برقم الأمر أو العميل أو المشروع','Search by order, customer or project')} value={search} onChange={value=>{setSearch(value);list.setPage(1);}}/>
    <ErrorMessage error={list.error||detail.error}/><Table headers={[t('رقم الأمر','Order number'),t('العميل','Customer'),t('المشروع','Project'),t('النوع','Type'),t('التاريخ','Date'),t('الحالة','Status')]}
      empty={list.pending?t('جارٍ التحميل…','Loading…'):t('لا توجد أوامر تحميل.','No loading orders.')}
      rows={(list.data?.items||[]).map(order=>[order.kind+order.id,[<button type="button" className="pc-name" onClick={()=>setSelected(order)}>{order.reference}</button>,order.customer,order.project,
        order.kind==='manual'?t('يدوي','Manual'):t('مرتبط بأمر تشغيل','From work order'),order.loading_date,
        ({draft:t('مسودة','Draft'),issued:t('صادر','Issued'),cancelled:t('ملغى','Cancelled'),released:t('جاهز','Released'),shipped:t('تم الشحن','Shipped'),closed:t('مغلق','Closed')})[order.status]||order.status]])}/>
    <Page data={list.data} onPage={list.setPage} t={t}/>
    {selected?.kind==='new'&&<ManualEditor key="new" {...props} close={()=>setSelected(null)} saved={order=>{setSelected({id:order.id,kind:'manual'});reload();}}/>}
    {selected?.kind==='manual'&&detail.data&&<ManualEditor key={detail.data.id+':'+detail.data.version} {...props} initial={detail.data} close={()=>setSelected(null)} saved={()=>reload()}/>}
    {selected?.kind==='linked'&&<LinkedReport {...props} selected={selected} close={()=>setSelected(null)}/>}
  </section>;
}
function LinkedReport(props){
  const {selected,request,revision}=props,path='/projects/'+selected.project_id;
  const ctx=useResource(request,path,revision),people=useResource(request,path+'/people',revision);
  return ctx.data?<Report {...props} ctx={ctx.data} people={people.data||[]} path={path} endpoint={path+'/orders/'+selected.order_id} reference={selected.reference} loadingReference={selected.reference} loading/>:
    <Dialog t={props.t} title={props.t('أمر التحميل','Loading order')} onClose={props.close}><ErrorMessage error={ctx.error}/></Dialog>;
}
function ManualEditor(props){
  const {initial,api,session,request,t,can,close,saved,access}=props;
  const master=useCertificateApi(api,session);
  const [draft,setDraft]=useState(()=>initial||{items:[{label:'',unit:'Pcs',quantity:''}],loading_date:localDate(),status:'draft',vehicle_plate:'',driver_name:'',notes:'',signatures:[],command_key:newKey()});
  const [customer,setCustomer]=useState(initial?.customer||null),[customerSearch,setCustomerSearch]=useState(''),q=useDebounce(customerSearch);
  const [project,setProject]=useState(initial?.project?.id?String(initial.project.id):''),[create,setCreate]=useState(''),[paste,setPaste]=useState(''),[dirty,setDirty]=useState(!initial),[masterRevision,refreshMasters]=useState(0);
  const choices=useResource(request,'/loading-options'+queryString({q,customer_id:customer?.id}),masterRevision);
  const action=useAction(request,saved),change=value=>{setDraft(value);setDirty(true);};
  const masterAllowed=access?.capabilities?.includes('create_master')&&Boolean(access.all_projects||access.allow_project_creation);
  function rows(changes){change({...draft,items:draft.items.map((row,index)=>({...row,...Object.fromEntries(changes.filter(cell=>cell.rowId===String(index)).map(cell=>[cell.key,cell.value]))}))});}
  return <Dialog t={t} wide title={initial?.reference||t('أمر تحميل يدوي جديد','New manual loading order')} onClose={close}>
    <form className="pc-stack" onSubmit={event=>{event.preventDefault();action.run(initial?'/loading-orders/'+initial.id:'/loading-orders',initial?'PATCH':'POST',{
      ...draft,project_id:Number(project),customer_id:customer?.id,version:initial?.version});}}>
      <fieldset className="pc-stack" disabled={!can('edit')||action.busy}>
        {initial?<p><bdi>{customer?.display_name} · {initial.project.name} · {initial.project.code}</bdi></p>:<div className="pc-form">
          <Combobox label={t('العميل','Customer')} selected={customer} options={choices.data?.customers||[]} onSearch={setCustomerSearch} onSelect={value=>{setCustomer(value);setProject('');setDirty(true);}} onClear={()=>{setCustomer(null);setProject('');}} t={t}/>
          <Pick label={t('المشروع','Project')} value={project} required onChange={value=>{setProject(value);change({...draft,signatures:choices.data?.projects.find(item=>String(item.id)===value)?.loading_signatures||[]});}} items={(choices.data?.projects||[]).map(value=>[value.id,value.code+' · '+value.name])}/>
          {masterAllowed&&<div className="pc-toolbar"><button type="button" onClick={()=>setCreate('customer')}>{t('عميل جديد','New customer')}</button>
            <button type="button" disabled={!customer} onClick={()=>setCreate('project')}>{t('مشروع جديد','New project')}</button></div>}
        </div>}
        <div className="pc-form"><Text type="date" label={t('تاريخ التحميل','Loading date')} value={draft.loading_date} onChange={value=>change({...draft,loading_date:value})}/>
          <Pick label={t('الحالة','Status')} value={draft.status} placeholder="" onChange={value=>change({...draft,status:value})} items={[
            ['draft',t('مسودة','Draft')],['issued',t('صادر','Issued')],['cancelled',t('ملغى','Cancelled')]]}/></div>
        <div className="ops-order-picker manual-loading-items"><SearchableTable t={t} records={draft.items.map((item,index)=>({...item,_gridId:String(index)}))}
          columns={[{key:'label',label:t('البيان','Description'),editable:true},{key:'unit',label:t('الوحدة','Unit'),editable:true},{key:'quantity',label:t('الكمية','Quantity'),editable:true,type:'number',min:0.0001}]} onChanges={rows}
          headers={[t('البيان','Description'),t('الوحدة','Unit'),t('الكمية','Quantity'),'']} rows={draft.items.map((item,index)=>[index,[
            ...['label','unit','quantity'].map(key=><input key={key} aria-label={t('بند ','Item ')+(index+1)+' '+({label:t('البيان','label'),unit:t('الوحدة','unit'),quantity:t('الكمية','quantity')})[key]} type={key==='quantity'?'number':'text'} min={key==='quantity'?0.0001:undefined} step="any" required value={item[key]}
              onChange={event=>change({...draft,items:draft.items.map((row,i)=>i===index?{...row,[key]:event.target.value}:row)})}/>),
            <button type="button" onClick={()=>change({...draft,items:draft.items.filter((_,i)=>i!==index)})}>{t('حذف','Remove')}</button>]])}/></div>
        <div className="pc-toolbar"><button type="button" onClick={()=>change({...draft,items:[...draft.items,{label:'',unit:'Pcs',quantity:''}]})}>{t('إضافة بند تحميل','Add loading item')}</button><span>{t('عدد البنود: ','Items: ')+draft.items.length}</span></div>
        <details><summary>{t('لصق بنود من Excel','Paste items from Excel')}</summary><small>{t('البيان ثم الوحدة ثم الكمية، كل بند في سطر.','Description, unit, quantity — one item per line.')}</small>
          <textarea aria-label={t('بنود Excel','Excel items')} value={paste} onChange={event=>setPaste(event.target.value)}/><button type="button" disabled={!paste.trim()} onClick={()=>{
            const added=parseSmartClipboardGrid(paste).filter(line=>line.some(value=>String(value).trim())).map(([label,unit,quantity])=>({label,unit:unit||'Pcs',quantity:normalizeSmartNumericClipboardValue(quantity||'')}));
            change({...draft,items:[...draft.items.filter(item=>item.label||item.quantity),...added]});setPaste('');}}>{t('إضافة البنود الملصقة','Add pasted items')}</button></details>
        <div className="pc-form">{[['vehicle_plate',t('رقم السيارة','Vehicle license plate')],['driver_name',t('اسم السائق','Driver name')],['notes',t('ملاحظات','Notes')]].map(([key,label])=>
          <Text key={key} label={label} value={draft[key]} onChange={value=>change({...draft,[key]:value})}/>)}</div>
        <details><summary>{t('التوقيعات','Signatures')}</summary>{draft.signatures.map((person,index)=><div className="pc-form" key={index}>
          {['name','title'].map(key=><Text key={key} label={key==='name'?t('الاسم','Name'):t('الوظيفة','Position')} value={person[key]} onChange={value=>change({...draft,signatures:draft.signatures.map((row,i)=>i===index?{...row,[key]:value}:row)})}/>)}
          <Pick label={t('الطرف','Side')} value={person.side} placeholder="" items={[["company",t('الشركة','Company')],["client",t('العميل','Customer')]]} onChange={value=>change({...draft,signatures:draft.signatures.map((row,i)=>i===index?{...row,side:value}:row)})}/>
          <button type="button" onClick={()=>change({...draft,signatures:draft.signatures.filter((_,i)=>i!==index)})}>{t('حذف','Remove')}</button></div>)}
          <button type="button" onClick={()=>change({...draft,signatures:[...draft.signatures,{name:'',title:'',side:'company'}]})}>{t('إضافة توقيع','Add signature')}</button></details>
        <button type="submit" className="primary" disabled={!project||!customer||!draft.items.length}>{t('حفظ أمر التحميل','Save loading order')}</button>
      </fieldset><ErrorMessage error={action.error||choices.error}/>
    </form>
    {initial&&<PdfOutput {...props} kind="loading" filters={{}} endpoint={'/api/project-operations/loading-orders/'+initial.id+'/pdf'} disabled={dirty||action.busy}/>}
    {create&&<NewMaster kind={create} customer={customer} request={master} t={t} close={()=>setCreate('')} saved={value=>{if(create==='customer'){setCustomer(value);setProject('');}else setProject(String(value.id));setCreate('');refreshMasters(value=>value+1);setDirty(true);}}/>}
  </Dialog>;
}
function NewMaster({kind,customer,request,t,close,saved}){
  const [name,setName]=useState(''),[address,setAddress]=useState(''),[category,setCategory]=useState(''),action=useAction(request,saved);
  return <Dialog t={t} title={kind==='customer'?t('عميل جديد','New customer'):t('مشروع جديد','New project')} onClose={close}><form className="pc-stack" onSubmit={event=>{event.preventDefault();action.run(kind==='customer'?'/customers':'/projects','POST',{name,address,category:category||(/^شركة\s/.test(name)?'corporate':undefined),customer_id:customer?.id,currency:'EGP'});}}>
    <Text label={t('الاسم','Name')} value={name} onChange={setName} required/><Text label={t('العنوان','Address')} value={address} onChange={setAddress}/>
    {kind==='customer'&&<Pick label={t('نوع العميل','Customer type')} value={category} onChange={setCategory} items={[["retail",t('فرد','Individual')],["corporate",t('شركة','Company')]]}/>}
    <p>{t('يُضاف إلى البيانات المحفوظة بكود فريد تلقائيًا.','Saved with an automatically assigned unique code.')}</p><ErrorMessage error={action.error}/><button type="submit" className="primary" disabled={action.busy}>{t('حفظ','Save')}</button></form></Dialog>;
}
