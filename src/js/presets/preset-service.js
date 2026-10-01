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

  /** Groups forest colors into neutral and hue families, then orders their lightness. */
  function forestColorKey(hex) {
    const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
    const [red, green, blue] = channels;
    const maximum = Math.max(...channels), minimum = Math.min(...channels);
    const chroma = maximum - minimum;
    const lightness = (maximum + minimum) / 2;
    if (chroma < 0.08) return [0, lightness, 0];
    const hue = ((maximum === red ? (green - blue) / chroma : maximum === green ? 2 + (blue - red) / chroma : 4 + (red - green) / chroma) * 60 + 360) % 360;
    const family = hue < 65 ? 1 : hue < 170 ? 2 : hue < 260 ? 3 : hue < 330 ? 4 : 5;
    return [family, lightness, hue];
  }

  /** Sorts catalog entries by their actual forest colors without changing preset IDs. */
  function compareForestColors(left, right) {
    const leftKey = forestColorKey(left.values.forestColor);
    const rightKey = forestColorKey(right.values.forestColor);
    for (let index = 0; index < leftKey.length; index += 1) {
      if (leftKey[index] !== rightKey[index]) return leftKey[index] - rightKey[index];
    }
    return left.name.localeCompare(right.name);
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
      list: () => [...entries.values()].sort(compareForestColors),
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
