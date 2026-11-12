# Dashboard performance work

The implementation preserves result semantics, latest/baseline matching, density settings, touch interactions and build history.

## Changes

- Scroll geometry is cached, native scroll events share one animation frame, snapping does not duplicate its paint work in the scroll handler, and unchanged rail styles are not rewritten.
- Comparison indexes, filtered build arrays and collapse handlers retain their identity. Cards and status labels can skip unrelated updates. Matrices and result summaries are memoized independently of history dialog and selected phone-column state.
- Dropdown baselines are indexed once per dataset. Searches filter pre-normalized records; closed menus do not construct result rows.
- Matrices mount near the viewport and remain mounted afterward. Release navigation explicitly reveals its destination. Measurement clones are avoided offscreen and a bounded per-matrix cache reuses measurements when switching density back.
- Fetch batches start without the artificial 100 ms delay, have configurable bounded concurrency (default 4), preserve ordering, expose progressive snapshots, share in-flight requests, and suppress stale/aborted batch callbacks. Partial build data remains visible while other flavour files load.
- IB and RelVal routes load separate chunks. The duplicate root provider tree is removed. RelVal-only providers/data initialize on that route, and architecture initialization reuses the structure already loaded by App.

## Verification

`node --test tests/*.test.mjs` covers ordered partial loading, concurrency, failure and cancellation behaviour, stable memoization and exact device baseline matching, in addition to the existing result/fit/history tests.

`tests/browser/layout.mjs` checks Chromium and Firefox geometry, density restoration, dropdowns, history, scrolling and touchscreen gestures. Full-card geometry tests explicitly reveal deferred matrices first.

`tests/browser/app-smoke.mjs` runs against the production build with delayed deterministic responses. It verifies that the first flavour displays while another is pending, structure is fetched once, RelVal data is not fetched on the IB route, and the lazy RelVal route initializes its providers correctly.

`tests/browser/performance.mjs` compares baseline and candidate using the same 20-card/80-GPU fixture, one CI runner and Chromium with 4x CPU slowdown. It reports main-thread script/layout/style time, React render time, DOM nodes, mounted matrices and steady-rail style mutations. These are synthetic Vite-development measurements, not field Core Web Vitals or a guarantee of device FPS. JSON reports are retained in the `performance-results` Actions artifact.

## Production bundle baseline

Built with the lockfile's Vite 8.0.16:

- Baseline: one JavaScript bundle, 912.96 kB minified / 281.87 kB gzip.
- Candidate: shell 439.15 kB / 142.23 kB gzip; shared chunk 110.22 kB / 37.24 kB gzip; IB route 267.57 kB / 78.65 kB gzip; RelVal route 105.07 kB / 29.94 kB gzip.

The shell's reduction is not the full IB-page reduction: its shared and route chunks must also load to display that page. No authenticated CERN response-time claim is made from fixture measurements.
