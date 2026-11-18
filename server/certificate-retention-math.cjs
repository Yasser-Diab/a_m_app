const holdCategories=new Set(['retention','works_insurance','final_insurance']);
const ruleKey=(rule,index)=>String(rule.key||`${rule.category}:${index}`);
const isHold=rule=>rule.sign!=='addition'&&rule.category!=='advance_recovery'&&(holdCategories.has(rule.category)||rule.refundable===true||Boolean(rule.collection_date));
function allocate(total,rows){
  const weights=rows.map(row=>({...row,weight:row.weight<0n?-row.weight:row.weight})).filter(row=>row.weight>0n);
  const sum=weights.reduce((value,row)=>value+row.weight,0n),result=new Map();let remaining=total;
  weights.forEach((row,index)=>{const part=index===weights.length-1?remaining:total*row.weight/sum;result.set(row.identity,part);remaining-=part;});
  return result;
}
function applyHold({rule,index,prior,lines,delta,minor,money,round}){
  const previous=new Map((prior?.lines||[]).map(line=>[line.identity,BigInt(minor(line.balance)||0)]));
  const releaseCompleted=rule.category==='works_insurance'&&!rule.collection_date;
  const eligible=lines.filter(line=>!(releaseCompleted&&Number(line.cumulative_progress)>=100));
  const weights=eligible.map(line=>({identity:line.identity,weight:BigInt(minor(line.current)||0)}));
  let shares=allocate(delta,weights.filter(row=>delta<0n?row.weight<0n:row.weight>0n));
  if(!shares.size&&delta!==0n)shares=allocate(delta,eligible.map(line=>({identity:line.identity,weight:BigInt(minor(line.cumulative)||0)})));
  const balances=new Map(previous);
  for(const line of lines){
    const before=previous.get(line.identity)||0n;
    const next=releaseCompleted&&Number(line.cumulative_progress)>=100?0n:before+(shares.get(line.identity)||0n);
    balances.set(line.identity,next<0n?0n:next);
  }
  const before=[...previous.values()].reduce((sum,value)=>sum+value,0n),balance=[...balances.values()].reduce((sum,value)=>sum+value,0n);
  return {delta:balance-before,previous:before,balance,hold:{key:ruleKey(rule,index),rule_index:index,category:rule.category,label:rule.label||prior?.label||'',
    collection_date:rule.collection_date||null,balance:money(balance),lines:[...balances].map(([identity,value])=>({identity,balance:money(value)}))}};
}
module.exports={holdCategories,isHold,ruleKey,allocate,applyHold};
