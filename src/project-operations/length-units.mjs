const factors={mm:1,cm:10,m:1000};
export function storageLengthUnit(key,field={}){
 if(/_mm$/.test(key))return 'mm';if(/_cm$/.test(key))return 'cm';
 const label=field.en||'';
 if(/\(mm\)|\bmm\s*$/i.test(label))return 'mm';
 if(/\(cm\)|\bcm\s*$/i.test(label))return 'cm';
 if(/\(m\)|\bm\s*$/i.test(label))return 'm';
 return null;
}
export function convertLength(value,from,to){
 if(value==null||value==='')return value;
 if(!factors[from]||!factors[to]||from===to)return value;
 const part=input=>{const n=Number(String(input).trim());return Number.isFinite(n)?String(Number((n*factors[from]/factors[to]).toPrecision(12))):input;};
 if(typeof value==='number')return Number(part(value));
 const text=String(value);if(text.trim()&&Number.isFinite(Number(text)))return part(text);if(/^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:\s*[x×]\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+))*\s*$/.test(text))return text.split(/([x×])/).map(p=>/[x×]/.test(p)?' × ':part(p)).join('');
 return value;
}
export function lengthLabel(text,unit,locale){
 const base=String(text).replace(/\s*\((?:mm|cm|m|مم|سم|م)\)\s*/gi,' ').replace(/\s+(?:mm|cm|مم|سم|متر)\s*$/i,'').trim();
 return `${base} (${locale==='ar'?{mm:'مم',cm:'سم',m:'م'}[unit]:unit})`;
}
