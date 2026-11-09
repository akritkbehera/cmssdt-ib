import React, { useState } from 'react';
import { Button, ButtonGroup } from 'react-bootstrap';

export default function DashboardDensity({ release, children }) {
  const [density, setDensity] = useState(() => {
    try { return localStorage.getItem('cms_ib_density') === 'compact' ? 'compact' : 'comfortable'; }
    catch { return 'comfortable'; }
  });
  const selectDensity = (value) => {
    setDensity(value);
    try { localStorage.setItem('cms_ib_density', value); } catch { /* Session state still works. */ }
  };
  return (
    <main className="ib-workspace" data-density={density}>
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
