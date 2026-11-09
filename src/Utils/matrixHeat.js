import React from 'react';

// Compare failure counts only within a stage row; never compare compiler
// warnings with failed tests or infer that a high count is a new regression.
export function shadeStageOutliers(node) {
  if (Array.isArray(node)) return node.map(shadeStageOutliers);
  if (!React.isValidElement(node)) return node;
  if (node.type === 'tr') {
    const values = [];
    const visit = (item) => {
      if (Array.isArray(item)) return item.forEach(visit);
      if (!React.isValidElement(item)) return;
      const value = item.props['data-result-count'];
      if (item.props['data-result-status'] === 'danger' && Number.isFinite(value)) values.push(value);
      visit(item.props.children);
    };
    visit(node);
    const min = Math.min(...values), max = Math.max(...values);
    const shade = (item) => {
      if (Array.isArray(item)) return item.map(shade);
      if (!React.isValidElement(item)) return item;
      const value = item.props['data-result-count'];
      const extra = item.props['data-result-status'] === 'danger' && Number.isFinite(value) && max > min
        ? { style: { ...item.props.style, '--ib-failure-weight': `${Math.round(35 * (value - min) / (max - min))}%` } } : {};
      return React.cloneElement(item, extra, shade(item.props.children));
    };
    return shade(node);
  }
  return React.cloneElement(node, {}, shadeStageOutliers(node.props.children));
}
