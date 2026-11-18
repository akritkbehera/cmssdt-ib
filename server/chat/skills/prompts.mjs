// Versioned prompt modules for the graph-guided skills.
//
// Planning and answer prompts are versioned so they can be iterated without
// touching the transport or model adapter. Prompts live in this runtime
// directory and are loaded independently of any developer tooling: the
// deployed chatbot never depends on editor/agent skill folders. Pick a version
// with CHAT_PROMPT_VERSION (e.g. `v2` loads prompts/route.v2.mjs).
const VERSIONS = { v1: () => import('./prompts/index.v1.mjs') };

export function resolvePromptVersion(env = process.env) {
  const version = String(env.CHAT_PROMPT_VERSION || 'v1').trim();
  return /^v[0-9]+$/.test(version) ? version : 'v1';
}

const bundles = new Map();

export async function loadPromptBundle(version = resolvePromptVersion()) {
  if (!bundles.has(version)) {
    const factory = VERSIONS[version] || VERSIONS.v1;
    bundles.set(version, factory().then(mod => mod.bundle).catch(() => null));
  }
  const bundle = await bundles.get(version);
  return bundle || (await VERSIONS.v1()).bundle;
}
