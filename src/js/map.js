// MAPLIBRE & TERRAIN CONSTANTS
// Base style URL, terrain source/layer IDs, and elevation tile URL template.
// -----------------------------------------------------------------------------
    const MAP_STYLE_URL = CartivaServices.mapStyleUrl;
    const TERRAIN_SOURCE_ID = 'mapartgen-terrain';
    const TERRAIN_LAYER_ID = 'mapartgen-hillshade';
    const TERRAIN_COLOR_SOURCE_ID = 'mapartgen-elevation-colors';
    const TERRAIN_COLOR_LAYER_ID = 'mapartgen-elevation-colors-layer';
    const TERRAIN_TILES_URL = CartivaServices.terrainTilesUrl;

// -----------------------------------------------------------------------------

// MAPLIBRE MAP INITIALIZATION
// Create map at the restored or randomly selected starter location.
// Attach move/zoom/moveend handlers for UI updates and terrain refresh.
// -----------------------------------------------------------------------------
    // MapLibre initialization using the restored or random starter location
    const map = new maplibregl.Map({
      container: 'map',
      preserveDrawingBuffer: true,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      attributionControl: false,
      style: MAP_STYLE_URL,
      center: START_LOCATION.center,
      zoom: START_LOCATION.zoom,
      bearing: START_LOCATION.bearing || 0,
      pitch: START_LOCATION.pitch || 0
    });
    window.CartivaMap = map;
    map.on('error', event => {
      const error = event.error || new Error('MapLibre reported an unknown error.');
      CartivaDiagnostics.report('map', error);
      if (typeof setStatus === 'function') setStatus(`Map service issue: ${error.message}`, true);
    });
    const zoomLevelDisplay = $('zoomLevelDisplay');
    function updateZoomLevelDisplay() {
      state.zoom = map.getZoom();
      zoomLevelDisplay.textContent = state.zoom.toFixed(2);
    }
    map.on('move', updateZoomLevelDisplay);
    map.on('move', renderMapAnnotations);
    map.on('zoomend', () => {
      configureMapForRender(map, state);
      triggerAllLayerUpdates();
      applyTextFilters(map, readControl('textFilter'));
    });
    map.on('moveend', () => {
      syncStateFromControls();
      saveLastLocation();
      schedulePreviewRenderSync();
    });
    let terrainRefreshTimer;
    map.on('moveend', () => {
      clearTimeout(terrainRefreshTimer);
      terrainRefreshTimer = setTimeout(() => {
        if (state.terrainEnabled) updateTerrainColorization().catch(error => CartivaDiagnostics.report('terrain.color', error));
      }, 250);
    });


// -----------------------------------------------------------------------------
// ZOOM & ROTATE CONTROLS
// Four zoom buttons (big/fine in/out) and three rotate buttons.
// -----------------------------------------------------------------------------
    // 4-Button Zoom Controls Event Listeners (Big steps & Fine adjustments)
    document.getElementById('zoomInBigBtn').addEventListener('click', () => {
      map.zoomTo(map.getZoom() + 2, { duration: 300 });
    });
    document.getElementById('zoomInFineBtn').addEventListener('click', () => {
      map.zoomTo(map.getZoom() + 0.25, { duration: 200 });
    });
    document.getElementById('zoomOutFineBtn').addEventListener('click', () => {
      map.zoomTo(map.getZoom() - 0.25, { duration: 200 });
    });
    document.getElementById('zoomOutBigBtn').addEventListener('click', () => {
      map.zoomTo(map.getZoom() - 2, { duration: 300 });
    });
    $('rotateLeftBtn').addEventListener('click', () => map.rotateTo(map.getBearing() - 15, { duration: 200 }));
    $('rotateRightBtn').addEventListener('click', () => map.rotateTo(map.getBearing() + 15, { duration: 200 }));
    $('resetBearingBtn').addEventListener('click', () => map.rotateTo(0, { duration: 250 }));


// -----------------------------------------------------------------------------
// LIVE MAGNIFIER
// Toggleable lens that shows a zoomed crop of the map canvas under the cursor.
// -----------------------------------------------------------------------------
    // Live Magnifier Functionality
    const magnifierBtn = document.getElementById('magnifierBtn');
    const mapMagnifierLens = document.getElementById('mapMagnifierLens');
    const magnifierContext = mapMagnifierLens.getContext('2d');
    const mapFrame = document.getElementById('mapFrame');
    let magnifierActive = false;
    let magnifierFrame = null;
    let magnifierPosition = null;

    magnifierBtn.addEventListener('click', () => {
      magnifierActive = !magnifierActive;
      if (magnifierActive) {
        magnifierBtn.classList.add('active-magnifier');
        mapMagnifierLens.style.display = 'block';
      } else {
        magnifierBtn.classList.remove('active-magnifier');
        mapMagnifierLens.style.display = 'none';
      }
    });

    function renderMagnifier() {
      magnifierFrame = null;
      if (!magnifierActive || !magnifierPosition) return;
      const { x, y, rect } = magnifierPosition;
      const mapCanvas = map.getCanvas();
      const sourceX = (x / rect.width) * mapCanvas.width;
      const sourceY = (y / rect.height) * mapCanvas.height;
      const sourceSize = 140;
      magnifierContext.clearRect(0, 0, mapMagnifierLens.width, mapMagnifierLens.height);
      magnifierContext.drawImage(
        mapCanvas,
        sourceX - sourceSize / 2,
        sourceY - sourceSize / 2,
        sourceSize,
        sourceSize,
        0,
        0,
        mapMagnifierLens.width,
        mapMagnifierLens.height
      );
    }

    mapFrame.addEventListener('mousemove', (e) => {
      if (!magnifierActive) return;
      const rect = mapFrame.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (x < 0 || x > rect.width || y < 0 || y > rect.height) {
        mapMagnifierLens.style.display = 'none';
        return;
      }

      mapMagnifierLens.style.display = 'block';
      const lensSize = 140;
      mapMagnifierLens.style.width = `${lensSize}px`;
      mapMagnifierLens.style.height = `${lensSize}px`;
      mapMagnifierLens.style.left = `${x - lensSize / 2}px`;
      mapMagnifierLens.style.top = `${y - lensSize / 2}px`;
      magnifierPosition = { x, y, rect };
      if (!magnifierFrame) magnifierFrame = requestAnimationFrame(renderMagnifier);
    });

    mapFrame.addEventListener('mouseleave', () => {
      if (magnifierActive) {
        mapMagnifierLens.style.display = 'none';
      }
    });


// -----------------------------------------------------------------------------
// LABEL VISIBILITY FILTERS
// Group label layers by role (water, cities, streets, transit, poi, natural).
// Show/hide labels based on selected filter mode (e.g. cities_only).
// -----------------------------------------------------------------------------
    // Map Labels Filter
    const textFilter = document.getElementById('textFilter');
    const LABEL_LAYER_GROUPS = Object.freeze({
      water: ['waterway_label', 'water_name', 'marine_label', 'ocean', 'sea', 'lake', 'river', 'canal', 'stream'],
      cities: ['place_', 'city', 'town', 'village', 'hamlet', 'suburb', 'neighbourhood', 'country_label', 'state_label', 'province'],
      streets: ['roadname', 'road_label', 'street', 'highway', 'motorway', 'path_label'],
      transit: ['transportation_name', 'transit', 'station', 'rail', 'airport', 'aerodrome', 'ferry'],
      poi: ['poi', 'housenumber', 'building_label', 'amenity', 'shop', 'tourism'],
      natural: ['natural', 'mountain', 'peak', 'volcano', 'glacier', 'forest_label', 'park_label']
    });

    function getLabelRole(layer) {
      const id = layer.id.toLowerCase();
      const sourceLayer = String(layer['source-layer'] || '').toLowerCase();
      for (const [role, names] of Object.entries(LABEL_LAYER_GROUPS)) {
        if (names.some(name => id.includes(name) || sourceLayer.includes(name.replace(/_label$|_name$/, '')))) {
          return role;
        }
      }
      return 'other';
    }

    function isLabelVisible(mode, role) {
      if (mode === 'none') return false;
      if (mode === 'all') return true;
      if (mode === 'cities_only') return role === 'cities';
      if (mode === 'streets_only') return role === 'streets';
      if (mode === 'water_only') return role === 'water';
      if (mode === 'transit_only') return role === 'transit';
      if (mode === 'poi_only') return role === 'poi';
      if (mode === 'natural_only') return role === 'natural';
      return false;
    }

    function applyTextFilters(targetMap = map, mode = state.textFilter) {
      const style = targetMap.getStyle();
      if (!style || !style.layers) return;

      style.layers.forEach(layer => {
        if (layer.type === 'symbol') {
          const liveTextField = targetMap.getLayoutProperty(layer.id, 'text-field');
          if (liveTextField == null && layer.layout?.['text-field'] == null) return;
          targetMap.setLayoutProperty(
            layer.id,
            'visibility',
            isLabelVisible(mode, getLabelRole(layer)) ? 'visible' : 'none'
          );
        }
      });
    }

    textFilter.addEventListener('change', () => {
      setState({ textFilter: readControl('textFilter') });
    });


// -----------------------------------------------------------------------------
// LAYER ROLE MAPPING & TERRAIN
// Map Carto layer IDs to roles (water, forest, land, etc.).
// Configure terrain source/layer and hillshade styling.
// Update terrain colorization overlay when terrain is enabled.
// -----------------------------------------------------------------------------
    // Global update triggers for initial map sync
    const MAP_DETAIL_POLICY = Object.freeze({
      buildings: Object.freeze({ minZoom: 0, maxZoom: 24 })
    });

    function getMapStateLayerValue(mapState, key, fallback) {
      return mapState.layers?.[key] ?? mapState[key] ?? fallback;
    }

    function configureBuildingZoom(targetMap, mapState = state) {
      const layers = targetMap.getStyle()?.layers || [];
      const enabled = getMapStateLayerValue(mapState, 'buildingToggle', true) !== false;
      layers.forEach(layer => {
        if (getLayerRole(layer) !== 'building') return;
        targetMap.setLayerZoomRange(
          layer.id,
          MAP_DETAIL_POLICY.buildings.minZoom,
          MAP_DETAIL_POLICY.buildings.maxZoom
        );
        if (layer.type === 'fill') {
          targetMap.setPaintProperty(layer.id, 'fill-opacity', enabled ? getMapStateLayerValue(mapState, 'buildingOpacity', 100) / 100 : 0);
        }
      });
    }

    // This is the single styling path shared by the interactive preview and
    // the high-resolution export map. Keep provider-specific layer handling here.
    function applyMapState(targetMap, mapState = state) {
      const layers = targetMap.getStyle()?.layers || [];
      layers.forEach(layer => {
        const role = getLayerRole(layer);
        if (!role || role === 'terrain') return;
        const definition = CartivaLayerRegistry.definitions.find(item => item.role === role);
        if (!definition) return;
        const enabled = getMapStateLayerValue(mapState, definition.toggleId, true) !== false;
        const opacity = Number(getMapStateLayerValue(mapState, definition.opacityId, 100)) / 100;
        const isAccent = (role === 'forest' && /park|recreation|pitch/.test(layer.id.toLowerCase()))
          || (role === 'landCover' && /residential/.test(layer.id.toLowerCase()));
        const colorId = isAccent && definition.accentColorId ? definition.accentColorId : definition.colorId;
        const color = getMapStateLayerValue(mapState, colorId, null);
        const isBuilding = role === 'building';
        const outlineEnabled = getMapStateLayerValue(mapState, definition.outlineToggleId, true) !== false && enabled;
        const outlineColor = getMapStateLayerValue(mapState, definition.outlineColorId, color);

        targetMap.setLayoutProperty(layer.id, 'visibility', isBuilding && layer.type === 'line'
          ? (outlineEnabled ? 'visible' : 'none')
          : (enabled ? 'visible' : 'none'));
        if (!color && !isBuilding) return;

        if (layer.type === 'fill') {
          targetMap.setPaintProperty(layer.id, 'fill-color', color);
          targetMap.setPaintProperty(layer.id, 'fill-opacity', enabled ? opacity : 0);
          if (isBuilding) {
            targetMap.setPaintProperty(layer.id, 'fill-outline-color', outlineEnabled ? outlineColor : color);
          }
        } else if (layer.type === 'line') {
          const lineColor = isBuilding ? outlineColor : color;
          targetMap.setPaintProperty(layer.id, 'line-color', lineColor);
          targetMap.setPaintProperty(layer.id, 'line-opacity', isBuilding ? (outlineEnabled ? opacity : 0) : (enabled ? opacity : 0));
        } else if (layer.type === 'background') {
          targetMap.setPaintProperty(layer.id, 'background-color', color);
          targetMap.setPaintProperty(layer.id, 'background-opacity', enabled ? opacity : 0);
        }
      });
      configureBuildingZoom(targetMap, mapState);
      applyTextFilters(targetMap, mapState.textFilter);
    }

    // Configure a map instance before it is allowed to render a final frame.
    function configureMapForRender(targetMap, mapState = state) {
      configureTerrain(targetMap, mapState);
      applyMapState(targetMap, mapState);
      applyLayerOrder(targetMap);
    }

    let previewSyncToken = 0;
    function schedulePreviewRenderSync() {
      const token = ++previewSyncToken;
      if (typeof waitForMapIdle !== 'function') return;
      waitForMapIdle(map, 10000).then(() => {
        if (token !== previewSyncToken || !runtimeState.mapReady) return;
        configureMapForRender(map, state);
        map.triggerRepaint();
      }).catch(error => CartivaDiagnostics.report('preview.sync', error));
    }

    function getLayerRole(layer) {
      return CartivaStyleAdapter.classify(layer);
    }

    function shadeHex(hex, amount) {
      const channel = index => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(index, index + 2), 16) + amount)));
      return `rgb(${channel(1)}, ${channel(3)}, ${channel(5)})`;
    }

    function configureTerrain(targetMap, terrainState = state) {
      if (!targetMap.getSource(TERRAIN_SOURCE_ID)) {
        targetMap.addSource(TERRAIN_SOURCE_ID, {
          type: 'raster-dem',
          tiles: [TERRAIN_TILES_URL],
          tileSize: 256,
          encoding: 'terrarium',
          maxzoom: 15
        });
      }
      if (!targetMap.getLayer(TERRAIN_LAYER_ID)) {
        const firstLabel = targetMap.getStyle().layers.find(layer => layer.type === 'symbol')?.id;
        targetMap.addLayer({
          id: TERRAIN_LAYER_ID,
          type: 'hillshade',
          source: TERRAIN_SOURCE_ID,
          paint: {
            'hillshade-exaggeration': 0,
            'hillshade-highlight-color': shadeHex(terrainState.mountainColor, 80),
            'hillshade-shadow-color': shadeHex(terrainState.mountainColor, -80),
            'hillshade-accent-color': terrainState.mountainColor
          }
        }, firstLabel);
      }
      targetMap.setPaintProperty(TERRAIN_LAYER_ID, 'hillshade-highlight-color', shadeHex(terrainState.mountainColor, 80));
      targetMap.setPaintProperty(TERRAIN_LAYER_ID, 'hillshade-shadow-color', shadeHex(terrainState.mountainColor, -80));
      targetMap.setPaintProperty(TERRAIN_LAYER_ID, 'hillshade-accent-color', terrainState.mountainColor);
      targetMap.setPaintProperty(TERRAIN_LAYER_ID, 'hillshade-exaggeration', terrainState.terrainEnabled ? terrainState.terrainExaggeration / 180 : 0);
    }

    async function updateTerrainColorization(targetMap = map, terrainState = state) {
      if (!terrainState.terrainEnabled) {
        if (targetMap.getLayer(TERRAIN_COLOR_LAYER_ID)) targetMap.setPaintProperty(TERRAIN_COLOR_LAYER_ID, 'raster-opacity', 0);
        return;
      }
      const grid = await getElevationGrid(targetMap.getBounds(), 81, Math.min(13, Math.max(10, Math.floor(targetMap.getZoom()))));
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = grid.size;
      const context = canvas.getContext('2d');
      const image = context.createImageData(grid.size, grid.size);
      const minimum = Math.min(...grid.heights);
      const maximum = Math.max(...grid.heights);
      grid.heights.forEach((height, index) => {
        const ratio = (height - minimum) / Math.max(1, maximum - minimum);
        const color = shadeHex(terrainState.mountainColor, -100 + ratio * 190).match(/\d+/g).map(Number);
        image.data[index * 4] = color[0]; image.data[index * 4 + 1] = color[1]; image.data[index * 4 + 2] = color[2]; image.data[index * 4 + 3] = 185;
      });
      context.putImageData(image, 0, 0);
      const bounds = targetMap.getBounds();
      const coordinates = [[bounds.getWest(), bounds.getNorth()], [bounds.getEast(), bounds.getNorth()], [bounds.getEast(), bounds.getSouth()], [bounds.getWest(), bounds.getSouth()]];
      if (targetMap.getLayer(TERRAIN_COLOR_LAYER_ID)) targetMap.removeLayer(TERRAIN_COLOR_LAYER_ID);
      if (targetMap.getSource(TERRAIN_COLOR_SOURCE_ID)) targetMap.removeSource(TERRAIN_COLOR_SOURCE_ID);
      targetMap.addSource(TERRAIN_COLOR_SOURCE_ID, { type: 'canvas', canvas, coordinates, animate: false });
      targetMap.addLayer({ id: TERRAIN_COLOR_LAYER_ID, type: 'raster', source: TERRAIN_COLOR_SOURCE_ID, paint: { 'raster-opacity': 0.72 } }, TERRAIN_LAYER_ID);
      applyLayerOrder(targetMap);
    }


// -----------------------------------------------------------------------------
// FIXED LAYER ORDERING
// Moves matching MapLibre layers into the canonical cartographic stack.
// -----------------------------------------------------------------------------
    function applyLayerOrder(targetMap = map) {
      const layers = targetMap.getStyle()?.layers || [];
      const beforeId = layers.find(layer => layer.type === 'symbol')?.id;
      FIXED_LAYER_ORDER.forEach(role => {
        const matchingIds = role === 'terrain'
          ? [TERRAIN_COLOR_LAYER_ID, TERRAIN_LAYER_ID]
          : layers.filter(layer => getLayerRole(layer) === role).map(layer => layer.id);
        matchingIds.forEach(id => {
          if (targetMap.getLayer(id)) targetMap.moveLayer(id, beforeId);
        });
      });
    }


// -----------------------------------------------------------------------------
// SCALE BAR & NORTH ARROW
// Compute real-world scale (meters) for current center/zoom.
// Render scale overlay and north arrow based on state and bearing.
// -----------------------------------------------------------------------------
    function getScaleInfo(targetMap = map) {
      const metersPerPixel = (40075016.686 * Math.cos(targetMap.getCenter().lat * Math.PI / 180)) / (512 * 2 ** targetMap.getZoom());
      const targetMeters = metersPerPixel * targetMap.getContainer().clientWidth * 0.2;
      const exponent = 10 ** Math.floor(Math.log10(targetMeters));
      const base = [1, 2, 5, 10].find(value => value * exponent >= targetMeters) || 10;
      const meters = base * exponent;
      return { meters, pixels: meters / metersPerPixel, label: meters >= 1000 ? `${meters / 1000} km` : `${Math.round(meters)} m` };
    }

    function renderMapAnnotations() {
      if (!runtimeState.mapReady) return;
      const scale = $('mapScaleOverlay');
      const north = $('northOverlay');
      scale.style.display = state.scaleEnabled ? 'block' : 'none';
      north.style.display = state.northEnabled ? 'block' : 'none';
      if (state.scaleEnabled) {
        const info = getScaleInfo();
        scale.style.width = `${info.pixels}px`;
        scale.firstElementChild.textContent = info.label;
      }
      if (state.northEnabled) north.style.transform = `rotate(${-map.getBearing()}deg)`;
    }

    function warnAboutUnsupportedLayers(targetMap) {
      const unsupported = CartivaLayerRegistry.getUnsupportedLayers(targetMap.getStyle().layers);
      if (unsupported.length) CartivaDiagnostics.record('map.layers', 'Unsupported map layers were left unchanged.', { unsupported }, 'warn');
    }


// -----------------------------------------------------------------------------
// COLOR & LAYER CONTROLLERS
// setupLayerControls: bind color/opacity/toggle inputs to MapLibre paint properties.
// Handles main vs accent colors for forest/landCover.
// -----------------------------------------------------------------------------
    // Color & Layer Controllers
    function setupLayerControls(definition) {
      const opacityValSpan = document.getElementById(definition.valueId);
      if (opacityValSpan) opacityValSpan.textContent = state.layers[definition.opacityId];
    }


// -----------------------------------------------------------------------------
// COLOR PRESETS
// Populate preset dropdown from CartivaPresetCatalog.
// applyColorPreset: write preset values to controls and update map layers.
// Step/randomize buttons for quick design changes.
// -----------------------------------------------------------------------------
    // Predefined color set definitions
    const colorPresetSelect = controls.colorPresetSelect;
    const predefinedColorSets = window.CartivaPresetData;
    const presetService = CartivaPresets.create(window.CartivaPresetCatalog, predefinedColorSets);
    presetService.list().forEach((preset, index) => {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = `${String(index + 1).padStart(4, '0')} - ${preset.name}`;
      colorPresetSelect.appendChild(option);
    });

    function applyColorPreset(presetName) {
      const set = presetService.values(presetName);
      if (!set) return;

      Object.entries(set).forEach(([id, value]) => {
        if ($(id)) writeControl(id, value);
      });
      state.preset = presetName;
      state.layers = { ...set };

      triggerAllLayerUpdates();
      syncStateFromControls();
      applyTextFilters(map, state.textFilter);
    }

    colorPresetSelect.addEventListener('change', (e) => {
      applyColorPreset(e.target.value);
    });

    function stepPreset(offset) {
      const count = colorPresetSelect.options.length;
      const current = Math.max(0, colorPresetSelect.selectedIndex);
      colorPresetSelect.selectedIndex = (current + offset + count) % count;
      applyColorPreset(colorPresetSelect.value);
    }
    $('previousPresetBtn').addEventListener('click', () => stepPreset(-1));
    $('nextPresetBtn').addEventListener('click', () => stepPreset(1));

    $('randomPresetBtn').addEventListener('click', () => {
      const randomHex = () => `#${Math.floor(Math.random() * 0x1000000).toString(16).padStart(6, '0')}`;
      const blueWater = ['#0ea5e9', '#38bdf8', '#0284c7', '#2563eb', '#60a5fa', '#7dd3fc', '#1d4ed8'];
      const fields = [
        'waterColor', 'forestColor', 'forestColorAccent', 'landColor',
        'landCoverColor', 'landCoverColorAccent', 'roadColor',
        'boundaryColor', 'buildingColor', 'buildingOutlineColor'
      ];
      fields.forEach(id => writeControl(id, randomHex()));
      writeControl('waterColor', Math.random() < 0.75
        ? blueWater[Math.floor(Math.random() * blueWater.length)]
        : randomHex());
      $('colorPresetSelect').selectedIndex = -1;
      syncStateFromControls();
      triggerAllLayerUpdates();
      renderPreview();
    });

    $('randomizeDesignBtn').addEventListener('click', () => {
      const presetNames = Object.keys(predefinedColorSets);
      const layoutNames = Array.from($('labelStyle').options, option => option.value);
      const effectNames = Array.from($('filterPreset').options, option => option.value);
      const randomItem = items => items[Math.floor(Math.random() * items.length)];

      writeControl('colorPresetSelect', randomItem(presetNames));
      writeControl('labelStyle', randomItem(layoutNames));
      writeControl('filterPreset', randomItem(effectNames));
      writeControl('contrastVal', 85 + Math.floor(Math.random() * 31));
      writeControl('brightnessVal', 90 + Math.floor(Math.random() * 21));
      writeControl('saturationVal', 80 + Math.floor(Math.random() * 61));
      applyColorPreset(readControl('colorPresetSelect'));
      updateStateFromControls();
    });

    function triggerAllLayerUpdates() {
      syncStateFromControls();
      CartivaLayerRegistry.definitions.forEach(setupLayerControls);
      applyMapState(map, state);
    }


// -----------------------------------------------------------------------------

// MAP LOAD INITIALIZATION
// When map is ready:
// - Configure terrain and colorization
// - Set up layer controls for water/forest/land/landCover/road/boundary
// - Initialize building controls and apply default preset
// - Apply the fixed layer order
// -----------------------------------------------------------------------------
    map.on('load', () => {
      runtimeState.mapReady = true;
      CartivaDiagnostics.record('map', 'Map style loaded.', { center: map.getCenter().toArray(), zoom: map.getZoom() });
      configureTerrain(map);
      updateTerrainColorization(map).catch(error => CartivaDiagnostics.report('terrain.color', error));
      configureMapForRender(map, state);
      configureBuildingZoom(map);
      applyTextFilters();

      CartivaLayerRegistry.definitions.forEach(setupLayerControls);
      applyColorPreset(DEFAULTS.preset);
      configureBuildingZoom(map);
      triggerAllLayerUpdates();
      applyTextFilters(map, readControl('textFilter'));
      renderPreview();
      warnAboutUnsupportedLayers(map);
      applyLayerOrder();
      schedulePreviewRenderSync();
    });

// -----------------------------------------------------------------------------