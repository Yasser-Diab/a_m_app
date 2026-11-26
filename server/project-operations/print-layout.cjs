// Runs in the print window. Measure at the report's actual A4 content width,
// keeping small groups intact while allowing long groups to start on page one.
async function prepareOperationsPrint() {
  const groups=[...document.querySelectorAll('.work-group')];
  if(!groups.length&&!document.querySelector('.loading-transport,.loading-sheet'))return {groups:0,flowing:0};
  await document.fonts?.ready;
  await Promise.all([...document.images].map(image=>image.decode().catch(()=>{})));
  const custom=JSON.parse(document.body.dataset.pageSetup||'null');
  document.body.style.width=custom?(custom.width-custom.margins.left-custom.margins.right)+'mm':'186mm';
  const ruler=document.createElement('div');
  // The native footer needs a real reserved margin; otherwise its white background clips the last row.
  ruler.style.cssText='position:absolute;visibility:hidden;height:265mm;width:1mm;pointer-events:none';
  document.body.append(ruler);
  if(custom)ruler.style.height=(custom.height-custom.margins.top-custom.margins.bottom)+'mm';
  const pageHeight=ruler.getBoundingClientRect().height;ruler.remove();
  const style=document.createElement('style');
  style.textContent='.work-group.ops-flow-group,.shared-specifications.ops-flow-block{break-inside:auto!important;page-break-inside:auto!important}.loading-dispatch{break-inside:avoid;page-break-inside:avoid}';
  document.head.append(style);
  for(const transport of document.querySelectorAll('.loading-transport')){
    const signoffs=transport.nextElementSibling;
    if(signoffs?.matches('.signoffs')&&!transport.parentElement.matches('.loading-dispatch')){
      const together=document.createElement('div');together.className='loading-dispatch';transport.before(together);together.append(transport,signoffs);
      if(together.getBoundingClientRect().height>pageHeight-2)together.style.breakInside='auto';
    }
  }
  const bodyTop=document.body.getBoundingClientRect().top;
  let flowing=0;
  for(const [index,group] of groups.entries()){
    group.classList.remove('ops-flow-group');
    const rect=group.getBoundingClientRect();
    const available=index===0?Math.max(0,pageHeight-(rect.top-bodyTop)):pageHeight;
    if(rect.height>available-2){group.classList.add('ops-flow-group');flowing++;}
    for(const block of group.querySelectorAll('.shared-specifications'))
      block.classList.toggle('ops-flow-block',block.getBoundingClientRect().height>pageHeight-2);
  }
  return {groups:groups.length,flowing};
}

module.exports={prepareOperationsPrint};
