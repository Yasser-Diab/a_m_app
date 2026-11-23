const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
function footerMetadata(data={},branding={},version='',now=new Date()){
  const type=String(data.type||data.document_type||'').toLowerCase();
  const commercial=!data.is_statement&&['offer','price_offer','quotation','invoice','taxinvoice','nontaxinvoice'].includes(type);
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const at=key=>parts.find(part=>part.type===key)?.value||'';
  return {locale:data.report_language==='en'?'en':'ar',appVersion:version,commercial,companyPhone:branding.companyPhone||'',
    companyAbbreviation:branding.companyAbbreviation||'HGAD',companyNameColor:branding.companyNameColor||'#9a6b16',lineColor:branding.lineColor||'#d6c08d',
    bodyFontStack:branding.bodyFontStack||'Arial,Tahoma,sans-serif',footerContact:branding.website||branding.companyPhone||branding.companyAbbreviation||'',
    preparedBy:data.prepared_by||'Eng. Yasser',preparedAt:`${at('day')}/${at('month')}/${at('year')} · ${at('hour')}:${at('minute')}`};
}
function footerContents(meta={},preview=false){
  const ar=meta.locale==='ar',credit=`EasyCommercial ${escape(meta.appVersion||'')}`;
  const page=preview?(ar?'معاينة الصفحة':'Page preview'):`${ar?'صفحة':'Page'} <span class="pageNumber"></span> ${ar?'من':'of'} <span class="totalPages"></span>`;
  const left=meta.commercial?escape(meta.companyPhone):credit;
  return `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;align-items:center;width:100%;min-height:42px;border-top:1px solid ${escape(meta.lineColor||'#d6c08d')}">
    <div style="text-align:left;line-height:1.45;min-width:0"><bdi dir="${ar?'rtl':'ltr'}">${page}</bdi><div dir="ltr">${left}</div></div>
    <div style="text-align:center;line-height:1.45;min-width:0"><div>${escape(meta.footerContact||meta.website||'')}</div><div>${escape(meta.companyAbbreviation||'HGAD')}</div>${meta.commercial?`<div class="app-credit" style="font-size:0.25em;line-height:1.45">${credit}</div>`:''}</div>
    <div style="text-align:right;line-height:1.45;min-width:0"><div><bdi dir="auto">${ar?'إعداد':'By'} ${escape(meta.preparedBy||'Eng. Yasser')}</bdi></div><div dir="ltr">${escape(meta.preparedAt||'')}</div></div></div>`;
}
function pdfFooter(meta){
  return `<div style="width:100%;font-size:9.5px;color:${escape(meta.companyNameColor||'#9a6b16')};padding:4px 28px 0;font-family:${escape(String(meta.bodyFontStack||'Arial,Tahoma,sans-serif').replaceAll('"',"'"))};background:white;direction:ltr">${footerContents(meta)}</div>`;
}
module.exports={footerMetadata,footerContents,pdfFooter};
