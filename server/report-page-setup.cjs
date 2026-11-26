const {AsyncLocalStorage}=require('node:async_hooks');
const context=new AsyncLocalStorage();
const sizes={A3:[297,420],A4:[210,297],A5:[148,210],Letter:[215.9,279.4],Legal:[215.9,355.6]};
function invalid(message){throw Object.assign(new Error(message),{status:400});}
function normalize(value){
  if(value==null||value==='')return null;
  if(typeof value==='string'){try{value=JSON.parse(value);}catch{invalid('Invalid paper settings');}}
  if(!value||typeof value!=='object'||Array.isArray(value))invalid('Invalid paper settings');
  const paper=Object.hasOwn(sizes,value.paper)?value.paper:value.paper==='Custom'?'Custom':null;
  if(!paper)invalid('Choose a supported paper size');
  const orientation=value.orientation==='landscape'?'landscape':'portrait';
  const number=(input,min,max)=>{const n=Number(input);if(!Number.isFinite(n)||n<min||n>max)invalid('Paper size or margins are outside the supported range');return Math.round(n*100)/100;};
  const base=paper==='Custom'?[number(value.width,80,1200),number(value.height,80,1200)]:sizes[paper];
  const [width,height]=orientation==='landscape'?[Math.max(...base),Math.min(...base)]:[Math.min(...base),Math.max(...base)];
  const margins=Object.fromEntries(['top','right','bottom','left'].map(key=>[key,number(value.margins?.[key]??12,0,200)]));
  if(width-margins.left-margins.right<40||height-margins.top-margins.bottom<40)invalid('Margins must leave at least 40 mm of usable page space');
  return {paper,orientation,width,height,margins};
}
function middleware(req,res,next){
  try{const setup=normalize(req.body?.page_setup??req.query?.page_setup);headers(res,setup);context.run({setup,res},()=>next());}
  catch(error){res.status(error.status||400).json({error:error.message});}
}
function current(){return context.getStore()?.setup||null;}
function run(value,fn){return context.run({setup:normalize(value)},fn);}
function publish(setup){const res=context.getStore()?.res;if(res&&!res.headersSent)headers(res,setup);}
function inferred(source,landscape=false){
 let paper='A4',orientation=landscape?'landscape':'portrait',margins={top:10,right:12,bottom:20,left:12},width=210,height=297;
 for(const match of source.matchAll(/@page\s*\{([^}]+)\}/gi)){
  const size=/\bsize\s*:\s*([^;}]+)/i.exec(match[1])?.[1]||'';
  const name=Object.keys(sizes).find(key=>new RegExp('\\b'+key+'\\b','i').test(size));if(name)paper=name;
  if(/landscape/i.test(size))orientation='landscape';else if(/portrait/i.test(size))orientation='portrait';
  const custom=/([\d.]+)mm\s+([\d.]+)mm/i.exec(size);if(custom){paper='Custom';width=Number(custom[1]);height=Number(custom[2]);orientation=width>height?'landscape':'portrait';}
  const margin=/\bmargin\s*:\s*([^;}]+)/i.exec(match[1])?.[1];if(margin){const parts=[...margin.matchAll(/([\d.]+)(mm)?/g)].map(m=>Number(m[1]));if(parts.length){const [top,right=top,bottom=top,left=right]=parts;margins={top,right,bottom,left};}}
 }
 return normalize({paper,orientation,width,height,margins});
}
function headers(res,setup){if(!setup)return;res.set('X-Report-Page-Setup',JSON.stringify(setup));const old=res.get('Access-Control-Expose-Headers')||'';res.set('Access-Control-Expose-Headers',[...new Set([...old.split(',').map(s=>s.trim()).filter(Boolean),'X-Report-Page-Setup','Content-Disposition'])].join(', '));}
function html(source,setup=current()){
  if(!setup)return source;
  const {width,height,margins:m}=setup;
  const css=`<style data-custom-page-setup>@page{size:${width}mm ${height}mm!important;margin:${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm!important}html,body{margin:0!important;padding:0!important}body{width:${width-m.left-m.right}mm!important;max-width:none!important}.page{width:100%!important;max-width:none!important;margin:0!important;padding:0!important}tr{break-inside:avoid;page-break-inside:avoid}</style>`;
  return source.replace(/<\/head>/i,css+'</head>').replace(/<body(?=[\s>])/i,`<body data-page-setup='${JSON.stringify(setup)}'`);
}
function printOptions(setup){return setup?{landscape:setup.orientation==='landscape',preferCSSPageSize:true,margins:Object.fromEntries(Object.entries(setup.margins).map(([k,v])=>[k,v/25.4]))}:{};}
async function fitPdf(bytes,setup=current()){
  if(!setup)return bytes;
  const {PDFDocument}=require('pdf-lib'),input=await PDFDocument.load(bytes),output=await PDFDocument.create(),pt=72/25.4;
  for(const page of input.getPages()){
    const target=output.addPage([setup.width*pt,setup.height*pt]),embedded=await output.embedPage(page),m=setup.margins;
    const width=(setup.width-m.left-m.right)*pt,height=(setup.height-m.top-m.bottom)*pt,scale=Math.min(width/page.getWidth(),height/page.getHeight());
    target.drawPage(embedded,{x:m.left*pt+(width-page.getWidth()*scale)/2,y:m.bottom*pt+(height-page.getHeight()*scale)/2,width:page.getWidth()*scale,height:page.getHeight()*scale});
  }
  return Buffer.from(await output.save());
}
module.exports={normalize,middleware,current,run,headers,publish,inferred,html,printOptions,fitPdf,sizes};
