import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { shadeStageOutliers } from '../src/Utils/matrixHeat.js';
const mark = (count, status = 'danger') => React.createElement('span', { 'data-result-status': status, 'data-result-count': count });
test('heat is relative to failure counts in one stage, excluding warnings', () => {
  const row = React.createElement('tr', {}, [mark(2), mark(13), mark(420, 'warning')]);
  const result = shadeStageOutliers(row).props.children;
  assert.equal(result[0].props.style['--ib-failure-weight'], '0%');
  assert.equal(result[1].props.style['--ib-failure-weight'], '35%');
  assert.equal(result[2].props.style, undefined);
});
test('equal counts do not imply an outlier', () => {
  const result = shadeStageOutliers(React.createElement('tr', {}, [mark(3), mark(3)]));
  assert.equal(result.props.children[0].props.style, undefined);
});
