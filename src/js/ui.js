// =============================================================================
// cartiva - app.js
// =============================================================================


// All basic app constants - as 1 object
const APP = {
  NAME: "cartiva",
  DESCRIPTION: "Create beautiful printable map art from any location",
  VERSION: "2026.10.05.190000", // yyyy.mm.dd.HHMMSS
  GITHUBLINK: "https://github.com/yafp/cartiva"
};


// Init some values in the UI with constants
// 
// Tab title
document.title = `${APP.NAME} - ${APP.DESCRIPTION}`;

// AppName
const heading = document.getElementById('appName');
if (heading) {
  heading.textContent = `${APP.NAME}`;
}

// AppDescription
const appDescription = document.getElementById('appDescription');
if (appDescription) {
  appDescription.textContent = `${APP.DESCRIPTION}`;
}

// AppVersion
const appVersion = document.getElementById('appVersion');
if (appVersion) {
  appVersion.textContent = `${APP.VERSION}`;
}

// AppGithubLink
const appGithubLink = document.getElementById('appGithubLink');
if (appGithubLink) {
  appGithubLink.href = `${APP.GITHUBLINK}`;
}




// -----------------------------------------------------------------------------
// START LOCATION & PERSISTENCE
// First-time visitors receive a random, curated larger city with prominent
// river, lake, harbor, or coastal geography. Returning visitors resume the
// last successfully used map location stored in this browser.
// -----------------------------------------------------------------------------
const LAST_LOCATION_STORAGE_KEY = 'cartiva.lastLocation';
const STARTER_CITIES = Object.freeze([
  { city: 'AMSTERDAM', country: 'NETHERLANDS', center: [4.9041, 52.3676], zoom: 12 },
  { city: 'HAMBURG', country: 'GERMANY', center: [9.9937, 53.5511], zoom: 12 },
  { city: 'LONDON', country: 'UNITED KINGDOM', center: [-0.1276, 51.5074], zoom: 11.5 },
  { city: 'PARIS', country: 'FRANCE', center: [2.3522, 48.8566], zoom: 12 },
  { city: 'VIENNA', country: 'AUSTRIA', center: [16.3738, 48.2082], zoom: 12 },
  { city: 'BUDAPEST', country: 'HUNGARY', center: [19.0402, 47.4979], zoom: 12 },
  { city: 'PRAGUE', country: 'CZECHIA', center: [14.4378, 50.0755], zoom: 12 },
  { city: 'STOCKHOLM', country: 'SWEDEN', center: [18.0686, 59.3293], zoom: 12 },
  { city: 'COPENHAGEN', country: 'DENMARK', center: [12.5683, 55.6761], zoom: 12 },
  { city: 'LISBON', country: 'PORTUGAL', center: [-9.1393, 38.7223], zoom: 12 },
  { city: 'PORTO', country: 'PORTUGAL', center: [-8.6291, 41.1579], zoom: 12 },
  { city: 'VANCOUVER', country: 'CANADA', center: [-123.1207, 49.2827], zoom: 12 },
  { city: 'CHICAGO', country: 'UNITED STATES', center: [-87.6298, 41.8781], zoom: 11.5 },
  { city: 'NEW YORK', country: 'UNITED STATES', center: [-74.0060, 40.7128], zoom: 11 },
  { city: 'SINGAPORE', country: 'SINGAPORE', center: [103.8198, 1.3521], zoom: 11 },
  { city: 'SYDNEY', country: 'AUSTRALIA', center: [151.2093, -33.8688], zoom: 11.5 }
]);

function getStoredLocation() {
  try {
    const value = JSON.parse(localStorage.getItem(LAST_LOCATION_STORAGE_KEY));
    const validCenter = Array.isArray(value?.center)
      && value.center.length === 2
      && value.center.every(Number.isFinite);
    if (!validCenter || !Number.isFinite(value?.zoom)) return null;
    return {
      city: String(value.city || 'MAP LOCATION').toUpperCase(),
      country: String(value.country || '').toUpperCase(),
      center: value.center,
      zoom: value.zoom,
      bearing: Number.isFinite(value.bearing) ? value.bearing : 0,
      pitch: Number.isFinite(value.pitch) ? value.pitch : 0
    };
  } catch (error) {
    globalThis.CartivaDiagnostics?.report('location.restore', error);
    return null;
  }
}

function getRandomStarterCity() {
  return STARTER_CITIES[Math.floor(Math.random() * STARTER_CITIES.length)];
}

const urlParams = new URLSearchParams(window.location.search);
const urlLat = Number(urlParams.get('lat'));
const urlLng = Number(urlParams.get('lng'));
const urlZoom = Number(urlParams.get('zoom'));
const urlRotation = Number(urlParams.get('rotation'));
const hasSharedLocation = ['lat', 'lng', 'zoom', 'rotation'].every(key => urlParams.has(key))
  && Number.isFinite(urlLat) && Math.abs(urlLat) <= 85
  && Number.isFinite(urlLng) && Math.abs(urlLng) <= 180
  && Number.isFinite(urlZoom) && urlZoom >= 0 && urlZoom <= 22
  && Number.isFinite(urlRotation);
const START_LOCATION = hasSharedLocation
  ? { city: 'MAP LOCATION', country: '', center: [urlLng, urlLat], zoom: urlZoom, bearing: urlRotation, pitch: 0 }
  : getStoredLocation() || getRandomStarterCity();

/** Keeps share links aligned with the latest camera and selected catalog preset. */
function updateShareUrl() {
  if (!map) return;
  const center = map.getCenter();
  const url = new URL(window.location.href);
  url.searchParams.set('lat', center.lat.toFixed(6));
  url.searchParams.set('lng', center.lng.toFixed(6));
  url.searchParams.set('zoom', map.getZoom().toFixed(2));
  url.searchParams.set('rotation', map.getBearing().toFixed(2));
  url.searchParams.set('preset', state.preset || DEFAULTS.preset);
  history.replaceState(null, '', url);
}


/**
* Saves the current map location and camera state to local storage.
*
* Stores:
* - City name
* - Country name
* - Map center coordinates (longitude, latitude)
* - Zoom level
* - Bearing
* - Pitch
*
* This information can later be used to restore the user's last viewed
* location and map perspective.
*
* @function saveLastLocation
* @throws {Error} Any storage-related errors are caught and reported via
* CartivaDiagnostics.
* @returns {void}
*/
function saveLastLocation() {
  try {
    const center = map.getCenter();
    localStorage.setItem(LAST_LOCATION_STORAGE_KEY, JSON.stringify({
      city: cityNameEl.textContent,
      country: cityCountryEl.textContent,
      center: [center.lng, center.lat],
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch()
    }));
  } catch (error) {
    CartivaDiagnostics.report('location.save', error);
  }
}

// -----------------------------------------------------------------------------
// NATIVE SHARING
// Show the minimal share control only when the browser exposes Web Share.
// navigator.share opens the native share sheet on supported mobile and desktop
// browsers. Sharing the canonical page URL avoids including temporary hashes.
// -----------------------------------------------------------------------------
const shareBtn = document.getElementById('shareBtn');
const shareData = {
  title: APP.NAME,
  text: `Create your own map art with ${APP.NAME}.`,
  url: window.location.href
};

// Feature detection keeps the control invisible on unsupported browsers.
// canShare is used when available to verify this exact payload.
const sharingSupported = typeof navigator.share === 'function'
  && (typeof navigator.canShare !== 'function' || navigator.canShare(shareData));

if (shareBtn && sharingSupported) {
  shareBtn.hidden = false;
  shareBtn.addEventListener('click', async () => {
    try {
      // Must run directly within the click handler to preserve user activation.
      await navigator.share({ ...shareData, url: window.location.href });
    } catch (error) {
      // AbortError means the user intentionally closed the native share dialog.
      if (error.name !== 'AbortError') {
        CartivaDiagnostics.report('sharing', error);
      }
    }
  });
}

// -----------------------------------------------------------------------------
// DEFAULT CONFIGURATION
// Frozen object with default values for presets, labels, export, filters,
// terrain, STL options, and the canonical layer order.
// -----------------------------------------------------------------------------
const FIXED_LAYER_ORDER = CartivaLayerRegistry.order;
const DEFAULTS = Object.freeze({
      preset: 'alpine',
      labelStyle: 'corner-bottom-right',
      labelOpacity: '100',
      textFilter: 'none',
      format: 'a4-portrait',
      customWidthMm: 210,
      customHeightMm: 297,
      bleedMm: 0,
      safeMm: 5,
      guidesEnabled: false,
      exportQuality: '1.5',
      printLineWeight: 'standard',
      exportType: 'image/png',
      exportDpi: 300,
      contrast: 100,
      brightness: 100,
      saturation: 100,
      shape: 'none',
      shapeColor: '#ffffff',
      shapeScale: 100,
      includeExportMetadata: false,
      terrainEnabled: false,
      contourEnabled: false,
      mountainColor: '#64748b',
      terrainExaggeration: 100,
      stlBuildingsEnabled: true,
      stlRoadsEnabled: true,
      scaleEnabled: false,
      northEnabled: false,
      layerOrder: FIXED_LAYER_ORDER
    });

// -----------------------------------------------------------------------------
// APPLICATION STATE
// Mutable state initialized from DEFAULTS and extended with map/location data.
// Updated as the user interacts with controls and the map.
// -----------------------------------------------------------------------------
    const state = {
      ...DEFAULTS,
      layerOrder: [...FIXED_LAYER_ORDER],
      center: [...START_LOCATION.center],
      zoom: START_LOCATION.zoom,
      bearing: START_LOCATION.bearing || 0,
      pitch: START_LOCATION.pitch || 0,
      city: START_LOCATION.city,
      coordinates: '',
      country: START_LOCATION.country,
      layers: {}
    };
    const runtimeState = CartivaRuntime;

// -----------------------------------------------------------------------------
// DOM CONTROL CACHE
// Build a frozen map from element ID to element for fast lookup.
// -----------------------------------------------------------------------------
    const controls = Object.freeze(Object.fromEntries(
      Array.from(document.querySelectorAll('[id]'), element => [element.id, element])
    ));
    document.querySelectorAll('svg').forEach(icon => {
      icon.setAttribute('aria-hidden', 'true');
      icon.setAttribute('focusable', 'false');
    });

// -----------------------------------------------------------------------------
// HELPER: SHORT $() FOR GETTING CONTROLS BY ID
// Returns the cached element or null if not found.
// -----------------------------------------------------------------------------
    const $ = id => controls[id] || null;

// -----------------------------------------------------------------------------

// OUTPUT DIMENSIONS MAP
// Pixel dimensions for each paper format at 300 DPI.
// Scaled later according to the chosen export DPI.
// -----------------------------------------------------------------------------
    const dimsMap = {
      'a2-portrait': { width: 4961, height: 7016 },
      'a2-landscape': { width: 7016, height: 4961 },
      'a3-portrait': { width: 3508, height: 4961 },
      'a3-landscape': { width: 4961, height: 3508 },
      'a4-portrait': { width: 2480, height: 3508 },
      'a4-landscape': { width: 3508, height: 2480 },
      'a5-portrait': { width: 1748, height: 2480 },
      'a5-landscape': { width: 2480, height: 1748 },
      'square-large': { width: 4961, height: 4961 },
      'square-medium': { width: 3508, height: 3508 },
      'square-small': { width: 2480, height: 2480 }
    };

    const mmToPixels = (mm, dpi) => Math.round(Number(mm) * dpi / 25.4);


// -----------------------------------------------------------------------------
// CONTROL HELPERS: READ/WRITE
// readControl: get value (boolean for checkbox, string otherwise).
// writeControl: set value (boolean for checkbox, string otherwise).
// -----------------------------------------------------------------------------
    function readControl(id) {
      const control = $(id);
      if (!control) {
        throw new Error(`Missing required control: #${id}`);
      }
      return control.type === 'checkbox' ? control.checked : control.value;
    }

    function writeControl(id, value) {
      const control = $(id);
      if (!control) {
        throw new Error(`Missing required control: #${id}`);
      }
      if (control.type === 'checkbox') control.checked = Boolean(value);
      else control.value = value;
    }


// -----------------------------------------------------------------------------
// STATE SYNC FROM UI
// Reads all relevant controls and updates the global `state` object.
// Also captures map camera state if `map` exists.
// -----------------------------------------------------------------------------
    function syncStateFromControls() {
      state.format = readControl('formatSelect');
      state.customWidthMm = Number(readControl('customWidthMm')) || 210;
      state.customHeightMm = Number(readControl('customHeightMm')) || 297;
      state.bleedMm = Number(readControl('bleedMm')) || 0;
      state.safeMm = Number(readControl('safeMm')) || 5;
      state.guidesEnabled = readControl('guidesToggle');
      state.exportType = readControl('exportType');
      state.exportDpi = Number(readControl('exportDpi'));
      state.exportQuality = readControl('exportQuality');
      state.printLineWeight = readControl('printLineWeight');
      state.preset = readControl('colorPresetSelect');
      state.labelStyle = readControl('labelStyle');
      state.labelOpacity = Number(readControl('labelOpacity'));
      state.labelFont = readControl('labelFontSelect');
      state.labelTextColor = readControl('labelTextColor');
      state.labelCoordColor = readControl('labelCoordColor');
      state.labelCountryColor = readControl('labelCountryColor');
      state.labelBgColor = readControl('labelBgColor');
      state.textFilter = readControl('textFilter');
      state.contrast = Number(readControl('contrastVal'));
      state.brightness = Number(readControl('brightnessVal'));
      state.saturation = Number(readControl('saturationVal'));
      state.shape = readControl('shapeSelect');
      state.shapeColor = readControl('shapeColor');
      state.shapeScale = Number(readControl('shapeScale'));
      state.includeExportMetadata = readControl('includeExportMetadata');
      state.terrainEnabled = readControl('terrainToggle');
      state.contourEnabled = readControl('contourToggle');
      state.mountainColor = readControl('mountainColor');
      state.terrainExaggeration = Number(readControl('terrainExaggeration'));
      state.stlBuildingsEnabled = readControl('stlBuildingsToggle');
      state.stlRoadsEnabled = readControl('stlRoadsToggle');
      state.scaleEnabled = readControl('scaleToggle');
      state.northEnabled = readControl('northToggle');
      state.borderEnabled = readControl('borderCheckbox');
      state.borderColor = readControl('borderColor');
      state.borderWidth = Number(readControl('borderWidth'));
      state.outerBorderRadius = Number(readControl('outerBorderRadius'));
      state.innerBorderRadius = Number(readControl('innerBorderRadius'));
      state.innerOutlineEnabled = readControl('innerOutlineEnabled');
      state.innerOutlineColor = readControl('innerOutlineColor');
      state.innerOutlineWidth = Number(readControl('innerOutlineWidth'));
      CartivaLayerRegistry.controlIds.forEach(id => {
        state.layers[id] = readControl(id);
      });
      state.city = $('cityName').textContent;
      state.coordinates = $('cityCoords').textContent;
      state.country = $('cityCountry').textContent;
      if (typeof map !== 'undefined') {
        state.center = map.getCenter().toArray();
        state.zoom = map.getZoom();
        state.bearing = map.getBearing();
        state.pitch = map.getPitch();
      }
      return state;
    }


// -----------------------------------------------------------------------------

// STATE PATCH HELPER
// Applies a partial update to `state` and optionally re-renders preview.
// -----------------------------------------------------------------------------
    function setState(patch, { render = true } = {}) {
      Object.assign(state, patch);
      if (render) renderPreview();
    }


// -----------------------------------------------------------------------------
// DIMENSION CALCULATIONS
// Compute target export size (px) for a given format and DPI.
// Update on-screen dimension readout.
// -----------------------------------------------------------------------------
    function getTargetDimensions(format = readControl('formatSelect'), dpi = Number(readControl('exportDpi'))) {
      if (format === 'custom') {
        return {
          width: mmToPixels(readControl('customWidthMm'), dpi),
          height: mmToPixels(readControl('customHeightMm'), dpi)
        };
      }
      const baseDims = dimsMap[format];
      if (!baseDims) throw new Error('Unsupported output format.');
      const scale = dpi / 300;
      return {
        width: Math.round(baseDims.width * scale),
        height: Math.round(baseDims.height * scale)
      };
    }

    function updateOutputDimensions() {
      const dimensions = getTargetDimensions();
      const label = `${dimensions.width} × ${dimensions.height} px`;
      $('outputDimensions').textContent = label;
      $('exportDialogDimensions').textContent = label;
    }


    const settingsForm = document.getElementById('settingsForm');
    const delegatedControlExclusions = new Set(['searchInput', 'geoJsonInput', 'projectFileInput', 'colorPresetSelect']);
    function handleSettingsChange(event) {
      const control = event.target;
      if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) return;
      if (delegatedControlExclusions.has(control.id)) return;
      const continuous = control.matches('input[type="range"], input[type="color"], input[type="number"]');
      if ((continuous && event.type !== 'input') || (!continuous && event.type !== 'change')) return;

      if (control.closest('.layer-control-card')) {
        state.preset = null;
        state.layers = {};
      }
      updateStateFromControls();

      const layerDefinition = CartivaLayerRegistry.definitions.find(definition =>
        [definition.colorId, definition.accentColorId, definition.opacityId, definition.toggleId,
          definition.outlineToggleId, definition.outlineColorId].includes(control.id)
      );
      if (layerDefinition?.valueId) $(layerDefinition.valueId).textContent = state.layers[layerDefinition.opacityId];

      if (control.id === 'formatSelect') {
        $('customSizeControls').hidden = state.format !== 'custom';
        clearTimeout(runtimeState.timers.mapResize);
        runtimeState.timers.mapResize = setTimeout(() => map.resize(), 300);
      }
      if (['terrainToggle', 'mountainColor', 'terrainExaggeration'].includes(control.id)) {
        $('terrainExaggerationVal').textContent = state.terrainExaggeration;
        configureTerrain(map, state);
        updateTerrainColorization(map, state).catch(error => CartivaDiagnostics.report('terrain.color', error));
      }
      if (control.id === 'contourToggle' || (control.id === 'mountainColor' && state.contourEnabled)) {
        if (state.contourEnabled) updateContours(map, state).catch(error => CartivaDiagnostics.report('terrain.contours', error));
        else {
          contourRequests.delete(map);
          if (map.getLayer('cartiva-contours')) map.setLayoutProperty('cartiva-contours', 'visibility', 'none');
        }
      }
    }
    settingsForm.addEventListener('input', handleSettingsChange);
    settingsForm.addEventListener('change', handleSettingsChange);
// -----------------------------------------------------------------------------
// INITIALIZATION
// Reset form, apply default values to controls, and sync state.
// Runs on DOMContentLoaded and on pageshow if persisted.
// -----------------------------------------------------------------------------
    function initializeDefaults() {
	  $('loadingProgress').value = 55;
		
		
		
	
		
      const form = document.getElementById('settingsForm');
      if (form) form.reset();
      document.getElementById('roadColor').value = "#374151";
      document.getElementById('boundaryColor').value = "#9ca3af";
      document.getElementById('borderWidth').value = "16";
      document.getElementById('borderWidthVal').textContent = "16";
      document.getElementById('searchInput').value = START_LOCATION.city;
      document.getElementById('cityName').textContent = START_LOCATION.city;
      document.getElementById('cityCountry').textContent = START_LOCATION.country;
      document.getElementById('colorPresetSelect').value = presetService.get(urlParams.get('preset')) ? urlParams.get('preset') : DEFAULTS.preset;
      document.getElementById('labelStyle').value = DEFAULTS.labelStyle;
      document.getElementById('labelOpacity').value = DEFAULTS.labelOpacity;
      document.getElementById('textFilter').value = DEFAULTS.textFilter;
      writeControl('formatSelect', DEFAULTS.format);
      writeControl('exportType', DEFAULTS.exportType);
      writeControl('exportDpi', DEFAULTS.exportDpi);
      writeControl('contrastVal', DEFAULTS.contrast);
      writeControl('brightnessVal', DEFAULTS.brightness);
      writeControl('saturationVal', DEFAULTS.saturation);
      writeControl('shapeScale', DEFAULTS.shapeScale);
      writeControl('includeExportMetadata', DEFAULTS.includeExportMetadata);
      writeControl('terrainToggle', DEFAULTS.terrainEnabled);
      writeControl('contourToggle', DEFAULTS.contourEnabled);
      writeControl('mountainColor', DEFAULTS.mountainColor);
      writeControl('terrainExaggeration', DEFAULTS.terrainExaggeration);
      writeControl('stlBuildingsToggle', DEFAULTS.stlBuildingsEnabled);
      writeControl('stlRoadsToggle', DEFAULTS.stlRoadsEnabled);
      writeControl('scaleToggle', DEFAULTS.scaleEnabled);
      writeControl('northToggle', DEFAULTS.northEnabled);
      renderPreview();
      if (runtimeState.mapReady) {
        applyTextFilters();
        applyColorPreset($('colorPresetSelect').value || DEFAULTS.preset);
      }
      syncStateFromControls();
    }

    document.addEventListener('DOMContentLoaded', initializeDefaults);
    window.addEventListener('pageshow', event => {
      if (event.persisted) initializeDefaults();
    });


// LIVE COLOR ADJUSTMENTS
// Apply contrast, brightness, and saturation to the map element.
// -----------------------------------------------------------------------------
    const mapEl = document.getElementById('map');
    const contrastNum = document.getElementById('contrastNum');
    const brightnessNum = document.getElementById('brightnessNum');
    const saturationNum = document.getElementById('saturationNum');

// -----------------------------------------------------------------------------
// BORDER & ASPECT RATIO
// Toggle border, choose color/width, and adjust inner/outer radii.
// Format select changes aspect ratio and resizes map.
// -----------------------------------------------------------------------------
    // Border & Aspect Ratio Controls
    const borderWidthVal = document.getElementById('borderWidthVal');
    const borderUiItems = document.querySelectorAll('.border-ui-item');

    document.querySelectorAll('input[type="color"]').forEach(input => {
      if (!input.getAttribute('aria-label')) {
        const title = input.getAttribute('title') || input.id.replace(/([A-Z])/g, ' $1');
        input.setAttribute('aria-label', title.trim());
      }
    });
    $('customSizeControls').hidden = readControl('formatSelect') !== 'custom';
