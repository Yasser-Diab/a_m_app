import {useState} from 'react';
import {Text,Pick,SearchableTable,ErrorMessage,useAction} from './shared.jsx';
import {newKey} from '../certificates/shared.jsx';
import {openingDescription} from './terminology.js';

export default function LoadingExtras({order,endpoint,request,t,can,reload}){
  const [settings,setSettings]=useState(order.loading_settings||{enabled:false,rows:[]});
  const [saved,setSaved]=useState(false);
  const action=useAction(request,()=>{setSaved(true);reload();});
  const change=next=>{setSettings(next);setSaved(false);};
  const set=(index,key,value)=>change({...settings,rows:settings.rows.map((row,i)=>i===index?{...row,[key]:value}:row)});
  return <details className="ops-loading-extras"><summary>{t('بنود التحميل الإضافية','Additional loading items')} · {settings.rows.length}</summary>
    <form className="pc-stack" onSubmit={event=>{event.preventDefault();action.run(endpoint+'/loading-settings','PATCH',{
      ...settings,version:order.loading_settings_version});}}>
      <small>{t('يمكن تخصيص الجزء لفتحة معينة أو للأمر كله. تحفظ الكميات وتحميلاتها لهذا الأمر.','Assign each part to an opening or to the whole order. Quantities and confirmed loads are saved for this order.')}</small>
      <fieldset disabled={!can('edit')||action.busy}>
        <label className="pc-check"><input type="checkbox" checked={settings.enabled} onChange={event=>change({...settings,enabled:event.target.checked})}/>
          {t('إظهار البنود الإضافية في أمر التحميل','Include additional items in the loading order')}</label>
        <SearchableTable t={t} records={settings.rows.map((row,index)=>({...row,opening:openingDescription(order.items.find(item=>item.id===Number(row.order_item_id))?.specification)||t('عام للأمر','General order item'),_gridId:String(index)}))}
          columns={[{key:'label',label:t('البيان','Description'),editable:true},{key:'unit',label:t('الوحدة','Unit'),editable:true},{key:'quantity',label:t('الكمية','Quantity'),editable:true,type:'number',min:0.0001},{key:'opening',label:t('الفتحة','Opening')}]}
          onChanges={can('edit')&&!action.busy?changes=>change({...settings,rows:settings.rows.map((row,index)=>({...row,...Object.fromEntries(changes.filter(cell=>cell.rowId===String(index)).map(cell=>[cell.key,cell.value]))}))}):undefined}
          headers={[t('البيان','Description'),t('الوحدة','Unit'),t('الكمية','Quantity'),t('الفتحة','Opening'),t('الكمية لكل فتحة','Quantity per opening'),'']} rows={settings.rows.map((row,index)=>[index,[
          <Text label={t('بيان البند','Item description')} value={row.label} required onChange={value=>set(index,'label',value)}/>,
          <Text label={t('وحدة البند','Item unit')} value={row.unit} required onChange={value=>set(index,'unit',value)}/>,
          <Text label={t('كمية البند','Item quantity')} value={row.quantity} type="number" min={0.0001} step="any" required onChange={value=>set(index,'quantity',value)}/>,
          <Pick label={t('الفتحة المرتبطة','Related opening')} placeholder={t('عام للأمر','General order item')} value={row.order_item_id||''} items={order.items.map(item=>[item.id,openingDescription(item.specification)+' · '+(item.specification.technical.tag||'')+' '+item.specification.technical.width_mm+' × '+item.specification.technical.height_mm])} onChange={value=>change({...settings,rows:settings.rows.map((entry,i)=>i===index?{...entry,order_item_id:value?Number(value):null,per_opening:Boolean(value)}:entry)})}/>,
          <label><input type="checkbox" disabled={!row.order_item_id} checked={Boolean(row.per_opening)} onChange={event=>set(index,'per_opening',event.target.checked)}/>{t('لكل فتحة','Per opening')}</label>,
          <button type="button" onClick={()=>change({...settings,rows:settings.rows.filter((_,i)=>i!==index)})}>{t('حذف','Remove')}</button>
        ]])}/>
        <div className="pc-toolbar"><button type="button" onClick={()=>change({...settings,rows:[...settings.rows,{id:newKey(),label:'',unit:'Pcs',quantity:'',order_item_id:null,per_opening:false}]})}>{t('إضافة بند تحميل','Add loading item')}</button>
          <button className="primary" type="submit" disabled={action.busy}>{t('حفظ بنود التحميل','Save loading items')}</button></div>
      </fieldset>
      <ErrorMessage error={action.error}/>{saved&&<p role="status">{t('تم الحفظ لهذا الأمر.','Saved for this work order.')}</p>}
    </form>
  </details>;
}
