// Project, history, user preset, and GeoJSON actions.
function applyProjectState(projectState) {
  const controlMap = {
    format: 'formatSelect', exportType: 'exportType', exportDpi: 'exportDpi', labelStyle: 'labelStyle',
    labelOpacity: 'labelOpacity', labelFont: 'labelFontSelect', labelTextColor: 'labelTextColor',
    labelCoordColor: 'labelCoordColor', labelCountryColor: 'labelCountryColor', labelBgColor: 'labelBgColor',
    textFilter: 'textFilter', filterPreset: 'filterPreset', contrast: 'contrastVal', brightness: 'brightnessVal',
    saturation: 'saturationVal', shape: 'shapeSelect', shapeColor: 'shapeColor', terrainEnabled: 'terrainToggle',
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
const savePresetBtn = $('savePresetBtn');
const loadPresetBtn = $('loadPresetBtn');
const projectFileInput = $('projectFileInput');

$('undoBtn')?.addEventListener('click', () => {
  const history = runtimeState.history;
  if (!history.past.length) return;
  history.future.push(JSON.parse(history.snapshot));
  const snapshot = history.past.pop();
  history.applying = true;
  applyProjectState(snapshot);
  history.applying = false;
  history.snapshot = JSON.stringify(state);
  updateHistoryButtons();
});

$('redoBtn')?.addEventListener('click', () => {
  const history = runtimeState.history;
  if (!history.future.length) return;
  history.past.push(JSON.parse(history.snapshot));
  const snapshot = history.future.pop();
  history.applying = true;
  applyProjectState(snapshot);
  history.applying = false;
  history.snapshot = JSON.stringify(state);
  updateHistoryButtons();
});

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

savePresetBtn?.addEventListener('click', () => {
  const name = window.prompt('Preset name');
  if (!name?.trim()) return;
  CartivaProject.savePreset(name.trim(), currentProject().state);
  setStatus(`Preset saved: ${name.trim()}`);
});

loadPresetBtn?.addEventListener('click', () => {
  const presets = CartivaProject.listPresets();
  if (!presets.length) { setStatus('No saved user presets.', true); return; }
  const name = window.prompt(`Preset name:\n${presets.map(item => item.name).join('\n')}`);
  const preset = presets.find(item => item.name === name);
  if (!preset) { setStatus('Preset not found.', true); return; }
  applyProjectState(preset.state);
  setStatus(`Preset loaded: ${name}`);
});

updateHistoryButtons();
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