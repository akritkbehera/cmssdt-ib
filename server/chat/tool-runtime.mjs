import Ajv from 'ajv';
const ajv = new Ajv({ strict: false, allErrors: true });

export function validateToolArguments(schema, args) {
  let validate;
  try { validate = ajv.compile(schema || { type: 'object' }); }
  catch { return { ok: false, errors: ['tool schema cannot be compiled'] }; }
  const ok = validate(args);
  return { ok, errors: ok ? [] : (validate.errors || []).map(error => `${error.instancePath || '(root)'} ${error.message}`) };
}

export function makeDedupe() {
  const seen = new Map();
  const canonical = value => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  return { key: (name, args) => `${name}:${JSON.stringify(canonical(args))}`, get: key => seen.get(key),
    set(key, value) { if (seen.size >= 24) seen.delete(seen.keys().next().value); seen.set(key, value); } };
}

// Retain actual conversation and tool output only, without generated summaries
// or hidden schema context. Evict complete old tool turns, never orphan a
// tool response from its assistant call. Latest question always remains.
export function trimToolHistory(context, maxChars = 64000) {
  while (JSON.stringify(context).length > maxChars && context.length > 2) {
    const firstCall = context.findIndex(message => message.tool_calls);
    if (firstCall > 0) {
      let end = firstCall + 1;
      while (context[end]?.role === 'tool') end++;
      if (end < context.length) { context.splice(firstCall, end - firstCall); continue; }
    }
    const lastUser = context.findLastIndex(message => message.role === 'user');
    if (lastUser > 1) { context.splice(1, lastUser - 1); continue; }
    break;
  }
}
