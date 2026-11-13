// Deterministic responses preserve the production callback and Promise contracts.
export function getSingleFile({ fileUrl, onSuccessCallback }) {
  const data=new URLSearchParams(location.search).has('prproportions')&&fileUrl?.endsWith('cmssw_labels.json')
    ? {core:'22c55e',orp:'22c55e',tests:'22c55e'} : [];
  const response = { data };
  onSuccessCallback?.(response);
  return Promise.resolve(response);
}
export function getMultipleFiles({ fileUrlList = [], onSuccessCallback }) {
  const responses = fileUrlList.map(() => ({ data: [] }));
  onSuccessCallback?.(responses);
  return Promise.resolve(responses);
}
