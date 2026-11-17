# CMSSDT OpenSearch — verified domain & schema guide

Snapshot 2026-11-17, from a manual Dev Tools discovery (`opensearch-discovery/raw/context1..4.txt`, queries 01–15 and 21–22).
Everything below is verified from captured responses unless marked **UNVERIFIED**. Field types are observed `_source` types and verified query behaviour — the `_mapping` responses were never captured. Never invent fields not listed here; if a question needs an unknown field or family, run discovery (`IndexMappingTool`) first.

## Index families

Generation-suffixed indices (`<family>-<generation>`): generations **2964** (created 2026-10-18) and **2968** (created 2026-11-15) coexist; queries in this guide use `cmssdt-ib-matrix-*`, which spans both.

| Family | Verified docs | Grain |
|---|---|---|
| `cmssdt-ib-matrix-*` | yes | one RelVal **workflow step run** of one IB on one architecture |
| `cmssdt-ibs-*`, `cmssdt-ib-dataset-*`, `cmssdt-relvals_stats_summary-*` | no | **UNVERIFIED** — run IndexMappingTool before querying |
| `cmssdt-jenkins-jobs-*`, `cmssdt-jenkins-ibs-*`, `cmssdt-jenkins-queue-*`, `cmssdt-jenkins-offline-nodes` | no | **UNVERIFIED** |
| `cmssdt-externals_stats_summary-*`, `cmssdt-externals_stats_avgs`, `cmssdt-git-repository-size` | no | **UNVERIFIED** |
| `cmssdt-cmspkg-access-*`, `cmssdt-scram-access-*`, `cmssdt-apache-cmsrep-*`, `cmssdt-apache-cmssdt-*`, `cmssdt-cmssw-afs-eos-*`, `cmssdt-cmssw-pkginfo-*`, `cmssdt-github-api-*` | no | **UNVERIFIED** |

## Release names (IBs)

Grammar: `CMSSW_<major>_<minor>[_<FLAVOUR>]_X_<YYYY-MM-DD>-<HHMM>`.
Flavour tokens observed: none (default, e.g. `CMSSW_20_1_X_…`), `ROOT6`, `UBSAN`, `ASAN`, `DBG`, `HI` (legacy `CMSSW_5_3_HI_X_…`).
Cadence: `CMSSW_20_1_X` intraday (0000/1100/2300, occasionally 1400/1600); `ROOT6` daily 2300; `UBSAN` every other day 2300; legacy cycles weekly Sunday 0000.

**Latest-release trap (verified):** within one cycle the zero-padded date suffix sorts lexicographically = chronologically, so `terms` + `order: {_key: desc}` finds the latest of a cycle. Across cycles lexicographic order is NOT chronological (`CMSSW_9_4_X` ranks above `CMSSW_20_1_X`). Never sort `release` bare to mean "latest overall"; filter to one cycle first. The dashboard labels "DEFAULT" and "ROOT642" are UI names: DEFAULT ↔ `CMSSW_<M>_<m>_X_…`; the release string flavour for ROOT is `ROOT6` — `ROOT642` in release strings is **UNVERIFIED**.

## cmssdt-ib-matrix document (verified fields)

Identity: `release`, `architecture`, `workflow`, `step`.
Status: `exitcode` (integer, **0 = step succeeded**; non-zero codes **UNVERIFIED** — most are multiples of 256, `1` also occurs), `error_count` (integer, true total of %MSG-e messages), `errors[]` (**capped at 10 entries**; each `{error: raw %MSG-e text, kind: "Category:  Module:process@method"}`), `exception` (full CMSSW exception text; **absent on some failed steps**, present on some succeeded ones).
Context: `@timestamp` (epoch **milliseconds**), `hostname`, `url` (step log under `https://cmssdt.cern.ch/SDT/cgi-bin/buildlogs/<arch>/<release>/pyRelValMatrixLogs/run/<workflow>_<name>/`), `jobreport`, `command` (full cmsDriver line — noisy; exclude from `_source` when possible), `events_read`, `total_events` (numeric **strings**).
Variants: `test_type` absent = standard RelVal; `test_type: "gpu"` + `gpu: "<device>"` (e.g. `nvidia_t4`); `test_type: "other"` + `other: "<sub>"` (e.g. `rntuple`).
Metrics (strings mostly, sometimes numbers — mixed typing is verified): `AvgEventTime`, `EventThroughput`, `MinEventTime` (sentinel `1000000` as a **number** when no events), `MaxEventTime`, `TotalJobTime`, `TotalJobCPU`, `TotalInitTime` (huge negatives observed), `TotalLoopTime` (huge positives observed), `PeakValueRss/Vsize`, `HEAP_*`, and memory-probe groups `<Name>-{a-COUNT,b-RUN,c-EVENT,d-VSIZE,e-DELTV,f-RSS}` (LargestRssEvent, LargestVsizeEventT1…). Do not aggregate metrics without checking their types first.

Verified query behaviours: `term`/`terms` filters and `terms` aggregations on `release`, `architecture`, `workflow`; `terms` on `exitcode` (integer keys); `exists` on `exception` and `exitcode`. `hits.total` shows `10000/gte` on big aggregations — use aggregation buckets for counts. Counts drift while an IB is still running (same release: 8239 docs in one run, 8735 in a later one) — always report the timestamp of the count.

## Workflows and failures

Workflow ids are dotted-decimal strings (`136.755`, `38634.422`, `2023.0000001`); steps are `step1`–`step4`; the same workflow appears once per step per architecture per release. Failure questions should filter `exitcode` (`exists` + `must_not: 0`), aggregate by `architecture`/`workflow`/`step`, and treat `errors`/`error_count` as log noise unless the step failed. "Which architectures have failures" = terms agg on `architecture` over failed steps of one release (verified shape: 15 failed steps for CMSSW_20_1_X_2026-11-16-2300 across el9_amd64_gcc14 / el9_aarch64_gcc14 / el8_amd64_gcc14 — a snapshot, not a final count).

## Provenance

Facts → source: index list & generations `context1.txt` q06; sample docs `context2.txt` q07–09 (one response block); releases/archs/workflows/exit codes `context3.txt` q10–13; exceptions & failed steps `context3.txt` q14–15; per-IB docs & failure distribution `context4.txt` q21–22. Queries 01–05 and 07–08 have no captured responses and queries 16–20 are missing entirely (see `discovery-gaps.md`). Raw files stay in `opensearch-discovery/raw/` and are never sent to end users.
