// Project and GeoJSON actions.
function applyProjectState(projectState) {
  const controlMap = {
    format: 'formatSelect', exportType: 'exportType', exportDpi: 'exportDpi', labelStyle: 'labelStyle',
    labelOpacity: 'labelOpacity', labelFont: 'labelFontSelect', labelTextColor: 'labelTextColor',
    labelCoordColor: 'labelCoordColor', labelCountryColor: 'labelCountryColor', labelBgColor: 'labelBgColor',
    textFilter: 'textFilter', contrast: 'contrastVal', brightness: 'brightnessVal',
    saturation: 'saturationVal', shape: 'shapeSelect', shapeColor: 'shapeColor', shapeScale: 'shapeScale',
    includeExportMetadata: 'includeExportMetadata', terrainEnabled: 'terrainToggle',
    mountainColor: 'mountainColor', terrainExaggeration: 'terrainExaggeration', stlBuildingsEnabled: 'stlBuildingsToggle',
    stlRoadsEnabled: 'stlRoadsToggle', scaleEnabled: 'scaleToggle', northEnabled: 'northToggle',
    borderEnabled: 'borderCheckbox', borderColor: 'borderColor', borderWidth: 'borderWidth',
    outerBorderRadius: 'outerBorderRadius', innerBorderRadius: 'innerBorderRadius',
    customWidthMm: 'customWidthMm', customHeightMm: 'customHeightMm', bleedMm: 'bleedMm',
    safeMm: 'safeMm', guidesEnabled: 'guidesToggle', exportQuality: 'exportQuality',
    printLineWeight: 'printLineWeight'
  };
  Object.entries(controlMap).forEach(([key, id]) => {
    if (Object.prototype.hasOwnProperty.call(projectState, key)) writeControl(id, projectState[key]);
  });
  Object.entries(projectState.layers || {}).forEach(([key, value]) => {
    if ($(key)) writeControl(key, value);
  });
  state.layerOrder = [...FIXED_LAYER_ORDER];
  if (Object.prototype.hasOwnProperty.call(projectState, 'preset')) state.preset = projectState.preset;
  if (projectState.city) $('cityName').textContent = projectState.city;
  if (projectState.coordinates) $('cityCoords').textContent = projectState.coordinates;
  if (projectState.country) $('cityCountry').textContent = projectState.country;
  if (Array.isArray(projectState.center) && Number.isFinite(projectState.zoom)) {
    map.jumpTo({ center: projectState.center, zoom: projectState.zoom, bearing: projectState.bearing || 0, pitch: projectState.pitch || 0 });
  }
  syncStateFromControls();
  triggerAllLayerUpdates();
  renderPreview();
}

function currentProject() {
  syncStateFromControls();
  return CartivaProject.create(state);
}

const saveProjectBtn = $('saveProjectBtn');
const downloadProjectBtn = $('downloadProjectBtn');
const loadProjectBtn = $('loadProjectBtn');
const projectFileInput = $('projectFileInput');

saveProjectBtn?.addEventListener('click', () => {
  CartivaProject.save(currentProject());
  setStatus('Project saved in this browser.');
});

downloadProjectBtn?.addEventListener('click', () => {
  CartivaProject.download(currentProject(), `cartiva_${getFileTimestamp()}.json`);
  setStatus('Project JSON downloaded.');
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