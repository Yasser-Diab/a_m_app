import {useState} from 'react';
import {Text,SearchableTable,ErrorMessage,useAction} from './shared.jsx';

export default function LoadingExtras({order,endpoint,request,t,can,reload}){
  const [settings,setSettings]=useState(order.loading_settings||{enabled:false,rows:[]});
  const [saved,setSaved]=useState(false);
  const action=useAction(request,()=>{setSaved(true);reload();});
  const change=next=>{setSettings(next);setSaved(false);};
  const set=(index,key,value)=>change({...settings,rows:settings.rows.map((row,i)=>i===index?{...row,[key]:value}:row)});
  return <details className="ops-loading-extras"><summary>{t('بنود التحميل الإضافية','Additional loading items')} · {settings.rows.length}</summary>
    <form className="pc-stack" onSubmit={event=>{event.preventDefault();action.run(endpoint+'/loading-settings','PATCH',{
      ...settings,version:order.loading_settings_version});}}>
      <small>{t('محفوظة لهذا الأمر فقط. تضاف إلى التقرير دون تغيير حساب الحلوق والضلف والسلك.','Saved for this work order. Included in reports without changing frame, leaf or flyscreen balances.')}</small>
      <fieldset disabled={!can('edit')||action.busy}>
        <label className="pc-check"><input type="checkbox" checked={settings.enabled} onChange={event=>change({...settings,enabled:event.target.checked})}/>
          {t('إظهار البنود الإضافية في أمر التحميل','Include additional items in the loading order')}</label>
        <SearchableTable t={t} records={settings.rows.map((row,index)=>({...row,_gridId:String(index)}))}
          columns={[{key:'label',label:t('البيان','Description'),editable:true},{key:'unit',label:t('الوحدة','Unit'),editable:true},{key:'quantity',label:t('الكمية','Quantity'),editable:true,type:'number',min:0.0001}]}
          onChanges={can('edit')&&!action.busy?changes=>change({...settings,rows:settings.rows.map((row,index)=>({...row,...Object.fromEntries(changes.filter(cell=>cell.rowId===String(index)).map(cell=>[cell.key,cell.value]))}))}):undefined}
          headers={[t('البيان','Description'),t('الوحدة','Unit'),t('الكمية','Quantity'),'']} rows={settings.rows.map((row,index)=>[index,[
          <Text label={t('بيان البند','Item description')} value={row.label} required onChange={value=>set(index,'label',value)}/>,
          <Text label={t('وحدة البند','Item unit')} value={row.unit} required onChange={value=>set(index,'unit',value)}/>,
          <Text label={t('كمية البند','Item quantity')} value={row.quantity} type="number" min={0.0001} step="any" required onChange={value=>set(index,'quantity',value)}/>,
          <button type="button" onClick={()=>change({...settings,rows:settings.rows.filter((_,i)=>i!==index)})}>{t('حذف','Remove')}</button>
        ]])}/>
        <div className="pc-toolbar"><button type="button" onClick={()=>change({...settings,rows:[...settings.rows,{label:'',unit:'',quantity:''}]})}>{t('إضافة بند تحميل','Add loading item')}</button>
          <button className="primary" type="submit" disabled={action.busy}>{t('حفظ بنود التحميل','Save loading items')}</button></div>
      </fieldset>
      <ErrorMessage error={action.error}/>{saved&&<p role="status">{t('تم الحفظ لهذا الأمر.','Saved for this work order.')}</p>}
    </form>
  </details>;
}
