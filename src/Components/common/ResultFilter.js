import React from 'react';
import { Button, ButtonGroup } from 'react-bootstrap';

export default function ResultFilter({ filter = 'all', counts, onChange }) {
  const total = counts && Object.values(counts).reduce((sum, count) => sum + count, 0);
  return <ButtonGroup className="ib-result-filter" aria-label="Test results filter">
    <Button variant="light" active={filter === 'all'} aria-pressed={filter === 'all'} onClick={() => onChange('all')}>
      All results {counts && <span>{total}</span>}
    </Button>
    <Button variant="light" active={filter === 'issues'} aria-pressed={filter === 'issues'} onClick={() => onChange('issues')}
      title="Emphasize failures and warnings; hide fully passing stage rows">
      Failures only {counts && <span>{counts.danger + counts.warning}</span>}
    </Button>
  </ButtonGroup>;
}
