# Discovery gaps — unresolved questions and read-only follow-up queries

Snapshot 2026-11-17. All queries below are read-only (`GET`/search/aggregations only). They are meant to be run in OpenSearch Dev Tools (or through `SearchIndexTool`) to upgrade entries in `schema-registry.json` from *observed* to *verified*. Nothing here was answered by the four discovery files.

## G0 — Captured responses are missing for part of the original session

`context1.txt` lists queries 01–06 but only the response of 06 (settings) is in the file; `context2.txt` lists 07–09 with one unlabeled response block (content matches 09); queries **16–20 do not exist in any file**. Consequence: `_cat/indices` counts, aliases, and the `cmssdt-*/_mapping` / `_field_caps` outputs were never captured. If the original responses exist elsewhere, add them to `opensearch-discovery/raw/` before regenerating the registry. Until then, re-run:

```
GET _cat/indices?v&h=index,status,docs.count,store.size&s=index
GET _cat/aliases?v
GET cmssdt-ib-matrix-*/_field_caps?fields=*
```

## G1 — Actual field mappings for `cmssdt-ib-matrix-*` (highest priority)

Everything in the registry is an observed `_source` type. Confirm real types (esp. `release`, `workflow`, `@timestamp`, `errors`, metric fields):

```
GET cmssdt-ib-matrix-2968/_mapping
```

Questions this answers: is `release` keyword or text+keyword (does `sort` work)? Is `@timestamp` a `date` (epoch_millis)? Are metric fields `keyword` (numeric strings) or `float`/`long` (mixed typing may have caused mapping conflicts)?

## G2 — Schemas of the unexplored families

No documents were ever sampled outside `cmssdt-ib-matrix`. For each family F in {cmssdt-ibs, cmssdt-ib-dataset, cmssdt-relvals_stats_summary, cmssdt-jenkins-ibs, cmssdt-jenkins-jobs}:

```
GET cmssdt-ibs-2968/_mapping
GET cmssdt-ibs-2968/_search
{
  "size": 2,
  "query": { "match_all": {} }
}
```

Open questions: how does `cmssdt-ibs` relate to `cmssdt-ib-matrix` (release key? build status? unit tests?) — the discovery gives **no** evidence about where unit-test results live; the perf question "show unit-test failures for a selected IB" cannot be answered from verified knowledge today. Same for `cmssdt-relvals_stats_summary` (rollup of matrix docs?) and `cmssdt-jenkins-ibs` (job ↔ IB relation?).

## G3 — Exit-code semantics

Only `0 = success` is verified. Non-zero values (256, 16640, 23552, 13568, …) are mostly multiples of 256, but `1` also occurs. Check a failing doc's log via its `url`, and the cms-bot source (`cms-bot` repo, relval monitor) for the exit-code table. Candidate probe (read-only) to see the spread per workflow step:

```
GET cmssdt-ib-matrix-*/_search
{
  "size": 3,
  "_source": ["release", "architecture", "workflow", "step", "exitcode", "url"],
  "query": { "bool": { "filter": [ { "term": { "exitcode": 1 } } ] } }
}
```

## G4 — `@timestamp` range queries and time semantics

No range query was executed. Verify that range filtering works and confirm units (values look like epoch milliseconds):

```
GET cmssdt-ib-matrix-*/_search
{
  "size": 2,
  "_source": ["release", "@timestamp"],
  "query": { "range": { "@timestamp": { "gte": "now-2d", "lte": "now" } } },
  "sort": [ { "@timestamp": { "order": "desc", "unmapped_type": "long" } } ]
}
```

Also unresolved: is `@timestamp` the run time or the ingestion time?

## G5 — The `errors[]` cap

Verified: 2 entries with `error_count: 2`, but `error_count: 26` with 10 entries and `error_count: 136` with 10 entries. Is 10 a hard cap? Is there a fuller error list elsewhere (per-doc? in the log URL only)?

```
GET cmssdt-ib-matrix-*/_search
{
  "size": 0,
  "aggs": {
    "error_count_vs_len": {
      "stats": { "field": "error_count" }
    }
  }
}
```

(plus manual inspection of one doc with `error_count > 10` and `errors` length)

## G6 — Flavour naming: dashboard labels vs release strings

The dashboard UI uses labels like `DEFAULT`, `ROOT6_X`, `ROOT612_X`, `CLANG_X` (see `src/__test__/App.test.js`), while release strings contain `ROOT6`, `UBSAN`, `ASAN`, `DBG`, `HI`. "ROOT642" (ROOT 6.42) does **not** appear in any captured release string. Resolve the mapping before answering "compare DEFAULT and ROOT642":

```
GET cmssdt-ib-matrix-*/_search
{
  "size": 0,
  "aggs": {
    "releases": {
      "terms": {
        "field": "release",
        "size": 300,
        "order": { "_key": "desc" },
        "include": "CMSSW_20_1_.*"
      }
    }
  }
}
```

If no `ROOT642`-style token shows up, the question must be answered using `CMSSW_20_1_ROOT6_X_*` (or the cycle the dashboard maps to ROOT642) and the substitution must be stated explicitly.

## G7 — Duplicate documents across generations

`cmssdt-ib-matrix-*` spans 2964 and 2968, and sampled documents for the same release appear under both. Are the two generations disjoint in time (rollover) or overlapping (duplicates)? Counts could double-count if both contain the same step runs:

```
GET cmssdt-ib-matrix-*/_search
{
  "size": 0,
  "query": { "term": { "release": "CMSSW_20_1_X_2026-11-16-2300" } },
  "aggs": {
    "per_index": { "terms": { "field": "_index", "size": 10 } }
  }
}
```

## G8 — Sentinel and corrupt metric values

`MinEventTime: 1000000` (as a JSON number) when zero events were read; `TotalInitTime: -3786700` and `TotalLoopTime: 3786880` in Triton-failure docs. Confirm these are known sentinels/overflow artifacts before any numeric analysis, and confirm whether these fields are aggregatable at all given mixed typing.

## G9 — `test_type` completeness

Only `gpu` and `other` were seen, with companion fields `gpu`/`other`. Are there more discriminators (e.g. machine-precision, high-stat)? And is `test_type` absent on standard runs, or is there a `"standard"` value never sampled?

```
GET cmssdt-ib-matrix-*/_search
{
  "size": 0,
  "aggs": {
    "test_types": { "terms": { "field": "test_type", "size": 20 } },
    "gpu_labels": { "terms": { "field": "gpu", "size": 20 } },
    "other_labels": { "terms": { "field": "other", "size": 20 } }
  }
}
```

## G10 — Unit-test and build results location

The IB Insights domain includes unit tests and builds, but no captured query touches unit-test or build-result data. Before answering unit-test questions, discover which family holds them (candidates: `cmssdt-ibs`, `cmssdt-jenkins-ibs`, `cmssdt-ib-dataset`) via G2 and only then build templates. Do not guess field names such as `unit_test`, `unittest`, `failed_tests` — none are verified.
