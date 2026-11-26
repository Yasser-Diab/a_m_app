import {useEffect,useState} from 'react';
import {ReportPageSetup,ReportPdfPreview,pageSetupFromResponse} from './report-page-setup.jsx';
export default function ReportPreviewFrame({url,session='',title,t,pageSetup,onSetupChange,showLogos}){
 const [result,setResult]=useState(null),[detected,setDetected]=useState(null),[refresh,setRefresh]=useState(0);
 const setupKey=JSON.stringify(pageSetup),[stable,setStable]=useState(setupKey);
 useEffect(()=>{const timer=setTimeout(()=>setStable(setupKey),350);return()=>clearTimeout(timer);},[setupKey]);
 useEffect(()=>{
  const controller=new AbortController();let localUrl;
  async function load(){try{
   const target=new URL(url,window.location.href);target.pathname=target.pathname.replace(/\/html$/,'/pdf');
   if(stable&&stable!=='null')target.searchParams.set('page_setup',stable);else target.searchParams.delete('page_setup');
   if(showLogos!==null&&showLogos!==undefined)target.searchParams.set('show_logos',showLogos?'1':'0');
   const response=await fetch(target,{signal:controller.signal,cache:'no-store',headers:session?{Authorization:'Bearer '+session}:{}});
   if(!response.ok)throw new Error((await response.json().catch(()=>({}))).error||`HTTP ${response.status}`);
   const blob=await response.blob();localUrl=URL.createObjectURL(blob);if(!controller.signal.aborted)setResult({url,blob,localUrl,setupKey:stable,detected:pageSetupFromResponse(response)});
  }catch(error){if(!controller.signal.aborted)setResult({url,error:error.message});}}
  load();return()=>{controller.abort();if(localUrl)URL.revokeObjectURL(localUrl);};
 },[url,session,stable,showLogos,refresh]);
 const current=result?.url===url?result:null;
 return <div className="report-preview-document" aria-label={title}><ReportPageSetup value={pageSetup} onChange={onSetupChange} detected={current?.detected||detected} t={t}/><button type="button" onClick={()=>setRefresh(n=>n+1)}>{t('تحديث المعاينة','Refresh preview')}</button>{current?.error?<p role="alert">{current.error}</p>:current?.blob?<><ReportPdfPreview blob={current.blob} url={current.localUrl} setup={pageSetup||current.detected} onSetupChange={onSetupChange} onDetected={setDetected} t={t}/>{current.setupKey!==setupKey&&<p role="status">{t('جارٍ تطبيق إعدادات الصفحة…','Applying page settings…')}</p>}</>:<p role="status">{t('جارٍ إعداد معاينة الصفحات…','Preparing page preview…')}</p>}</div>;
}
