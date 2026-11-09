/** Count visible status markers, not individual tests inside their numeric totals.
 * Follow children only: tooltip copies must never inflate the summary. */
export function summarizeMatrix(node) {
  const counts = { success: 0, danger: 0, warning: 0, secondary: 0, info: 0 };
  function visit(item) {
    if (Array.isArray(item)) return item.forEach(visit);
    if (!item || typeof item !== 'object' || !item.props) return;
    const status = item.props['data-result-status'];
    if (Object.hasOwn(counts, status)) counts[status] += 1;
    else visit(item.props.children);
  }
  visit(node);
  return counts;
}
