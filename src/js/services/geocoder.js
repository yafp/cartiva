// Network boundary for Nominatim. UI code should only deal with domain results.
(function attachGeocoder(global) {
  async function requestJson(url, signal) {
    const response = await fetch(url, {
      signal,
      headers: { Accept: 'application/json' }
    });
    if (response.status === 429) throw new Error('Geocoder rate limit reached. Please wait and try again.');
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    return response.json();
  }

  function createGeocoder({ searchEndpoint, reverseEndpoint }) {
    const cache = global.CartivaCache?.create(80);
    let lastRequestAt = 0;
    const reportFailure = (area, error) => {
      if (error?.name !== 'AbortError') global.CartivaDiagnostics?.report(area, error);
      throw error;
    };
    async function rateLimitedRequest(url, signal) {
      const interval = Number(global.CartivaServices?.geocoder?.minIntervalMs || 1200);
      const wait = Math.max(0, interval - (Date.now() - lastRequestAt));
      if (wait) await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, wait);
        signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
      });
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      lastRequestAt = Date.now();
      return requestJson(url, signal);
    }
    return Object.freeze({
      search(query, signal) {
        const url = `${searchEndpoint}?format=json&addressdetails=1&q=${encodeURIComponent(query)}&limit=5`;
        const key = `search:${query.toLowerCase()}`;
        if (cache?.has(key)) return Promise.resolve(cache.get(key));
        return rateLimitedRequest(url, signal).then(data => cache?.set(key, data) || data)
          .catch(error => reportFailure('geocoder.search', error));
      },
      reverse({ lat, lon }, signal) {
        const url = `${reverseEndpoint}?format=json&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1`;
        const key = `reverse:${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}`;
        if (cache?.has(key)) return Promise.resolve(cache.get(key));
        return rateLimitedRequest(url, signal).then(data => cache?.set(key, data) || data)
          .catch(error => reportFailure('geocoder.reverse', error));
      }
    });
  }

  global.CartivaGeocoding = Object.freeze({
    create: createGeocoder,
    requestJson
  });
})(window);
