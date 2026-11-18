const {parse}=require('./certificate-access.cjs');
const {toMinor,money}=require('./certificate-valuation.cjs');
const {isHold,ruleKey,allocate}=require('./certificate-retention-math.cjs');
// Derive the balances from immutable old snapshots; never rewrite an issued document.
function withRetentionHistory(db,snapshot){
  if(!snapshot||Array.isArray(snapshot.totals?.holds))return snapshot;
  const chain=[],seen=new Set();let cursor=snapshot;
  while(cursor&&!seen.has(cursor.id)){
    if(Array.isArray(cursor.totals?.holds))break;
    seen.add(cursor.id);chain.unshift(cursor);
    const id=cursor.baseline?.id;
    cursor=id?parse(db.get('SELECT snapshot_json FROM cert_revisions WHERE id=?',[id])?.snapshot_json,null):null;
  }
  const balances=new Map((cursor?.totals?.holds||[]).map(hold=>[hold.key,{...hold,lines:hold.lines.map(line=>({...line}))}]));
  for(const entry of chain){
    const used=new Set();
    for(const [index,rule]of (entry.applied_rules||[]).entries()){
      if(!rule.enabled||!isHold(rule))continue;
      const key=ruleKey(rule,index),components=entry.totals?.components||[];
      const ci=components.findIndex((c,i)=>!used.has(i)&&(c.rule_key===key||(!c.rule_key&&c.category===rule.category&&c.label===rule.label)));
      if(ci<0)continue;used.add(ci);
      const component=components[ci],prior=balances.get(key),before=new Map((prior?.lines||[]).map(line=>[line.identity,BigInt(toMinor(line.balance)||0)]));
      const movement=-BigInt(toMinor(component.amount??component.current)||0);
      const weights=(entry.lines||[]).map(line=>({identity:line.identity,weight:movement<0n?(before.get(line.identity)||0n):BigInt(toMinor(line.current)||0)}));
      let shares=allocate(movement,weights.filter(row=>row.weight>0n));
      if(!shares.size)shares=allocate(movement,(entry.lines||[]).map(line=>({identity:line.identity,weight:BigInt(toMinor(line.cumulative)||0)})));
      for(const [identity,value]of shares)before.set(identity,(before.get(identity)||0n)+value);
      const lines=[...before].map(([identity,value])=>({identity,balance:money(value>0n?value:0n)}));
      balances.set(key,{key,rule_index:index,category:rule.category,label:rule.label,collection_date:rule.collection_date||null,
        balance:money(lines.reduce((sum,line)=>sum+BigInt(toMinor(line.balance)||0),0n)),lines});
    }
  }
  return {...snapshot,totals:{...snapshot.totals,holds:[...balances.values()]}};
}
module.exports={withRetentionHistory};
