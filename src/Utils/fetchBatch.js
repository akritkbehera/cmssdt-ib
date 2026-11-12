/** Bounded, ordered requests with progressive snapshots and stale-request cancellation. */
export async function fetchBatch(urls, request, {concurrency = 4, onProgress, signal} = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new RangeError('Invalid request concurrency');
  const results = new Array(urls.length);
  let next = 0, completed = 0, failed = false;
  const check = () => { if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError'); };
  await Promise.all(Array.from({length: Math.min(concurrency, urls.length)}, async () => {
    while (!failed) {
      check();
      const index = next++;
      if (index >= urls.length) return;
      try {
        const response = await request(urls[index]);
        check();
        if (failed) return;
        results[index] = response;
        completed++;
        onProgress?.(results.slice(), {completed, total:urls.length, index});
      } catch (error) { failed = true; throw error; }
    }
  }));
  return results;
}
