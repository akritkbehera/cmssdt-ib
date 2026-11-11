# CMSSDT IB Dashboard — QA Bug Report

**Date:** 2026-11-11 · **Phase:** exploratory QA, report-only (no source changes made)
**App under test:** `http://localhost:5174/#/ib/CMSSW_20_1_X` (live GitHub pages-mode data; Vite root `~/Desktop/opencode/cmssdt-ib`)
**Browser:** real Chrome via browse MCP (fine pointer, desktop scrollbars; `innerWidth` 375 → content width 360). Touch emulation not active; phone touch-target rules apply via width media queries.
**Viewports tested:** 320 (overflow stress), 375×812, 768×1024, 1024×900, 1440×900.
**Evidence:** `evidence-2026-11-11/*.png` (10 files, viewport-sized captures) + labeled screenshots shown inline during the sweep ('QA 375 …', 'QA 768 …', etc.).
**Note:** the dataset is live and changes between runs (panel counts and dropdown item counts varied during the session — this is what exposed BUG-1). Measurements below record the state at the time of capture.

---

## Summary

| # | Bug | Severity | Viewports |
|---|-----|----------|-----------|
| 1 | RelVals / Unit-tests dropdown menus overflow narrow viewports (340px min-width, no max-width) | **Medium-High** | ≤375 (deterministic ≤320) |
| 2 | Navigator overlay targets far below touch minimum (Close 24×14px) | **Medium** | all (worst ≤767) |
| 3 | Escape does not close navigator overlay or mobile nav menu (inconsistent with dropdowns/modals) | **Medium** | all |
| 4 | History dialog controls undersized and inconsistent with card filters (30–32px vs 48px) | **Low-Medium** | 375, 768 |
| 5 | "See Branch" dropdown items 32px at phone width (app standard is 44px) | **Low-Medium** | ≤767 |
| 6 | Pluralization: "1 more variants" | **Low** | all (data-dependent) |
| 7 | Disclosure summary is an 18px-tall target (below WCAG 2.5.8 24px) on fine-pointer narrow viewports | **Low** | ≤1024 fine-pointer |
| 8 | ARIA nested-interactive: `role="button"` card headers contain 2–4 focusable controls each | **Low** | all |
| 9 | Fixed bottom rail overlays live controls mid-scroll on phones | **Low** | ≤767 |
| 10 | Compact density nearly inert at phone width (8px effect) and weak at 768/1024 (14px) | **Low** | ≤1024 |

**Console errors / page errors: none observed in any batch** across all viewports and interactions.
Contrast (spot checks) and focus visibility (full tab sweep) pass; details in "Verified working".

---

## Confirmed bugs

### BUG-1 — RelVals / Unit-tests dropdown menus overflow narrow viewports
**Severity:** Medium-High · **Viewports:** ≤375 (deterministic at 320; data-dependent at 375)

**Root cause (read-only source observation):** `Dropdown.Menu` inline style `minWidth: "340px"` / `minWidth: '340px'` with no `max-width`, and item labels `whiteSpace: "nowrap"` — `src/Components/IBPageComponents/RelvalsLabel.js:236` and `src/Components/IBPageComponents/UnitTestsLabel.js:227`. Menu width is content-driven above 340px, so long GPU/flavor labels push it past the viewport.

**Expected:** dropdown menus fit inside the viewport at every width; items fully reachable.
**Actual:** menu overflows and is clipped on the right; item right edges are unreachable.

**Measured:**
| State | Menu width | Viewport | Clipped |
|---|---|---|---|
| 320px, Unit Tests (10 items) | 362px | 320 | **42px** |
| 320px, RelVals (3 items) | 340px | 320 | **20px** |
| 375px, RelVals 5-item GPU state (earlier in session) | 384px at x=0 | 375 | **~24px** (`inViewport: false`) |
| 375px, current 1–3 item state | 340–362px | 360 content | 0–2px under scrollbar |

**Repro:**
1. Open `http://localhost:5174/#/ib/CMSSW_20_1_X`, set viewport to 320 (or 375 with a multi-item GPU flavor state).
2. In the 2nd release card, tap the **RelVals** or **Test** section pill (GPU flavor variant).
3. Observe the open menu's right edge extending past the viewport; item text/affordances at the right are cut off.

**Evidence:** `evidence-2026-11-11/e1-dropdown-overflow-320.png` (menu right edge 362 in 320px viewport).

---

### BUG-2 — Navigator overlay ("Show releases") targets far below touch minimum
**Severity:** Medium · **Viewports:** all (overlay is fixed 280px wide; worst at phone widths)

**Location (read-only):** inline-styled overlay in `src/Components/IBPageComponents/IBGroups.js` (~458–530, styles ~651–740).

**Expected:** interactive targets ≥44px (app touch standard used by nav links, pills, card filters) and ≥24×24px (WCAG 2.5.8).
**Actual (measured at 375):**
- "Close" button: **24×14px** — fails WCAG 2.5.8 (24px minimum in the narrow dimension).
- Release list items ("Next IB", `CMSSW_…` entries): **243×42px** — below the 44px app standard.
- "Search PR" button: **258×32px**; search input: **258×34px** — below app standard.

**Repro:**
1. At 375×812, tap **Show releases** in the bottom rail.
2. Measure the header Close button and list items (e.g., DevTools inspection or pointer hit-test).

**Evidence:** `evidence-2026-11-11/e2-navigator-overlay-375.png`, inline 'QA 375 navigator overlay'.

---

### BUG-3 — Escape does not close the navigator overlay or the mobile nav menu
**Severity:** Medium · **Viewports:** all (navigator); ≤767 (nav menu)

**Expected:** Escape closes the topmost dismissible layer, consistently with dropdown menus and modals (both of which close on Escape — verified).
**Actual:**
- Navigator overlay: Escape leaves it open; only the backdrop click or the 14px Close button dismiss it (verified twice).
- Phone hamburger menu: Escape leaves `navbar-collapse.show` in place; only re-tapping the toggler closes it.

**Repro (navigator):**
1. At 375, tap **Show releases** → overlay opens.
2. Press Escape → overlay still open (see screenshot).
3. Click backdrop → closes.

**Repro (nav menu):**
1. At 375, tap the hamburger → menu opens.
2. Press Escape → menu still open.

**Evidence:** `e3-navigator-after-escape-375.png`, `e8-nav-menu-after-escape-375.png`.

---

### BUG-4 — History dialog controls undersized and inconsistent with card filters
**Severity:** Low-Medium · **Viewports:** 375, 768 (dialog controls are the same at all widths)

**Expected:** dialog filter buttons match the card filter standard (48px at phone width, 44px general), consistent within the same screen.
**Actual (measured):**
| Control | 375 | 768 | Card filter at same width |
|---|---|---|---|
| "All results 199" / "Failures only 111" | 30px tall | 30px tall | 48px (375) / 44px (768+) |
| "Close" | 31×32px | 31×32px | — |
| "Reset size" | hidden (by design ≤767) | 82×31px | — |

The 30px filters pass WCAG 2.5.8's 24px minimum but break the app's own touch standard and look inconsistent next to the 48px card filters doing the same job.

**Repro:**
1. In a release card, tap **View … build history** (history icon, 24×24px — see note below).
2. In the dialog, compare the footer/header buttons against the card's "All results / Failures only" buttons.

**Evidence:** `e4-history-dialog-375.png`, `e9-history-dialog-768.png`, inline 'QA 375 history dialog'.

*Related note:* the history icon button that opens the dialog is 24×24px — exactly at the WCAG 2.5.8 minimum, below the 44px app touch standard. Included in BUG-4 scope.

---

### BUG-5 — "See Branch" dropdown items 32px at phone width
**Severity:** Low-Medium · **Viewports:** ≤767

**Expected:** 44px item height at phone widths (matching nav links and section pills).
**Actual:** items (`DEFAULT`, `ASAN_X`, `CLANG_X`, …) measure **32px** tall in the 200px menu; menu fits the viewport (x=160→360) — only the height is short.

**Repro:** At 375, in the **nextIB** card, tap **See Branch** → measure menu items.

**Evidence:** `e10-see-branch-32px-items-375.png`.

---

### BUG-6 — Pluralization: "1 more variants"
**Severity:** Low · **Viewports:** all (data-dependent)

**Expected:** "Comparison baselines for 1 more variant" (singular for count 1).
**Actual:** summary reads `Comparison baselines for 1 more variants` (captured in card index 6 of the 20_1_X cycle).

**Repro:** Find a card whose `<summary>` reads "Comparison baselines for 1 more variants" (present in the 2026-11-10 dataset).

**Evidence:** `e5-pluralization-1-more-variants-375.png`.

---

### BUG-7 — Disclosure summary is an 18px-tall target on fine-pointer narrow viewports
**Severity:** Low · **Viewports:** fine-pointer viewports ≤1024 (desktop/small laptop). Touch widths get 44px via `(hover:none),(pointer:coarse)` media rules — the fix deliberately excludes fine pointer.

**Expected:** pointer targets ≥24px (WCAG 2.5.8), ideally ≥44px per app standard.
**Actual:** `Comparison baselines for N more variants` summary measures **310×18px** at 375 and **546×18px** at 1440 (font-size 12px, fit-content width, 18px height). The sibling `How to read results and comparisons` summary is 26px (passes). 18px fails the 24px minimum for a non-inline disclosure target.

**Repro:** At any width on a mouse/trackpad, Tab to (or hover) the "Comparison baselines …" summary and measure its box.

**Evidence:** `e7-18px-summary-target-375.png`.

---

### BUG-8 — ARIA nested-interactive on `role="button"` card headers
**Severity:** Low (a11y semantics; no functional impact — verified) · **Viewports:** all

**Location (read-only):** `src/Components/IBPageComponents/IBGroupFrame.js` (~175–280).

**Expected:** interactive roles contain no focusable descendants (axe `nested-interactive`).
**Actual:** **17 elements** with `role="button"` (card/collapse headers) each contain 2–4 focusable controls ("Show Pull Requests", "Copy …", "All results 63", "Emphasize failures and warnings", "View branch commits…"). Screen readers may not expose the nested controls when the button role is announced.

**Verified non-issue (part of the same suspicion):** clicking nested buttons does **not** toggle the header collapse (`aria-expanded` stayed `true` after Copy and PR clicks) — event handling is correct; only semantics are affected.

**Repro:** DevTools/a11y tree: inspect any release-card header (`role="button"`, `tabindex="0"`) and observe focusable children. Or run axe-core: `nested-interactive` violations ×17.

**Evidence:** DOM audit output recorded during the sweep (no visual artifact).

---

### BUG-9 — Fixed bottom rail overlays live controls mid-scroll at phone width
**Severity:** Low (known fixed-control tradeoff; still intercepts taps on live controls) · **Viewports:** ≤767

**Context:** the phone rail is a fixed bottom row (`x=152..352, y=760..804` at 375×812, 200×44). The 60px end-of-page padding prevents permanent end-of-document hiding, but mid-scroll the rail floats over content.

**Expected:** fixed affordances do not intercept taps intended for underlying controls (or underlying controls are never placed in the occluded band without extra scroll).
**Actual (hit-tested at 375 across 6 scroll depths):** the rail's footprint covers interactive controls:
- scrollY 0: section pills "Run time analysis", "RelVals", "Crab↗", "Test"
- scrollY ~2000: "How to read results and comparisons" summary
- scrollY ~4400: "Failures only 15" filter button
- earlier in session: the Configuration `<select>` label

A tap in the rail's footprint hits the rail instead of the covered control.

**Repro:** At 375, scroll to any depth where a pill/filter sits at the bottom edge of the viewport; tap it — the rail receives the click.

**Evidence:** `e6-rail-covers-controls-375.png` (rail visibly over the pill row), inline 'QA 375 rail mid-scroll'.

---

### BUG-10 — Compact density nearly inert at phone width
**Severity:** Low (inconsistent UI state) · **Viewports:** ≤1024

**Expected:** the "Comfortable / Compact" density toggle visibly changes density at all widths, or the control is hidden where it does nothing.
**Actual (single-card height delta, comfortable → compact):**

| Viewport | Comfortable | Compact | Delta |
|---|---|---|---|
| 375 | 1901px | 1893px | **8px** |
| 768 | 1153px | 1139px | **14px** |
| 1024 | 1017px | 1003px | **14px** |
| 1440 | 943px | 906px | **37px** (pills 44→30px) |

At 375 the phone stage list keeps comfortable sizing (pills stay 44px), so the toggle reads as broken; at 768/1024 the effect is marginal.

**Repro:** At 375, tap **Compact** in the toolbar; observe card height and pill sizes (unchanged).

**Evidence:** measurements above; inline 'QA 375 compact density', 'QA 768 compact density', 'QA 1440 compact density'.

---

## Suspicions investigated and ruled out

| Suspicion | Verdict |
|---|---|
| Scroll hint "Scroll horizontally to see all architectures →" persists at scroll end | **Not a bug.** Static affordance rendered on `{hasOverflow}` (`ComparisonTable.js:713`); no scroll-driven hide contract exists in code or tests. |
| Toolbar subtitle briefly shows the previous release cycle after route switch | **Not a bug.** Transient state during fetch; subtitle updates to the new cycle once data resolves (verified `CMSSW_20_0_X` after switch). |
| "Reset size" hidden in history dialog at ≤767 | **By design.** `@media (max-width: 767px) .ib-history-resize { display: none }`. |
| Clicking nested header buttons also collapses the card | **Not a bug.** `aria-expanded` unchanged after nested Copy / PR clicks (verified). |
| Focus rings missing or invisible | **Not a bug.** Full Tab sweep at 1440: all 14 sampled focusables show visible outlines (1–3px). *Observation:* ring widths are inconsistent (1px summaries, 2px links/pills, 3px buttons) — cosmetic only. |
| Low-contrast text | **Not a bug.** Sampled pairs: secondary text 7.58:1, pill white-on-blue 5.17:1, pill text 16.27:1 — all pass WCAG AA. |
| Matrix family/flavor header misalignment | **Not a bug.** Flavor cards measured centered in family headers at 768/1024/1440. |
| Sticky name column losing stickiness on horizontal scroll | **Not a bug.** `position: sticky` confirmed with column pinned at scroller's left edge at scrollLeft 600 (768). |
| Console/runtime errors from interactions | **None found** in any tested batch (route switches, filters, comparison mode, dialogs, navigator, density, copy, PR search). |

## Verified working (tested at 375 unless noted)

Hamburger nav + "Older▾" submenu (44px links) · route switch with auto-close and correct subtitle · phone stage filtering (5→3) · Escape on dropdowns and modals · empty states ("No tests found", "No pull requests found") · configuration `<select>` switch · "Compare configurations" matrix (21 cols, scroll hint, horizontal scroll) · history dialog layout (fills 375×812, 65 cols, no body overflow) · collapse/expand (1046→179px, `aria-expanded` flips) · copy button ✓ feedback and reset · "Hide all releases"/"Show all releases" flip + restore · navigator release jump (scrollY 0→2470) and PR search error message · RelVals search filter ("No tests found" empty state) · emphasis toggle (`aria-pressed` false→true + `active` class) · `title` tooltips on status markers ("4 compiler warnings", "2 test results", …) · sticky name column · matrix proportions and tooltips at 768/1024/1440 · no document overflow at any tested width.

## Recommended fix order (for the review discussion — no code touched)

1. BUG-1: replace `minWidth: "340px"` with `minWidth: "min(340px, calc(100vw - 24px))"` + `maxWidth` cap (both dropdown components).
2. BUG-3: add Escape handling to the navigator overlay and `navbar-collapse` (matching dropdown/modal behavior).
3. BUG-2/4/5: normalize control heights to the 44px phone / 24px WCAG floor (navigator Close 14px → 44px first).
4. BUG-6: pluralize the baselines summary (`variant`/`variants`).
5. BUG-7: give the summary a min-height/padding to ≥24px (or extend the existing coarse-pointer rule to all pointers).
6. BUG-8: restructure card headers (header `role="button"` → dedicated collapse toggle button, or `aria-owns` pattern).
7. BUG-9/10: product decisions — rail placement/padding strategy and whether compact density should affect the phone list.
