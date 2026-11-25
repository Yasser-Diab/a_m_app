import ManualShipmentEntry from './ManualShipmentEntry.jsx';
import {SignatureInput,useSignatureDirectory} from '../signature-directory.jsx';
import {useMemo,useRef,useState} from 'react';
import {Combobox,Dialog,Problem,localDate,newKey,queryString,useCertificateApi,useDebounce,useResource} from '../certificates/shared.jsx';
import {ErrorMessage,Page,Pick,SearchableTable,Table,Text,useAction,usePaged,display,panelNames} from './shared.jsx';
import {PdfOutput} from './OperationsReports.jsx';
import {Report} from './Production.jsx';
import {parseSmartClipboardGrid,normalizeSmartNumericClipboardValue} from '../smart-table-clipboard.mjs';

export default function LoadingOrders(props){
  const {request,t,active,revision,reload,can}=props;
  const [search,setSearch]=useState(''),q=useDebounce(search),[selected,setSelected]=useState(null);
  const list=usePaged(request,active?'/loading-orders':null,{q},revision);
  const detail=useResource(request,selected?.kind==='manual'?'/loading-orders/'+selected.id:null,revision);
  const cached=useRef(null);if(detail.data)cached.current=detail.data;const current=detail.data?.id===selected?.id?detail.data:(cached.current?.id===selected?.id?cached.current:null);
  return <section className="pc-panel pc-stack"><div className="pc-toolbar"><h2>{t('أوامر التحميل','Loading Orders')}</h2>
    {can('edit')&&<button type="button" className="primary" onClick={()=>setSelected({kind:'new'})}>{t('أمر تحميل يدوي جديد','New manual loading order')}</button>}</div>
    <Text label={t('بحث برقم الأمر أو العميل أو المشروع','Search by order, customer or project')} value={search} onChange={value=>{setSearch(value);list.setPage(1);}}/>
    <ErrorMessage error={list.error||detail.error}/><Table headers={[t('رقم الأمر','Order number'),t('العميل','Customer'),t('المشروع','Project'),t('النوع','Type'),t('التاريخ','Date'),t('الحالة','Status')]}
      empty={list.pending?t('جارٍ التحميل…','Loading…'):t('لا توجد أوامر تحميل.','No loading orders.')}
      rows={(list.data?.items||[]).map(order=>[order.kind+order.id,[<button type="button" className="pc-name" onClick={()=>setSelected(order)}>{order.reference}</button>,order.customer,order.project,
        order.kind==='manual'?t('يدوي','Manual'):t('مرتبط بأمر تشغيل','From work order'),order.loading_date,
        ((({draft:t('مسودة','Draft'),issued:t('صادر','Issued'),cancelled:t('ملغى','Cancelled'),released:t('جاهز','Released'),shipped:t('تم الشحن','Shipped'),closed:t('مغلق','Closed')})[order.status]||order.status)+(order.loading_state&&order.loading_state!=='pending'?' · '+(order.loading_state==='complete'?t('مكتمل التحميل','Fully loaded'):t('تحميل جزئي','Partially loaded')):''))]])}/>
    <Page data={list.data} onPage={list.setPage} t={t}/>
    {selected?.kind==='new'&&<ManualEditor key="new" {...props} close={()=>setSelected(null)} saved={order=>{setSelected({id:order.id,kind:'manual'});reload();}}/>}
    {selected?.kind==='manual'&&current&&<ManualEditor key={current.id+':'+current.version} {...props} initial={current} close={()=>setSelected(null)} saved={()=>reload()}/>}
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
  const {initial,api,session,request,t,can,close,saved,access,reload}=props;
  const directory=useSignatureDirectory(request),[correctionReason,setCorrectionReason]=useState(''),[previousVersion,setPreviousVersion]=useState(null);
  const master=useCertificateApi(api,session);
  const [shipment,setShipment]=useState(null),[mapping,setMapping]=useState(null);
  const [draft,setDraft]=useState(()=>initial||{items:[{id:newKey(),label:'',unit:'Pcs',quantity:'',part_id:''}],loading_date:localDate(),status:'draft',vehicle_plate:'',driver_name:'',notes:'',signatures:[],command_key:newKey()});
  const [customer,setCustomer]=useState(initial?.customer||null),[customerSearch,setCustomerSearch]=useState(''),q=useDebounce(customerSearch);
  const [project,setProject]=useState(initial?.project?.id?String(initial.project.id):''),[create,setCreate]=useState(''),[paste,setPaste]=useState(''),[dirty,setDirty]=useState(!initial),[masterRevision,refreshMasters]=useState(0);
  const work=useResource(request,project?'/loading-work-options'+queryString({project_id:project,work_order_id:draft.work_order_id}):null);
  const choices=useResource(request,'/loading-options'+queryString({q,customer_id:customer?.id}),masterRevision);
  const partById=useMemo(()=>new Map((work.data?.parts||[]).map(part=>[part.part_id,part])),[work.data]),loadedById=useMemo(()=>new Map((initial?.rows||[]).map(row=>[row.id,row.loaded])),[initial?.rows]);
  const partCaption=id=>{const part=partById.get(id);return part?part.description+' · '+(part.label||display(panelNames,part.kind,t)):t('جارٍ تحميل المكون…','Loading component…');};
  const action=useAction(request,saved),change=value=>{setDraft(value);setDirty(true);};
  const masterAllowed=access?.capabilities?.includes('create_master')&&Boolean(access.all_projects||access.allow_project_creation);
  function rows(changes){change({...draft,items:draft.items.map((row,index)=>({...row,...Object.fromEntries(changes.filter(cell=>cell.rowId===String(index)).map(cell=>[cell.key,cell.value]))}))});}
  return <Dialog t={t} wide title={initial?.reference||t('أمر تحميل يدوي جديد','New manual loading order')} onClose={close}>
    <form className="pc-stack" onSubmit={event=>{event.preventDefault();action.run(initial?'/loading-orders/'+initial.id:'/loading-orders',initial?'PATCH':'POST',{
      ...draft,correction:initial?.edit_window?.correction_required===true,reason:correctionReason,project_id:Number(project),customer_id:customer?.id,version:initial?.version});}}>
      <fieldset className="pc-stack" disabled={!can('edit')||action.busy}>
        {initial?<p><bdi>{customer?.display_name} · {initial.project.name} · {initial.project.code}</bdi></p>:<div className="pc-form">
          <Combobox label={t('العميل','Customer')} selected={customer} options={choices.data?.customers||[]} onSearch={setCustomerSearch} onSelect={value=>{setCustomer(value);setProject('');change({...draft,work_order_id:null,items:draft.items.map(item=>({...item,part_id:''}))});}} onClear={()=>{setCustomer(null);setProject('');}} t={t}/>
          <Pick label={t('المشروع','Project')} value={project} required onChange={value=>{setProject(value);change({...draft,work_order_id:null,items:draft.items.map(item=>({...item,part_id:''})),signatures:choices.data?.projects.find(item=>String(item.id)===value)?.loading_signatures||[]});}} items={(choices.data?.projects||[]).map(value=>[value.id,value.code+' · '+value.name])}/>
          {masterAllowed&&<div className="pc-toolbar"><button type="button" onClick={()=>setCreate('customer')}>{t('عميل جديد','New customer')}</button>
            <button type="button" disabled={!customer} onClick={()=>setCreate('project')}>{t('مشروع جديد','New project')}</button></div>}
        </div>}
        <div className="pc-form"><Text type="date" label={t('تاريخ التحميل','Loading date')} value={draft.loading_date} onChange={value=>change({...draft,loading_date:value})}/>
          <Pick label={t('الحالة','Status')} value={draft.status} placeholder="" onChange={value=>change({...draft,status:value})} items={[
            ['draft',t('مسودة','Draft')],['issued',t('صادر','Issued')],['cancelled',t('ملغى','Cancelled')]]}/></div>
        <Pick label={t('أمر التشغيل المرتبط (اختياري)','Related work order (optional)')} value={draft.work_order_id||''} disabled={initial?.rows?.some(row=>row.loaded>0&&row.part_id)}
          items={(work.data?.orders||[]).map(order=>[order.id,order.reference+(order.source_reference?' · '+order.source_reference:'')])} onChange={value=>change({...draft,work_order_id:value?Number(value):null,items:draft.items.map(item=>({...item,part_id:''}))})}/>
        {initial?.rows&&<p className="pc-caption" role="status">{t('حالة التحميل: ','Loading status: ')+({pending:t('لم يبدأ','Not started'),partial:t('جزئي','Partially loaded'),complete:t('مكتمل','Complete')})[initial.loading_state]}</p>}
        <div className="ops-order-picker manual-loading-items"><SearchableTable t={t} records={draft.items.map((item,index)=>({...item,_gridId:String(index),part_label:item.part_id?partCaption(item.part_id):''}))}
          columns={[{key:'label',label:t('البيان','Description'),editable:true},{key:'unit',label:t('الوحدة','Unit'),editable:true},{key:'quantity',label:t('الكمية','Quantity'),editable:true,type:'number',min:0.0001},{key:'part_label',label:t('مكون العمل','Work component')}]} onChanges={rows}
          headers={[t('البيان','Description'),t('الوحدة','Unit'),t('الكمية','Quantity'),t('مكون العمل','Work component'),'']} rows={draft.items.map((item,index)=>[index,[
            ...['label','unit','quantity'].map(key=><input key={key} aria-label={t('بند ','Item ')+(index+1)+' '+({label:t('البيان','label'),unit:t('الوحدة','unit'),quantity:t('الكمية','quantity')})[key]} type={key==='quantity'?'number':'text'} disabled={key==='unit'&&(Boolean(item.part_id)||loadedById.get(item.id)>0)} min={key==='quantity'?0.0001:undefined} step="any" required value={item[key]}
              onChange={event=>change({...draft,items:draft.items.map((row,i)=>i===index?{...row,[key]:event.target.value}:row)})}/>),
            <button type="button" disabled={!draft.work_order_id||loadedById.get(item.id)>0} onClick={()=>setMapping(index)}>{item.part_id?partCaption(item.part_id):t('ربط بمكون','Link component')}</button>,
            <button type="button" disabled={loadedById.get(item.id)>0} onClick={()=>change({...draft,items:draft.items.filter((_,i)=>i!==index)})}>{t('حذف','Remove')}</button>]])}/></div>
        <div className="pc-toolbar"><button type="button" onClick={()=>change({...draft,items:[...draft.items,{id:newKey(),label:'',unit:'Pcs',quantity:'',part_id:''}]})}>{t('إضافة بند تحميل','Add loading item')}</button><span>{t('عدد البنود: ','Items: ')+draft.items.length}</span></div>
        <details><summary>{t('لصق بنود من Excel','Paste items from Excel')}</summary><small>{t('البيان ثم الوحدة ثم الكمية، كل بند في سطر.','Description, unit, quantity — one item per line.')}</small>
          <textarea aria-label={t('بنود Excel','Excel items')} value={paste} onChange={event=>setPaste(event.target.value)}/><button type="button" disabled={!paste.trim()} onClick={()=>{
            const added=parseSmartClipboardGrid(paste).filter(line=>line.some(value=>String(value).trim())).map(([label,unit,quantity])=>({label,unit:unit||'Pcs',id:newKey(),part_id:'',quantity:normalizeSmartNumericClipboardValue(quantity||'')}));
            change({...draft,items:[...draft.items.filter(item=>item.label||item.quantity),...added]});setPaste('');}}>{t('إضافة البنود الملصقة','Add pasted items')}</button></details>
        <div className="pc-form">{[['vehicle_plate',t('رقم السيارة','Vehicle license plate')],['driver_name',t('اسم السائق','Driver name')],['notes',t('ملاحظات','Notes')]].map(([key,label])=>
          <Text key={key} label={label} value={draft[key]} onChange={value=>change({...draft,[key]:value})}/>)}</div>
        <details><summary>{t('التوقيعات','Signatures')}</summary><button type="button" onClick={()=>change({...draft,signatures:(directory?.defaults.loading||[]).map(id=>directory.people.find(person=>person.id===id)).filter(Boolean)})}>{t('تطبيق التوقيعات العامة','Apply global signatures')}</button>{draft.signatures.map((person,index)=><div className="pc-form" key={index}>
          {['name','title'].map(key=><SignatureInput key={key} t={t} title={key==='title'} options={key==='name'?directory?.people||[]:directory?.titles||[]} label={key==='name'?t('الاسم','Name'):t('الوظيفة','Position')} value={person[key]} onChange={value=>change({...draft,signatures:draft.signatures.map((row,i)=>i===index?{...row,[key]:value}:row)})}/>)}
          <Pick label={t('الطرف','Side')} value={person.side} placeholder="" items={[["company",t('الشركة','Company')],["client",t('العميل','Customer')]]} onChange={value=>change({...draft,signatures:draft.signatures.map((row,i)=>i===index?{...row,side:value}:row)})}/>
          <button type="button" onClick={()=>change({...draft,signatures:draft.signatures.filter((_,i)=>i!==index)})}>{t('حذف','Remove')}</button></div>)}
          <button type="button" onClick={()=>change({...draft,signatures:[...draft.signatures,{name:'',title:'',side:'company'}]})}>{t('إضافة توقيع','Add signature')}</button></details>
        {initial?.edit_window?.correction_required&&<Text label={t('سبب مستند التصحيح','Correction document reason')} required value={correctionReason} onChange={setCorrectionReason}/>}
        <button type="submit" className="primary" disabled={!project||!customer||!draft.items.length}>{t('حفظ أمر التحميل','Save loading order')}</button>
      </fieldset><ErrorMessage error={action.error||choices.error||work.error}/>
    </form>
    {initial&&can('load')&&can('release')&&<button type="button" className="primary" disabled={dirty||action.busy||initial.status!=='issued'} onClick={()=>setShipment({})}>{t('تأكيد شحنة','Confirm shipment')}</button>}
    {initial&&initial.status==='draft'&&<p className="pc-caption">{t('احفظ أمر التحميل بحالة صادر لتأكيد الشحنات.','Save the loading order as Issued to confirm shipments.')}</p>}
    {initial?.shipments?.length>0&&<section className="pc-stack"><h3>{t('الشحنات وأذون التسليم','Shipments and Delivery Notes')}</h3>{initial.shipments.map(note=><div className="pc-toolbar" key={note.id}><button type="button" disabled={!can('load')||!can('release')} onClick={()=>setShipment({noteId:note.id})}>{note.reference}</button><span>{note.loading_date} · {note.vehicle_plate} · {note.driver_name}</span><PdfOutput {...props} kind="delivery" filters={{}} endpoint={'/api/project-operations/delivery-notes/'+note.id+'/pdf'}/></div>)}</section>}
    {shipment&&<ManualShipmentEntry {...props} manualOrderId={initial.id} noteId={shipment.noteId} close={()=>{setShipment(null);reload();}}/>}
    {mapping!==null&&<Dialog t={t} title={t('ربط بند بمكون عمل','Link a loading item to work')} onClose={()=>setMapping(null)}><Pick label={t('مكون العمل','Work component')} value={draft.items[mapping]?.part_id||''} items={(work.data?.parts||[]).map(part=>[part.part_id,part.description+' · '+(part.label||display(panelNames,part.kind,t))+' · '+part.remaining+' '+part.unit])} onChange={value=>{const part=work.data?.parts.find(part=>part.part_id===value);change({...draft,items:draft.items.map((item,index)=>index===mapping?{...item,part_id:value,unit:part?.unit||item.unit,label:item.label||part?.description||'',quantity:part?Math.min(Number(item.quantity)||part.required,part.required):item.quantity}:item)});setMapping(null);}}/></Dialog>}
    {initial&&<PdfOutput {...props} kind="loading" filters={{}} endpoint={'/api/project-operations/loading-orders/'+initial.id+'/pdf'} disabled={dirty||action.busy}/>}
    {initial?.document_history?.length>0&&<details><summary>{t('النسخ السابقة','Previous versions')}</summary>{initial.document_history.map(version=><button key={version.id} type="button" onClick={()=>setPreviousVersion(version)}><bdi>{version.reference} · {version.created_at}</bdi></button>)}</details>}
    {previousVersion&&<Dialog t={t} title={t('نسخة سابقة','Previous version')} onClose={()=>setPreviousVersion(null)}><PdfOutput {...props} kind="loading" filters={{history_id:previousVersion.id}} endpoint={'/api/project-operations/loading-orders/'+initial.id+'/pdf'}/></Dialog>}
    {create&&<NewMaster kind={create} customer={customer} request={master} t={t} close={()=>setCreate('')} saved={value=>{if(create==='customer'){setCustomer(value);setProject('');}else{setProject(String(value.id));change({...draft,work_order_id:null,items:draft.items.map(item=>({...item,part_id:''}))});}setCreate('');refreshMasters(value=>value+1);setDirty(true);}}/>}
  </Dialog>;
}
function NewMaster({kind,customer,request,t,close,saved}){
  const [name,setName]=useState(''),[address,setAddress]=useState(''),[category,setCategory]=useState(''),action=useAction(request,saved);
  return <Dialog t={t} title={kind==='customer'?t('عميل جديد','New customer'):t('مشروع جديد','New project')} onClose={close}><form className="pc-stack" onSubmit={event=>{event.preventDefault();action.run(kind==='customer'?'/customers':'/projects','POST',{name,address,category:category||(/^شركة\s/.test(name)?'corporate':undefined),customer_id:customer?.id,currency:'EGP'});}}>
    <Text label={t('الاسم','Name')} value={name} onChange={setName} required/><Text label={t('العنوان','Address')} value={address} onChange={setAddress}/>
    {kind==='customer'&&<Pick label={t('نوع العميل','Customer type')} value={category} onChange={setCategory} items={[["retail",t('فرد','Individual')],["corporate",t('شركة','Company')]]}/>}
    <p>{t('يُضاف إلى البيانات المحفوظة بكود فريد تلقائيًا.','Saved with an automatically assigned unique code.')}</p><ErrorMessage error={action.error}/><button type="submit" className="primary" disabled={action.busy}>{t('حفظ','Save')}</button></form></Dialog>;
}
