import {lazy,Suspense,useEffect,useState} from 'react';
import './report-page-setup.css';
const PdfPages=lazy(()=>import('./report-pdf-pages.jsx'));
export const paperSizes={A3:[297,420],A4:[210,297],A5:[148,210],Letter:[215.9,279.4],Legal:[215.9,355.6]};
export const initialPageSetup={paper:'A4',orientation:'portrait',width:210,height:297,margins:{top:12,right:12,bottom:20,left:12}};
export function pageSetupFromResponse(response){try{return JSON.parse(response.headers.get('X-Report-Page-Setup'))||null;}catch{return null;}}
export function pageSetupQuery(setup){return setup?{page_setup:JSON.stringify(setup)}:{};}
export function useReportPageSetup(key){
  const read=()=>{try{return JSON.parse(localStorage.getItem('reportPageSetupV1:'+key))||null;}catch{return null;}};
  const [value,setValue]=useState(read);
  useEffect(()=>setValue(read()),[key]);
  const set=next=>{setValue(next);try{if(next)localStorage.setItem('reportPageSetupV1:'+key,JSON.stringify(next));else localStorage.removeItem('reportPageSetupV1:'+key);}catch{}};
  return [value,set];
}
export function ReportPageSetup({value,onChange,t,detected,disabled=false}){
  const setup=value||detected||initialPageSetup;
  const change=(key,v)=>{const next={...setup,margins:{...setup.margins},[key]:v};if(key==='paper'&&paperSizes[v])[next.width,next.height]=next.orientation==='landscape'?[...paperSizes[v]].reverse():paperSizes[v];if(key==='orientation'&&((v==='landscape')!==(Number(next.width)>Number(next.height))))[next.width,next.height]=[next.height,next.width];if(['width','height'].includes(key))next.orientation=Number(next.width)>Number(next.height)?'landscape':'portrait';onChange(next);};
  return <details className="report-page-settings"><summary>{t('إعداد الصفحة والهوامش','Paper size and margins')} <bdi>{value?setup.paper:t('افتراضي التقرير','Report default')+' · '+setup.paper} · {setup.width} × {setup.height} mm</bdi></summary><fieldset disabled={disabled}>
    <div className="report-page-fields"><label>{t('مقاس الورق','Paper size')}<select aria-label={t('مقاس الورق','Paper size')} value={value?setup.paper:''} onChange={e=>e.target.value?change('paper',e.target.value):onChange(null)}><option value="">{t('افتراضي التقرير','Report default')}</option>{[...Object.keys(paperSizes),'Custom'].map(p=><option key={p} value={p}>{p==='Custom'?t('مخصص','Custom'):p}</option>)}</select></label>
    <label>{t('الاتجاه','Orientation')}<select aria-label={t('الاتجاه','Orientation')} value={setup.orientation} onChange={e=>change('orientation',e.target.value)}><option value="portrait">{t('رأسي','Portrait')}</option><option value="landscape">{t('أفقي','Landscape')}</option></select></label>
    {setup.paper==='Custom'&&['width','height'].map(k=><label key={k}>{k==='width'?t('العرض مم','Width mm'):t('الارتفاع مم','Height mm')}<input type="number" min="80" max="1200" step="0.1" value={setup[k]} onChange={e=>change(k,e.target.value)}/></label>)}
    {['top','right','bottom','left'].map((k,i)=><label key={k}>{t(...[['الهامش العلوي مم','Top margin mm'],['الهامش الأيمن مم','Right margin mm'],['الهامش السفلي مم','Bottom margin mm'],['الهامش الأيسر مم','Left margin mm']][i])}<input type="number" min="0" max="200" step="0.5" value={setup.margins[k]} onChange={e=>onChange({...setup,margins:{...setup.margins,[k]:Number(e.target.value)}})}/></label>)}
    </div><div className="report-page-hint"><span>{t('اسحب خطوط الهوامش في معاينة فواصل الصفحات، ثم حدّث المعاينة لتطبيقها على PDF.','Drag margin guides in the page-break preview, then refresh the preview to apply them to the PDF.')}</span><button type="button" onClick={()=>onChange(null)}>{t('استعادة افتراضي التقرير','Reset to report default')}</button></div>
  </fieldset></details>;
}
export function ReportPdfPreview({blob,url,t,setup,onSetupChange,onDetected}){
  return <Suspense fallback={<p role="status">{t('جارٍ تجهيز معاينة الصفحات…','Preparing page-break preview…')}</p>}><PdfPages {...{blob,url,t,setup,onSetupChange,onDetected}}/></Suspense>;
}
