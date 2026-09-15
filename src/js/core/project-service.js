// Versioned project persistence. Only plain data crosses this boundary.
(function attachProjectService(global) {
  const VERSION = 2;
  const STORAGE_KEY = 'cartiva.project.v2';
  const PERSISTED_KEYS = Object.freeze([
    'preset', 'labelStyle', 'labelOpacity', 'labelFont', 'labelTextColor', 'labelCoordColor',
    'labelCountryColor', 'labelBgColor', 'textFilter', 'format', 'customWidthMm',
    'customHeightMm', 'bleedMm', 'safeMm', 'guidesEnabled', 'exportQuality',
    'printLineWeight', 'exportType', 'exportDpi', 'contrast', 'brightness',
    'saturation', 'shape', 'shapeColor', 'terrainEnabled', 'mountainColor',
    'terrainExaggeration', 'stlBuildingsEnabled', 'stlRoadsEnabled', 'scaleEnabled',
    'northEnabled', 'borderEnabled', 'borderColor', 'borderWidth', 'outerBorderRadius',
    'innerBorderRadius', 'layerOrder', 'center', 'zoom', 'bearing', 'pitch', 'city',
    'coordinates', 'country', 'layers'
  ]);

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isHex(value) { return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value); }
  function numberInRange(value, fallback, minimum, maximum) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
  }

  function migrate(input) {
    const source = input?.state && typeof input.state === 'object' ? input.state : input;
    const migrated = clone(source || {});
    if (!migrated.schemaVersion) migrated.schemaVersion = 1;
    if (!Array.isArray(migrated.layerOrder)) migrated.layerOrder = ['land', 'water', 'forest', 'landCover', 'terrain', 'road', 'boundary', 'building'];
    migrated.schemaVersion = VERSION;
    return migrated;
  }

  function normalizeProject(input) {
    if (!input || typeof input !== 'object') throw new Error('Project data must be an object.');
    const source = migrate(input);
    if (!source.layers || typeof source.layers !== 'object') throw new Error('Project data is missing layer settings.');
    const persistentState = Object.fromEntries(PERSISTED_KEYS
      .filter(key => Object.prototype.hasOwnProperty.call(source, key))
      .map(key => [key, clone(source[key])]));
    persistentState.schemaVersion = VERSION;
    persistentState.layerOrder = ['land', 'water', 'forest', 'landCover', 'terrain', 'road', 'boundary', 'building'];
    const project = {
      schemaVersion: VERSION,
      savedAt: input.savedAt || new Date().toISOString(),
      appVersion: input.appVersion || global.CartivaApp?.version || 'unknown',
      state: persistentState
    };
    project.state.exportDpi = numberInRange(project.state.exportDpi, 300, 72, 600);
    project.state.contrast = numberInRange(project.state.contrast, 100, 50, 250);
    project.state.brightness = numberInRange(project.state.brightness, 100, 50, 150);
    project.state.saturation = numberInRange(project.state.saturation, 100, 0, 200);
    project.state.layers = Object.fromEntries(Object.entries(project.state.layers).map(([key, value]) => {
      if (/Color/i.test(key) && !isHex(value)) return [key, undefined];
      if (/Opacity/i.test(key)) return [key, numberInRange(value, 100, 0, 100)];
      return [key, value];
    }).filter(([, value]) => value !== undefined));
    return project;
  }

  function createProject(state) {
    return normalizeProject({ schemaVersion: VERSION, appVersion: global.CartivaApp?.version, state });
  }

  function save(project) {
    const normalized = normalizeProject(project);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    } catch (error) {
      throw new Error(`Project could not be saved: ${error.message}`);
    }
    global.CartivaDiagnostics?.record('project.save', 'Project saved to browser storage.', { schemaVersion: normalized.schemaVersion });
    return normalized;
  }

  function load() {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('cartiva.project.v1');
    return raw ? normalizeProject(JSON.parse(raw)) : null;
  }

  function download(project, filename = 'cartiva-project.json') {
    const blob = new Blob([JSON.stringify(normalizeProject(project), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    global.CartivaDiagnostics?.record('project.download', 'Project download created.', { filename, bytes: blob.size });
  }

  function readFile(file) {
    return file.text().then(text => normalizeProject(JSON.parse(text)));
  }

  global.CartivaProject = Object.freeze({
    VERSION, STORAGE_KEY, create: createProject, normalize: normalizeProject,
    save, load, download, readFile
  });
})(window);
