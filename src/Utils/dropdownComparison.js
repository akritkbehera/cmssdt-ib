import {cellKey} from './ibComparison.js';
import {resultDelta} from './resultDelta.js';

const identity = (ib, item, stage) => {
  const {release_name, ...result} = item;
  return cellKey(ib, result, stage);
};
export function dropdownComparison(ib, context, section, stage, key, currentItems) {
  if (!context?.latest || !context.previous) return null;
  const current = currentItems[key];
  const previousItems = context.previous[section]?.[stage] || {};
  if (!current || current.done !== true) return null;
  const signature = identity(ib,current,section+'/'+stage);
  if (Object.values(currentItems).filter(item=>identity(ib,item,section+'/'+stage)===signature).length!==1) return null;
  const matches = Object.entries(previousItems).filter(([oldKey,item]) =>
    (oldKey===key || section==='other_data' && oldKey==='rntuple/'+key) && identity(context.previous,item,section+'/'+stage)===signature);
  if(matches.length!==1 || matches[0][1].done!==true) return null;
  const failureKey=stage==='qa'?'num_fails':'num_failed';
  const normalize=item=>({...item,passed:item.passed ?? (Number(item.details?.[failureKey])>0 ? false : Number(item.details?.known_failed)>0 ? 'warning' : true)});
  const delta=resultDelta(normalize(current),normalize(matches[0][1]),stage);
  if(!delta)return null;
  return {...delta, metrics:delta.metrics.filter(metric=>metric.key===failureKey),
    baseline:context.previous.release_name};
}
