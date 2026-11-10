import React, { useLayoutEffect, useRef, useState } from 'react';
import { Button, ButtonGroup } from 'react-bootstrap';

export default function DashboardDensity({ release, children }) {
  const workspaceRef = useRef(null);
  const [density, setDensity] = useState(() => {
    try { return localStorage.getItem('cms_ib_density') === 'compact' ? 'compact' : 'comfortable'; }
    catch { return 'comfortable'; }
  });
  const selectDensity = (value) => {
    setDensity(value);
    try { localStorage.setItem('cms_ib_density', value); } catch { /* Session state still works. */ }
  };
  useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    let frame;
    // Only measure the real chrome offset. CSS owns the viewport budget and
    // spacing; measuring card heights here would create a resize feedback loop.
    const measure = () => {
      frame = undefined;
      const list = workspace.querySelector('.ib-card-list');
      if (!list) return;
      // Upcoming notices precede results but are not one of the two result cards.
      const firstResult = list.querySelector('.ib-release-panel:has(.ib-matrix-section)');
      const top = Math.max(0, (firstResult || list).getBoundingClientRect().top + window.scrollY);
      const value = `${top}px`;
      if (workspace.style.getPropertyValue('--ib-card-list-top') !== value) {
        workspace.style.setProperty('--ib-card-list-top', value);
      }
    };
    const schedule = () => { if (frame === undefined) frame = requestAnimationFrame(measure); };
    const resize = new ResizeObserver(schedule);
    resize.observe(workspace);
    resize.observe(workspace.querySelector('.ib-workspace-toolbar'));
    const mutation = new MutationObserver(schedule);
    mutation.observe(workspace, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-pr-visible'] });
    window.addEventListener('resize', schedule);
    measure();
    return () => {
      resize.disconnect(); mutation.disconnect(); window.removeEventListener('resize', schedule);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [density]);
  return (
    <main ref={workspaceRef} className="ib-workspace" data-density={density}>
      <header className="ib-workspace-toolbar">
        <div><h1>Integration builds</h1><span className="ib-release-identifier">{release}</span></div>
        <ButtonGroup aria-label="Display density" size="sm">
          {['comfortable', 'compact'].map(value => (
            <Button key={value} variant={density === value ? 'primary' : 'outline-secondary'}
              aria-pressed={density === value} onClick={() => selectDensity(value)}>
              {value === 'compact' ? 'Compact' : 'Comfortable'}
            </Button>
          ))}
        </ButtonGroup>
      </header>
      {children}
    </main>
  );
}
