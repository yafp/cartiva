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
    CartivaWebGl.prepareMap(map);
    map.on('error', event => {
      const error = event.error || new Error('MapLibre reported an unknown error.');
      CartivaDiagnostics.report('map', error);
      if (typeof setStatus === 'function') setStatus(`Map service issue: ${error.message}`, true);
    });
    const zoomLevelDisplay = $('zoomLevelDisplay');
    const rotationLevelDisplay = $('rotationLevelDisplay');
    /**
     * Updates zoom level display for the Cartiva application.
     * @function updateZoomLevelDisplay
     */
    function updateZoomLevelDisplay() {
      state.zoom = map.getZoom();
      zoomLevelDisplay.textContent = state.zoom.toFixed(2);
      const bearing = Math.round(map.getBearing());
      rotationLevelDisplay.textContent = `${bearing === 0 ? 0 : bearing}°`;
    }
    window.CartivaMapDetailPolicy = Object.freeze({
      thresholds: Object.freeze({ centerMovementPx: 24, zoom: 0.08, orientationDegrees: 2 }),
      /**
       * Checks a candidate camera against the last fully rendered camera using spatial hysteresis.
       * @param {Object|null} previous - Settled camera snapshot with center, zoom, bearing, and pitch.
       * @param {Object} current - Candidate camera snapshot with center, zoom, bearing, and pitch.
       * @param {*} targetMap - MapLibre map used to project the center displacement.
       * @returns {boolean} True when the map detail should be refreshed.
       */
      isSignificant(previous, current, targetMap = map) {
        if (!previous || !current) return true;
        const limits = window.CartivaMapDetailPolicy.thresholds;
        const zoomDelta = Math.abs(Number(current.zoom) - Number(previous.zoom));
        if (!Number.isFinite(zoomDelta)) return true;
        const angleDistance = (left, right) => {
          const difference = Math.abs(Number(left || 0) - Number(right || 0)) % 360;
          return Math.min(difference, 360 - difference);
        };
        if (zoomDelta > limits.zoom
          || angleDistance(current.bearing, previous.bearing) > limits.orientationDegrees
          || Math.abs(Number(current.pitch || 0) - Number(previous.pitch || 0)) > limits.orientationDegrees) return true;
        const center = point => Array.isArray(point)
          ? point
          : [Number(point?.lng ?? point?.lon), Number(point?.lat)];
        const previousCenter = center(previous.center);
        const currentCenter = center(current.center);
        if (![...previousCenter, ...currentCenter].every(Number.isFinite)) return true;
        const previousPixel = targetMap.project(previousCenter);
        const currentPixel = targetMap.project(currentCenter);
        return Math.hypot(previousPixel.x - currentPixel.x, previousPixel.y - currentPixel.y) > limits.centerMovementPx;
      }
    });
    map.on('move', updateZoomLevelDisplay);
    map.on('move', renderMapAnnotations);
    const mapServices = [
      { name: 'Google Maps', url: (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}` },
      { name: 'OpenStreetMap', url: (lat, lng) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=${Math.round(map.getZoom())}/${lat}/${lng}` }
    ];
    const mapServicesDialog = $('mapServicesDialog');
    $('mapServicesBtn').addEventListener('click', () => {
      const { lat, lng } = map.getCenter();
      const list = $('mapServicesList');
      list.replaceChildren();
      for (const service of mapServices) {
        const link = document.createElement('a');
        link.className = 'secondary-action-btn map-service-link';
        link.textContent = service.name;
        link.href = service.url(lat.toFixed(6), lng.toFixed(6));
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.addEventListener('click', () => mapServicesDialog.close());
        list.append(link);
      }
      mapServicesDialog.showModal();
    });
    $('mapServicesCloseBtn').addEventListener('click', () => mapServicesDialog.close());
    map.on('movestart', () => globalThis.CartivaRefinedPreview?.hide({ preserveImage: true }));
    let mapDragActive = false;
    let dragDetailTimer = null;
    const DRAG_DETAIL_ROLES = new Set(['forest', 'landCover', 'road', 'boundary', 'building']);
    /**
     * Hides expensive thematic details during a pointer drag while retaining the base land/water map.
     * @param {*} targetMap - MapLibre map being simplified.
     */
    function applyLightweightDragStyle(targetMap) {
      (targetMap.getStyle()?.layers || []).forEach(layer => {
        if (layer.type === 'symbol' || DRAG_DETAIL_ROLES.has(getLayerRole(layer))) {
          targetMap.setLayoutProperty(layer.id, 'visibility', 'none');
        }
      });
    }
    /**
     * Restores full styling after map movement has settled.
     */
    function scheduleDragStyleRestore() {
      if (!mapDragActive) return;
      clearTimeout(dragDetailTimer);
      dragDetailTimer = setTimeout(() => {
        mapDragActive = false;
        applyMapState(map, state);
        applyTextFilters(map, readControl('textFilter'));
        map.triggerRepaint();
        schedulePreviewRenderSync();
      }, 300);
    }
    map.on('dragstart', () => {
      clearTimeout(dragDetailTimer);
      mapDragActive = true;
      if (!globalThis.CartivaRefinedPreview?.hasBufferedDetail()) applyLightweightDragStyle(map);
    });
    map.on('dragend', scheduleDragStyleRestore);
    map.on('zoomend', () => {
      configureMapForRender(map, state);
      triggerAllLayerUpdates();
      applyTextFilters(map, readControl('textFilter'));
    });
    map.on('moveend', () => {
      syncStateFromControls();
      saveLastLocation();
      updateShareUrl();
      schedulePreviewRenderSync();
      scheduleDragStyleRestore();
    });
    let terrainRefreshTimer;
    map.on('moveend', () => {
      clearTimeout(terrainRefreshTimer);
      terrainRefreshTimer = setTimeout(() => {
        if (state.terrainEnabled) updateTerrainColorization().catch(error => CartivaDiagnostics.report('terrain.color', error));
        if (state.contourEnabled) updateContours().catch(error => CartivaDiagnostics.report('terrain.contours', error));
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
    const magnifierPreviewImage = document.getElementById('refinedMapPreview');
    let magnifierActive = false;
    let magnifierFrame = null;
    let magnifierPosition = null;
    const MAGNIFIER_SIZE = 180;

    magnifierBtn.addEventListener('click', () => {
      magnifierActive = !magnifierActive;
      magnifierBtn.classList.toggle('active-magnifier', magnifierActive);
      magnifierBtn.setAttribute('aria-pressed', String(magnifierActive));
      if (magnifierActive) queueMagnifierRender();
      else mapMagnifierLens.style.display = 'none';
    });

    /**
     * Schedules a magnifier refresh without queuing duplicate animation frames.
     * @function queueMagnifierRender
     */
    function queueMagnifierRender() {
      if (magnifierActive && magnifierPosition && !magnifierFrame) {
        magnifierFrame = requestAnimationFrame(renderMagnifier);
      }
    }

    /**
     * Returns the highest-detail image currently visible beneath the lens.
     * @function getMagnifierSource
     * @returns {{image: HTMLCanvasElement|HTMLImageElement, rect: DOMRect, width: number, height: number}|null}
     */
    function getMagnifierSource() {
      const previewOpacity = Number.parseFloat(getComputedStyle(magnifierPreviewImage).opacity);
      if (magnifierPreviewImage.classList.contains('ready')
        && magnifierPreviewImage.complete
        && magnifierPreviewImage.naturalWidth > 0
        && previewOpacity > 0.05) {
        return {
          image: magnifierPreviewImage,
          rect: magnifierPreviewImage.getBoundingClientRect(),
          width: magnifierPreviewImage.naturalWidth,
          height: magnifierPreviewImage.naturalHeight
        };
      }
      const canvas = map.getCanvas();
      return {
        image: canvas,
        rect: canvas.getBoundingClientRect(),
        width: canvas.width,
        height: canvas.height
      };
    }

    /**
     * Renders magnifier for the Cartiva application.
     * @function renderMagnifier
     */
    function renderMagnifier() {
      magnifierFrame = null;
      if (!magnifierActive || !magnifierPosition) return;
      const source = getMagnifierSource();
      if (!source || !source.rect.width || !source.rect.height) return;
      const { clientX, clientY } = magnifierPosition;
      const sourceX = ((clientX - source.rect.left) / source.rect.width) * source.width;
      const sourceY = ((clientY - source.rect.top) / source.rect.height) * source.height;
      const sourceSize = Math.min(source.width, source.height) * 0.09;
      const lensWidth = mapMagnifierLens.width;
      const lensHeight = mapMagnifierLens.height;
      magnifierContext.clearRect(0, 0, mapMagnifierLens.width, mapMagnifierLens.height);
      magnifierContext.save();
      magnifierContext.beginPath();
      magnifierContext.arc(lensWidth / 2, lensHeight / 2, Math.min(lensWidth, lensHeight) / 2, 0, Math.PI * 2);
      magnifierContext.clip();
      magnifierContext.drawImage(
        source.image,
        sourceX - sourceSize / 2,
        sourceY - sourceSize / 2,
        sourceSize,
        sourceSize,
        0,
        0,
        lensWidth,
        lensHeight
      );
      magnifierContext.restore();
    }

    mapFrame.addEventListener('pointermove', (e) => {
      if (!magnifierActive) return;
      const rect = mapFrame.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (x < 0 || x > rect.width || y < 0 || y > rect.height) {
        mapMagnifierLens.style.display = 'none';
        return;
      }

      mapMagnifierLens.style.display = 'block';
      const lensSize = Math.min(MAGNIFIER_SIZE, rect.width, rect.height);
      mapMagnifierLens.style.width = `${lensSize}px`;
      mapMagnifierLens.style.height = `${lensSize}px`;
      const halfSize = lensSize / 2;
      const left = Math.max(0, Math.min(rect.width - lensSize, x - halfSize));
      const top = Math.max(0, Math.min(rect.height - lensSize, y - halfSize));
      mapMagnifierLens.style.left = `${left}px`;
      mapMagnifierLens.style.top = `${top}px`;
      magnifierPosition = { clientX: e.clientX, clientY: e.clientY };
      queueMagnifierRender();
    });

    mapFrame.addEventListener('pointerleave', () => {
      mapMagnifierLens.style.display = 'none';
    });
    map.on('render', queueMagnifierRender);
    magnifierPreviewImage.addEventListener('load', queueMagnifierRender);
    new MutationObserver(queueMagnifierRender).observe(magnifierPreviewImage, {
      attributes: true,
      attributeFilter: ['class', 'src']
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

    /**
     * Returns information about label role for the Cartiva application.
     * @function getLabelRole
     * @param {*} layer - Input value.
     */
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

    /**
     * Determines whether label visible is true.
     * @function isLabelVisible
     * @param {*} mode - Input value.
     * @param {*} role - Input value.
     */
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

    /**
    * Applies the selected text-visibility filter to map symbol layers.
     * @function applyTextFilters
     * @param {*} targetMap - Input value.
     * @param {*} mode - Input value.
     */
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
      buildings: Object.freeze({ maxZoom: 24 })
    });

    /**
     * Returns information about map state layer value for the Cartiva application.
     * @function getMapStateLayerValue
     * @param {*} mapState - Input value.
     * @param {*} key - Input value.
     * @param {*} fallback - Input value.
     */
    function getMapStateLayerValue(mapState, key, fallback) {
      return mapState.layers?.[key] ?? mapState[key] ?? fallback;
    }

    /**
     * Returns information about detailed layer color for the Cartiva application.
     * @function getDetailedLayerColor
     * @param {*} mapState - Input value.
     * @param {*} layer - Input value.
     * @param {*} role - Input value.
     * @param {*} fallback - Input value.
     */
    function getDetailedLayerColor(mapState, layer, role, fallback) {
      const id = layer.id.toLowerCase();
      const color = key => getMapStateLayerValue(mapState, key, null);
      if (role === 'water') {
        if (id === 'waterway') return color('waterwayColor') || fallback;
        if (id === 'water_shadow') return color('waterShadowColor') || fallback;
      }
      if (role === 'forest') {
        if (id === 'park_national_park') return color('parkColor') || fallback;
        if (id === 'park_nature_reserve') return color('natureReserveColor') || fallback;
        if (id === 'landcover' && (color('woodColor') || color('grassColor'))) {
          return ['case',
            ['==', ['get', 'class'], 'wood'], color('woodColor') || fallback,
            ['==', ['get', 'class'], 'grass'], color('grassColor') || fallback,
            ['==', ['get', 'subclass'], 'recreation_ground'], color('grassColor') || fallback,
            fallback
          ];
        }
      }
      if (role === 'landCover') {
        if (id === 'landuse_residential') return color('residentialColor') || fallback;
        if (id === 'landuse' && (color('cemeteryColor') || color('stadiumColor'))) {
          return ['match', ['get', 'class'],
            'cemetery', color('cemeteryColor') || fallback,
            'stadium', color('stadiumColor') || fallback,
            fallback
          ];
        }
      }
      if (role === 'road') {
        const isCase = id.includes('_case');
        const hierarchy = [
          [/mot/, 'motorwayColor', 'motorwayCaseColor'],
          [/trunk/, 'trunkRoadColor', 'trunkRoadCaseColor'],
          [/_pri_/, 'primaryRoadColor', 'primaryRoadCaseColor'],
          [/_sec_/, 'secondaryRoadColor', 'secondaryRoadCaseColor'],
          [/minor/, 'minorRoadColor', 'minorRoadCaseColor'],
          [/service/, 'serviceRoadColor', 'serviceRoadCaseColor'],
          [/path|track/, 'pathColor', 'pathCaseColor'],
          [/rail/, 'railColor', 'railCaseColor'],
          [/runway/, 'runwayColor', 'runwayCaseColor'],
          [/taxiway/, 'taxiwayColor', 'taxiwayCaseColor']
        ].find(([pattern]) => pattern.test(id));
        const hierarchyColor = hierarchy ? color(isCase ? hierarchy[2] : hierarchy[1]) : null;
        if (id.startsWith('bridge_')) return color(isCase ? 'bridgeCaseColor' : 'bridgeColor') || hierarchyColor || fallback;
        if (id.startsWith('tunnel_')) return color(isCase ? 'tunnelCaseColor' : 'tunnelColor') || hierarchyColor || fallback;
        return hierarchyColor || (isCase ? color('roadCaseColor') : color('roadFillColor')) || fallback;
      }
      if (role === 'boundary') {
        if (id.includes('country')) return color('countryBoundaryColor') || fallback;
        if (id.includes('state')) return color('stateBoundaryColor') || fallback;
        if (id.includes('county')) return color('countyBoundaryColor') || fallback;
      }
      if (role === 'building' && id === 'building-top') return color('buildingTopColor') || fallback;
      return fallback;
    }

    /**
     * Configures building zoom for the Cartiva application.
     * @function configureBuildingZoom
     * @param {*} targetMap - Input value.
     * @param {*} mapState - Input value.
     */
    function configureBuildingZoom(targetMap, mapState = state) {
      const layers = targetMap.getStyle()?.layers || [];
      const enabled = getMapStateLayerValue(mapState, 'buildingToggle', true) !== false;
      layers.forEach(layer => {
        if (getLayerRole(layer) !== 'building') return;
        targetMap.setLayerZoomRange(
          layer.id,
          Number.isFinite(Number(mapState.buildingMinZoom)) ? Number(mapState.buildingMinZoom) : 10.5,
          MAP_DETAIL_POLICY.buildings.maxZoom
        );
        if (layer.type === 'fill') {
          targetMap.setPaintProperty(layer.id, 'fill-opacity', enabled ? getMapStateLayerValue(mapState, 'buildingOpacity', 100) / 100 : 0);
        }
      });
    }

    // This is the single styling path shared by the interactive preview and
    // the high-resolution export map. Keep provider-specific layer handling here.
    const maritimeBoundaryLayers = new WeakMap();
    /**
     * Handles maritime boundaries for the Cartiva application.
     * @function excludeMaritimeBoundaries
     * @param {*} targetMap - Input value.
     * @param {*} layer - Input value.
     */
    function excludeMaritimeBoundaries(targetMap, layer) {
      let filteredLayers = maritimeBoundaryLayers.get(targetMap);
      if (!filteredLayers) {
        filteredLayers = new Set();
        maritimeBoundaryLayers.set(targetMap, filteredLayers);
      }
      if (filteredLayers.has(layer.id)) return;
      // CARTO's boundary source exposes `maritime` as a numeric field (0/1).
      // Keep the provider's admin-level filter and explicitly discard sea borders.
      targetMap.setFilter(layer.id, ['all', ...(layer.filter ? [layer.filter] : []), ['!=', 'maritime', 1]]);
      filteredLayers.add(layer.id);
    }

    /**
    * Applies layer colors, opacity, visibility, zoom limits, and text filters.
     * @function applyMapState
     * @param {*} targetMap - Input value.
     * @param {*} mapState - Input value.
     */
    function applyMapState(targetMap, mapState = state) {
      const layers = targetMap.getStyle()?.layers || [];
      layers.forEach(layer => {
        const role = getLayerRole(layer);
        if (!role || role === 'terrain') return;
        if (role === 'boundary') excludeMaritimeBoundaries(targetMap, layer);
        const definition = CartivaLayerRegistry.definitions.find(item => item.role === role);
        if (!definition) return;
        const enabled = getMapStateLayerValue(mapState, definition.toggleId, true) !== false;
        const opacity = Number(getMapStateLayerValue(mapState, definition.opacityId, 100)) / 100;
        const isAccent = (role === 'forest' && /park|recreation|pitch/.test(layer.id.toLowerCase()))
          || (role === 'landCover' && /residential/.test(layer.id.toLowerCase()));
        const colorId = isAccent && definition.accentColorId ? definition.accentColorId : definition.colorId;
        const color = getDetailedLayerColor(mapState, layer, role, getMapStateLayerValue(mapState, colorId, null));
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
      if (targetMap === map && mapDragActive) applyLightweightDragStyle(targetMap);
    }

    // Configure a map instance before it is allowed to render a final frame.
    /**
     * Configures map for render for the Cartiva application.
     * @function configureMapForRender
     * @param {*} targetMap - Input value.
     * @param {*} mapState - Input value.
     */
    function configureMapForRender(targetMap, mapState = state) {
      configureTerrain(targetMap, mapState);
      applyMapState(targetMap, mapState);
      applyLayerOrder(targetMap);
      if (mapState.contourEnabled && targetMap === map) updateContours(targetMap, mapState).catch(error => CartivaDiagnostics.report('terrain.contours', error));
      else {
        contourRequests.delete(targetMap);
        if (targetMap.getLayer('cartiva-contours')) targetMap.setLayoutProperty('cartiva-contours', 'visibility', 'none');
      }
    }

    const contourRequests = new WeakMap();
    /**
     * Derives elevation isolines from the same DEM grid used for terrain exports.
     * Callers rendering adjacent map regions may pass their shared full-footprint bounds
     * so each render uses the same sampling grid and contour geometry.
     * @param {*} targetMap - MapLibre map to receive the contour layer.
     * @param {*} mapState - Current visual state.
     * @param {Object} [options] - Optional contour generation settings.
     * @param {*} [options.bounds] - Shared full-footprint bounds in MapLibre or GeoJSON bounds form.
     * @param {number} [options.zoom] - Shared sampling zoom; defaults to state.zoom or map zoom.
     * @returns {Promise<void>} Resolves when the contour source and layer are current.
     */
    async function updateContours(targetMap = map, mapState = state, options = {}) {
      if (!mapState.contourEnabled || !targetMap.getStyle()?.layers?.length) return;
      const boundsInput = options.bounds ?? mapState.bounds;
      const bounds = boundsInput?.getWest
        ? boundsInput
        : boundsInput?.length === 2
          ? new maplibregl.LngLatBounds(boundsInput[0], boundsInput[1])
          : targetMap.getBounds();
      const requestedZoom = Number(options.zoom ?? mapState.zoom ?? targetMap.getZoom());
      const sampleZoom = Number.isFinite(requestedZoom) ? requestedZoom : targetMap.getZoom();
      const requestKey = JSON.stringify([bounds.toArray(), Math.floor(sampleZoom), mapState.mountainColor]);
      if (contourRequests.get(targetMap) === requestKey) return;
      contourRequests.set(targetMap, requestKey);
      const size = 49;
      let heights;
      try {
        ({ heights } = await getElevationGrid(bounds, size, Math.min(12, Math.max(9, Math.floor(sampleZoom)))));
      } catch (error) {
        if (contourRequests.get(targetMap) === requestKey) contourRequests.delete(targetMap);
        throw error;
      }
      if (contourRequests.get(targetMap) !== requestKey) return;
      if (!mapState.contourEnabled || !targetMap.getStyle()?.layers?.length) return;
      const minimum = Math.max(100, Math.ceil(Math.min(...heights) / 100) * 100);
      const maximum = Math.min(Math.max(...heights), minimum + 6000);
      const features = [];
      const coordinate = (column, row) => [
        bounds.getWest() + column / (size - 1) * (bounds.getEast() - bounds.getWest()),
        bounds.getNorth() + row / (size - 1) * (bounds.getSouth() - bounds.getNorth())
      ];
      for (let elevation = minimum; elevation <= maximum; elevation += 100) {
        const lines = [];
        for (let row = 0; row < size - 1; row += 1) {
          for (let column = 0; column < size - 1; column += 1) {
            const corners = [
              [column, row, heights[row * size + column]],
              [column + 1, row, heights[row * size + column + 1]],
              [column + 1, row + 1, heights[(row + 1) * size + column + 1]],
              [column, row + 1, heights[(row + 1) * size + column]]
            ];
            const crossings = [];
            for (let edge = 0; edge < 4; edge += 1) {
              const start = corners[edge], end = corners[(edge + 1) % 4];
              if ((start[2] < elevation) === (end[2] < elevation)) continue;
              const fraction = (elevation - start[2]) / (end[2] - start[2]);
              crossings.push(coordinate(start[0] + (end[0] - start[0]) * fraction, start[1] + (end[1] - start[1]) * fraction));
            }
            for (let index = 0; index + 1 < crossings.length; index += 2) lines.push([crossings[index], crossings[index + 1]]);
          }
        }
        if (lines.length) features.push({ type: 'Feature', properties: { elevation }, geometry: { type: 'MultiLineString', coordinates: lines } });
      }
      const sourceId = 'cartiva-contours';
      const data = { type: 'FeatureCollection', features };
      if (!targetMap.getSource(sourceId)) targetMap.addSource(sourceId, { type: 'geojson', data });
      else targetMap.getSource(sourceId).setData(data);
      if (!targetMap.getLayer(sourceId)) targetMap.addLayer({ id: sourceId, type: 'line', source: sourceId, paint: { 'line-color': mapState.mountainColor, 'line-width': 0.8, 'line-opacity': 0.65 } }, targetMap.getStyle().layers.find(layer => layer.type === 'symbol')?.id);
      targetMap.setPaintProperty(sourceId, 'line-color', mapState.mountainColor);
      targetMap.setLayoutProperty(sourceId, 'visibility', 'visible');
    }

    let previewSyncToken = 0;
    let previewSyncTimer = null;
    /**
     * Schedules preview render sync for the Cartiva application.
     * @function schedulePreviewRenderSync
     */
    function schedulePreviewRenderSync() {
      const token = ++previewSyncToken;
      if (typeof waitForMapIdle !== 'function') return;
      clearTimeout(previewSyncTimer);
      previewSyncTimer = setTimeout(() => {
        previewSyncTimer = null;
        waitForMapIdle(map, 10000).then(() => {
          if (token !== previewSyncToken || !runtimeState.mapReady) return;
          configureMapForRender(map, state);
          map.triggerRepaint();
          globalThis.CartivaRefinedPreview?.schedule();
        }).catch(error => CartivaDiagnostics.report('preview.sync', error));
      }, mapDragActive ? 350 : 180);
    }

    /**
     * Returns information about layer role for the Cartiva application.
     * @function getLayerRole
     * @param {*} layer - Input value.
     */
    function getLayerRole(layer) {
      return CartivaStyleAdapter.classify(layer);
    }

    /**
     * Shades hex for the Cartiva application.
     * @function shadeHex
     * @param {*} hex - Input value.
     * @param {*} amount - Input value.
     */
    function shadeHex(hex, amount) {
      const channel = index => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(index, index + 2), 16) + amount)));
      return `rgb(${channel(1)}, ${channel(3)}, ${channel(5)})`;
    }

    /**
     * Configures terrain for the Cartiva application.
     * @function configureTerrain
     * @param {*} targetMap - Input value.
     * @param {*} terrainState - Input value.
     */
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
      targetMap.setPaintProperty(TERRAIN_LAYER_ID, 'hillshade-exaggeration', terrainState.terrainEnabled ? Math.max(0, Math.min(1, (Number(terrainState.terrainExaggeration) || 0) / 300)) : 0);
    }

    /**
     * Updates terrain colorization for the Cartiva application.
     * @function updateTerrainColorization
     * @param {*} targetMap - Input value.
     * @param {*} terrainState - Input value.
     */
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
    /**
    * Moves thematic and terrain layers into the canonical drawing order.
     * @function applyLayerOrder
     * @param {*} targetMap - Input value.
     */
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
      if (targetMap.getLayer('cartiva-contours')) {
        if (beforeId) targetMap.moveLayer('cartiva-contours', beforeId);
        else targetMap.moveLayer('cartiva-contours');
      }
    }


// -----------------------------------------------------------------------------
// SCALE BAR & NORTH ARROW
// Compute real-world scale (meters) for current center/zoom.
// Render scale overlay and north arrow based on state and bearing.
// -----------------------------------------------------------------------------
    /**
     * Returns information about scale info for the Cartiva application.
     * @function getScaleInfo
     * @param {*} targetMap - Input value.
     */
    function getScaleInfo(targetMap = map) {
      const metersPerPixel = (40075016.686 * Math.cos(targetMap.getCenter().lat * Math.PI / 180)) / (512 * 2 ** targetMap.getZoom());
      const targetMeters = metersPerPixel * targetMap.getContainer().clientWidth * 0.2;
      const exponent = 10 ** Math.floor(Math.log10(targetMeters));
      const base = [1, 2, 5, 10].find(value => value * exponent >= targetMeters) || 10;
      const meters = base * exponent;
      return { meters, pixels: meters / metersPerPixel, label: meters >= 1000 ? `${meters / 1000} km` : `${Math.round(meters)} m` };
    }

    /**
     * Renders map annotations for the Cartiva application.
     * @function renderMapAnnotations
     */
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

    /**
     * Warns about unsupported layers for the Cartiva application.
     * @function warnAboutUnsupportedLayers
     * @param {*} targetMap - Input value.
     */
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
    /**
     * Setups layer controls for the Cartiva application.
     * @function setupLayerControls
     * @param {*} definition - Input value.
     */
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

    const presetPicker = document.createElement('div');
    presetPicker.className = 'visual-preset-picker';
    const presetPickerButton = document.createElement('button');
    presetPickerButton.type = 'button';
    presetPickerButton.className = 'secondary-action-btn';
    presetPickerButton.title = 'Choose a color palette with a four-color preview';
    presetPickerButton.setAttribute('aria-expanded', 'false');
    const presetPickerList = document.createElement('div');
    presetPickerList.className = 'visual-preset-list';
    presetPickerList.hidden = true;
    const presetSwatch = values => {
      const swatch = document.createElement('span');
      swatch.className = 'preset-swatch';
      swatch.style.background = `conic-gradient(${values.waterColor} 0 25%, ${values.forestColor} 25% 50%, ${values.landColor} 50% 75%, ${values.buildingColor} 75% 100%)`;
      return swatch;
    };
    /**
     * Updates preset picker for the Cartiva application.
     * @function updatePresetPicker
     */
    function updatePresetPicker() {
      const preset = presetService.get(colorPresetSelect.value);
      presetPickerButton.replaceChildren();
      if (preset) presetPickerButton.append(presetSwatch(preset.values));
      presetPickerButton.append(document.createTextNode(preset?.name || 'Custom palette'));
    }
    presetService.list().forEach(preset => {
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.className = 'preset-choice';
      choice.append(presetSwatch(preset.values), document.createTextNode(preset.name));
      choice.addEventListener('click', () => {
        colorPresetSelect.value = preset.id;
        colorPresetSelect.dispatchEvent(new Event('change', { bubbles: true }));
        presetPickerList.hidden = true;
        presetPickerButton.setAttribute('aria-expanded', 'false');
      });
      presetPickerList.append(choice);
    });
    presetPickerButton.addEventListener('click', () => {
      presetPickerList.hidden = !presetPickerList.hidden;
      presetPickerButton.setAttribute('aria-expanded', String(!presetPickerList.hidden));
    });
    document.addEventListener('click', event => {
      if (!presetPicker.contains(event.target)) {
        presetPickerList.hidden = true;
        presetPickerButton.setAttribute('aria-expanded', 'false');
      }
    });
    presetPicker.append(presetPickerButton, presetPickerList);
    colorPresetSelect.after(presetPicker);
    colorPresetSelect.classList.add('visually-hidden');

    /**
    * Applies a saved color preset to controls and map layers.
     * @function applyColorPreset
     * @param {*} presetName - Input value.
     */
    function applyColorPreset(presetName) {
      const set = presetService.values(presetName);
      if (!set) return;

      colorPresetSelect.value = presetName;
      Object.entries(set).forEach(([id, value]) => {
        if ($(id)) writeControl(id, value);
      });
      state.preset = presetName;
      state.layers = { ...set };

      triggerAllLayerUpdates();
      renderPreview();
      updateShareUrl();
      updatePresetPicker();
    }

    colorPresetSelect.addEventListener('change', (e) => {
      applyColorPreset(e.target.value);
    });

    /**
     * Handles preset for the Cartiva application.
     * @function stepPreset
     * @param {*} offset - Input value.
     */
    function stepPreset(offset) {
      const count = colorPresetSelect.options.length;
      const current = Math.max(0, colorPresetSelect.selectedIndex);
      colorPresetSelect.selectedIndex = (current + offset + count) % count;
      applyColorPreset(colorPresetSelect.value);
      const section = $('colorPresetsSection');
      section.classList.remove('collapsed');
      section.querySelector('.section-header').setAttribute('aria-expanded', 'true');
      section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    $('previousPresetBtn').addEventListener('click', () => stepPreset(-1));
    $('nextPresetBtn').addEventListener('click', () => stepPreset(1));

    $('randomPresetBtn').addEventListener('click', () => {
      const mode = ['complementary', 'analog', 'triadic', 'monochromatic', 'split complementary', 'warm', 'cold', 'high contrast'][Math.floor(Math.random() * 8)];
      const baseHue = Math.floor(Math.random() * 360);
      const offsets = {
        complementary: [0, 180], analog: [-30, 0, 30], triadic: [0, 120, 240],
        monochromatic: [0], 'split complementary': [0, 150, 210],
        warm: [-25, 0, 25], cold: [140, 180, 220], 'high contrast': [0, 180]
      }[mode];
      const hslToHex = (hue, saturation, lightness) => {
        const channel = offset => {
          const value = (offset + hue / 30) % 12;
          const chroma = saturation * Math.min(lightness, 1 - lightness);
          return Math.round(255 * (lightness - chroma * Math.max(-1, Math.min(value - 3, 9 - value, 1)))).toString(16).padStart(2, '0');
        };
        return `#${channel(0)}${channel(8)}${channel(4)}`;
      };
      const colors = Object.keys(presetService.values(DEFAULTS.preset)).filter(key => key.toLowerCase().includes('color'));
      const palette = Object.fromEntries(colors.map((key, index) => [key, hslToHex(
        (baseHue + offsets[index % offsets.length] + 360) % 360,
        mode === 'monochromatic' ? 0.35 : 0.4 + Math.random() * 0.3,
        mode === 'high contrast' ? (index % 2 ? 0.25 : 0.8) : 0.35 + Math.random() * 0.4
      )]));
      Object.entries(palette).forEach(([id, value]) => { if ($(id)) writeControl(id, value); });
      colorPresetSelect.selectedIndex = -1;
      state.layers = palette;
      syncStateFromControls();
      triggerAllLayerUpdates();
      renderPreview();
      updatePresetPicker();
      setStatus(`${mode} color palette generated.`);
    });

    $('randomizeDesignBtn').addEventListener('click', () => {
      const presetNames = Object.keys(predefinedColorSets);
      const layoutNames = Array.from($('labelStyle').options, option => option.value);
      const randomItem = items => items[Math.floor(Math.random() * items.length)];

      writeControl('colorPresetSelect', randomItem(presetNames));
      writeControl('labelStyle', randomItem(layoutNames));
      writeControl('contrastVal', 85 + Math.floor(Math.random() * 31));
      writeControl('brightnessVal', 90 + Math.floor(Math.random() * 21));
      writeControl('saturationVal', 80 + Math.floor(Math.random() * 61));
      applyColorPreset(readControl('colorPresetSelect'));
      $('randomPresetBtn').click();
      writeControl('labelBgColor', readControl('landColor'));
      const background = readControl('labelBgColor');
      const textColor = relativeLuminance(background) > 0.179 ? '#111827' : '#ffffff';
      writeControl('labelTextColor', textColor);
      writeControl('labelCoordColor', textColor);
      writeControl('labelCountryColor', textColor);
      writeControl('borderCheckbox', Math.random() > 0.3);
      writeControl('borderColor', readControl('buildingColor'));
      writeControl('borderWidth', 4 + Math.floor(Math.random() * 28));
      writeControl('outerBorderRadius', Math.floor(Math.random() * 25));
      writeControl('innerOutlineEnabled', Math.random() > 0.5);
      writeControl('innerOutlineColor', readControl('roadColor'));
      updateStateFromControls();
    });

    /**
     * Handles all layer updates for the Cartiva application.
     * @function triggerAllLayerUpdates
     */
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
      const requestedPreset = urlParams.get('preset');
      if (requestedPreset && !presetService.get(requestedPreset)) {
        setStatus(`Preset "${requestedPreset}" is unavailable. Using the default preset.`, true);
      }
      applyColorPreset(presetService.get(requestedPreset) ? requestedPreset : DEFAULTS.preset);
      $('loadingProgress').value = 100;
      $('loadingSplash').classList.add('finished');
      $('loadingSplash').addEventListener('transitionend', () => $('loadingSplash').remove(), { once: true });
      configureBuildingZoom(map);
      triggerAllLayerUpdates();
      applyTextFilters(map, readControl('textFilter'));
      renderPreview();
      warnAboutUnsupportedLayers(map);
      applyLayerOrder();
      schedulePreviewRenderSync();
    });

// -----------------------------------------------------------------------------