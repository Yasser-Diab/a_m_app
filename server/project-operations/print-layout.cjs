// Runs in the print window. Measure at the report's actual A4 content width,
// keeping small groups intact while allowing long groups to start on page one.
async function prepareOperationsPrint() {
  const groups=[...document.querySelectorAll('.work-group')];
  if(!groups.length)return {groups:0,flowing:0};
  await document.fonts?.ready;
  await Promise.all([...document.images].map(image=>image.decode().catch(()=>{})));
  document.body.style.width='186mm';
  const ruler=document.createElement('div');
  ruler.style.cssText='position:absolute;visibility:hidden;height:273mm;width:1mm;pointer-events:none';
  document.body.append(ruler);
  const pageHeight=ruler.getBoundingClientRect().height;ruler.remove();
  const style=document.createElement('style');
  style.textContent='.work-group.ops-flow-group,.shared-specifications.ops-flow-block{break-inside:auto!important;page-break-inside:auto!important}';
  document.head.append(style);
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
