// Map style knowledge is isolated here so renderer code does not own naming rules.
(function attachLayerRegistry(global) {
  const roleMap = Object.freeze({
    water: ['water', 'waterway'],
    forest: ['park', 'landcover', 'landuse'],
    land: ['background'],
    landCover: ['residential', 'commercial', 'industrial'],
    road: ['road', 'bridge', 'tunnel', 'railway', 'rail', 'transportation', 'aeroway'],
    boundary: ['boundary'],
    building: ['building']
  });
  const order = Object.freeze(['land', 'water', 'forest', 'landCover', 'terrain', 'road', 'boundary', 'building']);
  const definitions = Object.freeze([
    Object.freeze({ role: 'water', toggleId: 'waterToggle', colorId: 'waterColor', opacityId: 'waterOpacity', valueId: 'waterOpacityVal', featureKey: 'water', featureLimit: 4000, material: 'water' }),
    Object.freeze({ role: 'forest', toggleId: 'forestToggle', colorId: 'forestColor', accentColorId: 'forestColorAccent', opacityId: 'forestOpacity', valueId: 'forestOpacityVal', featureKey: 'forest', featureLimit: 4000, material: 'forest' }),
    Object.freeze({ role: 'land', toggleId: 'landToggle', colorId: 'landColor', opacityId: 'landOpacity', valueId: 'landOpacityVal', material: 'terrain' }),
    Object.freeze({ role: 'landCover', toggleId: 'landCoverToggle', colorId: 'landCoverColor', accentColorId: 'landCoverColorAccent', opacityId: 'landCoverOpacity', valueId: 'landCoverOpacityVal', featureKey: 'landCover', featureLimit: 4000, material: 'landCover' }),
    Object.freeze({ role: 'road', toggleId: 'roadToggle', colorId: 'roadColor', opacityId: 'roadOpacity', valueId: 'roadOpacityVal', featureKey: 'roads', featureLimit: 8000, material: 'road', modelToggle: 'includeRoads' }),
    Object.freeze({ role: 'boundary', toggleId: 'boundaryToggle', colorId: 'boundaryColor', opacityId: 'boundaryOpacity', valueId: 'boundaryOpacityVal', featureKey: 'boundary', featureLimit: 4000, material: 'boundary' }),
    Object.freeze({ role: 'building', toggleId: 'buildingToggle', colorId: 'buildingColor', opacityId: 'buildingOpacity', valueId: 'buildingOpacityVal', outlineToggleId: 'buildingOutlineToggle', outlineColorId: 'buildingOutlineColor', featureKey: 'buildings', featureLimit: 3000, material: 'building', modelToggle: 'includeBuildings' })
  ]);
  const controlIds = Object.freeze([...new Set(definitions.flatMap(definition => [
    definition.colorId,
    definition.accentColorId,
    definition.opacityId,
    definition.toggleId,
    definition.outlineToggleId,
    definition.outlineColorId
  ].filter(Boolean)))]);

  function getRole(layer) {
    const id = layer.id.toLowerCase();
    const sourceLayer = String(layer['source-layer'] || '').toLowerCase();
    for (const [role, names] of Object.entries(roleMap)) {
      if (names.some(name => id === name || id.startsWith(`${name}_`) || id.startsWith(`${name}-`) || sourceLayer === name)) {
        return role;
      }
    }
    return null;
  }

  function getUnsupportedLayers(layers) {
    return layers
      .filter(layer => ['background', 'fill', 'line'].includes(layer.type) && !getRole(layer))
      .map(layer => layer.id);
  }

  global.CartivaLayerRegistry = Object.freeze({
    roles: roleMap,
    order,
    definitions,
    controlIds,
    getRole,
    getUnsupportedLayers
  });
})(window);
