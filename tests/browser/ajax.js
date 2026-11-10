// Deterministic responses preserve the production callback and Promise contracts.
export function getSingleFile({ onSuccessCallback }) {
  const response = { data: [] };
  onSuccessCallback?.(response);
  return Promise.resolve(response);
}
export function getMultipleFiles({ fileUrlList = [], onSuccessCallback }) {
  const responses = fileUrlList.map(() => ({ data: [] }));
  onSuccessCallback?.(responses);
  return Promise.resolve(responses);
}
