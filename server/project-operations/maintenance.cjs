const {parse}=require('../certificate-access.cjs');
const services=[
  ['screen','شد سلك جديد','Flyscreen re-meshing',['flyscreen']],
  ['rollers','تغيير عجل الضلف','Roller replacement',[]],
  ['rubber','تغيير كاوتش','Gasket replacement',[]],
  ['glass','تغيير زجاج','Glass replacement',['glass']],
  ['general','نظافة وصيانة عامة','General cleaning and maintenance',[]],
  ['adjustment','ضبط الضلف والمفصلات','Leaf and hinge adjustment',[]],
  ['locks','تغيير التسكيك والإكسسوارات','Lock and hardware replacement',[]],
  ['hinges','تغيير مفصلات','Hinge replacement',[]],
  ['closer','تغيير ماكينة باب','Door closer replacement',[]],
  ['sealant','تجديد السيليكون والعزل','Sealant and weatherproofing renewal',[]],
  ['motor','صيانة موتور أو شاتر','Motor or shutter repair',[]],
  ['drainage','تنظيف المجاري وتسليك الصرف','Track and drainage cleaning',[]],
  ['fixing','إصلاح الحلق والتثبيت','Frame and fixing repair',[]],
  ['other','صيانة أخرى','Other maintenance',[]],
];
const category={id:'maintenance',ar:'صيانة',en:'Maintenance',
  hidden_common:['profile','color','finish','infill','glass_thickness','glass_color','glazing','coating_direction'],
  systems:services.map(([key,ar,en,tags])=>({id:'maintenance-'+key,ar,en,tags,fields:[]})),
  fields:[
    {key:'maintenance_mode',ar:'مكان تنفيذ الصيانة',en:'Maintenance location',options:['On site','Factory']},
    {key:'service_component',ar:'المكون المطلوب إرجاعه للعميل',en:'Component to return to the customer',options:['Flyscreen leaf','Operable leaf','Frame','Glass panel','Complete opening','Other item']},
    {key:'replacement_spec',ar:'مواصفات الخامة أو القطعة البديلة',en:'Replacement material or part specification'},
    {key:'service_findings',ar:'العطل وأعمال الصيانة المطلوبة',en:'Fault and required maintenance'},
    {key:'screen_material',ar:'خامة السلك',en:'Flyscreen mesh material'},
    {key:'glass_type',ar:'نوع الزجاج',en:'Glass type'},
    {key:'infill',ar:'تكوين الزجاج',en:'Glass composition'},
    {key:'glass_thickness',ar:'سمك الزجاج (مم)',en:'Glass thickness (mm)',type:'number'},
  ]};
function onSite(order){return order.kind==='maintenance'&&(order.service||parse(order.service_data,{})).mode!=='factory';}
function factory(order){return order.kind==='maintenance'&&!onSite(order);}
function mode(technical){return technical?.maintenance_mode==='Factory'?'factory':'site';}
module.exports={category,onSite,factory,mode};
