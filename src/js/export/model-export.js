// STL and 3MF export orchestration. Geometry helpers live in the export engine.
const MODEL_EXPORT_LIMITS = Object.freeze({ features: 60000, coordinates: 500000 });

/**
 * Evaluates the data-driven style values used by Cartiva's layer colors.
 * @param {*} value - A constant or MapLibre style expression.
 * @param {Object} feature - The rendered feature.
 * @param {number} zoom - The map's styling zoom.
 * @returns {*} The resolved value, or undefined for an unsupported expression.
 */
function evaluateModelStyle(value, feature, zoom) {
  if (value && !Array.isArray(value) && typeof value === 'object' && Array.isArray(value.stops)) {
    const input = value.property ? feature.properties?.[value.property] : zoom;
    if (value.type === 'categorical') {
      return value.stops.find(([label]) => label === input)?.[1] ?? value.default;
    }
    if (value.type === 'interval') {
      return evaluateModelStyle(['step', input, value.stops[0]?.[1], ...value.stops.flat()], feature, zoom);
    }
    return evaluateModelStyle(['interpolate', ['exponential', value.base ?? 1], input, ...value.stops.flat()], feature, zoom);
  }
  if (!Array.isArray(value)) return value;
  const [operator, ...args] = value;
  const resolve = input => evaluateModelStyle(input, feature, zoom);
  switch (operator) {
    case 'literal': return args[0];
    case 'get': return feature.properties?.[args[0]];
    case 'has': return Object.hasOwn(feature.properties || {}, args[0]);
    case 'zoom': return zoom;
    case 'to-number': return Number(resolve(args[0]));
    case 'to-string': return String(resolve(args[0]));
    case 'coalesce': return args.map(resolve).find(result => result != null);
    case '==': return resolve(args[0]) === resolve(args[1]);
    case '!=': return resolve(args[0]) !== resolve(args[1]);
    case '>': return resolve(args[0]) > resolve(args[1]);
    case '>=': return resolve(args[0]) >= resolve(args[1]);
    case '<': return resolve(args[0]) < resolve(args[1]);
    case '<=': return resolve(args[0]) <= resolve(args[1]);
    case '!': return !resolve(args[0]);
    case 'all': return args.every(resolve);
    case 'any': return args.some(resolve);
    case 'case':
      for (let index = 0; index < args.length - 1; index += 2) {
        if (resolve(args[index])) return resolve(args[index + 1]);
      }
      return resolve(args.at(-1));
    case 'match': {
      const input = resolve(args[0]);
      for (let index = 1; index < args.length - 1; index += 2) {
        const labels = Array.isArray(args[index]) ? args[index] : [args[index]];
        if (labels.includes(input)) return resolve(args[index + 1]);
      }
      return resolve(args.at(-1));
    }
    case 'step': {
      const input = Number(resolve(args[0]));
      let result = resolve(args[1]);
      for (let index = 2; index < args.length; index += 2) {
        if (input < args[index]) break;
        result = resolve(args[index + 1]);
      }
      return result;
    }
    case 'interpolate': {
      const input = Number(resolve(args[1]));
      for (let index = 2; index < args.length - 2; index += 2) {
        if (input <= args[index]) return resolve(args[index + 1]);
        if (input <= args[index + 2]) {
          const left = resolve(args[index + 1]), right = resolve(args[index + 3]);
          if (!Number.isFinite(left) || !Number.isFinite(right)) return undefined;
          const base = args[0]?.[0] === 'exponential' ? Number(args[0][1]) : 1;
          const distance = args[index + 2] - args[index];
          const offset = input - args[index];
          const ratio = base === 1 ? offset / distance : (base ** offset - 1) / (base ** distance - 1);
          return left + (right - left) * ratio;
        }
      }
      return resolve(args.at(-1));
    }
    case '*': return args.map(resolve).reduce((result, number) => result * number, 1);
    case '+': return args.map(resolve).reduce((result, number) => result + number, 0);
    default: return undefined;
  }
}

/**
 * Counts geometry coordinates without changing the feature.
 * @param {Array} coordinates - GeoJSON coordinate arrays.
 * @returns {number} The number of positions.
 */
function countModelCoordinates(coordinates) {
  if (!Array.isArray(coordinates)) return 0;
  if (typeof coordinates[0] === 'number') return 1;
  return coordinates.reduce((total, child) => total + countModelCoordinates(child), 0);
}

/**
 * Removes multipart components wholly outside the model footprint.
 * @param {Object} geometry - Rendered GeoJSON geometry (which may span a whole tile).
 * @param {Object} bounds - The model's geographic bounds.
 * @returns {Object|null} Geometry whose components intersect the exported footprint.
 */
function getModelFootprintGeometry(geometry, bounds) {
  if (!bounds) return geometry;
  const intersects = coordinates => {
    let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
    const visit = positions => {
      if (typeof positions?.[0] === 'number') {
        west = Math.min(west, positions[0]); east = Math.max(east, positions[0]);
        south = Math.min(south, positions[1]); north = Math.max(north, positions[1]);
      } else if (Array.isArray(positions)) positions.forEach(visit);
    };
    visit(coordinates);
    return east >= bounds.getWest() && west <= bounds.getEast()
      && north >= bounds.getSouth() && south <= bounds.getNorth();
  };
  if (geometry.type === 'MultiPolygon' || geometry.type === 'MultiLineString') {
    const coordinates = geometry.coordinates.filter(intersects);
    return coordinates.length ? { type: geometry.type, coordinates } : null;
  }
  return intersects(geometry.coordinates) ? geometry : null;
}

/**
 * Resolves a preview color into the RGB format accepted by both mesh writers.
 * @param {*} value - Resolved style color.
 * @param {string} fallback - Broad or accent material color.
 * @returns {string} A six-digit RGB color.
 */
function normalizeModelColor(value, fallback) {
  if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return value;
  if (typeof value === 'string' && /^#[0-9a-f]{3}$/i.test(value)) {
    return `#${value.slice(1).split('').map(character => character + character).join('')}`;
  }
  const rgb = typeof value === 'string' && value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (rgb) return `#${rgb.slice(1, 4).map(channel => Math.max(0, Math.min(255, Math.round(Number(channel)))).toString(16).padStart(2, '0')).join('')}`;
  return /^#[0-9a-f]{6}$/i.test(fallback || '') ? fallback : '#808080';
}

/**
 * Applies the preview's contrast, brightness and saturation to model RGB colors.
 * @param {string} color - Six-digit sRGB color.
 * @param {Object} renderSpec - Preview filter percentages.
 * @returns {string} Filtered six-digit sRGB color.
 */
function filterModelColor(color, renderSpec) {
  const factor = key => Math.max(0, Number(renderSpec[key] ?? 100)) / 100;
  const contrast = factor('contrast'), brightness = factor('brightness'), saturation = factor('saturation');
  const clamp = value => Math.max(0, Math.min(1, value));
  const channels = [1, 3, 5].map(index => clamp((parseInt(color.slice(index, index + 2), 16) / 255 - 0.5) * contrast + 0.5))
    .map(channel => clamp(channel * brightness));
  const luminance = channels[0] * 0.213 + channels[1] * 0.715 + channels[2] * 0.072;
  return `#${channels.map(channel => Math.round(clamp(luminance + saturation * (channel - luminance)) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Collects all supported visible geometry, preserving each styled layer's color.
 * @param {Object} renderSpec - Immutable live render settings.
 * @param {Object} targetMap - Loaded preview or isolated detail map.
 * @param {Object} materials - Mutable RGB palette passed to the mesh writer.
 * @returns {Object} Feature arrays grouped by mesh role.
 * @throws {Error} When an explicit device safety budget is exceeded.
 */
function getVisibleCityFeatures(renderSpec, targetMap = map, materials = { ...renderSpec.model.materials }) {
  const result = Object.fromEntries(CartivaLayerRegistry.definitions
    .filter(definition => definition.featureKey).map(definition => [definition.featureKey, []]));
  result.contours = [];
  result.overlays = [];
  const layers = targetMap.getStyle().layers || [];
  const zoom = targetMap.getZoom();
  const bounds = targetMap.getBounds();
  const previewWidth = Math.max(1, Number(renderSpec.previewMapSize?.width) || targetMap.getContainer().clientWidth);
  const targetWidth = Math.max(1, targetMap.getContainer().clientWidth);
  const pixelsToMm = 160 / targetWidth;
  let featureCount = 0;
  let coordinateCount = 0;
  let unsupported = 0;
  const unsupportedStyles = new Set();

  layers.forEach((layer, drawOrder) => {
    if (!['fill', 'line', 'fill-extrusion'].includes(layer.type)) return;
    const role = getLayerRole(layer);
    const definition = CartivaLayerRegistry.definitions.find(item => item.role === role && item.featureKey);
    const contour = layer.id === 'cartiva-contours';
    const overlay = layer.source === 'cartiva-user-geojson';
    if (!definition && !contour && !overlay) return;
    if (definition && (renderSpec.layers[definition.toggleId] === false || Number(renderSpec.layers[definition.opacityId] ?? 100) <= 0)) return;
    if (contour && !renderSpec.contourEnabled) return;
    // Refinement must not bring back buildings hidden at the live zoom threshold.
    if (role === 'building' && renderSpec.zoom < Number(renderSpec.buildingMinZoom ?? 10.5)) return;
    if (targetMap.getLayoutProperty(layer.id, 'visibility') === 'none' || layer.layout?.visibility === 'none') return;
    if (zoom < (layer.minzoom ?? 0) || zoom >= (layer.maxzoom ?? 25)) return;
    const prefix = layer.type === 'fill-extrusion' ? 'fill-extrusion' : layer.type;
    const opacity = targetMap.getPaintProperty(layer.id, `${prefix}-opacity`) ?? layer.paint?.[`${prefix}-opacity`] ?? 1;
    const color = targetMap.getPaintProperty(layer.id, `${prefix}-color`) ?? layer.paint?.[`${prefix}-color`];
    const width = layer.type === 'line' ? targetMap.getPaintProperty(layer.id, 'line-width') ?? layer.paint?.['line-width'] : null;
    const accent = (role === 'forest' && /park|recreation|pitch/i.test(layer.id))
      || (role === 'landCover' && /residential/i.test(layer.id));
    const broadMaterial = overlay ? (layer.type === 'line' ? 'overlayLine' : 'overlayFill')
      : contour ? 'contour' : accent ? `${definition.material}Accent` : definition.material;
    const fallback = materials[broadMaterial] || materials[definition?.material] || renderSpec.mountainColor;
    const seen = new Set();
    targetMap.queryRenderedFeatures({ layers: [layer.id] }).forEach(feature => {
      const resolvedOpacity = evaluateModelStyle(opacity, feature, zoom);
      if (Number.isFinite(Number(resolvedOpacity)) && Number(resolvedOpacity) <= 0) return;
      let geometry = feature.geometry;
      if (!geometry?.coordinates || !['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'].includes(geometry.type)) {
        unsupported += 1;
        return;
      }
      geometry = getModelFootprintGeometry(geometry, bounds);
      if (!geometry) return;
      const key = `${feature.source || ''}:${feature.sourceLayer || ''}:${JSON.stringify(geometry)}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (layer.type === 'line' && ['Polygon', 'MultiPolygon'].includes(geometry.type)) {
        geometry = { type: 'MultiLineString', coordinates: geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat() };
      }
      const resolvedColor = evaluateModelStyle(color, feature, zoom);
      if (Array.isArray(color) && resolvedColor == null) unsupportedStyles.add(layer.id);
      const hex = normalizeModelColor(resolvedColor, fallback);
      const material = hex.toLowerCase() === String(materials[broadMaterial]).toLowerCase()
        ? broadMaterial : `color_${hex.slice(1).toLowerCase()}`;
      materials[material] = hex;
      const resolvedWidth = evaluateModelStyle(width, feature, zoom);
      if (layer.type === 'line' && Number.isFinite(resolvedWidth) && resolvedWidth <= 0) return;
      const collection = contour ? 'contours'
        : overlay || role === 'building' && layer.type === 'line' ? 'overlays' : definition.featureKey;
      const exportedFeature = {
        type: 'Feature', properties: {}, geometry,
        cartivaMaterial: material,
        cartivaLayer: layer.id,
        cartivaDrawOrder: drawOrder,
        // A modest physical minimum keeps fine preview strokes printable.
        cartivaLineWidth: Math.max(0.08, (Number.isFinite(resolvedWidth) ? resolvedWidth : 2 * targetWidth / previewWidth) * pixelsToMm)
      };
      result[collection].push(exportedFeature);
      featureCount += 1;
      coordinateCount += countModelCoordinates(geometry.coordinates);
      if (featureCount > MODEL_EXPORT_LIMITS.features || coordinateCount > MODEL_EXPORT_LIMITS.coordinates) {
        throw new Error(`3D export exceeds the safe device limit (${MODEL_EXPORT_LIMITS.features.toLocaleString()} styled features or ${MODEL_EXPORT_LIMITS.coordinates.toLocaleString()} coordinates). Zoom in or hide layers; no features were silently omitted.`);
      }
    });
  });
  if (unsupported || unsupportedStyles.size) {
    CartivaDiagnostics.record('model.export', 'Unsupported point geometry or style expressions cannot be reproduced by the mesh renderer.', {
      unsupportedGeometry: unsupported, fallbackColorLayers: [...unsupportedStyles]
    }, 'warn');
  }
  return result;
}

/**
 * Builds a model from a bounded detail map without mutating the live preview.
 * @param {Object} renderSpec - The captured render settings.
 * @param {string} area - Operation diagnostics area.
 * @returns {Promise<Object>} The rotated mesh and its RGB material palette.
 */
async function createVisibleModelMesh(renderSpec, area) {
  const preview = renderSpec.previewMapSize;
  const requestedScale = 2 ** (typeof REFINED_PREVIEW_ZOOM_BOOST === 'number' ? REFINED_PREVIEW_ZOOM_BOOST : 1.5);
  const maxSide = typeof REFINED_PREVIEW_MAX_SIDE === 'number' ? REFINED_PREVIEW_MAX_SIDE : 2048;
  const scale = Math.min(requestedScale, maxSide / Math.max(preview.width, preview.height));
  let exportMap;
  let container;
  const materials = { ...renderSpec.model.materials };
  let bounds;
  let cityFeatures;
  try {
    ({ exportMap, container } = await createExportMap(
      Math.max(1, Math.round(preview.width * scale)),
      Math.max(1, Math.round(preview.height * scale)),
      renderSpec,
      { includeContours: true }
    ));
    bounds = exportMap.getBounds();
    cityFeatures = getVisibleCityFeatures(renderSpec, exportMap, materials);
  } finally {
    exportMap?.remove();
    container?.remove();
  }
  CartivaDiagnostics.record(area, 'Visible detail-map features collected without truncation.', {
    featureCounts: Object.fromEntries(Object.entries(cityFeatures).map(([role, features]) => [role, features.length])),
    materialCount: Object.keys(materials).length,
    terrainEnabled: renderSpec.terrainEnabled
  });
  const grid = renderSpec.terrainEnabled
    ? await getElevationGrid(bounds)
    : { size: 65, heights: Array(65 * 65).fill(0) };
  const mesh = rotateMeshToMapBearing(
    createVisibleTerrainMesh(grid.heights, grid.size, bounds, renderSpec.terrainEnabled ? renderSpec.terrainExaggeration : 0, cityFeatures),
    renderSpec.bearing
  );
  Object.keys(materials).forEach(material => {
    // The physical support is not part of the map image's CSS color treatment.
    if (material !== 'base') materials[material] = filterModelColor(normalizeModelColor(materials[material], '#808080'), renderSpec);
  });
  return { mesh, materials };
}

/**
 * Runs the common model export workflow for STL and colored 3MF.
 * @param {string} format - The requested model extension.
 * @param {HTMLElement} button - The initiating export button.
 * @returns {Promise<*>} The tracked export operation.
 */
function exportVisibleModel(format, button) {
  const area = `${format}.export`;
  const label = format === 'stl' ? 'STL' : '3MF';
  return CartivaOperations.run({
    area, button,
    startStatus: 'Loading visible map detail for 3D model...',
    successStatus: '3D model exported.',
    successNotification: format === 'stl'
      ? 'STL export finished. STL color support varies by viewer; use 3MF for reliable colors.'
      : '3MF export finished.',
    errorPrefix: '3D model export failed',
    errorNotificationPrefix: `${label} export failed`
  }, async () => {
    const renderSpec = createRenderSnapshot();
    const { mesh, materials } = await createVisibleModelMesh(renderSpec, area);
    const model = format === 'stl' ? createTerrainStl(mesh, materials) : createVisibleThreeMf(mesh, materials);
    CartivaDiagnostics.record(area, `${label} mesh generated.`, { triangles: mesh.triangleMaterials.length });
    const name = `cartiva_${renderSpec.city.trim().replace(/\s+/g, '_')}_${getFileTimestamp()}.${format}`;
    downloadBlob(model, name);
    if (renderSpec.includeExportMetadata) downloadExportMetadata(renderSpec, name.replace(/\.(stl|3mf)$/, ''));
    $('exportDialog').close();
  });
}

$('stlExportBtn').addEventListener('click', () => exportVisibleModel('stl', $('stlExportBtn')));
$('threeMfExportBtn').addEventListener('click', () => exportVisibleModel('3mf', $('threeMfExportBtn')));
