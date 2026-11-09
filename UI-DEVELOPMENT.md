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
