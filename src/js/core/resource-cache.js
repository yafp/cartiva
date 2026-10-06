// Small cache boundary shared by geocoding and tile services.
(function attachResourceCache(global) {
  /**
   * Creates create for the Cartiva application.
   * @function create
   * @param {*} maxEntries - Input value.
   */
  function create(maxEntries = 100) {
    const values = new Map();
    return Object.freeze({
      has: key => values.has(key),
      get: key => values.get(key),
      set(key, value) {
        if (values.size >= maxEntries && !values.has(key)) values.delete(values.keys().next().value);
        values.set(key, value);
        return value;
      },
      clear: () => values.clear(),
      size: () => values.size
    });
  }
  global.CartivaCache = Object.freeze({ create });
})(window);
