# Dashboard styling

`src/styles/tokens.css` owns the shared palette, type scale, spacing, radii,
shadows and component/screen metrics. `src/styles/theme.js` exposes those CSS
variables to components that still need inline styles. `src/dashboard.css`
owns dashboard component layout. Bootstrap continues to own the grid,
buttons and modal defaults; avoid reinstating global padding/card resets.

Release panels use named classes; icon actions share `IconButton` with a
44px target and accessible name. Navigation uses ResizeObserver to reserve
its actual height, including expanded filters and mobile navigation.

With Node 20.19+ or 22.12+ and dependencies installed, run:

```sh
npm ci
npm run build:preview
```

This builds the React source and copies the output to the sibling
`cmssdt-web/html/cmssdt-ib-react19` checkout. It does not commit or push.
The Python preview server can continue running; hard-refresh the browser.

Until that first build, `npm run sync:preview` regenerates a CSS adapter for
the checked-in legacy bundle. It combines source tokens and styles, mapping
named panel selectors to legacy markup and overriding old inline/reset
rules. Never edit the generated `dashboard.css` in cmssdt-web by hand.
This transitional adapter only updates styles; it cannot publish React
component changes. After publishing a build, use `build:preview` exclusively.

Browser QA should cover desktop and mobile: release navigation, opening
filters (including wrapped content), expanding/collapsing groups, PR controls,
keyboard activation, copying tags, table scrolling and floating navigation.
The legacy preview cannot validate new component behavior.

## Two-phase matrix fit

Tune `matrixFitConfig` in `src/config.js`:

- `horizontalThreshold: 0.05`: Phase 2 runs only when unused width is **more than 5%** of the container. Set `0` to consume any meaningful slack, or raise it to retain the original aspect ratio more often.
- `maxGapMultiplier: 2`: horizontal cell padding may grow to twice its scaled base size before cell content space widens. Set `1` to disable padding growth.
- `maxUniformScale: 1.25`: caps Phase 1's text, icons, dimensions, and vertical spacing together.
- `viewportHeightRatio: 0.65`: default matrix height budget as a fraction of viewport height; `maxHeightPx` can supply an explicit height instead.

Phase 1 uses the minimum of the width ratio, height ratio, and uniform-scale cap. Phase 2 checks the leftover/container-width ratio, allocates that width to horizontal padding first, and then widens all configuration columns equally. It never changes Phase 1's text size, icon size, stage width, or measured row heights. Small slack stays unused when the threshold is not exceeded.

The base layout is measured in an invisible, unscaled clone, independent of the expanded table. ResizeObserver callbacks are scheduled through animation frames; cached base measurements are invalidated for data, density, device geometry, and font changes. This prevents Phase 2 reflow from feeding back into Phase 1. Narrow or short screens retain readable base sizes inside a contained scrolling viewport; the phone's single-configuration view is unchanged.

Regression tests: `node --test tests/matrixFit.test.mjs` covers limiting dimensions, threshold boundaries, padding-first allocation, padding caps, grow/shrink cycles, and overflow bounds.
