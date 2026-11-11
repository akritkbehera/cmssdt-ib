# CMSSDT IB Dashboard — Responsive Audit & Repair Report

Repo: `~/Desktop/opencode/cmssdt-ib` (branch `master`, working tree only — **nothing committed, pushed, or deployed**).
Audit harness: `~/Desktop/cmssdt-ib-qa` (Playwright + headless Chromium, live-data Vite app on `:5174` fed by the pages-mode GitHub raw data URLs).

Viewport matrix: **320, 375, 390, 768, 1024, 1280, 1440** (plus regression widths 1366/1536/1920/2560 in `tests/browser/layout.mjs`).
Touch emulation: `hasTouch: true, isMobile: true` at 320/375/390/768 — verified `matchMedia('(pointer: coarse)') === true` (`report-after.json` → `coarse`). Desktop widths use fine pointers.

Evidence: `report/before/*.png`, `report/after/*.png` (75 screenshots per side: `*-top`, `*-mid`, `*-card1`, `*-collapsed`, `*-comfortable`, `*-filter-issues`, `*-nav-open`, `*-state-*`), raw metrics in `report-*.json` / `states-*.json`, and `rail-overlap-before.txt` / `rail-overlap-after.txt` (element-level overlap probe).

---

## 1. Issue checklist (ranked)

### CRITICAL

**C1 — Floating action rail overlapped interactive content at every width.**
The fixed rail (`Hide all releases / Go to top / Go to bottom / Show releases`, 44×44 ×4, `z-index: 1050`) covered the right edge of every screen at all scroll positions.
- Before, it covered (`rail-overlap-before.txt`):
  - 320: section pill `Crab↗`, comparison-context block
  - 390: the configuration `<select>`, **“Compare configurations”**, **“View DEFAULT history”**
  - 768: matrix help disclosure, panel header (Collapse control), result-details trigger
  - 1024/1440: **matrix result links** (`a:"8"`, `a:"1"`, `a:"5"`), config header link `el9amd64gcc14`, panel header/Collapse
- Screenshots: `before/320-mid.png`, `before/1440-mid.png`, `before/390-top.png`, `before/768-top.png`.
- **Fixed**: the rail is now class-driven (`.ib-floating-actions`) and `.ib-workspace:has(.ib-floating-actions)` reserves a right channel (`--ib-actions-gutter` = button + offset + breathing gap = 68px ≥768). At ≤767.98 the rail becomes a compact bottom row and the workspace gains 60px bottom padding, so phone cards keep full width.
- After: **zero** covered interactive elements at 768/1024/1280/1440 (`rail-overlap-after.txt`); on phones only the standard fixed-control tradeoff remains (see Limitations).
- Screenshots: `after/320-mid.png`, `after/1440-mid.png`, `after/390-top.png`, `after/768-top.png`.

### HIGH

**H2 — Inline `minHeight: "30px"` in `StatusLabels.getLabelBaseStyle` defeated all responsive/touch sizing rules.**
Inline styles outrank the stylesheet, so `.ib-section-pill` touch rules (44px) never applied: **53 small targets at 320/390** (30px pills, 18px summaries), 43 at 768.
- **Fixed**: removed the competing inline style (the class already sets 30px on desktop, so compact desktop visuals are pixel-identical); sizing now owned by `.ib-section-pill` + media queries and the new `--ui-pill-min-height` token (30px base → 44px on `(hover: none), (pointer: coarse)` and ≤767.98).
- After: **0 small targets** at 320/375/390/768. Screenshots: `after/320-card1.png` (44px pills) vs `before/320-card1.png`.
- Same treatment for the Commits.js PR dropdown toggle (`minHeight: var(--ui-pill-min-height)`).

**H3 — `.ib-comparison-context > details > summary` (“Comparison baselines for N more…”) had an 18px tap target.**
- **Fixed**: 44px `min-height` + inline-flex centering on coarse pointers (`src/dashboard.css`, touch block).
- After: no 18px targets remain in the touch-target audit.

### MEDIUM

**M4 — 10px filter count badges (`.ib-result-filter .btn span`) below the 12px type floor** (30 instances on phones).
- **Fixed**: `font: 500 12px/18px`. After: `tiny=0` at 320/375/390 (was 30).

**M5 — `.ib-history-latest` 11px.**
- **Fixed**: 12px (`src/dashboard.css`).

### LOW / verified-by-audit, no change needed

- **L6 — Marquee flavour labels** (`OverflowLabel`): captures show labels mid-scroll. This is the intended recent feature (scrolls only when the name overflows, pauses on hover/focus, disabled under `prefers-reduced-motion`). Left as designed.
- **L7 — Harness-only collapse pitfall**: at 768 the old audit clicked the header’s centre, which lands on the nested copy IconButton (it stops propagation by design). The harness now clicks `.ib-collapse-toggle`; collapse/expand verified at all widths (`states-after.json`: `collapsedHeight` 224 / 205.5 / 141.5 / 115.5 at 320/390/768/1440, no errors).
- Verified healthy before & after: no horizontal document overflow at any width (`docOverflow: 0` everywhere), family/config header alignment, group borders and matrix proportions unchanged, matrix scroll + visible scroll hint at ≥768, phone single-config view at <768, expanded/collapsed cards, loading/running markers, filters (Failures only / All results), PR panels, history + multi-flavour comparison dialogs fit every width, density toggle, responsive navigation (`*-nav-open.png`), keyboard focus-visible styles.

---

## 2. Changed files (all in `~/Desktop/opencode/cmssdt-ib`, uncommitted)

| File | Change |
|---|---|
| `src/Components/IBPageComponents/IBGroups.js` | Rail markup: inline fixed positioning replaced with `className="ib-floating-actions"` (styles moved to CSS; its hard-coded 10px gap normalized to the 8px `--ui-space-2` scale via `--ib-actions-gap`). |
| `src/styles/tokens.css` | New tokens: `--ui-pill-min-height` (30px → 44px on coarse pointer / ≤767.98), `--ib-actions-size/offset/gap/gutter`; responsive overrides in the coarse-pointer and mobile media blocks. |
| `src/dashboard.css` | `.ib-floating-actions` styles (vertical channel ≥768, bottom row ≤767.98, hidden in print); `.ib-workspace:has(.ib-floating-actions)` gutter reservation; touch target for `.ib-comparison-context > details > summary`; filter count badge 10px→12px; `.ib-history-latest` 11px→12px. |
| `src/Components/IBPageComponents/StatusLabels.js` | Removed competing inline `minHeight: "30px"` from `getLabelBaseStyle`. |
| `src/Components/IBPageComponents/Commits.js` | PR dropdown toggle `minHeight: "var(--ui-pill-min-height)"`. |

Design-system compliance: all decisions live in `tokens.css` values and `dashboard.css` media queries (UI-DEVELOPMENT.md §4/§5); no breakpoints changed; `:has()` scoping keeps rail-less surfaces (e.g. the test fixture) at their historical metrics.

---

## 3. Test results

| Suite | Result |
|---|---|
| `node --test tests/*.test.mjs` (matrixFit, mobileResults, etc.) | **47/47 pass** (before and after) |
| `tests/browser/layout.mjs` (fixture on `:5173`, widths 1366→2560) | **pass, exit 0** (before and after) — matrix fit, row budgets, alignment, 11px corner slots, `readable type ≥12px`, overflow assertions all intact |
| `npm run build` (production) | **succeeds** (pre-existing 500 kB chunk-size warning only) |
| Playwright audit 320/375/390 (touch) | tiny 30→**0**, small targets 53→**0**, overflow 0→0 |
| Playwright audit 768 (touch) | tiny 73→**45** (remaining = 11px delta slots, by test contract), small targets 43→**0** |
| Playwright audit 1024/1280/1440 (fine pointer) | tiny 73→**45** (delta slots), small targets 150–161 (30px pills by desktop design — see Limitations) |
| Interaction states (filters, collapse, PR panel, history, multi-flavour comparison, details dialog, nav) | all work at 320/390/768/1440; no console/page errors in any run |
| Rail overlap probe (`rail-probe.mjs`) | before: covered links/pills/selects at 5/5 widths → after: **0 covered elements at 768+** |

---

## 4. Remaining limitations / accepted tradeoffs

1. **11px delta slots** (`.ib-result-delta` corner delta values) stay 11px: `tests/browser/layout.mjs` contractually asserts ≤11.5px corner slots (`'11px corner slots fit without touching the status'`). They remain the only sub-12px text (`tiny=45` counts at ≥768).
2. **`.ib-build-kind` 11px** micro-label retained (component identity marker, non-interactive).
3. **Desktop pill height stays 30px on fine pointers** — the design system’s compact desktop identity; the 44px target applies to touch (WCAG 2.5.8’s pointer-type exemption). The `--ui-pill-min-height` token makes a future policy change a one-line edit.
4. **Phone bottom rail** (200×44, bottom-right) can momentarily overlap content mid-scroll — inherent to any fixed floating control; page end is always reachable (60px reserved bottom padding). This replaces the old full-height right column that permanently occluded content and the Collapse control at all scroll positions.
5. **768–1023 touch “details” dialog triggers** render 0×0 (`button.ib-status-details`) — identical before and after (pre-existing); at tablet widths result inspection uses the direct result links (44×44 on touch), while the dialog is phone-only. The 1440 “no trigger” in `states-*.json` is by design (desktop shows direct links).
6. **Clipboard `navigator.clipboard.writeText` rejects in headless Chromium** — copy-button ✓ state was verified visually; copy logic is covered by unit tests.
7. **Commits.js PR-panel action targets** keep their component-level 30px on pointer devices (their dropdown toggle now scales via the pill token). PR panels verified open/close at all widths.
8. Captures are of the live dataset at audit time; counts vary run to run (panels 17–20) but geometry conclusions hold.

## 5. How to reproduce

```bash
# app under test (live data, pages-mode data URLs, separate vite cache)
cd ~/Desktop/cmssdt-ib-qa && npx vite --mode pages --config vite.app.mjs   # :5174, root = ~/Desktop/opencode/cmssdt-ib
# regression fixture + tests
node --test tests/*.test.mjs
npx vite --config tests/browser/vite.config.mjs &           # :5173
node tests/browser/layout.mjs
# audit
cd ~/Desktop/cmssdt-ib-qa
node audit.mjs after 5174 && node states.mjs after 5174 && node rail-probe.mjs 5174
```
