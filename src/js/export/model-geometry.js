// Visible-model extensions reuse the established relief and shoreline engine.
/**
 * Adds clipped, material-aware preview geometry to the established terrain mesh.
 * @param {Array<number>} heights - Elevation samples in north-to-south order.
 * @param {number} size - Square elevation grid size.
 * @param {Object} bounds - Model geographic bounds.
 * @param {number} exaggeration - Relief percentage.
 * @param {Object} cityFeatures - Supported visible feature collections.
 * @returns {Object} Triangle vertices and parallel material keys.
 */
function createVisibleTerrainMesh(heights, size, bounds, exaggeration, cityFeatures) {
  const water = (cityFeatures.water || []).filter(feature => /Polygon$/.test(feature.geometry.type));
  const mesh = createTerrainMesh(heights, size, bounds, exaggeration, { water });
  const latitude = (bounds.getNorth() + bounds.getSouth()) / 2;
  const widthMeters = (bounds.getEast() - bounds.getWest()) * 111320 * Math.cos(latitude * Math.PI / 180);
  const depthMeters = (bounds.getNorth() - bounds.getSouth()) * 110540;
  const width = 160;
  const depth = Math.max(20, width * depthMeters / Math.max(widthMeters, 1));
  const sampleHeights = Array(size * size).fill(2);
  // The established engine emits two upper and two base triangles per grid cell.
  for (let row = 0; row < size - 1; row += 1) {
    for (let column = 0; column < size - 1; column += 1) {
      const offset = (row * (size - 1) + column) * 12;
      sampleHeights[row * size + column] = mesh.triangles[offset][2];
      sampleHeights[(row + 1) * size + column] = mesh.triangles[offset + 1][2];
      sampleHeights[row * size + column + 1] = mesh.triangles[offset + 2][2];
      sampleHeights[(row + 1) * size + column + 1] = mesh.triangles[offset + 5][2];
    }
  }
  const heightAt = (x, y) => {
    const column = Math.max(0, Math.min(size - 1, x / width * (size - 1)));
    const row = Math.max(0, Math.min(size - 1, (1 - y / depth) * (size - 1)));
    const left = Math.floor(column), top = Math.floor(row);
    const right = Math.min(size - 1, left + 1), bottom = Math.min(size - 1, top + 1);
    const horizontal = column - left, vertical = row - top;
    return sampleHeights[top * size + left] * (1 - horizontal) * (1 - vertical)
      + sampleHeights[top * size + right] * horizontal * (1 - vertical)
      + sampleHeights[bottom * size + left] * (1 - horizontal) * vertical
      + sampleHeights[bottom * size + right] * horizontal * vertical;
  };
  const project = ([longitude, lat]) => [
    (longitude - bounds.getWest()) / (bounds.getEast() - bounds.getWest()) * width,
    (lat - bounds.getSouth()) / (bounds.getNorth() - bounds.getSouth()) * depth
  ];
  const clipRing = ring => {
    let points = ring.map(project).filter(point => point.every(Number.isFinite));
    if (points.length > 1 && points[0].every((value, index) => value === points.at(-1)[index])) points.pop();
    for (const [axis, limit, greater] of [[0, 0, true], [0, width, false], [1, 0, true], [1, depth, false]]) {
      if (!points.length) break;
      const output = [];
      let previous = points.at(-1);
      const inside = point => greater ? point[axis] >= limit : point[axis] <= limit;
      for (const current of points) {
        if (inside(previous) !== inside(current)) {
          const ratio = (limit - previous[axis]) / (current[axis] - previous[axis]);
          output.push(previous.map((value, index) => value + (current[index] - value) * ratio));
        }
        if (inside(current)) output.push(current);
        previous = current;
      }
      points = output;
    }
    return points;
  };
  const insideRing = (point, ring) => {
    let inside = false;
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
      const a = ring[index], b = ring[previous];
      if ((a[1] > point[1]) !== (b[1] > point[1])
        && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  };
  const waterRegions = water.flatMap(feature => {
    const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    return polygons.map(polygon => ({ rings: polygon.map(clipRing), material: feature.cartivaMaterial || 'water' }))
      .filter(region => region.rings[0]?.length >= 3);
  });
  // Keep connected-water leveling and island holes, but restore the layer palette.
  mesh.triangleMaterials.forEach((material, index) => {
    if (material !== 'water') return;
    const vertices = mesh.triangles.slice(index * 3, index * 3 + 3);
    const center = [0, 1].map(axis => vertices.reduce((sum, point) => sum + point[axis], 0) / 3);
    const region = waterRegions.findLast(candidate => insideRing(center, candidate.rings[0])
      && !candidate.rings.slice(1).some(hole => insideRing(center, hole)));
    if (region) mesh.triangleMaterials[index] = region.material;
  });
  const add = (a, b, c, material) => {
    if (![a, b, c].every(point => point.every(Number.isFinite))) throw new Error('3D geometry contains invalid coordinates.');
    mesh.triangles.push(a, b, c);
    mesh.triangleMaterials.push(material);
    if (mesh.triangleMaterials.length > 1500000) {
      throw new Error('3D export exceeds the safe limit of 1,500,000 triangles. Zoom in or hide layers; no partial model was downloaded.');
    }
  };
  const addPolygon = (polygon, material, elevation) => {
    const rings = polygon.map(clipRing);
    if (rings[0]?.length < 3) return;
    const valid = [rings[0], ...rings.slice(1).filter(ring => ring.length >= 3)];
    const points = valid.flat();
    let offset = 0;
    const holes = valid.slice(0, -1).map(ring => { offset += ring.length; return offset; });
    const top = points.map(([x, y]) => [x, y, heightAt(x, y) + elevation]);
    const indices = earcut(points.flat(), holes, 2);
    for (let index = 0; index < indices.length; index += 3) {
      add(top[indices[index]], top[indices[index + 1]], top[indices[index + 2]], material);
    }
    offset = 0;
    valid.forEach(ring => {
      ring.forEach((_, index) => {
        const a = top[offset + index], b = top[offset + (index + 1) % ring.length];
        const lowerA = [a[0], a[1], heightAt(a[0], a[1])];
        const lowerB = [b[0], b[1], heightAt(b[0], b[1])];
        add(a, b, lowerA, material); add(b, lowerB, lowerA, material);
      });
      offset += ring.length;
    });
  };
  const addSegment = (first, second, material, elevation, lineWidth) => {
    const a = project(first), b = project(second);
    if (![...a, ...b].every(Number.isFinite)) throw new Error('3D line contains invalid coordinates.');
    const delta = [b[0] - a[0], b[1] - a[1]];
    let start = 0, end = 1;
    for (const [p, q] of [[-delta[0], a[0]], [delta[0], width - a[0]], [-delta[1], a[1]], [delta[1], depth - a[1]]]) {
      if (!p) { if (q < 0) return; continue; }
      const ratio = q / p;
      if (p < 0) start = Math.max(start, ratio);
      else end = Math.min(end, ratio);
      if (start > end) return;
    }
    const firstPoint = a.map((value, axis) => value + delta[axis] * start);
    const lastPoint = a.map((value, axis) => value + delta[axis] * end);
    const length = Math.hypot(lastPoint[0] - firstPoint[0], lastPoint[1] - firstPoint[1]);
    if (length < 0.000001) return;
    const halfWidth = Math.max(0.04, Number(lineWidth) / 2 || 0.15);
    const perpendicular = [-(lastPoint[1] - firstPoint[1]) / length * halfWidth, (lastPoint[0] - firstPoint[0]) / length * halfWidth];
    const ring = [
      firstPoint.map((value, axis) => value + perpendicular[axis]),
      firstPoint.map((value, axis) => value - perpendicular[axis]),
      lastPoint.map((value, axis) => value - perpendicular[axis]),
      lastPoint.map((value, axis) => value + perpendicular[axis])
    ].map(([x, y]) => [
      bounds.getWest() + x / width * (bounds.getEast() - bounds.getWest()),
      bounds.getSouth() + y / depth * (bounds.getNorth() - bounds.getSouth())
    ]);
    addPolygon([ring], material, elevation);
  };
  const collections = [
    ['forest', 'forest', 0.2], ['landCover', 'landCover', 0.25], ['water', 'water', 0.45],
    ['roads', 'road', 0.9], ['boundary', 'boundary', 0.6], ['buildings', 'building', 4],
    ['contours', 'contour', 0.65], ['overlays', 'overlayFill', 1.05]
  ];
  collections.forEach(([key, fallback, elevation]) => {
    (cityFeatures[key] || []).forEach(feature => {
      const geometry = feature.geometry;
      const material = feature.cartivaMaterial || fallback;
      const layerOffset = Math.max(0, Number(feature.cartivaDrawOrder) || 0) * 0.0001;
      const height = (key === 'overlays' && /building/i.test(feature.cartivaLayer || '') ? 4.02 : elevation) + layerOffset;
      const polygons = geometry.type === 'Polygon' ? [geometry.coordinates]
        : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
      if (key !== 'water') polygons.forEach(polygon => addPolygon(polygon, material, height));
      const lines = geometry.type === 'LineString' ? [geometry.coordinates]
        : geometry.type === 'MultiLineString' ? geometry.coordinates : [];
      lines.forEach(line => line.slice(1).forEach((point, index) =>
        addSegment(line[index], point, material, height, feature.cartivaLineWidth)));
    });
  });
  CartivaDiagnostics.record('model.geometry', 'Visible polygons, clipped strokes, holes and layer materials generated.', {
    triangles: mesh.triangleMaterials.length, waterRegions: waterRegions.length
  });
  return mesh;
}

/**
 * Writes all visible material colors as a standards-compliant 3MF palette.
 * @param {Object} mesh - Triangle vertices and material keys.
 * @param {Object} colors - Six-digit RGB colors indexed by material.
 * @returns {Blob} A stored ZIP containing the colored 3MF model.
 */
function createVisibleThreeMf(mesh, colors) {
  const legacy = ['terrain', 'forest', 'landCover', 'water', 'boundary', 'road', 'building', 'base'];
  const names = ['Land', 'Nature', 'Urban areas', 'Water', 'Boundaries', 'Streets', 'Buildings', 'Base and sides'];
  const materials = [...legacy, ...Object.keys(colors).filter(key => !legacy.includes(key))];
  const indices = new Map(materials.map((material, index) => [material, index]));
  const bases = materials.map((material, index) => {
    const color = colors[material] || (material === 'base' ? '#8b5e3c' : colors.terrain) || '#808080';
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error(`Invalid 3MF material color: ${material}`);
    return `<base name="${names[index] || `Layer color ${index}`}" displaycolor="${color.toUpperCase()}FF"/>`;
  }).join('');
  const vertices = mesh.triangles.map(vertex => `<vertex x="${vertex[0]}" y="${vertex[1]}" z="${vertex[2]}"/>`).join('');
  const triangles = mesh.triangleMaterials.map((material, index) => {
    if (!indices.has(material)) throw new Error(`Missing 3MF material: ${material}`);
    return `<triangle v1="${index * 3}" v2="${index * 3 + 1}" v3="${index * 3 + 2}" pid="1" p1="${indices.get(material)}"/>`;
  }).join('');
  const model = `<?xml version="1.0" encoding="UTF-8"?><model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" unit="millimeter" xml:lang="en-US"><resources><basematerials id="1">${bases}</basematerials><object id="2" type="model" pid="1" pindex="0"><mesh><vertices>${vertices}</vertices><triangles>${triangles}</triangles></mesh></object></resources><build><item objectid="2"/></build></model>`;
  return createStoredZip([
    { name: '[Content_Types].xml', content: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>' },
    { name: '_rels/.rels', content: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>' },
    { name: '3D/3dmodel.model', content: model }
  ]);
}
