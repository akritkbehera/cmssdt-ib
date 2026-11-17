# CMSSW Integration Build domain guide (version 1)

This guide records **domain conventions** for CMSSW Integration Builds (IBs),
RelVals, unit tests and Jenkins/CI results. It is version-controlled and
edited by humans. It is *not* observed data: field names, index families and
values must still be verified against live OpenSearch mappings via the schema
registry before they are used in queries. Nothing here authorizes access or
overrides per-user OpenSearch permissions.

Status markers: `[verified]` = confirmed against this repository's own
consumers or CMS public conventions; `[convention]` = widely used naming that
must still be matched against live mappings.

## Release naming `[verified in this repo]`

- IB release names follow `CMSSW_<major>_<minor>_<FLAVOUR>_<YYYY-MM-DD-HHMM>`,
  e.g. `CMSSW_20_1_X_2026-11-16-2300`. The frontend parses them with
  `^([a-zA-Z]+_\d+_\d+)_(.+)_(\d{4}-\d{2}-\d{2}-\d{4})` (`src/Utils/processing.js`).
- The release *series* (queue) is `CMSSW_<major>_<minor>_<FLAVOUR>`, e.g.
  `CMSSW_20_1_X`. `release_queue` is authoritative and queues are never merged
  by display name (`COMPARISON-CONTRACT.md`).
- Timestamps are `YYYY-MM-DD-HHMM` (UTC wall clock of the build label). The
  accepted sortable forms are `YYYY-MM-DD-HHmm` and `YYYY-MM-DDTHH:mm[:00][Z]`.

## Flavours `[verified in this repo]`

- The default flavour is encoded as `X` (display name `DEFAULT`); other
  flavours replace/extend that suffix: `CLANG_X`, `ASAN_X`, `UBSAN_X`,
  `ROOT642_X` and further flavours appear as separate queues.
- **Do not assume flavours share mappings or semantics.** Comparison across
  flavours must state that builds are only comparable when architecture,
  toolchain and build type match.
- `isIB` marks integration builds; `next_ib` marks pre-staged next IBs.

## Architectures and toolchains `[convention]`

- Architecture strings follow `<os>_<arch>_<compiler>`, e.g.
  `el9_amd64_gcc14`, `el8_amd64_gcc12`, `slc7_aarch64_gcc700`. They are exact
  identifiers: compare them exactly, never prefix-match.
- Full architecture/compiler strings and build configuration fields must match
  exactly before two results are considered comparable.

## Build stages `[verified in this repo]`

These are the frontend JSON contract, **not verified OpenSearch mappings**.
Do not assume the stage fields below exist in any OpenSearch index or use
them to identify build-statistics documents. Verify the actual document
grain and completion/build-type semantics in the relevant Jenkins or
build-statistics index before comparing full-build durations.

- Results are grouped per stage: `builds`, `utests` (unit tests), `relvals`,
  `addons`, `dupDict` (duplicate dictionaries). Stage records carry `arch`,
  `passed`, `done`, `details`, `file`.
- `done === false` means the stage did not complete; never report such a build
  as "latest completed" without checking `done`.
- A build's completion and freshness must be checked with a live query at
  answer time; cached registry data is structural only and never proves that a
  build is the latest one.

## RelVals (release validation) `[verified in this repo]`

- RelVal results are per workflow with `workflowID`, `workflowName`,
  `workflowHash`, `steps` and `exitcode`. Steps are numbered and logged as
  `step<N>_<workflowName>.log`; `step1_dasquery.log` marks DAS query errors.
- Step/result statuses used by the dashboard: `PASSED`, `FAILED`, `DAS_ERROR`,
  `TIMEOUT`, `NOTRUN`.
- `exitcode === 0` means passed; a nonzero `exitcode` is a failure with an
  exit-code name taken from the community-maintained
  `https://cms-sw.github.io/exitcodes.json` (`src/relValConfig.js`). Do not
  invent exit-code meanings beyond `0 = passed`; quote the published name when
  available and mark it as externally sourced.
- "Known failed" RelVals are tracked separately from newly failing ones
  (`known_failed` vs `failed`).

## Unit tests and Jenkins `[convention]`

- Unit-test results (`utests`) follow the same stage-record contract.
- Jenkins/CI job status and build numbers may appear in dedicated fields or
  indices; verify names against live mappings before querying. Log URLs
  (`file`) point at the SDT log server.

## Query safety conventions `[verified in this repo]`

- Bound every search (`size <= 100`, short time ranges); prefer aggregations
  over large document dumps.
- Keyword fields support exact matching/filtering; text fields are analyzed
  and must not be used for exact-match filters (this distinction is only known
  from live mappings — check the registry's field summary).
- Distinguish observations (tool results) from hypotheses in every answer.

## Maintenance

When an investigation reveals a *verified* naming or structural fact, update
this file via code review (shared, versioned) and/or the runtime schema
registry (shared, observed from live mappings). Never record user-specific
data, credentials or result payloads here.
