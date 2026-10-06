// Project and GeoJSON actions.
/**
 * Restores saved project settings, map position, and location labels.
 * @function applyProjectState
 * @param {*} projectState - Input value.
 */
function applyProjectState(projectState) {
  cancelLocationUpdate();
  clearTimeout(runtimeState.timers.mapResize);
  const controlMap = {
    format: 'formatSelect', exportType: 'exportType', exportDpi: 'exportDpi', labelStyle: 'labelStyle',
    labelOpacity: 'labelOpacity', labelFont: 'labelFontSelect', labelTextColor: 'labelTextColor',
    labelCoordColor: 'labelCoordColor', labelCountryColor: 'labelCountryColor', labelBgColor: 'labelBgColor',
    textFilter: 'textFilter', contrast: 'contrastVal', brightness: 'brightnessVal',
    saturation: 'saturationVal', shape: 'shapeSelect', shapeColor: 'shapeColor', shapeScale: 'shapeScale',
    includeExportMetadata: 'includeExportMetadata', terrainEnabled: 'terrainToggle',
    mountainColor: 'mountainColor', terrainExaggeration: 'terrainExaggeration', buildingMinZoom: 'buildingMinZoom',
    scaleEnabled: 'scaleToggle', northEnabled: 'northToggle',
    borderEnabled: 'borderCheckbox', borderColor: 'borderColor', borderWidth: 'borderWidth',
    outerBorderRadius: 'outerBorderRadius', innerBorderRadius: 'innerBorderRadius',
    innerOutlineEnabled: 'innerOutlineEnabled', innerOutlineColor: 'innerOutlineColor', innerOutlineWidth: 'innerOutlineWidth',
    customWidthMm: 'customWidthMm', customHeightMm: 'customHeightMm', bleedMm: 'bleedMm',
    safeMm: 'safeMm', guidesEnabled: 'guidesToggle', exportQuality: 'exportQuality',
    printLineWeight: 'printLineWeight'
  };
  Object.entries(controlMap).forEach(([key, id]) => {
    if (Object.prototype.hasOwnProperty.call(projectState, key)) writeControl(id, projectState[key]);
  });
  if (Object.prototype.hasOwnProperty.call(projectState, 'buildingMinZoom')) {
    $('buildingMinZoomVal').textContent = String(Number(projectState.buildingMinZoom));
  }
  Object.entries(projectState.layers || {}).forEach(([key, value]) => {
    if ($(key)) writeControl(key, value);
  });
  state.layerOrder = [...FIXED_LAYER_ORDER];
  if (Object.prototype.hasOwnProperty.call(projectState, 'preset')) writeControl('colorPresetSelect', projectState.preset || '');
  $('customSizeControls').hidden = projectState.format !== 'custom';
  if (projectState.city) {
    $('cityName').textContent = projectState.city;
    $('searchInput').value = projectState.city;
  }
  if (projectState.coordinates) $('cityCoords').textContent = projectState.coordinates;
  if (projectState.country) $('cityCountry').textContent = projectState.country;
  if (Array.isArray(projectState.center) && Number.isFinite(projectState.zoom)) {
    locationSelectionInProgress = true;
    map.jumpTo({ center: projectState.center, zoom: projectState.zoom, bearing: projectState.bearing || 0, pitch: projectState.pitch || 0 });
  }
  syncStateFromControls();
  triggerAllLayerUpdates();
  renderPreview();
  locationSelectionInProgress = true;
  map.resize();
  locationSelectionInProgress = false;
  preserveLocationName();
  saveLastLocation();
}

/**
 * Handles project for the Cartiva application.
 * @function currentProject
 */
function currentProject() {
  syncStateFromControls();
  return CartivaProject.create(state);
}

const saveProjectBtn = $('saveProjectBtn');
const loadProjectBtn = $('loadProjectBtn');
const projectFileInput = $('projectFileInput');

saveProjectBtn?.addEventListener('click', async () => {
  await CartivaOperations.run({
    area: 'project.save', button: saveProjectBtn,
    startStatus: 'Saving project...', successStatus: 'Project JSON downloaded.', errorPrefix: 'Project save failed'
  }, async () => {
    const project = currentProject();
    const location = String(project.state.city || 'MAP_LOCATION').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'MAP_LOCATION';
    CartivaProject.download(project, `cartiva_${location}_${getFileTimestamp()}.json`);
    CartivaDiagnostics.record('project.save', 'Project saved as JSON.', { location: project.state.city, center: project.state.center });
  });
});

loadProjectBtn?.addEventListener('click', () => projectFileInput?.click());
projectFileInput?.addEventListener('change', async () => {
  const file = projectFileInput.files?.[0];
  if (!file) return;
  await CartivaOperations.run({
    area: 'project.load',
    button: loadProjectBtn,
    startStatus: 'Loading project...',
    successStatus: 'Project loaded.',
    errorPrefix: 'Project load failed'
  }, async cleanup => {
    cleanup(() => { projectFileInput.value = ''; });
    const project = await CartivaProject.readFile(file);
    applyProjectState(project.state);
    CartivaDiagnostics.record('project.load', 'Project restored from JSON.', { filename: file.name, location: project.state.city, center: project.state.center });
  });
});

$('geoJsonBtn')?.addEventListener('click', () => $('geoJsonInput')?.click());
$('geoJsonInput')?.addEventListener('change', async () => {
  const file = $('geoJsonInput').files?.[0];
  if (!file) return;
  await CartivaOperations.run({
    area: 'geojson.load',
    button: $('geoJsonBtn'),
    startStatus: 'Importing GeoJSON...',
    successStatus: 'GeoJSON overlay imported.',
    errorPrefix: 'GeoJSON import failed'
  }, async cleanup => {
    cleanup(() => { $('geoJsonInput').value = ''; });
    await CartivaGeoJson.load(file);
  });
});