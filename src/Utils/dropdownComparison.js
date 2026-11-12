import {cellKey} from './ibComparison.js';
import {resultDelta} from './resultDelta.js';

const identity = (ib, item, stage) => {
  const {release_name, ...result} = item;
  return cellKey(ib, result, stage);
};

/** Index once per dataset, not once per result or search keystroke. */
export function buildDropdownComparisons(ib, context, section, stage, currentItems) {
  const comparisons = new Map();
  if (!context?.latest || !context.previous) return comparisons;
  const signatureCounts = new Map(), current = new Map(), previous = new Map();
  for (const [key,item] of Object.entries(currentItems)) {
    const signature=identity(ib,item,section+'/'+stage);
    signatureCounts.set(signature,(signatureCounts.get(signature)||0)+1);
    current.set(key,{item,signature});
  }
  for (const [key,item] of Object.entries(context.previous[section]?.[stage] || {})) {
    for (const alias of new Set([key, ...(section==='other_data' && key.startsWith('rntuple/') ? [key.slice(8)] : [])])) {
      if(!previous.has(alias)) previous.set(alias,[]);
      previous.get(alias).push({item,signature:identity(context.previous,item,section+'/'+stage)});
    }
  }
  const failureKey=stage==='qa'?'num_fails':'num_failed';
  const normalize=item=>({...item,passed:item.passed ?? (Number(item.details?.[failureKey])>0 ? false : Number(item.details?.known_failed)>0 ? 'warning' : true)});
  for (const [key,{item,signature}] of current) {
    if(item.done!==true || signatureCounts.get(signature)!==1) continue;
    const matches=(previous.get(key)||[]).filter(entry=>entry.signature===signature);
    if(matches.length!==1 || matches[0].item.done!==true) continue;
    const delta=resultDelta(normalize(item),normalize(matches[0].item),stage);
    if(delta) comparisons.set(key,{...delta,metrics:delta.metrics.filter(metric=>metric.key===failureKey),baseline:context.previous.release_name});
  }
  return comparisons;
}

export function dropdownComparison(ib, context, section, stage, key, currentItems) {
  return buildDropdownComparisons(ib, context, section, stage, currentItems).get(key) || null;
}
