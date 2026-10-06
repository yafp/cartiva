// Versioned project persistence. Only plain data crosses this boundary.
(function attachProjectService(global) {
  const VERSION = 2;
  const PERSISTED_KEYS = Object.freeze([
    'preset', 'labelStyle', 'labelOpacity', 'labelFont', 'labelTextColor', 'labelCoordColor',
    'labelCountryColor', 'labelBgColor', 'textFilter', 'format', 'customWidthMm',
    'customHeightMm', 'bleedMm', 'safeMm', 'guidesEnabled', 'exportQuality',
    'printLineWeight', 'exportType', 'exportDpi', 'contrast', 'brightness',
    'saturation', 'shape', 'shapeColor', 'shapeScale', 'includeExportMetadata', 'terrainEnabled', 'mountainColor',
    'terrainExaggeration', 'buildingMinZoom', 'scaleEnabled',
    'northEnabled', 'borderEnabled', 'borderColor', 'borderWidth', 'outerBorderRadius',
    'innerBorderRadius', 'layerOrder', 'center', 'zoom', 'bearing', 'pitch', 'city',
    'innerOutlineEnabled', 'innerOutlineColor', 'innerOutlineWidth',
    'coordinates', 'country', 'layers'
  ]);

  /**
   * Clones clone for the Cartiva application.
   * @function clone
   * @param {*} value - Input value.
   */
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /**
   * Determines whether hex is true.
   * @function isHex
   * @param {*} value - Input value.
   */
  function isHex(value) { return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value); }
  /**
   * Handles in range for the Cartiva application.
   * @function numberInRange
   * @param {*} value - Input value.
   * @param {*} fallback - Input value.
   * @param {*} minimum - Input value.
   * @param {*} maximum - Input value.
   */
  function numberInRange(value, fallback, minimum, maximum) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
  }

  /**
   * Migrates migrate for the Cartiva application.
   * @function migrate
   * @param {*} input - Input value.
   */
  function migrate(input) {
    const source = input?.state && typeof input.state === 'object' ? input.state : input;
    const migrated = clone(source || {});
    if (!migrated.schemaVersion) migrated.schemaVersion = 1;
    if (!Array.isArray(migrated.layerOrder)) migrated.layerOrder = ['land', 'water', 'forest', 'landCover', 'terrain', 'road', 'boundary', 'building'];
    migrated.schemaVersion = VERSION;
    return migrated;
  }

  /**
   * Normalizes project for the Cartiva application.
   * @function normalizeProject
   * @param {*} input - Input value.
   */
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
    project.state.innerOutlineEnabled = project.state.innerOutlineEnabled === true;
    project.state.innerOutlineColor = isHex(project.state.innerOutlineColor) ? project.state.innerOutlineColor : '#000000';
    project.state.innerOutlineWidth = numberInRange(project.state.innerOutlineWidth, 1, 0.5, 8);
    if (['peace', 'hexagon', 'spiral', 'smiley'].includes(project.state.shape)) project.state.shape = 'none';
    project.state.layers = Object.fromEntries(Object.entries(project.state.layers).map(([key, value]) => {
      if (/Color/i.test(key) && !isHex(value)) return [key, undefined];
      if (/Opacity/i.test(key)) return [key, numberInRange(value, 100, 0, 100)];
      return [key, value];
    }).filter(([, value]) => value !== undefined));
    return project;
  }

  /**
   * Creates project for the Cartiva application.
   * @function createProject
   * @param {*} state - Input value.
   */
  function createProject(state) {
    return normalizeProject({ schemaVersion: VERSION, appVersion: global.CartivaApp?.version, state });
  }

  /**
   * Downloads download for the Cartiva application.
   * @function download
   * @param {*} project - Input value.
   * @param {*} filename - Input value.
   */
  function download(project, filename = 'cartiva-project.json') {
    const blob = new Blob([JSON.stringify(normalizeProject(project), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    global.CartivaDiagnostics?.record('project.download', 'Project download created.', { filename, bytes: blob.size });
  }

  /**
   * Returns information about file for the Cartiva application.
   * @function readFile
   * @param {*} file - Input value.
   */
  function readFile(file) {
    return file.text().then(text => normalizeProject(JSON.parse(text)));
  }

  global.CartivaProject = Object.freeze({
    VERSION, create: createProject, normalize: normalizeProject,
    download, readFile
  });
})(window);
