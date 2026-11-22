const assert=require('node:assert/strict');
const {orderQuantities,unitKey,unitName}=require('../server/project-operations/order-quantities.cjs');
const {orderSummary}=require('../server/project-operations/reports.cjs');
const item=(quantity,count,measured,unit)=>({quantity,specification:{technical:{quantity:count,width_mm:9000,height_mm:9000},commercial:{quantity:measured,unit}}});
const order={items:[item(4,10,24.5,'م²'),item(2,5,12,'lm'),item(3,8,8,'count'),item(1,3,75,'KG'),item(2,4,12,'Box')]};
const original=structuredClone(order);
assert.deepEqual(orderQuantities(order),{count:12,quantities:[{unit:'m²',quantity:9.8},{unit:'l.m',quantity:4.8},{unit:'Pcs',quantity:3},{unit:'kg',quantity:25},{unit:'Box',quantity:6}]});
order.balances=[{kind:'frames',required:100},{kind:'sliding',required:200}];
assert.equal(orderQuantities(order).count,12,'Do not count loading components as extra openings');
assert.deepEqual(order.items,original.items);
assert.deepEqual(orderQuantities({items:[item(2,0,12,'m²'),item(1,4,null,'l.m')]}),{count:3,quantities:[]},'Unknown measurement quantities are not inferred from manufacturing dimensions');
assert.deepEqual(orderQuantities({items:[item(1,1,0.1,'m²'),item(1,1,0.2,'sqm')]}).quantities,[{unit:'m²',quantity:0.3}]);
assert.equal(unitKey('م.ط'),'l.m');assert.equal(unitName('kg','ar'),'كجم');assert.equal(unitName('Pcs','ar'),'عدد');
for(const locale of ['ar','en']){
  const html=orderSummary(order,locale);
  assert.equal((html.match(/<tr>/g)||[]).length,1);
  assert.ok(html.includes('>12</bdi>')&&html.includes('>9.8</bdi>')&&html.includes('>4.8</bdi>'));
  assert.ok(html.includes(locale==='ar'?'م²':'m²'));
  assert.ok(!orderSummary({items:[item(1,1,1,'<unsafe>')]},locale).includes('<unsafe>'));
}
console.log('Order totals passed: partial orders, mixed units, loading counts, missing measurements, rounding and bilingual output.');
