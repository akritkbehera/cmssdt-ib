# IB comparison contract and review

## Observed application schema

`IBLayout.state.dataList` contains fetched release entries with `comparisons`
arrays. The display groups these by `ib_date`. Each comparison uses
`isIB`, `next_ib`, `release_queue`, `release_name`, `tests_archs`, `cmsdistTags`,
`compared_tags`, and per-stage arrays (`builds`, `utests`, `relvals`, `addons`,
`dupDict`). Stage records use `arch`, `passed`, `done`, `details`, and `file`.
This is derived from the existing application's consumers; no live backend
sample was available in this sandbox.

## Identity and ordering

The complete fetched `dataList` now reaches IBGroups independently of the
visible flavor/architecture filters. All returned comparison records feed a
pure index. Only `isIB === true`, non-next-IB records with a valid identity and
sortable timestamp qualify. `release_queue` is authoritative and kept whole:
we do not merge CLANG, ASAN, UBSAN or any other queues by display name.
Explicit `variant`/`build_variant`, if present, also partitions the sequence.

`ib_date` supplies the ordering when present. The validated, anchored build-tag
timestamp is used only when it is absent. The build-name prefix must agree
exactly with the backend queue; otherwise comparisons are suppressed. The
accepted timestamp formats are YYYY-MM-DD-HHmm and YYYY-MM-DDTHH:mm[:00][Z].
Timestamp fields outside this documented contract suppress comparison rather
than guess. Dates without a zone establish ordering only, not a displayed UTC
claim. Equal timestamps are ambiguous and produce no deltas.

The latest record selects the immediately preceding eligible timestamp in the
same exact sequence, even when that record has no results. Older records never
receive comparison annotations. The UI exposes the complete baseline ID near
the latest card header. Latest is relative to the full response returned to this
page, not globally beyond the API's history window. If the response is truncated
or omits IBs, the backend must supply authoritative ordering/completeness metadata
to guarantee a globally immediate predecessor.

## Cell identity and values

Keys retain the full queue, explicit variant, stage, parent configuration/flavor/
patch/toolchain metadata when supplied, and every result field other than the
known mutable outcome fields (`passed`, `done`, `details`) and log URL (`file`).
Thus full architecture/compiler strings and additional result configuration
fields must match exactly. Multiple records for a current architecture, or
multiple baseline matches, suppress comparison. The existing matrix order and
backend result selection are not regrouped or rewritten.

Each recognized metric is compared independently with the same named metric;
metrics are never summed. Differing metric sets, nonnumeric/null/negative counts,
missing cells, unknown states and `done === false` suppress comparisons. A final
`passed` enum/boolean without `done:false` follows the existing application's
reported status contract. Counts with unknown units require a backend metric ID
before comparison can be enabled.

Pass→fail is “Newly failing”; fail→pass is “Fixed.” Nonzero metric deltas show
signed counts, with pass increases favorable and error increases adverse.
Warning metrics retain warning styling. Unchanged results show no zero annotation.
The tooltip supplies metric, current/previous values, interpretation and baseline.

No stable failure-signature field is established by the current schema. The UI
never says UNIQUE. That feature needs stable per-cell failure IDs from the backend.

## UI and skill review

- Architecture/flavor header groups remain the original backend groups. Their
  start columns carry identical neutral borders through both headers and body.
- Empty filtered header groups are skipped without renumbering data positions.
- Long semantics live in native accessible details; baseline IDs remain visible.
- Novelty has a text/border violet marker separate from red failure meaning.
- Counts and links remain visible. Partial success/failure marks keep their
  static circle and glyph; only the clipped inner fill pulses for 1.8 seconds.
- Reduced-motion uses a static inner tint. Pending data cannot create final deltas.
- frontend-ui-standards review: shared tokens and existing Bootstrap components;
  no additional framework, no architecture tabs, no new aggregate count type.
- interface-design review: matrix remains focal, explanations collapse, deltas
  are subordinate and comparison identity is not inferred from appearance.

Unit tests cover canonical queue isolation, exact configurations, duplicates,
equal timestamps, absent baseline data, older cards, metric directions, unchanged
counts and running suppression. Production build and whitespace checks run locally.
No lint/typecheck scripts exist in package.json. Playwright browser checks used
the live local preview on desktop and mobile without js_repl; matrix alignment,
sticky scrolling, card collapse, density, filters, PR controls and navigation
were exercised. Running-animation and screen-reader behavior remain unverified
in a browser.

## Status/comparison cleanup (instruction-status-comparison.md)

Missing, incompatible, unfinished and unchanged comparisons now return null;
they produce no annotation DOM, tooltip or reserved annotation line. Valid
latest-only signed metric changes and status transitions remain visible.

Running markers use structured done:false. The fixed circular glyph is above
three clipped internal layers: a rim arc and radar sweep share a 2s revolution;
the internal fill pulses over 1.8s. Finished icons have no active animation;
reduced motion stops arc/sweep/fill and retains a static subtle highlight.
Playwright verified actual rendered pass/fail circles, stable 20x20 geometry,
no final delta during running, static completed states, reduced motion, and
matrix alignment/interactions at 1440px and 390px widths. Browser test data for
running states was overridden only within the test browser, never on the backend.
Build Status Badge.html became available and was inspected directly. The matrix
now adapts its semantic colors, SVG mark paths, 2px outlines, pale fills and
half-circle conic tails. Comfortable circles are 24px (compact 20px); animation
geometry stays static. The demo-card layout and outer glow are omitted.
