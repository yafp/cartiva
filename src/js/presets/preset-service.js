// Presets are treated as data with a validated service boundary.
(function attachPresetService(global) {
  const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
  const numericKeys = new Set([
    'waterOpacity', 'forestOpacity', 'landOpacity', 'landCoverOpacity',
    'roadOpacity', 'boundaryOpacity', 'buildingOpacity'
  ]);
  const detailColorFallbacks = Object.freeze({
    waterwayColor: 'waterColor',
    waterShadowColor: 'waterColor',
    parkColor: 'forestColor',
    natureReserveColor: 'forestColor',
    grassColor: 'forestColorAccent',
    woodColor: 'forestColor',
    residentialColor: 'landCoverColor',
    cemeteryColor: 'landCoverColorAccent',
    stadiumColor: 'landCoverColorAccent',
    roadCaseColor: 'landColor',
    motorwayColor: 'roadColor',
    motorwayCaseColor: 'roadCaseColor',
    trunkRoadColor: 'roadColor',
    primaryRoadColor: 'roadColor',
    secondaryRoadColor: 'roadColor',
    minorRoadColor: 'roadColor',
    serviceRoadColor: 'roadColor',
    pathColor: 'roadColor',
    railColor: 'roadColor',
    bridgeColor: 'roadColor',
    bridgeCaseColor: 'roadCaseColor',
    tunnelColor: 'roadColor',
    tunnelCaseColor: 'roadCaseColor',
    countryBoundaryColor: 'boundaryColor',
    stateBoundaryColor: 'boundaryColor',
    countyBoundaryColor: 'boundaryColor',
    buildingTopColor: 'buildingColor'
  });

  function completePreset(values) {
    const completed = { ...values };
    for (const [key, fallbackKey] of Object.entries(detailColorFallbacks)) {
      completed[key] = completed[key] || completed[fallbackKey];
    }
    const requiredKeys = [...global.CartivaLayerRegistry.controlIds, ...Object.keys(detailColorFallbacks)];
    const missingKeys = requiredKeys.filter(key => completed[key] === undefined);
    if (missingKeys.length) throw new Error(`Preset is missing required values: ${missingKeys.join(', ')}.`);
    return completed;
  }

  function validatePreset(id, values) {
    if (!values || typeof values !== 'object') throw new Error(`Preset ${id} is not an object.`);
    for (const [key, value] of Object.entries(values)) {
      if (key.toLowerCase().includes('color') && !COLOR_PATTERN.test(value)) {
        throw new Error(`Preset ${id} has invalid color ${key}.`);
      }
      if (numericKeys.has(key) && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100)) {
        throw new Error(`Preset ${id} has invalid opacity ${key}.`);
      }
    }
    return true;
  }

  function createService(catalog, presets) {
    const entries = new Map();
    catalog.forEach(entry => {
      if (!entry?.id || entries.has(entry.id)) throw new Error(`Invalid or duplicate preset id: ${entry?.id}`);
      const values = completePreset(presets[entry.id]);
      validatePreset(entry.id, values);
      entries.set(entry.id, Object.freeze({ ...entry, values: Object.freeze(values) }));
    });

    return Object.freeze({
      list: () => [...entries.values()],
      get: id => entries.get(id) || null,
      values: id => entries.get(id)?.values || null,
      validate: validatePreset,
      randomId: () => {
        const ids = [...entries.keys()];
        return ids[Math.floor(Math.random() * ids.length)];
      }
    });
  }

  global.CartivaPresets = Object.freeze({ create: createService, validate: validatePreset });
})(window);
