// Deterministic context selection for the agent. Picks the relevant schema
// family, matched query templates and domain-guide sections from the question,
// with strict context-size limits. The full registry is never injected. All
// state is derived from the current question and verified tool results of the
// current investigation; nothing is remembered between users or invented.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { detectIntent, extractParams, TEMPLATES } from './templates.mjs';

const GUIDE_PATH = fileURLToPath(new URL('./knowledge/domain-guide.md', import.meta.url));
let guideCache;
export async function loadDomainGuide() {
  if (!guideCache) {
    guideCache = await readFile(GUIDE_PATH, 'utf8').catch(() => '').then(text => {
      const sections = [];
      for (const chunk of text.split(/\n(?=## )/)) {
        const title = /^## (.+)/.exec(chunk)?.[1] || 'General';
        sections.push({ title: title.trim(), body: chunk.replace(/^## .+\n/, '').trim() });
      }
      return sections;
    });
  }
  return guideCache;
}

const tokensOf = text => new Set(String(text).toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 2));
const fit = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 20)}\n[context truncated]`);

const FAMILY_HINTS = { build: ['ibs', 'build', 'jenkins'], relval: ['relval', 'workflow'], unit: ['unit', 'utest', 'test'] };

export function selectFamilies({ question, intent, registry, limit = 2 }) {
  const families = (registry?.document?.families || []).filter(family => family.fields && Object.keys(family.fields).length);
  const tokens = tokensOf(question);
  const hints = FAMILY_HINTS[{ 'latest-ib': 'build', 'release-arch-match': 'build', 'failing-relvals': 'relval',
    'relval-failure-aggregation': 'relval', 'compare-flavours': 'build', 'compare-builds': 'build',
    'unit-test-failures': 'unit', 'build-status': 'build' }[intent]] || [];
  const scored = families.map(family => {
    const words = String(family.id).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    let score = 0;
    for (const token of tokens) if (words.includes(token)) score += 2;
    for (const hint of hints) if (words.includes(hint)) score += 3;
    if (family.lastValidatedAt) score += 1;
    return { family, score };
  }).sort((a, b) => b.score - a.score);
  return scored.filter(entry => entry.score > 0).slice(0, limit).map(entry => entry.family);
}

export function matchTemplates(intent) {
  return TEMPLATES.filter(template => template.id === intent).slice(0, 3);
}

// Compact structured investigation state, maintained only within one run and
// only from the user's question and verified tool results.
export function createInvestigationState(question) {
  const params = extractParams(question);
  const intent = detectIntent(question);
  const outstanding = [];
  if (!params.release && !params.series && ['latest-ib', 'failing-relvals', 'build-status', 'unit-test-failures'].includes(intent)) {
    outstanding.push('No release series or release name was specified in the question.');
  }
  return {
    question: String(question).slice(0, 300),
    intent,
    releaseSeries: params.series ? `CMSSW_${params.series}` : null,
    release: params.release || null,
    flavour: params.flavour || null,
    architecture: params.arch || null,
    workflow: params.workflow || null,
    verifiedIndexFamily: null,
    mappingFingerprint: null,
    queriesAttempted: [],
    successfulEvidence: [],
    outstanding,
  };
}

export function noteQuery(state, { tool, templateId, ok, summary }) {
  state.queriesAttempted.push({ tool: tool || templateId, ok: Boolean(ok) });
  if (ok && summary) state.successfulEvidence.push(summary.slice(0, 240));
  if (state.successfulEvidence.length > 6) state.successfulEvidence = state.successfulEvidence.slice(-6);
}

export function formatState(state) {
  const lines = [
    `Question: ${state.question}`,
    `Release series: ${state.releaseSeries || 'unresolved'} | Release: ${state.release || 'unresolved'} | Flavour: ${state.flavour || 'unspecified'} | Arch: ${state.architecture || 'unspecified'}`,
    `Verified index family: ${state.verifiedIndexFamily || 'unverified'} | Mapping fingerprint: ${state.mappingFingerprint || 'none'}`,
  ];
  if (state.queriesAttempted.length) lines.push(`Queries attempted (${state.queriesAttempted.length}): ${state.queriesAttempted.map(query => `${query.tool}:${query.ok ? 'ok' : 'failed'}`).join(', ')}`);
  if (state.successfulEvidence.length) lines.push(`Verified evidence so far: ${state.successfulEvidence.join(' | ')}`);
  if (state.outstanding.length) lines.push(`Outstanding: ${state.outstanding.join(' | ')}`);
  return lines.join('\n');
}

// Build the compact context block for the system prompt. Deterministic,
// budgeted, and clearly labelled as registry facts (dated) vs domain
// conventions (versioned guide) vs live evidence (this investigation).
export async function buildContext({ question, registry, state, planEvidence = [], maxChars = 3600 }) {
  const parts = [];
  const families = selectFamilies({ question, intent: state.intent, registry });
  if (families.length) {
    state.verifiedIndexFamily = families[0].id;
    state.mappingFingerprint = families[0].fingerprint || null;
    parts.push(['## Verified OpenSearch schema (registry; refresh only if stale or incomplete)',
      ...families.map(family => registry.familySummary(family.id, { maxChars: 900 }))].join('\n'));
  } else {
    parts.push('## Verified OpenSearch schema (registry)\nNo cached schema covers this question yet: discover indices and mappings once, then report them so they can be cached.');
  }
  const chosen = [...new Map([...TEMPLATES.filter(template => template.id === state.intent),
    ...TEMPLATES.filter(template => template.familyHint && families[0] && String(families[0].id).includes(template.familyHint === 'relval' ? 'relval' : template.familyHint === 'unit' ? 'unit' : 'ibs'))]
    .map(template => [template.id, template])).values()].slice(0, 3);
  if (chosen.length) {
    parts.push(['## Validated query templates (prefer these shapes; parameters extracted from the question)',
      `Extracted parameters: ${JSON.stringify({ release: state.release, series: state.releaseSeries, flavour: state.flavour, arch: state.architecture, workflow: state.workflow })}`,
      ...chosen.map(template => `- ${template.id}: ${template.title}. Needs fields: ${template.needs.join(', ')}. Status in registry: ${registry?.templateStatus?.(template.id, families[0]) || 'unvalidated'}.`)].join('\n'));
  }
  const guide = await loadDomainGuide();
  const tokens = tokensOf(question);
  const scored = guide.map(section => {
    const words = tokensOf(`${section.title} ${section.body}`);
    let score = 0;
    for (const token of tokens) if (words.has(token)) score += 1;
    if (/release naming/i.test(section.title) && (state.release || state.releaseSeries)) score += 3;
    if (/flavours/i.test(section.title) && state.flavour) score += 3;
    return { section, score };
  }).sort((a, b) => b.score - a.score);
  const domain = scored.filter(entry => entry.score > 0).slice(0, 2).map(entry => entry.section);
  if (domain.length) parts.push(['## Domain conventions (versioned guide; conventions, not live data)',
    ...domain.map(section => `${section.title}: ${section.body.slice(0, 500)}`)].join('\n'));
  if (planEvidence.length) {
    parts.push(['## Verified deterministic query results (real SearchIndexTool calls made for this question)',
      ...planEvidence.map(entry => `${entry.description}: ${entry.ok ? 'OK' : 'FAILED'}\n${entry.excerpt}`)].join('\n'));
  }
  parts.push(['## Investigation state (this conversation only; derived from verified results)',
    formatState(state)].join('\n'));
  // Budget: first sections win; the whole block stays under maxChars.
  const out = [];
  let budget = maxChars;
  for (const part of parts) {
    if (budget <= 150) break;
    const section = fit(part, Math.min(part.length, budget));
    out.push(section);
    budget -= section.length + 2;
  }
  return out.join('\n\n');
}
