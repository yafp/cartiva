// Network boundary for Nominatim. UI code should only deal with domain results.
(function attachGeocoder(global) {
  /**
   * Requests json for the Cartiva application.
   * @function requestJson
   * @param {*} url - Input value.
   * @param {*} signal - Input value.
   * @param {Function} normalize - Reduces provider metadata before it is cached.
   */
  async function requestJson(url, signal, normalize = value => value) {
    const response = await fetch(url, {
      signal,
      headers: { Accept: 'application/json' }
    });
    if (response.status === 429) throw new Error('Geocoder rate limit reached. Please wait and try again.');
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    return normalize(await response.json());
  }

  /**
   * Copies only the address fields used by location search and reverse lookup.
   * @param {Object} address - Nominatim address object.
   * @returns {Object} A compact address object.
   */
  function compactAddress(address) {
    if (!address || typeof address !== 'object' || Array.isArray(address)) return {};
    const fields = ['city', 'town', 'municipality', 'village', 'county', 'state', 'country'];
    return Object.fromEntries(fields
      .filter(field => typeof address[field] === 'string')
      .map(field => [field, address[field]]));
  }

  /**
   * Removes Nominatim search metadata as soon as the response crosses the network boundary.
   * @param {*} results - Raw Nominatim search response.
   * @returns {*} Search fields consumed by location UI, preserving malformed input for normal error handling.
   */
  function compactSearchResponse(results) {
    if (!Array.isArray(results)) return results;
    return results.map(item => ({
      lat: item?.lat,
      lon: item?.lon,
      display_name: item?.display_name,
      address: compactAddress(item?.address)
    }));
  }

  /**
   * Removes unused reverse-geocoding metadata at the network response boundary.
   * @param {*} result - Raw Nominatim reverse response.
   * @returns {*} The address fields consumed by the application.
   */
  function compactReverseResponse(result) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
    return { address: compactAddress(result.address) };
  }

  /**
   * Creates geocoder for the Cartiva application.
   * @function createGeocoder
   * @param {*} reverseEndpoint - Input value.
   */
  function createGeocoder({ searchEndpoint, reverseEndpoint }) {
    const cache = global.CartivaCache?.create(80);
    let lastRequestAt = 0;
    const reportFailure = (area, error) => {
      if (error?.name !== 'AbortError') global.CartivaDiagnostics?.report(area, error);
      throw error;
    };
    /**
     * Handles limited request for the Cartiva application.
     * @function rateLimitedRequest
     * @param {*} url - Input value.
     * @param {*} signal - Input value.
     */
    async function rateLimitedRequest(url, signal, normalize) {
      const interval = Number(global.CartivaServices?.geocoder?.minIntervalMs || 1200);
      const wait = Math.max(0, interval - (Date.now() - lastRequestAt));
      if (wait) await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, wait);
        signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
      });
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      lastRequestAt = Date.now();
      return requestJson(url, signal, normalize);
    }
    return Object.freeze({
      search(query, signal) {
        const url = `${searchEndpoint}?format=json&addressdetails=1&q=${encodeURIComponent(query)}&limit=5`;
        const key = `search:${query.toLowerCase()}`;
        if (cache?.has(key)) return Promise.resolve(cache.get(key));
        return rateLimitedRequest(url, signal, compactSearchResponse).then(data => cache?.set(key, data) || data)
          .catch(error => reportFailure('geocoder.search', error));
      },
      reverse({ lat, lon }, signal) {
        const url = `${reverseEndpoint}?format=json&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1`;
        const key = `reverse:${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}`;
        if (cache?.has(key)) return Promise.resolve(cache.get(key));
        return rateLimitedRequest(url, signal, compactReverseResponse).then(data => cache?.set(key, data) || data)
          .catch(error => reportFailure('geocoder.reverse', error));
      }
    });
  }

  global.CartivaGeocoding = Object.freeze({
    create: createGeocoder,
    requestJson
  });
})(window);
