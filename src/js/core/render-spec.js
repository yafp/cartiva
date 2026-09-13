// Immutable render input shared by preview, image, and 3D renderers.
(function attachRenderSpec(global) {
  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function create(projectState, runtime = {}) {
    const source = clone(projectState);
    const layers = Object.freeze({ ...(source.layers || {}) });
    const camera = runtime.camera || {
      center: source.center,
      zoom: source.zoom,
      bearing: source.bearing || 0,
      pitch: source.pitch || 0
    };
    const modelMaterials = Object.freeze({
      terrain: source.terrainEnabled ? source.mountainColor : layers.landColor,
      forest: layers.forestColor,
      landCover: layers.landCoverColor,
      boundary: layers.boundaryColor,
      building: layers.buildingColor,
      road: layers.roadColor,
      water: layers.waterColor
    });
    return Object.freeze({
      ...source,
      layerOrder: [...global.CartivaLayerRegistry.order],
      layers,
      center: clone(camera.center),
      zoom: camera.zoom,
      bearing: camera.bearing,
      pitch: camera.pitch,
      bounds: clone(runtime.bounds ?? source.bounds ?? null),
      dimensions: runtime.dimensions ? Object.freeze({ ...runtime.dimensions }) : null,
      previewMapSize: runtime.previewMapSize ? Object.freeze({ ...runtime.previewMapSize }) : null,
      overlay: clone(runtime.overlay ?? source.overlay ?? null),
      model: Object.freeze({
        includeBuildings: source.stlBuildingsEnabled !== false,
        includeRoads: source.stlRoadsEnabled !== false,
        materials: modelMaterials
      })
    });
  }

  global.CartivaRenderSpec = Object.freeze({ create });
})(window);