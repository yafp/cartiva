// External providers are configured in one place for easier replacement and testing.
(function attachServiceConfig(global) {
  global.CartivaServices = Object.freeze({
    geocoder: {
      searchEndpoint: 'https://nominatim.openstreetmap.org/search',
      reverseEndpoint: 'https://nominatim.openstreetmap.org/reverse',
      attribution: 'Geocoding by OpenStreetMap Nominatim',
      minIntervalMs: 1200
    },
    mapStyleUrl: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    maxExportZoom: 18,
    terrainTilesUrl: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors · © CARTO',
    geoJson: { maxFeatures: 5000, maxCoordinates: 250000 }
  });
})(window);
