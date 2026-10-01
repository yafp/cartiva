/** Runs focused regressions against an initialized cartiva window without a build tool. */
async function runCartivaRegressionTests(app) {
  const results = [];
  const document = app.document;
  /** Fails a regression with an actionable description. */
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  /** Collects failures while allowing independent regressions to finish. */
  const test = async (name, action) => {
    try { await action(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: error.message }); }
  };
  /** Dispatches the same state transition used by interactive controls. */
  const change = (id, value) => {
    const control = document.getElementById(id);
    if (control.type === 'checkbox') control.checked = value;
    else control.value = value;
    control.dispatchEvent(new app.Event(control.type === 'range' ? 'input' : 'change', { bubbles: true }));
  };
  const original = app.currentProject();
  app.CartivaRefinedPreview.hide();

  await test('Relief slider stays inside MapLibre 0..1', () => {
    let actual;
    const target = { getSource: () => true, getLayer: () => true, setPaintProperty: (id, key, value) => {
      if (key === 'hillshade-exaggeration') actual = value;
    } };
    for (const strength of [20, 100, 180, 183, 300, 900, -1, NaN]) {
      app.configureTerrain(target, { mountainColor: '#64748b', terrainEnabled: true, terrainExaggeration: strength });
      assert(actual >= 0 && actual <= 1, `Invalid relief at ${strength}`);
    }
    app.configureTerrain(target, { mountainColor: '#64748b', terrainEnabled: false, terrainExaggeration: 300 });
    assert(actual === 0, 'Disabled relief must be zero');
  });

  await test('About opens, closes on Escape/X and restores focus', () => {
    const trigger = document.getElementById('aboutBtn');
    const dialog = document.getElementById('aboutDialog');
    trigger.focus(); trigger.click();
    assert(dialog.open, 'About did not open');
    assert(document.getElementById('aboutVersion').textContent === app.CartivaApp.version, 'Version mismatch');
    dialog.dispatchEvent(new app.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert(!dialog.open && document.activeElement === trigger, 'Escape or focus restoration failed');
    trigger.click(); document.getElementById('aboutCloseBtn').click();
    assert(!dialog.open, 'Close button failed');
  });

  await test('Transparent labels do not blur the map', () => {
    change('labelOpacity', 0);
    const style = app.getComputedStyle(document.getElementById('mapLabelOverlay'));
    assert(style.backdropFilter === 'none', 'Label backdrop is still blurred');
    assert(style.backgroundColor === 'rgba(0, 0, 0, 0)' || style.backgroundColor.endsWith(', 0)'), 'Label is not transparent');
  });

  await test('Inner outline follows radius and stays inside the map', () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 50;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const spec = { borderEnabled: true, innerOutlineEnabled: true, innerOutlineWidth: 2, innerOutlineColor: '#000000', innerBorderRadius: 8 };
    app.drawInnerBorderOutline(context, spec, 0, 0, 50, 50, 1);
    assert(context.getImageData(25, 0, 1, 1).data[3] === 255, 'Top outline missing');
    assert(context.getImageData(25, 3, 1, 1).data[3] === 0, 'Outline too thick');
    assert(context.getImageData(0, 0, 1, 1).data[3] === 0, 'Rounded corner filled');
    context.clearRect(0, 0, 50, 50);
    app.drawInnerBorderOutline(context, { ...spec, borderEnabled: false }, 0, 0, 50, 50, 1);
    assert(context.getImageData(25, 0, 1, 1).data[3] === 0, 'Disabled border still outlined');
    change('innerOutlineEnabled', true); change('innerOutlineWidth', 2);
    assert(document.getElementById('innerBorderOutline').style.borderWidth === '2px', 'Preview outline not updated');
  });

  await test('Project migration, location, outline and preset round-trip', () => {
    const project = app.CartivaProject.create({ ...original.state, city: 'HAMBURG', shape: 'peace', innerOutlineEnabled: true, innerOutlineWidth: 2, innerOutlineColor: '#123456' });
    const loaded = app.CartivaProject.normalize(JSON.parse(JSON.stringify(project)));
    assert(loaded.state.city === 'HAMBURG' && loaded.state.shape === 'none', 'Location or obsolete shape migration failed');
    app.applyProjectState(loaded.state);
    const saved = app.currentProject();
    assert(saved.state.innerOutlineColor === '#123456' && saved.state.innerOutlineWidth === 2, 'Outline was not persisted');
    assert(saved.state.preset === original.state.preset, 'Preset was lost on load');
    assert(!app.CartivaProject.save && !app.CartivaProject.load, 'Obsolete browser storage actions remain');
  });

  await test('Project filename and save/load logs include the location', async () => {
    const anchorPrototype = app.HTMLAnchorElement.prototype;
    const previousClick = anchorPrototype.click;
    let filename;
    anchorPrototype.click = function captureDownload() { filename = this.download; };
    try {
      document.getElementById('saveProjectBtn').click();
      await new Promise(resolve => setTimeout(resolve, 0));
      assert(/^cartiva_HAMBURG_\d{8}_\d{6}\.json$/.test(filename), `Unexpected filename: ${filename}`);
      const file = new app.File([JSON.stringify(app.currentProject())], 'hamburg.json', { type: 'application/json' });
      const transfer = new app.DataTransfer(); transfer.items.add(file);
      document.getElementById('projectFileInput').files = transfer.files;
      document.getElementById('projectFileInput').dispatchEvent(new app.Event('change', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 100));
      const logs = app.CartivaDiagnostics.list();
      assert(logs.some(entry => entry.area === 'project.save' && entry.details?.location === 'HAMBURG'), 'Save log missing location');
      assert(logs.some(entry => entry.area === 'project.load' && entry.details?.filename === 'hamburg.json'), 'Load log missing filename');
    } finally { anchorPrototype.click = previousClick; }
  });

  await test('Preset forest colors form contiguous color families', () => {
    const presets = app.CartivaPresets.create(app.CartivaPresetCatalog, app.CartivaPresetData).list();
    /** Mirrors the documented neutral/brown/green/blue/purple/red family boundaries. */
    const family = hex => {
      const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
      const [red, green, blue] = channels;
      const maximum = Math.max(...channels), chroma = maximum - Math.min(...channels);
      if (chroma < 0.08) return 0;
      const hue = ((maximum === red ? (green - blue) / chroma : maximum === green ? 2 + (blue - red) / chroma : 4 + (red - green) / chroma) * 60 + 360) % 360;
      return hue < 65 ? 1 : hue < 170 ? 2 : hue < 260 ? 3 : hue < 330 ? 4 : 5;
    };
    const families = presets.map(preset => family(preset.values.forestColor));
    assert(families.every((value, index) => !index || value >= families[index - 1]), 'Color families are interleaved');
    assert(document.getElementById('colorPresetSelect').options.length === presets.length, 'Presets lost');
    document.getElementById('fineTuningToggle').click();
    document.getElementById('fineTuningToggle').click();
    assert(document.getElementById('fineTuningToggle').querySelector('svg'), 'Cog removed by toggle');
  });

  await test('Removed shapes and live external coordinates', () => {
    const values = [...document.getElementById('shapeSelect').options].map(option => option.value);
    assert(!['peace', 'hexagon', 'spiral', 'smiley'].some(value => values.includes(value)), 'Removed shape still selectable');
    app.CartivaMap.jumpTo({ center: [-0.1276, 51.5074] });
    const link = document.getElementById('googleMapsLink');
    assert(new URL(link.href).searchParams.get('query') === '51.507400,-0.127600', 'Coordinates reversed or stale');
    assert(link.target === '_blank' && link.rel.includes('noopener'), 'External link not isolated');
  });

  await test('Refined rendering preserves city zoom limits and text size', () => {
    const style = { version: 8, sources: {}, layers: [{ id: 'city', type: 'symbol', minzoom: 8, maxzoom: 15, layout: { 'text-field': '{name}', 'text-size': { stops: [[10, 16], [13, 19]] } } }] };
    const scaled = app.createScaledMapStyle(style, 4).layers[0];
    assert(scaled.maxzoom === 17 && scaled.layout['text-size'].stops[0][1] === 64, 'City label not preserved');
    assert(style.layers[0].maxzoom === 15, 'Live style mutated');
    const expression = app.shiftStyleZoom(['interpolate', ['linear'], ['zoom'], 10, 12, 14, 20], 2, 4);
    assert(expression[0] === 'interpolate' && expression[3] === 12, 'Camera expression no longer at top level');
  });

  await test('600 DPI output limits and rotated tile coordinates', () => {
    for (const [width, height] of [[4960, 7016], [9922, 14032], [9922, 9922]]) app.validateExportSize(width, height);
    let rejected = false;
    try { app.validateExportSize(24000, 24000); } catch { rejected = true; }
    assert(rejected, 'Unsafe final canvas accepted');
    const spec = { center: [9.9937, 53.5511], zoom: 12, bearing: 0, previewMapSize: { width: 500 } };
    const center = app.getExportTileCenter(spec, 19272, 19272, 9636, 9636);
    assert(Math.abs(center[0] - spec.center[0]) < 1e-8, 'Tile center shifted');
    const north = app.getExportTileCenter({ ...spec, bearing: 90 }, 19272, 19272, 9636, 9000);
    assert(north[0] > spec.center[0], 'Rotated tile projection mirrored');
  });

  await test('Raw WebGL uploads clear flags and restore state on errors', () => {
    const flags = new Map([[1, true], [2, true]]);
    let actual;
    const context = { UNPACK_FLIP_Y_WEBGL: 1, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 2,
      getParameter: key => flags.get(key), pixelStorei: (key, value) => flags.set(key, value),
      texImage2D: (...args) => { actual = [...flags.values()]; if (args[0] === 'fail') throw Error('upload'); },
      texSubImage2D: () => { actual = [...flags.values()]; } };
    app.CartivaWebGl.prepareContext(context);
    context.texImage2D(0, 0, 0, 1, 1, 0, 0, 0, new Uint8Array(4));
    assert(!actual.some(Boolean) && [...flags.values()].every(Boolean), 'Raw unpack flags not restored');
    context.texImage2D(0, 0, 0, 0, 0, {});
    assert(actual.every(Boolean), 'DOM upload changed');
    try { context.texImage2D('fail', 0, 0, 1, 1, 0, 0, 0, null); } catch { /* Expected upload failure. */ }
    assert([...flags.values()].every(Boolean), 'Error left GL state changed');
  });

  await test('Oversized intermediate renders use bounded tiles and clean up failures', async () => {
    const previousCreate = app.createExportMap, previousIdle = app.waitForMapIdle, previousTerrain = app.updateTerrainColorization;
    let draws = 0, removed = 0, mapCount = 0;
    app.waitForMapIdle = async () => {};
    app.updateTerrainColorization = async () => {};
    app.createExportMap = async (width, height) => {
      assert(width <= 4096 && height <= 4096, 'GPU canvas exceeds tile budget');
      mapCount += 1;
      return { exportMap: { getCanvas: () => ({}), resize: () => {}, jumpTo: () => {}, remove: () => { removed += 1; } }, container: { style: {}, remove: () => {} } };
    };
    const spec = { center: [9.9937, 53.5511], zoom: 12, bearing: 0, pitch: 0, previewMapSize: { width: 500 } };
    try {
      await app.drawExportMap({ drawImage: () => { draws += 1; } }, spec, 19272, 19272, 0, 0, 9922, 9922);
      assert(draws === 100 && mapCount === 1 && removed === 1, 'Tiling count or cleanup incorrect');
      try { await app.drawExportMap({ drawImage: () => { throw Error('compositing failure'); } }, spec, 5000, 5000, 0, 0, 2500, 2500); } catch { /* Expected compositor failure. */ }
      assert(removed === 2, 'Failed compositor leaked its map');
    } finally {
      app.createExportMap = previousCreate; app.waitForMapIdle = previousIdle; app.updateTerrainColorization = previousTerrain;
    }
  });

  await test('Physical terrain scale, north orientation and flat water', async () => {
    const bounds = { getWest: () => 9.9, getEast: () => 10.1, getNorth: () => 53.6, getSouth: () => 53.5 };
    const heights = Array.from({ length: 81 }, (_, index) => index % 7);
    const bare = app.createTerrainMesh(heights, 9, bounds, 100, {});
    assert(Math.max(...bare.triangles.map(vertex => vertex[2])) < 2.1, 'Lowland heights overstretched');
    const water = { geometry: { type: 'Polygon', coordinates: [[[9.9, 53.5], [10.1, 53.5], [10.1, 53.6], [9.9, 53.6], [9.9, 53.5]]] } };
    const mesh = app.createTerrainMesh(heights, 9, bounds, 100, { water: [water] });
    const levels = mesh.triangles.filter((_, index) => mesh.triangleMaterials[Math.floor(index / 3)] === 'water').map(vertex => vertex[2]);
    assert(Math.max(...levels) - Math.min(...levels) < 0.081, 'Water or ground under water is uneven');
    const directional = app.createTerrainMesh(Array.from({ length: 81 }, (_, index) => index < 9 ? 100 : 0), 9, bounds, 100);
    const north = Math.max(...directional.triangles.filter(vertex => vertex[1] > 100).map(vertex => vertex[2]));
    const south = Math.max(...directional.triangles.filter(vertex => vertex[1] === 0).map(vertex => vertex[2]));
    assert(north > south && heights[1] === 1, 'Elevation rows mirrored or input mutated');
    const colors = { terrain: '#ffffff', forest: '#228833', landCover: '#dddddd', water: '#4488aa', boundary: '#000000', road: '#aaaaaa', building: '#ffffff', base: '#8b5e3c' };
    const archive = new Uint8Array(await app.createColoredThreeMf(mesh, colors).arrayBuffer());
    const view = new DataView(archive.buffer);
    let offset = 0, xml;
    while (view.getUint32(offset, true) === 0x04034b50) {
      const length = view.getUint32(offset + 18, true), nameLength = view.getUint16(offset + 26, true), extraLength = view.getUint16(offset + 28, true);
      const start = offset + 30 + nameLength + extraLength;
      const name = new TextDecoder().decode(archive.slice(offset + 30, offset + 30 + nameLength));
      if (name === '3D/3dmodel.model') xml = new TextDecoder().decode(archive.slice(start, start + length));
      offset = start + length;
    }
    const model = new DOMParser().parseFromString(xml, 'application/xml');
    assert(!model.querySelector('parsererror') && model.querySelector('base[name="Base and sides"]').getAttribute('displaycolor') === '#8B5E3CFF', '3MF base material invalid');
    assert(model.querySelector('triangle[p1="7"]'), '3MF sides not assigned brown material');
  });

  await test('3D-only Buildings/Streets toggles affect feature collection', () => {
    change('stlBuildingsToggle', false); change('stlRoadsToggle', false);
    const spec = app.createRenderSnapshot();
    const features = app.getVisibleCityFeatures(spec);
    assert(features.buildings.length === 0 && features.roads.length === 0, '3D toggles ignored');
  });

  await test('Water islands are not filled and adjacent fragments share one level', () => {
    const bounds = { getWest: () => 0, getEast: () => 1, getSouth: () => 0, getNorth: () => 1 };
    const outer = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
    const island = [[0.3, 0.3], [0.3, 0.7], [0.7, 0.7], [0.7, 0.3], [0.3, 0.3]];
    const mesh = app.createTerrainMesh(Array(81).fill(0), 9, bounds, 100, { water: [{ geometry: { type: 'Polygon', coordinates: [outer, island] } }] });
    const waterFaces = mesh.triangleMaterials.flatMap((material, index) => material === 'water' ? [mesh.triangles.slice(index * 3, index * 3 + 3)] : []);
    assert(waterFaces.length > 0, 'No water generated');
    assert(!waterFaces.some(vertices => {
      const centerX = vertices.reduce((sum, vertex) => sum + vertex[0], 0) / 3;
      const centerY = vertices.reduce((sum, vertex) => sum + vertex[1], 0) / 3;
      return centerX > 55 && centerX < 105 && centerY > 55 && centerY < 105;
    }), 'Water covers island interior');
    const pieces = [0, 0.5].map(left => ({ geometry: { type: 'Polygon', coordinates: [[[left, 0], [left + 0.5, 0], [left + 0.5, 1], [left, 1], [left, 0]]] } }));
    const connected = app.createTerrainMesh(Array.from({ length: 81 }, (_, index) => index % 9 < 4 ? 0 : 100), 9, bounds, 100, { water: pieces });
    const levels = connected.triangles.filter((_, index) => connected.triangleMaterials[Math.floor(index / 3)] === 'water').map(vertex => vertex[2]);
    assert(Math.max(...levels) - Math.min(...levels) < 0.081, 'Adjacent water fragments have different levels');
  });

  await test('Project location survives delayed reverse-geocoding responses', async () => {
    app.CartivaMap.jumpTo({ center: [-0.1276, 51.5074] });
    app.applyProjectState({ ...original.state, center: [9.9937, 53.5511], city: 'SAVED HAMBURG', country: 'GERMANY' });
    await new Promise(resolve => setTimeout(resolve, 1500));
    assert(document.getElementById('cityName').textContent === 'SAVED HAMBURG', 'Stale geocoder overwrote saved name');
  });

  app.applyProjectState(original.state);
  return results;
}