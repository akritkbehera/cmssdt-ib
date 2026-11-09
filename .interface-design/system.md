# CMSSW IB dashboard

Design for engineers scanning releases, build architectures, compiler variants,
test failures and associated pull requests. Preserve information density and
all operational links. The build/test matrix is the focal element.

Domain signature: compare test stages across compiler/platform configurations
within each IB. Avoid generic metric-card grids or large decorative headings.

Use a light-first canvas #F8FAFC, primary text #111827, action blue #2563EB,
success #16803C and failure #DC2626. Architecture identity stays neutral;
status colors communicate results. Depth comes from neutral 1px borders,
with restrained shadows only for overlays.

Fonts: Inter or Geist Sans when installed, system sans fallback; build IDs
and toolchain identifiers use the monospace stack. No remote font dependency.
Type roles: 12px captions, 13px labels, 14px body, 16px section headings,
20px page title, 24px display. Weight and color distinguish metadata from values.
Spacing scale: 4/8/12/16/24/32px. Controls have 6px radii, panels 10px.
Icon buttons retain 44px targets. Numeric data uses tabular numerals.

Comfortable density: 8px matrix cell padding, 24px status marks, 12px panel gaps.
Compact density: 4px cell padding, 20px status marks, 8px panel gaps. Density
persists locally; do not hide configurations or test rows to achieve compactness.

Reuse IBGroupFrame as the build panel, ComparisonTable as the matrix,
ArchitectureHeader for platform/toolchain metadata, IconButton for actions,
and existing Commits components for PR interactions. Keep state and fetch
patterns intact; extract additional components when real repeated roles emerge.

Validate long build IDs, dense architecture sets, open filters, PR panels,
keyboard controls and both density modes at desktop/mobile sizes. The mobile
matrix scrolls horizontally with a visible cue. Desktop and mobile layout,
sticky column alignment, filters, density, PR toggles and navigation were
checked with Playwright against the local preview.

Reference refinement: Screenshot 2026-11-06 at 14-16-02 Review Dashboard Design.png.
Use summary counts above a two-option results filter. Counts represent rendered
stage/architecture outcomes, not numeric test totals; exclude tooltip copies.
Failures only hides non-failure rows and markers while preserving architecture
column alignment. Warnings remain in All results. Successful markers are
outlined green checks; failures/warnings use small tinted pills. Horizontal
separators replace the boxed matrix grid. Do not copy illustrative screenshot data.

Instruction refinement: comparison selection now uses the full returned dataset
before UI filtering, exact queue/variant sequences and exact stage/configuration
keys. Only latest records receive deltas; older cards remain raw. Full baseline
IDs are visible near the header. Duplicate/missing identities suppress comparison.
Never label count changes UNIQUE without backend failure signatures. A violet
NEWLY FAILING marker is separate from the ordinary red result.

Group dividers span both header tiers and all body rows without reordering columns.
Running states retain solid circle/glyph/counts; only an inner clipped fill pulses
at 1.8s. Reduced motion uses static tint. Long explanations live in native details.
See COMPARISON-CONTRACT.md for data assumptions and validation limitations.

Latest cleanup: missing baselines produce no cell annotation or reserved line.
Keep valid comparisons secondary. Running circles use a synchronized 2s rim
arc/radar sweep and 1.8s inner fill pulse, with fixed glyph/outline/geometry and
no effects outside the circle. Reduced motion freezes all animation. This
supersedes the earlier inner-pulse-only running treatment.

Badge synchronization: reference-style motion is preserved but its colors alias
the shared success/failure tokens. Circle sizes are 24px comfortable / 20px
compact, with 12px glyphs, 4px icon/count gap and a 3ch minimum count lane.
Counts use the shared 13px monospace/tabular scale and 600 weight; deltas use
the shared 12px numeric style. No independent reference palette remains.
