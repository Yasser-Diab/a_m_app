import {useState} from 'react';
import {ChevronDown} from 'lucide-react';
import './settings-category.css';

export default function SettingsCategory({id,title,description,icon:Icon,children}){
  const [open,setOpen]=useState(()=>{try{return localStorage.getItem('settingsCategory:'+id)==='open';}catch{return false;}});
  return <details className="settings-category" data-settings-category={id} open={open} onToggle={event=>{
    const next=event.currentTarget.open;setOpen(next);try{localStorage.setItem('settingsCategory:'+id,next?'open':'closed');}catch{}
  }}>
    <summary><span className="settings-category-icon">{Icon&&<Icon size={21}/>}</span><span className="settings-category-heading"><h2>{title}</h2><span>{description}</span></span><ChevronDown className="settings-category-chevron" size={18}/></summary>
    <div className="settings-category-content">{children}</div>
  </details>;
}
