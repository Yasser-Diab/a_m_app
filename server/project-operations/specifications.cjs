const originalCatalogue = require("./catalogue.json");
const catalogue={...originalCatalogue,categories:[...originalCatalogue.categories,require('./maintenance.cjs').category]};
const {date, encode, fail, parse, str} = require("../certificate-access.cjs");

const directions = ["right","left","top","bottom"];
const approvalParts = ["measurement","profile","glass","accessories","finish","details","drawing"];
const panels = ["sliding","hinged","fixed","other","items","screens"];
const labels={screen:"السلك",screen_type:"نوع السلك",screen_material:"خامة السلك",screen_configuration:"تفصيلة السلك",
  coating_direction:"اتجاه العاكس",viewing:"تحديد اليمين والشمال من",glass_thickness:"سمك الزجاج (مم)",profile:"نوع القطاع",
  infill:"تكوين الزجاج / الحشو",lock_right:"التسكيك يمين",lock_left:"التسكيك شمال",
  hinge_side:"جهة المفصلات / اتجاه الفتح",opening_direction:"الفتح للداخل / للخارج",
  layers:"عدد طبقات الزجاج",spacer_thickness:"سمك فاصل الزجاج (مم)",cavity:"نوع الغاز / التجويف",perimeter:"البرور"};
const named=(field)=>({...field,...(labels[field.key]?{ar:labels[field.key]}:{}),
  ...(field.key==='opening_direction'?{options:['Inward','Outward']}:{}),
  ...({vent_opening:{ar:"شفاط",en:"Vent"},vent_position:{ar:"مكان الشفاط",en:"Vent position",options:["Right","Left","Centre","In leaf"]},
    vent_width:{populatedOnly:true},vent_height:{populatedOnly:true},vent_direction:{populatedOnly:true}}[field.key]||{})});
const common = catalogue.common.filter(({key}) => !["item_code","project_code","customer_code","system","area","production_ref"].includes(key)).map(named);
const categories = new Map(catalogue.categories.map((category) => [category.id,category]));
const openings = new Set(["windows","doors"]);
const tagsByCategory = {
  windows:{hinged:[2,3,5,6,7,13,14,15,16,17,18,21,22],sliding:[8,9,10,11,12],tilt:[4,6,7,11,12],fixed:[1],fixed_panel:[19,20,22]},
  doors:{hinged:[1,2,3,4,5,11,12,14,16,17,18,19,20],sliding:[6,7,8,9,10,13],
    automatic:[13,14,15,21],panic:[16,17],fire:[17],fixed_panel:[3,4],other_panels:[15,21]},
  curtain_walls:{capped:[1,2],point:[7],structural:[2,3,4,6],integrated:[13,14,18]},
  railings:{glass:[4,5,6,7,8],base_shoe:[4],posts:[1,2,3,5,10,11,12,13,14,16,17]},
  cladding:{cassette:[1,2,5,21,22,23,24],aluminum:[1,2,3,4,5,6,7,8,9,10,21,22,23,24]},
  glass:{insulated:[5,6,7],laminated:[4,17,18,28],bent:[19],coated:[8,9,10,15,22],printing:[11,12,20]},
  roofs:{moving:[7,8,9],fabric:[8]},
  louvers:{moving:[3,4,8,9,10,13,14],fire:[7],acoustic:[5],water:[6]},
};
const conditional = {
  windows:{
    hinge_side:"hinged", opening_direction:"hinged tilt", hinge:"hinged", tracks:"sliding", slide_direction:"sliding",
    roller:"sliding", lock_right:"sliding", lock_left:"sliding", central_lock_handle:"sliding",
    tilt_mode:"tilt", tilt_fixed:"tilt", tilt_arm:"tilt", tilt_arm_45:"tilt", tilt_hinges:"tilt",
    interlock_right:"sliding", interlock_right_mm:"sliding", interlock_left:"sliding", interlock_left_mm:"sliding",
    fixed_position:"fixed fixed_panel",top_fixed_height:"fixed fixed_panel",bottom_fixed_height:"fixed fixed_panel",vent_position:"fixed fixed_panel",
  },
  doors:{
    active_leaf:"hinged sliding",hinge_side:"hinged",opening_angle:"hinged",hinge:"hinged",closer:"hinged",
    lock_right:"sliding",lock_left:"sliding",central_lock_handle:"sliding",
    motor:"automatic",panic_bar:"panic",escape_direction:"panic fire",fire_seal:"fire",fire_rating:"fire",
  },
  curtain_walls:{cap:"capped",cap_size:"capped",spider:"point",structural_silicone:"structural"},
  railings:{base_shoe:"base_shoe",base_size:"base_shoe",glass_height:"glass",railing_glass_thickness:"glass",posts:"posts",post_spacing:"posts",post_profile:"posts"},
  cladding:{cassette:"cassette",cassette_depth:"cassette",face_thickness:"aluminum"},
  glass:{spacer_thickness:"insulated",cavity:"insulated",inside_glass:"insulated laminated",inside_thickness:"insulated laminated",
    spacer:"insulated",sealant:"insulated",interlayer:"laminated",bend_radius:"bent",coating_surface:"coated",printing:"printing"},
  roofs:{motor:"moving",control:"moving",rain_sensor:"moving",wind_sensor:"moving",fabric:"fabric"},
  louvers:{motor:"moving",side_guide:"moving",cover_box:"moving",limit_switch:"moving",water:"water",fire_rating:"fire",acoustic:"acoustic"},
  maintenance:{service_component:'factory',screen_material:'flyscreen',glass_type:'glass',infill:'glass',glass_thickness:'glass'},
};
const dependencies = {
  windows:{screen_type:"screen",screen_material:"screen",screen_configuration:"screen",
    georgian_configuration:"georgian",vent_position:"vent_opening",vent_size:"vent_opening",vent_width:"vent_opening",vent_height:"vent_opening",vent_direction:"vent_opening"},
  curtain_walls:{opening_type:"opening_unit"},
  louvers:{mesh:"screen"},
};
const doorExtras = [{key:"fixed_panels",en:"Fixed panels",ar:"عدد الأجزاء الثابتة",type:"number"},
  {key:"perimeter",ar:"البرور",en:"Perimeter trims",type:"sides"}];
const trimFields=[{key:"trim_type",ar:"نوع البرور",en:"Architrave type",options:["عدل","بومبيه"]},
  {key:"trim_size_cm",ar:"مقاس البرور (سم)",en:"Architrave size (cm)",type:"number"}];
const panelMeasurements=[
  {key:'panel_measurement_basis',ar:'المقاس المحدد',en:'Measured part',type:'text',options:['Fixed panel','Operable leaf'],requiresFixed:true},
  {key:'fixed_width_mm',ar:'عرض الجزء الثابت (مم)',en:'Fixed panel width (mm)',type:'number',panelBasis:'Fixed panel'},
  {key:'fixed_height_mm',ar:'ارتفاع الجزء الثابت (مم)',en:'Fixed panel height (mm)',type:'number',panelBasis:'Fixed panel'},
  {key:'leaf_width_mm',ar:'عرض الضلفة المتحركة (مم)',en:'Operable leaf width (mm)',type:'number',panelBasis:'Operable leaf'},
  {key:'leaf_height_mm',ar:'ارتفاع الضلفة المتحركة (مم)',en:'Operable leaf height (mm)',type:'number',panelBasis:'Operable leaf'},
];
const slidingLocks=[
  {key:"lock_right",en:"Right lock",ar:"التسكيك يمين",minLeaves:2,type:"text"},
  {key:"lock_left",en:"Left lock",ar:"التسكيك شمال",minLeaves:2,type:"text"},
  {key:"central_lock_handle",en:"Central locking handle type",ar:"نوع يد القفل الوسطى",minLeaves:3,type:"text"},
];
const coating={key:"coating_direction",en:"Reflective coating direction",ar:"اتجاه العاكس",type:"text",options:["للخارج","للداخل","داخل الكتلة"]};
const glassCategories=new Set(["windows","doors","curtain_walls","railings","cladding","glass","roofs"]);
const glassType={key:"glass_type",en:"Glass type",ar:"نوع الزجاج",type:"text",
  options:["Float","Tempered","Heat-strengthened","Laminated","Low-E","Reflective","Tinted","Low-iron","Fire-rated","Acoustic","Switchable"]};
const glassCompositionKeys=new Set(["layers","outside_glass","outside_thickness","spacer_thickness","cavity","inside_glass","inside_thickness","interlayer"]);
const glassCompositionFields=categories.get("glass").fields.filter(({key})=>glassCompositionKeys.has(key));
const categoryFields=(kind)=>[...(categories.get(kind)?.fields||[]).filter(({key})=>!["coating_direction","glass_type","interlock_right","interlock_left"].includes(key)).map(named),
  ...(kind==="doors"?doorExtras:[]),...(openings.has(kind)?trimFields:[]),...(kind==="windows"?[{key:"vent_size",ar:"مقاس الشفاط (مم)",en:"Vent size (mm)",type:"text"}]:[]),...(openings.has(kind)?[...slidingLocks,
    {key:"frames_per_opening",ar:"عدد الحلوق لكل فتحة",en:"Frames per opening",type:"number"}]:[]),
  ...(glassCategories.has(kind)?[glassType]:[]),
  ...(glassCategories.has(kind)&&kind!=="windows"?[{key:"glazing",en:"Glazing",ar:"نوع التزجيج",type:"text",options:["Single","Double","Triple"]}]:[]),
  ...(glassCategories.has(kind)&&kind!=="glass"?glassCompositionFields.map(named):[]),
  ...(["windows","doors","glass","curtain_walls"].includes(kind)?[coating]:[]),
  ...(openings.has(kind)?[{key:"screen_leaves",ar:"عدد ضلف السلك لكل فتحة",en:"Flyscreen leaves per opening",type:"number"}]:[]),
  ...(openings.has(kind)?panelMeasurements:[])];
const counts = new Set(["quantity","leaves","fixed_panels","tracks","sections","posts","layers","slopes","blades","modules","fixing_points"]);
const choices = (value) => Boolean(value && !["لا","بدون","لا ينطبق","none","no","n/a"].includes(String(value).toLowerCase()));

function systemSeeds() {
  return catalogue.categories.flatMap((category) => category.systems.map((system,index) => ({
    ...system,category:category.id,tags:system.tags||Object.entries(tagsByCategory[category.id])
      .filter(([,indices])=>indices.includes(index+1)).map(([tag])=>tag),fields:[],
  })));
}
const seedsById=new Map(systemSeeds().map(system=>[system.id,system]));

function configuration(db, category, id) {
  if (!id) return null;
  const stored = db.get("SELECT * FROM ops_systems WHERE id=? AND category=?",[id,category]);
  if (!stored) fail(400,"Select a configuration from the selected category");
  const seed=categories.get(category)?.systems.find(system=>system.id===id);
  const defaults=seedsById.get(id);
  return {...stored,ar:seed?.ar||stored.ar,tags:[...new Set([...parse(stored.tags,[]),...(defaults?.tags||[])])],fields:parse(stored.fields,[])};
}

function openingDefaults(category,input={}){
  return openings.has(category)?{viewing:"Inside",perimeter:[...directions],...input}:category==='maintenance'?{maintenance_mode:'On site',...input}:input;
}

function fieldsFor(category, system, data = {}, includePopulated = false) {
  const tags = new Set(system?.tags || []);
  if(category==='maintenance'&&data.maintenance_mode==='Factory')tags.add('factory');
  if (Number(data.fixed_panels)>0) tags.add("fixed_panel");
  if(Number(data.top_fixed_height)>0||Number(data.bottom_fixed_height)>0||/upper|lower|علوي|سفلي/i.test(data.tilt_fixed||""))tags.add("fixed_panel");
  if (/double|triple|دبل|مزدوج|ثلاثي/i.test(data.glazing||"")) tags.add("insulated");
  if (/laminat|مصفح|رقائقي/i.test(data.glass_type||"")) tags.add("laminated");
  const specific = [...categoryFields(category),...(system?.fields||[])];
  return [...common,...specific].filter((field)=>{
    if(category==='maintenance'&&categories.get(category).hidden_common.includes(field.key)&&!specific.includes(field))return false;
    if((field.requiresFixed||field.panelBasis)&&!(tags.has('fixed_panel')||tags.has('fixed')))return false;
    if(field.panelBasis&&data.panel_measurement_basis!==field.panelBasis)return false;
    if(trimFields.some(item=>item.key===field.key)&&(!Array.isArray(data.perimeter)||!data.perimeter.length))return false;
    if(field.populatedOnly&&(data[field.key]==null||data[field.key]===""))return false;
    if (includePopulated && data[field.key]!=null && data[field.key]!=="" &&
        (!Array.isArray(data[field.key]) || data[field.key].length)) return true;
    const requirement = conditional[category]?.[field.key];
    const dependency = dependencies[category]?.[field.key];
    return (!requirement || requirement.split(" ").some((tag)=>tags.has(tag))) &&
      (!dependency || choices(data[dependency])) && (!field.minLeaves || Number(data.leaves)>=field.minLeaves);
  });
}

function catalogueForClient(db) {
  const systems = db.all("SELECT * FROM ops_systems ORDER BY ar, id");
  return {...catalogue, common, conditional, dependencies, approvalParts, directions, panels,
    categories:catalogue.categories.map((category)=>({
      ...category,fields:categoryFields(category.id),
      systems:systems.filter((s)=>s.category===category.id).map((s)=>({
        ...category.systems.find((entry)=>entry.id===s.id), ...s, ar:category.systems.find(entry=>entry.id===s.id)?.ar||s.ar,
        tags:configuration(db,category.id,s.id).tags,fields:parse(s.fields,[]),
      })),
    })),
  };
}

function number(value, label, {integer = false, positive = false, max = 1e9} = {}) {
  if (value == null || value === "") return null;
  if (!["number","string"].includes(typeof value) || String(value).trim()==="") fail(400, "Enter a valid " + label);
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0 || result > max || (integer && !Number.isInteger(result)) || (positive && !result))
    fail(400, "Enter a valid " + label);
  return result;
}

function cleanFrame(frame) {
  if (!frame || typeof frame !== "object") return null;
  const sides = {};
  for (const direction of directions) if (frame.sides?.[direction]) {
    const side = frame.sides[direction];
    sides[direction] = {
      width:number(side.width,"sub-frame width",{positive:true}),
      depth:number(side.depth,"sub-frame depth",{positive:true}),
      deduction:number(side.deduction,"sub-frame deduction",{positive:true}),
    };
  }
  if (!Object.keys(sides).length) return null;
  if (!["deducted","not_deducted"].includes(frame.status)) fail(400,"Select whether sub-frame dimensions have already been deducted");
  return {sides, status:frame.status};
}

function cleanTechnical(db, category, system, input = {}, nested = false) {
  input=openingDefaults(category,require('./customer-defaults.cjs').normalizeLocks(input));
  if(category==='maintenance'&&!['On site','Factory'].includes(input.maintenance_mode))fail(400,'Select on-site or factory maintenance');
  const result = {};
  for (const {key,type,en} of fieldsFor(category,system,input)) {
    if (input[key] == null || input[key] === "") continue;
    if (type === "number") result[key] = number(input[key],en,{integer:counts.has(key)});
    else if (type === "date") result[key] = date(input[key],true);
    else if (type === "boolean") {
      if (typeof input[key] !== "boolean") fail(400,"Select yes or no for " + en);
      result[key] = input[key];
    } else if (type === "sides") result[key] = directions.filter((side)=>Array.isArray(input[key]) && input[key].includes(side));
    else result[key] = str(input[key],1800);
  }
  if (openings.has(category)) {
    if (result.frames_per_opening!=null) result.frames_per_opening=number(result.frames_per_opening,"frames per opening",{integer:true});
    if (result.screen_leaves!=null) result.screen_leaves=number(result.screen_leaves,"flyscreen leaves per opening",{integer:true});
    if ([result.hinge_side,result.slide_direction].some((direction)=>/right|left|يمين|يسار/i.test(direction || "")) &&
        !["Inside","Outside","من الداخل","من الخارج"].includes(result.viewing))
      fail(400,"Select inside or outside viewing direction before entering handedness");
    const frame = cleanFrame(input.subframe);
    if (frame) result.subframe = frame;
    if (typeof input.rubber_bar==="boolean") result.rubber_bar = input.rubber_bar;
  }
  if (result.coating_direction)
    result.coating_direction=({"Inside":"للداخل","Outside":"للخارج","Inward":"للداخل","Outward":"للخارج","Inside cavity":"داخل الكتلة",
      "من الداخل":"للداخل","من الخارج":"للخارج"})[result.coating_direction]||result.coating_direction;
  if (!nested && category==="curtain_walls" && choices(result.opening_unit) && openings.has(input.integrated?.category)) {
    const {category:kind,system:id,spec} = input.integrated;
    result.integrated = {category:kind,system:configuration(db,kind,id)?.id || "",spec:cleanTechnical(db,kind,configuration(db,kind,id),spec,true)};
  }
  if (input.panel_counts && typeof input.panel_counts === "object")
    result.panel_counts = Object.fromEntries(panels.filter((kind)=>input.panel_counts[kind] !== "" && input.panel_counts[kind] != null)
      .map((kind)=>[kind,number(input.panel_counts[kind],"panel count",{integer:true})]));
  for(const key of ["viewing","perimeter"])if(input[key]===null||input[key]==="")result[key]=null;
  return result;
}

function dimensions(technical) {
  const {width_mm:width,height_mm:height,subframe} = technical;
  if (width == null || height == null) return null;
  if (!subframe || subframe.status==="deducted") return {width,height};
  if (subframe.status!=="not_deducted" || Object.values(subframe.sides).some((side)=>side.deduction==null)) return null;
  const applied = (side)=>subframe.sides[side]?.deduction || 0;
  const actual = {width:width-applied("left")-applied("right"),height:height-applied("top")-applied("bottom")};
  return actual.width>0 && actual.height>0 ? actual : null;
}

function estimatedArea({quantity,width_mm:width,height_mm:height}) {
  return [quantity,width,height].some((value)=>value==null || value==="") ? null : quantity*width*height/1e6;
}

function frameQuantity(category,system,technical,quantity) {
  if (!openings.has(category)) return 0;
  if (technical.frames_per_opening!=null) return number(technical.frames_per_opening,"frames per opening",{integer:true})*quantity;
  return /frameless|بدون إطار/i.test(system?.en||system?.ar||"")?0:quantity;
}

function screenQuantity(category,technical,quantity) {
  if (!openings.has(category)) return 0;
  if (technical.screen_leaves!=null) return number(technical.screen_leaves,"flyscreen leaves per opening",{integer:true})*quantity;
  return choices(technical.screen)?quantity:0;
}

function perimeterDescription(value,locale) {
  if (!Array.isArray(value)) return "";
  const chosen=directions.filter(side=>value.includes(side));
  const labels=locale==="ar"?{right:"يمين",left:"شمال",top:"علوي",bottom:"سفلي"}:{right:"Right",left:"Left",top:"top",bottom:"bottom"};
  const join=sides=>sides.map(side=>labels[side]).join(locale==="ar"?" و":" and ");
  if (chosen.length===4) return locale==="ar"?"ببار كامل":"With full perimeter trim";
  if (!chosen.length) return locale==="ar"?"بدون بار":"Without trim";
  if (chosen.length===1) return locale==="ar"?"ببار "+join(chosen)+" فقط":join(chosen)+" trim only";
  return locale==="ar"?"بدون بار "+join(directions.filter(side=>!chosen.includes(side))):"Without "+join(directions.filter(side=>!chosen.includes(side))).toLowerCase()+" trim";
}

function loadingQuantities(category, system, technical, quantity) {
  if(category==='maintenance'){
    if(technical.maintenance_mode!=='Factory')return {};
    const kind={'Flyscreen leaf':'screens','Operable leaf':'other',Frame:'frames','Glass panel':'fixed','Complete opening':'items','Other item':'items'}[technical.service_component];
    if(!kind)fail(400,'Choose the maintenance component that will return to the customer');
    return {[kind]:quantity};
  }
  const blades=counts=>({...counts,...(counts.sliding>0?{sliding_blades:counts.sliding}:{})});
  const perOpening = technical.panel_counts;
  const frames=frameQuantity(category,system,technical,quantity);
  const screens=Object.hasOwn(perOpening||{},"screens")?null:screenQuantity(category,technical,quantity);
  if (perOpening && Object.values(perOpening).some((value)=>value>0))
    return blades({...Object.fromEntries(Object.entries(perOpening).filter(([,value])=>value>0).map(([kind,value])=>[kind,value*quantity])),
      ...(frames?{frames}:{}),...(screens?{screens}:{})});
  if (!openings.has(category)) return {items:quantity};
  const tags = new Set(system?.tags || []);
  const moving = ["sliding","hinged","other_panels"].filter((tag)=>tags.has(tag));
  if (moving.length>1 || (!moving.length && !tags.has("fixed")))
    fail(400,"Enter panel counts per opening for this configuration");
  if (moving.length && !(technical.leaves>0)) fail(400,"Enter the moving leaf count per opening");
  if ((tags.has("fixed") || tags.has("fixed_panel")) && !(technical.fixed_panels>0))
    fail(400,"Enter the fixed panel count per opening");
  const counts = {};
  if (moving.length) counts[moving[0]==="other_panels"?"other":moving[0]]=technical.leaves*quantity;
  if (technical.fixed_panels>0) counts.fixed=technical.fixed_panels*quantity;
  return blades({...counts,...(frames?{frames}:{}),...(screens?{screens}:{})});
}

function extensionFields(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  return input.map((field)=>{
    const key = "extra_" + str(field.key,55).toLowerCase();
    if (!/^extra_[a-z][a-z0-9_]*$/.test(key) || seen.has(key)) fail(400,"Use distinct English keys for custom fields");
    seen.add(key);
    const en = str(field.en,100);
    const ar = str(field.ar,100) || en;
    if (!en) fail(400,"Enter a label for each custom field");
    return {key,en,ar,type:["text","number","date","boolean","sides"].includes(field.type)?field.type:"text",
      ...(Array.isArray(field.options)?{options:field.options.map((choice)=>str(choice,100)).filter(Boolean)}:{})};
  });
}

function initializeSystems(db) {
  for (const system of systemSeeds()) db.run("INSERT OR IGNORE INTO ops_systems(id,category,ar,en,tags) VALUES (?,?,?,?,?)",
    [system.id,system.category,system.ar,system.en,encode(system.tags)]);
}

module.exports = {categories, approvalParts, directions, panels, systemSeeds, configuration, catalogueForClient, fieldsFor,
  cleanTechnical,openingDefaults, dimensions, estimatedArea, loadingQuantities,frameQuantity,screenQuantity,perimeterDescription, extensionFields, initializeSystems, number};
