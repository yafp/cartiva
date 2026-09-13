// User GeoJSON overlay import and export definition.
(function attachGeoJson(global) {
  const SOURCE_ID = 'cartiva-user-geojson';
  const FILL_ID = `${SOURCE_ID}-fill`;
  const LINE_ID = `${SOURCE_ID}-line`;
  let data = null;

  function countCoordinates(value) {
    if (!Array.isArray(value)) return 0;
    if (typeof value[0] === 'number') return 1;
    return value.reduce((total, child) => total + countCoordinates(child), 0);
  }

  function validate(input) {
    const featureCollection = input?.type === 'FeatureCollection'
      ? input
      : input?.type === 'Feature'
        ? { type: 'FeatureCollection', features: [input] }
        : null;
    if (!featureCollection) throw new Error('GeoJSON must be a Feature or FeatureCollection.');
    if (featureCollection.features.length > Number(global.CartivaServices.geoJson.maxFeatures)) {
      throw new Error('GeoJSON contains too many features.');
    }
    const coordinates = featureCollection.features.reduce(
      (total, feature) => total + countCoordinates(feature.geometry?.coordinates),
      0
    );
    if (coordinates > Number(global.CartivaServices.geoJson.maxCoordinates)) {
      throw new Error('GeoJSON contains too many coordinates.');
    }
    return featureCollection;
  }

  function addToMap(targetMap) {
    if (!data || !targetMap?.isStyleLoaded()) return;
    if (targetMap.getLayer(FILL_ID)) targetMap.removeLayer(FILL_ID);
    if (targetMap.getLayer(LINE_ID)) targetMap.removeLayer(LINE_ID);
    if (targetMap.getSource(SOURCE_ID)) targetMap.removeSource(SOURCE_ID);
    targetMap.addSource(SOURCE_ID, { type: 'geojson', data });
    targetMap.addLayer({ id: FILL_ID, type: 'fill', source: SOURCE_ID, paint: { 'fill-color': '#059669', 'fill-opacity': 0.16 } });
    targetMap.addLayer({ id: LINE_ID, type: 'line', source: SOURCE_ID, paint: { 'line-color': '#047857', 'line-width': 2, 'line-opacity': 0.9 } });
  }

  function fitMap(targetMap) {
    const coordinates = [];
    const collect = value => {
      if (Array.isArray(value) && typeof value[0] === 'number') coordinates.push(value);
      else if (Array.isArray(value)) value.forEach(collect);
    };
    data?.features?.forEach(feature => collect(feature.geometry?.coordinates));
    if (!coordinates.length || !targetMap) return;
    const bounds = coordinates.reduce((result, coordinate) => result.extend(coordinate), new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));
    targetMap.fitBounds(bounds, { padding: 40, maxZoom: 14, duration: 500 });
  }

  async function load(file, targetMap = global.CartivaMap) {
    global.CartivaDiagnostics?.record('geojson', 'GeoJSON import started.', { filename: file.name, bytes: file.size });
    const parsed = validate(JSON.parse(await file.text()));
    data = parsed;
    addToMap(targetMap);
    fitMap(targetMap);
    global.CartivaDiagnostics?.record('geojson', 'GeoJSON import completed.', { filename: file.name, features: data.features.length });
    return data;
  }

  global.CartivaGeoJson = Object.freeze({
    load,
    addToMap,
    getData: () => data,
    sourceId: SOURCE_ID,
    definition: () => data ? { source: { type: 'geojson', data }, layers: [
      { id: FILL_ID, type: 'fill', source: SOURCE_ID, paint: { 'fill-color': '#059669', 'fill-opacity': 0.16 } },
      { id: LINE_ID, type: 'line', source: SOURCE_ID, paint: { 'line-color': '#047857', 'line-width': 2, 'line-opacity': 0.9 } }
    ] } : null
  });
})(window);
