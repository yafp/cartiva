// STL and 3MF export orchestration. Geometry helpers live in the export engine.
function getVisibleCityFeatures(renderSpec) {
  const layers = map.getStyle().layers || [];
  const collect = role => {
    const layerIds = layers.filter(layer => getLayerRole(layer) === role && ['fill', 'line'].includes(layer.type)).map(layer => layer.id);
    if (!layerIds.length) return [];
    const seen = new Set();
    return map.queryRenderedFeatures({ layers: layerIds }).filter(feature => {
      const key = `${feature.source || ''}:${feature.sourceLayer || ''}:${feature.id ?? JSON.stringify(feature.geometry)}`;
      if (seen.has(key) || !feature.geometry?.coordinates) return false;
      seen.add(key);
      return true;
    });
  };
  return Object.fromEntries(CartivaLayerRegistry.definitions
    .filter(definition => definition.featureKey)
    .map(definition => {
      const layerEnabled = renderSpec.layers[definition.toggleId] !== false;
      const modelEnabled = !definition.modelToggle || renderSpec.model[definition.modelToggle];
      const features = layerEnabled && modelEnabled
        ? collect(definition.role).slice(0, definition.featureLimit)
        : [];
      return [definition.featureKey, features];
    }));
}

$('stlExportBtn').addEventListener('click', () => {
  const button = $('stlExportBtn');
  return CartivaOperations.run({
    area: 'stl.export',
    button,
    startStatus: 'Loading elevation data for 3D model...',
    successStatus: '3D model exported.',
    errorPrefix: '3D model export failed'
  }, async () => {
    const renderSpec = createRenderSnapshot();
    const bounds = map.getBounds();
    const cityFeatures = getVisibleCityFeatures(renderSpec);
    CartivaDiagnostics.record('stl.export', 'STL features collected.', { featureCounts: Object.fromEntries(Object.entries(cityFeatures).map(([role, features]) => [role, features.length])) });
    const grid = await getElevationGrid(bounds);
    const mesh = rotateMeshToMapBearing(
      createTerrainMesh(grid.heights, grid.size, bounds, renderSpec.terrainExaggeration, cityFeatures),
      renderSpec.bearing
    );
    const model = createTerrainStl(mesh, renderSpec.model.materials);
    CartivaDiagnostics.record('stl.export', 'STL mesh generated.', { triangles: mesh.triangleMaterials.length });
    const name = `cartiva_${renderSpec.city.trim().replace(/\s+/g, '_')}_${getFileTimestamp()}.stl`;
    downloadBlob(model, name);
    downloadExportMetadata(renderSpec, name.replace(/\.stl$/, ''));
  });
});

$('threeMfExportBtn').addEventListener('click', () => {
  const button = $('threeMfExportBtn');
  return CartivaOperations.run({
    area: '3mf.export',
    button,
    startStatus: 'Loading elevation data for colored 3D model...',
    successStatus: 'Colored 3D model exported.',
    errorPrefix: 'Colored 3D model export failed'
  }, async () => {
    const renderSpec = createRenderSnapshot();
    const bounds = map.getBounds();
    const cityFeatures = getVisibleCityFeatures(renderSpec);
    CartivaDiagnostics.record('3mf.export', '3MF features collected.', { featureCounts: Object.fromEntries(Object.entries(cityFeatures).map(([role, features]) => [role, features.length])) });
    const grid = await getElevationGrid(bounds);
    const mesh = rotateMeshToMapBearing(
      createTerrainMesh(grid.heights, grid.size, bounds, renderSpec.terrainExaggeration, cityFeatures),
      renderSpec.bearing
    );
    const model = createColoredThreeMf(mesh, renderSpec.model.materials);
    CartivaDiagnostics.record('3mf.export', '3MF mesh generated.', { triangles: mesh.triangleMaterials.length });
    const name = `cartiva_${renderSpec.city.trim().replace(/\s+/g, '_')}_${getFileTimestamp()}.3mf`;
    downloadBlob(model, name);
    downloadExportMetadata(renderSpec, name.replace(/\.3mf$/, ''));
  });
});