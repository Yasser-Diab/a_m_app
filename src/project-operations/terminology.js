import values from "../../server/project-operations/translations.json";
export const onSiteMaintenance=order=>order.kind==='maintenance'&&order.service?.mode!=='factory';
export const factoryMaintenance=order=>order.kind==='maintenance'&&order.service?.mode==='factory';
export const openingDescription=item=>item?.opening_description||item?.commercial?.description||item?.description||item?.technical?.tag||item?.code||'';
export const partMeasurementAvailable=(field,tags,technical)=>!(field.requiresFixed||field.panelBasis)||
  (tags.has('fixed_panel')||tags.has('fixed'))&&(!field.panelBasis||technical.panel_measurement_basis===field.panelBasis);
export const openingDefaults=(category,technical={})=>["windows","doors"].includes(category)?{viewing:"Inside",perimeter:["right","left","top","bottom"],...technical}:category==='maintenance'?{maintenance_mode:'On site',...technical}:technical;
export const commonAvailable=(category,key)=>!category?.hidden_common?.includes(key)||category.fields?.some(field=>field.key===key);
export const hasTrim=(key,technical)=>!["trim_type","trim_size_cm"].includes(key)||Array.isArray(technical.perimeter)&&technical.perimeter.length>0;
export const technicalText=(value,locale)=>values[value]?.[locale==="ar"?0:1]??value;
export const coatingValue=(value)=>({"Inside":"للداخل","Outside":"للخارج","Inward":"للداخل","Outward":"للخارج",
  "Inside cavity":"داخل الكتلة","من الداخل":"للداخل","من الخارج":"للخارج"})[value]||value;
export const fieldOptions=(field,spec={})=>field.key==="coating_direction"?
  ["للخارج","للداخل",...(/double|triple|دبل|مزدوج|ثلاثي/i.test(spec.glazing||"")?["داخل الكتلة"]:[])]:
  field.key==='hinge_side'&&Number(spec.leaves)===1?['Right','Left']:field.options||[];
export function perimeterText(value,locale) {
  if (!Array.isArray(value)) return "";
  const directions=["right","left","top","bottom"];
  const chosen=directions.filter(side=>value.includes(side));
  const labels=locale==="ar"?{right:"يمين",left:"شمال",top:"علوي",bottom:"سفلي"}:{right:"Right",left:"Left",top:"top",bottom:"bottom"};
  const join=sides=>sides.map(side=>labels[side]).join(locale==="ar"?" و":" and ");
  if (chosen.length===4) return locale==="ar"?"ببار كامل":"With full perimeter trim";
  if (!chosen.length) return locale==="ar"?"بدون بار":"Without trim";
  if (chosen.length===1) return locale==="ar"?"ببار "+join(chosen)+" فقط":join(chosen)+" trim only";
  return locale==="ar"?"بدون بار "+join(directions.filter(side=>!chosen.includes(side))):"Without "+join(directions.filter(side=>!chosen.includes(side))).toLowerCase()+" trim";
}
export function configurationTags(system,technical={}) {
  const tags=new Set(system?.tags||[]);
  if(technical.maintenance_mode==='Factory')tags.add('factory');
  if (Number(technical.fixed_panels)>0) tags.add("fixed_panel");
  if(Number(technical.top_fixed_height)>0||Number(technical.bottom_fixed_height)>0||/upper|lower|علوي|سفلي/i.test(technical.tilt_fixed||""))tags.add("fixed_panel");
  if (/double|triple|دبل|مزدوج|ثلاثي/i.test(technical.glazing||"")) tags.add("insulated");
  if (/laminat|مصفح|رقائقي/i.test(technical.glass_type||"")) tags.add("laminated");
  return tags;
}
