import {findSmartTableMatches,normalizeSmartNumericClipboardValue,replaceSmartSearchMatches} from './smart-table-clipboard.mjs';

export function tableReplacementCandidates({rows,columns,query,replacement,current=null,valueFor=(row,key)=>row[key],idFor=row=>row._gridId}){
  const indexed=rows.map((row,index)=>({...Object.fromEntries(columns.map(key=>[key,valueFor(row,key)])),_gridId:String(idFor(row)),index}));
  const matches=findSmartTableMatches({rows:indexed,columnOrder:columns,searchText:query});
  return matches.filter(match=>!current||String(match.rowId)===String(current.rowId)&&match.columnKey===current.columnKey).map(match=>{
    const row=rows[match.rowIndex],result=replaceSmartSearchMatches(valueFor(row,match.columnKey),query,replacement,{firstOnly:Boolean(current)});
    return {row,rowIndex:match.rowIndex,key:match.columnKey,value:result.value,replacements:result.replacements};
  });
}

export function selectionStatistics(values=[]){
  let sum=0,compensation=0,numericCount=0;
  for(const raw of values){
    if(raw==null||String(raw).trim()===''||typeof raw==='boolean')continue;
    const text=normalizeSmartNumericClipboardValue(raw);
    if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text))continue;
    const number=Number(text);if(!Number.isFinite(number))continue;
    const adjusted=number-compensation,next=sum+adjusted;compensation=(next-sum)-adjusted;sum=next;numericCount++;
  }
  return {count:values.length,numericCount,sum,average:numericCount?sum/numericCount:0};
}

// Apply a visible view by identity. Rows excluded by a filter retain their values and order.
export function mergeVisibleRows(rows,visible,id='_gridId'){
  const updates=new Map(visible.map(row=>[row[id],row])),existing=new Set(rows.map(row=>row[id]));
  return [...rows.map(row=>updates.get(row[id])||row),...visible.filter(row=>!existing.has(row[id]))];
}

export function reorderVisibleRows(rows,visible,id='_gridId'){
  const included=new Set(visible.map(row=>row[id]));let index=0;
  return rows.map(row=>included.has(row[id])?visible[index++]:row);
}

export function offsetIndex(offsets,value){
  let low=0,high=Math.max(0,offsets.length-2);
  while(low<high){const middle=Math.ceil((low+high)/2);if(offsets[middle]<=value)low=middle;else high=middle-1;}
  return low;
}
