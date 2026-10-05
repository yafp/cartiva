// EXPORT STATE BUILDER
// Constructs a comprehensive snapshot for high-resolution export:
// - All settings from controls/state
// - Map bounds and camera
// - Overlay geometry and label metrics for precise placement
// -----------------------------------------------------------------------------
    // The export and preview begin from the same normalized live render snapshot.
    function createRenderSnapshot() {
      syncStateFromControls();
      return getExportState();
    }

    function getExportState() {
      const labelModel = getLabelRenderModel(map);
      return CartivaRenderSpec.create(state, {
        dimensions: getTargetDimensions(state.format, state.exportDpi),
        camera: {
          center: map.getCenter().toArray(),
          zoom: map.getZoom(),
          bearing: map.getBearing(),
          pitch: map.getPitch()
        },
        bounds: map.getBounds().toArray(),
        previewMapSize: {
          width: map.getContainer().clientWidth,
          height: map.getContainer().clientHeight
        },
        overlay: labelModel
      });
    }


// -----------------------------------------------------------------------------

// HIGH-RES EXPORT ENGINE
// - Optional Web Worker for PDF generation
// - Helper to download blobs (images, SVG, PDF, STL, 3MF)
// - Elevation grid fetch from Terrarium tiles
// - Terrain mesh generation with buildings/roads/water
// - STL and colored 3MF export
// - Canvas/SVG/PDF/image export with labels and annotations
// -----------------------------------------------------------------------------
    // High-Res Export Engine & Download Handlers
    const exportBtn = document.getElementById('exportBtn');
    const imageExportBtnLabel = document.getElementById('imageExportBtnLabel');
    const exportDialog = document.getElementById('exportDialog');
    const exportConfirmBtn = document.getElementById('exportConfirmBtn');
    const exportCancelBtn = document.getElementById('exportCancelBtn');
    const exportDialogCloseBtn = document.getElementById('exportDialogCloseBtn');

    function selectExportTab(models) {
      $('exportImagesPanel').hidden = models;
      $('exportModelsPanel').hidden = !models;
      $('exportImagesTab').setAttribute('aria-selected', String(!models));
      $('exportModelsTab').setAttribute('aria-selected', String(models));
      $('exportConfirmBtn').hidden = models;
    }
    $('exportImagesTab').addEventListener('click', () => selectExportTab(false));
    $('exportModelsTab').addEventListener('click', () => selectExportTab(true));

    exportBtn.addEventListener('click', () => {
      updateOutputDimensions();
      setStatus('');
      selectExportTab(false);
      exportDialog.showModal();
    });
    [exportCancelBtn, exportDialogCloseBtn].forEach(button => {
      button.addEventListener('click', () => {
        if (!runtimeState.operations['image.export']) exportDialog.close();
      });
    });
    exportDialog.addEventListener('cancel', event => {
      if (runtimeState.operations['image.export']) event.preventDefault();
    });
    const pdfExporter = CartivaPdfExporter.create();
    function lngLatToTile(lng, lat, zoom) {
      const latitude = Math.max(-85.05112878, Math.min(85.05112878, lat));
      const scale = 2 ** zoom;
      return {
        x: ((lng + 180) / 360) * scale,
        y: (1 - Math.asinh(Math.tan(latitude * Math.PI / 180)) / Math.PI) / 2 * scale
      };
    }

    const elevationTileCache = CartivaCache.create(120);

    async function getElevationGrid(bounds, size = 65, zoom = 12) {
      async function loadTile(tileX, tileY) {
        const scale = 2 ** zoom;
        const wrappedX = ((tileX % scale) + scale) % scale;
        const key = `${wrappedX}/${tileY}`;
        if (elevationTileCache.has(`${zoom}:${key}`)) return elevationTileCache.get(`${zoom}:${key}`);
        const tilePromise = (async () => {
          const response = await fetch(TERRAIN_TILES_URL.replace('{z}', zoom).replace('{x}', wrappedX).replace('{y}', tileY));
          if (!response.ok) throw new Error('Elevation data is unavailable for this location.');
          const bitmap = await createImageBitmap(await response.blob());
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 256;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          context.drawImage(bitmap, 0, 0);
          bitmap.close();
          return context.getImageData(0, 0, 256, 256).data;
        })().catch(error => { CartivaDiagnostics.report('terrain', error, { key }); throw error; });
        elevationTileCache.set(`${zoom}:${key}`, tilePromise);
        return tilePromise;
      }
      const heights = await Promise.all(Array.from({ length: size * size }, async (_, index) => {
        const row = Math.floor(index / size);
        const column = index % size;
        const lng = bounds.getWest() + (bounds.getEast() - bounds.getWest()) * (column / (size - 1));
        const lat = bounds.getNorth() + (bounds.getSouth() - bounds.getNorth()) * (row / (size - 1));
        const position = lngLatToTile(lng, lat, zoom);
        const tileX = Math.floor(position.x);
        const tileY = Math.floor(position.y);
        const pixels = await loadTile(tileX, tileY);
        const pixelX = Math.max(0, Math.min(255, Math.floor((position.x - tileX) * 256)));
        const pixelY = Math.max(0, Math.min(255, Math.floor((position.y - tileY) * 256)));
        const offset = (pixelY * 256 + pixelX) * 4;
        return pixels[offset] * 256 + pixels[offset + 1] + pixels[offset + 2] / 256 - 32768;
      }));
      return { heights, size };
    }

    function createTerrainMesh(heights, size, bounds, exaggeration, cityFeatures = {}) {
      const latitude = (bounds.getNorth() + bounds.getSouth()) / 2;
      const widthMeters = (bounds.getEast() - bounds.getWest()) * 111320 * Math.cos(latitude * Math.PI / 180);
      const depthMeters = (bounds.getNorth() - bounds.getSouth()) * 110540;
      const widthMm = 160;
      const depthMm = Math.max(20, widthMm * depthMeters / Math.max(widthMeters, 1));
      const elevations = [...heights];
      const minimum = Math.min(...heights);
      const metersToMm = widthMm / Math.max(widthMeters, 1) * Math.max(0, Number(exaggeration) || 0) / 100;
      const modelHeight = elevation => 2 + Math.max(0, elevation - minimum) * metersToMm;
      const heightAt = index => modelHeight(elevations[index]);
      const vertexAt = (row, column, base = false) => [column * widthMm / (size - 1), (size - 1 - row) * depthMm / (size - 1), base ? 0 : heightAt(row * size + column)];
      const triangles = [];
      const triangleMaterials = [];
      const add = (a, b, c, material = 'terrain') => { triangles.push(a, b, c); triangleMaterials.push(material); };
      /** Uses Earcut for concave surfaces and island holes. */
      const triangulatePolygon = (points, holes = []) => {
        const indices = earcut(points.flatMap(point => point.slice(0, 2)), holes, 2);
        return Array.from({ length: indices.length / 3 }, (_, index) => indices.slice(index * 3, index * 3 + 3));
      };
      const terrainHeightAt = (x, y) => {
        const column = Math.max(0, Math.min(size - 1, x / widthMm * (size - 1)));
        const row = Math.max(0, Math.min(size - 1, (1 - y / depthMm) * (size - 1)));
        const left = Math.floor(column), top = Math.floor(row);
        const right = Math.min(size - 1, left + 1), bottom = Math.min(size - 1, top + 1);
        const horizontal = column - left, vertical = row - top;
        return heightAt(top * size + left) * (1 - horizontal) * (1 - vertical)
          + heightAt(top * size + right) * horizontal * (1 - vertical)
          + heightAt(bottom * size + left) * (1 - horizontal) * vertical
          + heightAt(bottom * size + right) * horizontal * vertical;
      };
      const pointFromCoordinate = coordinate => {
        const [lng, lat] = coordinate;
        if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < bounds.getWest() || lng > bounds.getEast() || lat < bounds.getSouth() || lat > bounds.getNorth()) return null;
        return [
          (lng - bounds.getWest()) / (bounds.getEast() - bounds.getWest()) * widthMm,
          (lat - bounds.getSouth()) / (bounds.getNorth() - bounds.getSouth()) * depthMm
        ];
      };
      const clipRingToModelBounds = ring => {
        let points = ring.map(coordinate => {
          const [lng, lat] = coordinate;
          return [
            (lng - bounds.getWest()) / (bounds.getEast() - bounds.getWest()) * widthMm,
            (lat - bounds.getSouth()) / (bounds.getNorth() - bounds.getSouth()) * depthMm
          ];
        }).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
        if (points.length > 1 && points[0][0] === points.at(-1)[0] && points[0][1] === points.at(-1)[1]) points.pop();
        const clip = (inside, intersect) => {
          if (!points.length) return;
          const output = [];
          let previous = points.at(-1);
          for (const current of points) {
            const previousInside = inside(previous);
            const currentInside = inside(current);
            if (currentInside !== previousInside) output.push(intersect(previous, current));
            if (currentInside) output.push(current);
            previous = current;
          }
          points = output;
        };
        const verticalIntersection = (x, start, end) => {
          const ratio = (x - start[0]) / (end[0] - start[0]);
          return [x, start[1] + (end[1] - start[1]) * ratio];
        };
        const horizontalIntersection = (y, start, end) => {
          const ratio = (y - start[1]) / (end[1] - start[1]);
          return [start[0] + (end[0] - start[0]) * ratio, y];
        };
        clip(point => point[0] >= 0, (start, end) => verticalIntersection(0, start, end));
        clip(point => point[0] <= widthMm, (start, end) => verticalIntersection(widthMm, start, end));
        clip(point => point[1] >= 0, (start, end) => horizontalIntersection(0, start, end));
        clip(point => point[1] <= depthMm, (start, end) => horizontalIntersection(depthMm, start, end));
        return points;
      };
      const pointIsInsideRing = (point, ring) => {
        let inside = false;
        for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
          const currentPoint = ring[index];
          const previousPoint = ring[previous];
          const crossesLatitude = (currentPoint[1] > point[1]) !== (previousPoint[1] > point[1]);
          if (crossesLatitude) {
            const crossingX = (previousPoint[0] - currentPoint[0]) * (point[1] - currentPoint[1]) / (previousPoint[1] - currentPoint[1]) + currentPoint[0];
            if (point[0] < crossingX) inside = !inside;
          }
        }
        return inside;
      };
      const waterPolygons = (cityFeatures.water || []).flatMap(feature => {
        const coordinates = feature.geometry?.coordinates;
        const polygons = feature.geometry?.type === 'Polygon'
          ? [coordinates]
          : feature.geometry?.type === 'MultiPolygon'
            ? coordinates
            : [];
        return (polygons || []).map(polygon => polygon.map(clipRingToModelBounds)).filter(rings => rings[0]?.length >= 3).map(([ring, ...holes]) => ({
          ring, holes: holes.filter(hole => hole.length >= 3),
          minX: Math.min(...ring.map(point => point[0])),
          maxX: Math.max(...ring.map(point => point[0])),
          minY: Math.min(...ring.map(point => point[1])),
          maxY: Math.max(...ring.map(point => point[1]))
        }));
      });
      /** Measures proximity to shorelines so grid cells cannot protrude through the water. */
      const distanceToRing = (point, ring) => Math.min(...ring.map((start, index) => {
        const end = ring[(index + 1) % ring.length];
        const deltaX = end[0] - start[0], deltaY = end[1] - start[1];
        const lengthSquared = deltaX * deltaX + deltaY * deltaY;
        const ratio = lengthSquared ? Math.max(0, Math.min(1, ((point[0] - start[0]) * deltaX + (point[1] - start[1]) * deltaY) / lengthSquared)) : 0;
        return Math.hypot(point[0] - start[0] - ratio * deltaX, point[1] - start[1] - ratio * deltaY);
      }));
      const insideWater = (point, polygon) => pointIsInsideRing(point, polygon.ring) && !polygon.holes.some(hole => pointIsInsideRing(point, hole));
      const shorelineMargin = Math.hypot(widthMm, depthMm) / (size - 1);
      waterPolygons.forEach(polygon => {
        const samples = [];
        heights.forEach((height, index) => {
          const point = vertexAt(Math.floor(index / size), index % size);
          if (insideWater(point, polygon)) samples.push(height);
        });
        if (!samples.length) polygon.ring.forEach(([x, y]) => {
          const column = Math.max(0, Math.min(size - 1, Math.round(x / widthMm * (size - 1))));
          const row = Math.max(0, Math.min(size - 1, Math.round((1 - y / depthMm) * (size - 1))));
          samples.push(heights[row * size + column]);
        });
        samples.sort((left, right) => left - right);
        polygon.level = samples[Math.floor((samples.length - 1) * 0.1)];
        polygon.group = { level: polygon.level };
      });
      waterPolygons.forEach((polygon, index) => {
        waterPolygons.slice(index + 1).forEach(other => {
          if (polygon.maxX < other.minX || polygon.minX > other.maxX || polygon.maxY < other.minY || polygon.minY > other.maxY) return;
          const connected = polygon.ring.some(point => insideWater(point, other) || distanceToRing(point, other.ring) < 0.00001)
            || other.ring.some(point => insideWater(point, polygon) || distanceToRing(point, polygon.ring) < 0.00001);
          if (!connected || polygon.group === other.group) return;
          const previousGroup = other.group;
          polygon.group.level = Math.min(polygon.group.level, previousGroup.level);
          waterPolygons.forEach(candidate => { if (candidate.group === previousGroup) candidate.group = polygon.group; });
        });
      });
      elevations.forEach((height, index) => {
        const point = vertexAt(Math.floor(index / size), index % size);
        waterPolygons.forEach(polygon => {
          if (point[0] < polygon.minX - shorelineMargin || point[0] > polygon.maxX + shorelineMargin || point[1] < polygon.minY - shorelineMargin || point[1] > polygon.maxY + shorelineMargin) return;
          if (polygon.holes.some(hole => pointIsInsideRing(point, hole))) return;
          if (insideWater(point, polygon) || distanceToRing(point, polygon.ring) <= shorelineMargin) elevations[index] = polygon.group.level;
        });
      });
      const terrainMaterialAt = vertices => {
        const point = [
          vertices.reduce((sum, vertex) => sum + vertex[0], 0) / vertices.length,
          vertices.reduce((sum, vertex) => sum + vertex[1], 0) / vertices.length
        ];
        return waterPolygons.some(polygon =>
          point[0] >= polygon.minX && point[0] <= polygon.maxX &&
          point[1] >= polygon.minY && point[1] <= polygon.maxY &&
          insideWater(point, polygon)
        ) ? 'water' : 'terrain';
      };
      const addBuilding = ring => {
        const points = ring.map(pointFromCoordinate);
        if (points.some(point => !point)) return;
        if (points.length < 4) return;
        const top = points.slice(0, -1).map(([x, y]) => [x, y, terrainHeightAt(x, y) + 4]);
        if (top.length < 3) return;
        const trianglesForTop = triangulatePolygon(top);
        if (trianglesForTop) trianglesForTop.forEach(([a, b, c]) => add(top[a], top[b], top[c], 'building'));
        top.forEach((point, index) => {
          const next = top[(index + 1) % top.length];
          const base = [point[0], point[1], terrainHeightAt(point[0], point[1])];
          const nextBase = [next[0], next[1], terrainHeightAt(next[0], next[1])];
          add(point, next, base, 'building'); add(next, nextBase, base, 'building');
        });
      };
      const addSurface = (ring, material, height, waterPolygon = null) => {
        const rings = waterPolygon ? [waterPolygon.ring, ...waterPolygon.holes] : [clipRingToModelBounds(ring)];
        const points = rings.flat();
        if (points.length < 3) return;
        const top = points.map(([x, y]) => [x, y, (waterPolygon ? modelHeight(waterPolygon.group.level) : terrainHeightAt(x, y)) + height]);
        if (top.length < 3) return;
        let holeOffset = 0;
        const holeIndices = rings.slice(0, -1).map(pointsInRing => { holeOffset += pointsInRing.length; return holeOffset; });
        const trianglesForTop = triangulatePolygon(top, holeIndices);
        if (trianglesForTop) trianglesForTop.forEach(([a, b, c]) => add(top[a], top[b], top[c], material));
        let ringOffset = 0;
        rings.forEach(pointsInRing => {
        pointsInRing.forEach((_, index) => {
          const point = top[ringOffset + index];
          const next = top[ringOffset + (index + 1) % pointsInRing.length];
          const base = [point[0], point[1], terrainHeightAt(point[0], point[1])];
          const nextBase = [next[0], next[1], terrainHeightAt(next[0], next[1])];
          add(point, next, base, material); add(next, nextBase, base, material);
        });
        ringOffset += pointsInRing.length;
        });
      };
      const addPathSegment = (start, end, material, height, halfWidth) => {
        const a = pointFromCoordinate(start), b = pointFromCoordinate(end);
        if (!a || !b) return;
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (length < 0.1) return;
        const offsetX = -(b[1] - a[1]) / length * halfWidth, offsetY = (b[0] - a[0]) / length * halfWidth;
        const lower = [[a[0] + offsetX, a[1] + offsetY], [a[0] - offsetX, a[1] - offsetY], [b[0] - offsetX, b[1] - offsetY], [b[0] + offsetX, b[1] + offsetY]];
        const bottom = lower.map(([x, y]) => [x, y, terrainHeightAt(x, y)]);
        const top = lower.map(([x, y]) => [x, y, terrainHeightAt(x, y) + height]);
        add(top[0], top[1], top[2], material); add(top[0], top[2], top[3], material);
        for (let index = 0; index < 4; index += 1) { const next = (index + 1) % 4; add(top[index], top[next], bottom[index], material); add(top[next], bottom[next], bottom[index], material); }
      };
      for (let row = 0; row < size - 1; row += 1) for (let column = 0; column < size - 1; column += 1) {
        const topLeft = vertexAt(row, column), topRight = vertexAt(row, column + 1), bottomLeft = vertexAt(row + 1, column), bottomRight = vertexAt(row + 1, column + 1);
        add(topLeft, bottomLeft, topRight, terrainMaterialAt([topLeft, bottomLeft, topRight]));
        add(topRight, bottomLeft, bottomRight, terrainMaterialAt([topRight, bottomLeft, bottomRight]));
        const baseTopLeft = vertexAt(row, column, true), baseTopRight = vertexAt(row, column + 1, true), baseBottomLeft = vertexAt(row + 1, column, true), baseBottomRight = vertexAt(row + 1, column + 1, true);
        add(baseTopRight, baseBottomLeft, baseTopLeft, 'base'); add(baseBottomRight, baseBottomLeft, baseTopRight, 'base');
      }
      for (let index = 0; index < size - 1; index += 1) {
        [[vertexAt(0, index), vertexAt(0, index + 1), vertexAt(0, index + 1, true), vertexAt(0, index, true)], [vertexAt(size - 1, index + 1), vertexAt(size - 1, index), vertexAt(size - 1, index, true), vertexAt(size - 1, index + 1, true)], [vertexAt(index + 1, 0), vertexAt(index, 0), vertexAt(index, 0, true), vertexAt(index + 1, 0, true)], [vertexAt(index, size - 1), vertexAt(index + 1, size - 1), vertexAt(index + 1, size - 1, true), vertexAt(index, size - 1, true)]].forEach(([a, b, c, d]) => { add(a, b, c, 'base'); add(a, c, d, 'base'); });
      }
      cityFeatures.buildings?.forEach(feature => {
        const coordinates = feature.geometry?.coordinates;
        if (feature.geometry?.type === 'Polygon') addBuilding(coordinates[0]);
        if (feature.geometry?.type === 'MultiPolygon') coordinates.forEach(polygon => addBuilding(polygon[0]));
      });
      cityFeatures.roads?.forEach(feature => {
        const lines = feature.geometry?.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry?.type === 'MultiLineString' ? feature.geometry.coordinates : [];
        lines.forEach(line => line.slice(1).forEach((point, index) => addPathSegment(line[index], point, 'road', 0.9, 0.3)));
        if (feature.geometry?.type === 'Polygon') addSurface(feature.geometry.coordinates[0], 'road', 0.9);
        if (feature.geometry?.type === 'MultiPolygon') feature.geometry.coordinates.forEach(polygon => addSurface(polygon[0], 'road', 0.9));
      });
      waterPolygons.forEach(polygon => addSurface(null, 'water', 0.08, polygon));
      cityFeatures.water?.forEach(feature => {
        const coordinates = feature.geometry?.coordinates;
        const lines = feature.geometry?.type === 'LineString' ? [coordinates] : feature.geometry?.type === 'MultiLineString' ? coordinates : [];
        lines.forEach(line => line.slice(1).forEach((point, index) => addPathSegment(line[index], point, 'water', 0.45, 0.45)));
      });
      cityFeatures.forest?.forEach(feature => {
        const coordinates = feature.geometry?.coordinates;
        if (feature.geometry?.type === 'Polygon') addSurface(coordinates[0], 'forest', 0.2);
        if (feature.geometry?.type === 'MultiPolygon') coordinates.forEach(polygon => addSurface(polygon[0], 'forest', 0.2));
      });
      cityFeatures.landCover?.forEach(feature => {
        const coordinates = feature.geometry?.coordinates;
        if (feature.geometry?.type === 'Polygon') addSurface(coordinates[0], 'landCover', 0.25);
        if (feature.geometry?.type === 'MultiPolygon') coordinates.forEach(polygon => addSurface(polygon[0], 'landCover', 0.25));
      });
      cityFeatures.boundary?.forEach(feature => {
        const coordinates = feature.geometry?.coordinates;
        const lines = feature.geometry?.type === 'LineString' ? [coordinates] : feature.geometry?.type === 'MultiLineString' ? coordinates : [];
        lines.forEach(line => line.slice(1).forEach((point, index) => addPathSegment(line[index], point, 'boundary', 0.6, 0.18)));
      });
      CartivaDiagnostics.record('model.terrain', 'Terrain scaled from geographic meters; connected water surfaces flattened.', { widthMeters, depthMeters, metersToMm, waterPolygons: waterPolygons.length });
      return { triangles, triangleMaterials };
    }

    function createTerrainStl(mesh, colors) {
      const triangleCount = mesh.triangles.length / 3;
      const buffer = new ArrayBuffer(84 + triangleCount * 50);
      const view = new DataView(buffer);
      const header = new TextEncoder().encode('cartiva colored terrain STL');
      new Uint8Array(buffer, 0, header.length).set(header);
      view.setUint32(80, triangleCount, true);
      const colorAttribute = material => {
        const hex = colors[material] || colors.terrain;
        const red = Math.round(parseInt(hex.slice(1, 3), 16) * 31 / 255);
        const green = Math.round(parseInt(hex.slice(3, 5), 16) * 31 / 255);
        const blue = Math.round(parseInt(hex.slice(5, 7), 16) * 31 / 255);
        return 0x8000 | (red << 10) | (green << 5) | blue;
      };
      let offset = 84;
      for (let index = 0; index < mesh.triangles.length; index += 3) {
        offset += 12;
        mesh.triangles.slice(index, index + 3).forEach(vertex => {
          view.setFloat32(offset, vertex[0], true); view.setFloat32(offset + 4, vertex[1], true); view.setFloat32(offset + 8, vertex[2], true); offset += 12;
        });
        view.setUint16(offset, colorAttribute(mesh.triangleMaterials[index / 3]), true); offset += 2;
      }
      return new Blob([buffer], { type: 'model/stl' });
    }

    function rotateMeshToMapBearing(mesh, bearing) {
      if (!bearing) return mesh;
      const bounds = mesh.triangles.reduce((result, vertex) => ({
        minX: Math.min(result.minX, vertex[0]), maxX: Math.max(result.maxX, vertex[0]),
        minY: Math.min(result.minY, vertex[1]), maxY: Math.max(result.maxY, vertex[1])
      }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
      const centerX = (bounds.minX + bounds.maxX) / 2;
      const centerY = (bounds.minY + bounds.maxY) / 2;
      const angle = -bearing * Math.PI / 180;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      return {
        ...mesh,
        triangles: mesh.triangles.map(([x, y, z]) => [
          centerX + (x - centerX) * cosine - (y - centerY) * sine,
          centerY + (x - centerX) * sine + (y - centerY) * cosine,
          z
        ])
      };
    }

    function createStoredZip(files) {
      const encoder = new TextEncoder();
      const entries = files.map(({ name, content }) => ({ name: encoder.encode(name), content: typeof content === 'string' ? encoder.encode(content) : content }));
      let offset = 0;
      const parts = [];
      const directory = [];
      const pushUint16 = (view, offsetValue, value) => view.setUint16(offsetValue, value, true);
      const pushUint32 = (view, offsetValue, value) => view.setUint32(offsetValue, value, true);
      entries.forEach(entry => {
        const crc = crc32(entry.content), header = new Uint8Array(30 + entry.name.length), view = new DataView(header.buffer);
        pushUint32(view, 0, 0x04034b50); pushUint16(view, 4, 20); pushUint16(view, 6, 0x0800); pushUint16(view, 8, 0); pushUint32(view, 14, crc); pushUint32(view, 18, entry.content.length); pushUint32(view, 22, entry.content.length); pushUint16(view, 26, entry.name.length); entry.setName = offset;
        header.set(entry.name, 30); parts.push(header, entry.content); offset += header.length + entry.content.length;
        directory.push({ ...entry, crc, offset: entry.setName });
      });
      const directoryOffset = offset;
      directory.forEach(entry => {
        const header = new Uint8Array(46 + entry.name.length), view = new DataView(header.buffer);
        pushUint32(view, 0, 0x02014b50); pushUint16(view, 4, 20); pushUint16(view, 6, 20); pushUint16(view, 8, 0x0800); pushUint16(view, 10, 0); pushUint32(view, 16, entry.crc); pushUint32(view, 20, entry.content.length); pushUint32(view, 24, entry.content.length); pushUint16(view, 28, entry.name.length); pushUint32(view, 42, entry.offset); header.set(entry.name, 46); parts.push(header); offset += header.length;
      });
      const footer = new Uint8Array(22), footerView = new DataView(footer.buffer);
      pushUint32(footerView, 0, 0x06054b50); pushUint16(footerView, 8, entries.length); pushUint16(footerView, 10, entries.length); pushUint32(footerView, 12, offset - directoryOffset); pushUint32(footerView, 16, directoryOffset); parts.push(footer);
      return new Blob(parts, { type: 'model/3mf' });
    }

    function createColoredThreeMf(mesh, colors) {
      const materialIndex = { terrain: 0, forest: 1, landCover: 2, water: 3, boundary: 4, road: 5, building: 6, base: 7 };
      const color = hex => `${hex.toUpperCase()}FF`;
      const vertices = mesh.triangles.map(vertex => `<vertex x="${vertex[0]}" y="${vertex[1]}" z="${vertex[2]}"/>`).join('');
      const triangles = mesh.triangleMaterials.map((material, index) => `<triangle v1="${index * 3}" v2="${index * 3 + 1}" v3="${index * 3 + 2}" pid="1" p1="${materialIndex[material]}"/>`).join('');
      const model = `<?xml version="1.0" encoding="UTF-8"?><model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" unit="millimeter" xml:lang="en-US"><resources><basematerials id="1"><base name="Land" displaycolor="${color(colors.terrain)}"/><base name="Nature" displaycolor="${color(colors.forest)}"/><base name="Urban areas" displaycolor="${color(colors.landCover)}"/><base name="Water" displaycolor="${color(colors.water)}"/><base name="Boundaries" displaycolor="${color(colors.boundary)}"/><base name="Streets" displaycolor="${color(colors.road)}"/><base name="Buildings" displaycolor="${color(colors.building)}"/><base name="Base and sides" displaycolor="${color(colors.base || '#8b5e3c')}"/></basematerials><object id="2" type="model" pid="1" pindex="0"><mesh><vertices>${vertices}</vertices><triangles>${triangles}</triangles></mesh></object></resources><build><item objectid="2"/></build></model>`;
      return createStoredZip([
        { name: '[Content_Types].xml', content: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>' },
        { name: '_rels/.rels', content: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>' },
        { name: '3D/3dmodel.model', content: model }
      ]);
    }

    function drawExportAnnotations(context, exportState, width, height, mapWidth, borderWidth) {
      context.save();
      context.fillStyle = '#111827';
      context.strokeStyle = '#111827';
      context.lineWidth = Math.max(2, width / 900);
      context.font = `800 ${Math.max(14, width / 115)}px sans-serif`;
      if (exportState.scaleEnabled) {
        const previewInfo = getScaleInfo(map);
        const scaleWidth = previewInfo.pixels * (mapWidth / map.getContainer().clientWidth);
        const x = borderWidth + width * 0.025, y = height - borderWidth - width * 0.035;
        context.textAlign = 'center'; context.fillText(previewInfo.label, x + scaleWidth / 2, y - 8);
        context.beginPath(); context.moveTo(x, y); context.lineTo(x + scaleWidth, y); context.moveTo(x, y - 6); context.lineTo(x, y + 6); context.moveTo(x + scaleWidth, y - 6); context.lineTo(x + scaleWidth, y + 6); context.stroke();
      }
      if (exportState.northEnabled) {
        const x = borderWidth + width * 0.045, y = borderWidth + width * 0.055;
        context.translate(x, y); context.rotate(-exportState.bearing * Math.PI / 180); context.textAlign = 'center'; context.fillText('N', 0, -12); context.beginPath(); context.moveTo(0, -8); context.lineTo(-7, 13); context.lineTo(0, 8); context.lineTo(7, 13); context.closePath(); context.fill();
      }
      if (exportState.guidesEnabled) {
        const bleed = Math.max(0, Number(exportState.bleedMm || 0)) * width / Math.max(1, Number(exportState.customWidthMm || 210));
        const safe = Math.max(0, Number(exportState.safeMm || 0)) * width / Math.max(1, Number(exportState.customWidthMm || 210));
        context.save();
        context.setLineDash([10, 8]);
        context.strokeStyle = '#b45309';
        context.strokeRect(bleed, bleed, width - bleed * 2, height - bleed * 2);
        context.strokeStyle = '#059669';
        context.strokeRect(safe, safe, width - safe * 2, height - safe * 2);
        context.restore();
      }
      context.restore();
    }

    function canvasToSvg(canvas, exportState) {
      const dataUrl = canvas.toDataURL('image/png');
      const escape = value => String(value).replace(/[&<>"]/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
      })[character]);
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">
  <title>${escape(exportState.city)} map poster (raster-backed SVG)</title>
  <image width="100%" height="100%" href="${dataUrl}"/>
</svg>`;
    }

    function validateExportSize(width, height) {
      const pixels = width * height;
      const maxPixels = 160000000;
      const maxSide = 16384;
      if (!Number.isFinite(pixels) || width < 1 || height < 1) throw new Error('Invalid export dimensions.');
      if (width > maxSide || height > maxSide || pixels > maxPixels) {
        throw new Error(`Export is too large for this browser (${width} × ${height}, ${(pixels / 1000000).toFixed(1)} MP). Choose a smaller DPI or paper size.`);
      }
    }

    async function addPngResolutionMetadata(blob, dpi) {
      if (blob.type !== 'image/png' || !Number.isFinite(dpi)) return blob;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytes.length < 33 || bytes[12] !== 73 || bytes[13] !== 72 || bytes[14] !== 68 || bytes[15] !== 82) return blob;
      const pixelsPerMeter = Math.round(dpi / 0.0254);
      const data = new Uint8Array(9);
      const view = new DataView(data.buffer);
      view.setUint32(0, pixelsPerMeter);
      view.setUint32(4, pixelsPerMeter);
      data[8] = 1;
      const type = new TextEncoder().encode('pHYs');
      const crcInput = new Uint8Array(type.length + data.length);
      crcInput.set(type); crcInput.set(data, type.length);
      const chunk = new Uint8Array(4 + 4 + data.length + 4);
      const chunkView = new DataView(chunk.buffer);
      chunkView.setUint32(0, data.length);
      chunk.set(type, 4); chunk.set(data, 8);
      chunkView.setUint32(17, crc32(crcInput));
      return new Blob([bytes.slice(0, 33), chunk, bytes.slice(33)], { type: 'image/png' });
    }

    function applyExportLineWeight(targetMap, exportState) {
      const multipliers = { fine: 0.78, standard: 1, bold: 1.28 };
      const multiplier = multipliers[exportState.printLineWeight] || 1;
      if (multiplier === 1) return;
      (targetMap.getStyle()?.layers || []).forEach(layer => {
        if (layer.type !== 'line' || !['road', 'water', 'boundary'].includes(getLayerRole(layer))) return;
        const current = targetMap.getPaintProperty(layer.id, 'line-width');
        if (typeof current === 'number') targetMap.setPaintProperty(layer.id, 'line-width', current * multiplier);
        else if (Array.isArray(current)) targetMap.setPaintProperty(layer.id, 'line-width', ['*', current, multiplier]);
      });
    }

    function drawCanvasInTiles(context, source, x, y, width, height, tileSize = 2048) {
      const scaleX = width / source.width;
      const scaleY = height / source.height;
      for (let sourceY = 0; sourceY < source.height; sourceY += tileSize) {
        for (let sourceX = 0; sourceX < source.width; sourceX += tileSize) {
          const tileWidth = Math.min(tileSize, source.width - sourceX);
          const tileHeight = Math.min(tileSize, source.height - sourceY);
          context.drawImage(source, sourceX, sourceY, tileWidth, tileHeight,
            x + sourceX * scaleX, y + sourceY * scaleY,
            tileWidth * scaleX, tileHeight * scaleY);
        }
      }
    }

    /** Draws the outline wholly inside the map edge, preserving rounded inner corners. */
    function drawInnerBorderOutline(context, exportState, x, y, width, height, scale) {
      if (!exportState.borderEnabled || !exportState.innerOutlineEnabled) return;
      const lineWidth = Math.min(width / 2, height / 2, exportState.innerOutlineWidth * scale);
      const radius = Math.min(width / 2, height / 2, exportState.innerBorderRadius * scale);
      context.save();
      context.beginPath();
      context.roundRect(x, y, width, height, radius);
      context.roundRect(x + lineWidth, y + lineWidth, width - 2 * lineWidth, height - 2 * lineWidth, Math.max(0, radius - lineWidth));
      context.fillStyle = exportState.innerOutlineColor;
      context.fill('evenodd');
      context.restore();
    }

    function waitForMapIdle(targetMap, timeoutMs = 30000) {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Map tiles did not finish loading in time.')), timeoutMs);
        const finish = () => {
          if (!targetMap.loaded() || !targetMap.areTilesLoaded()) return;
          clearTimeout(timeout);
          targetMap.off('idle', finish);
          resolve();
        };
        targetMap.on('idle', finish);
        finish();
      });
    }

    function compareRenderBounds(exportMap, exportState) {
      const actual = exportMap.getBounds().toArray();
      const expected = exportState.bounds;
      const longitudeDelta = Math.max(
        Math.abs(actual[0][0] - expected[0][0]),
        Math.abs(actual[1][0] - expected[1][0])
      );
      const latitudeDelta = Math.max(
        Math.abs(actual[0][1] - expected[0][1]),
        Math.abs(actual[1][1] - expected[1][1])
      );
      const comparison = { longitudeDelta, latitudeDelta, expected, actual };
      CartivaDiagnostics.record('render.bounds', 'Preview/export bounds compared.', comparison);
      if (longitudeDelta > 0.01 || latitudeDelta > 0.01) {
        CartivaDiagnostics.record('render.bounds', 'Preview/export geographic bounds differ.', comparison, 'warn');
      }
      return comparison;
    }

    /** Shifts camera stops while preserving feature-dependent values in MapLibre styles. */
    function shiftStyleZoom(value, offset, multiplier = 1) {
      if (typeof value === 'number') return value * multiplier;
      if (value && !Array.isArray(value) && Array.isArray(value.stops)) {
        return { ...value, stops: value.stops.map(([stop, output]) => [
          value.property ? stop : stop + offset,
          typeof output === 'number' ? output * multiplier : output
        ]) };
      }
      if (!Array.isArray(value)) return value;
      const expression = JSON.parse(JSON.stringify(value));
      const inputIndex = expression[0] === 'step' ? 1 : expression[0] === 'interpolate' ? 2 : -1;
      if (inputIndex >= 0 && expression[inputIndex]?.[0] === 'zoom') {
        for (let index = 3; index < expression.length; index += 2) {
          expression[index] += offset;
          if (multiplier !== 1) expression[index + 1] = ['*', expression[index + 1], multiplier];
        }
        if (expression[0] === 'step' && multiplier !== 1) expression[2] = ['*', expression[2], multiplier];
        return expression;
      }
      return multiplier === 1 ? expression : ['*', expression, multiplier];
    }

    /** Preserves label and layer visibility when a larger viewport raises the render zoom. */
    function createScaledMapStyle(style, scale) {
      const result = JSON.parse(JSON.stringify(style));
      result.layers = result.layers.filter(layer => ![TERRAIN_COLOR_SOURCE_ID, TERRAIN_SOURCE_ID].includes(layer.source));
      delete result.sources[TERRAIN_COLOR_SOURCE_ID];
      delete result.sources[TERRAIN_SOURCE_ID];
      const offset = Math.log2(scale);
      const layoutPixels = new Set(['text-size', 'icon-size', 'text-padding', 'icon-padding', 'symbol-spacing']);
      const paintPixels = new Set(['text-halo-width', 'text-halo-blur', 'icon-halo-width', 'icon-halo-blur']);
      result.layers.forEach(layer => {
        if (layer.minzoom != null) layer.minzoom = Math.max(0, Math.min(24, layer.minzoom + offset));
        if (layer.maxzoom != null) layer.maxzoom = Math.max(0, Math.min(24, layer.maxzoom + offset));
        if (layer.type !== 'symbol') return;
        layer.layout ||= {};
        if (layer.layout['text-field'] != null && layer.layout['text-size'] == null) layer.layout['text-size'] = 16;
        for (const group of ['layout', 'paint']) {
          Object.entries(layer[group] || {}).forEach(([key, value]) => {
            const multiplier = (group === 'layout' ? layoutPixels : paintPixels).has(key) ? scale : 1;
            layer[group][key] = shiftStyleZoom(value, offset, multiplier);
          });
        }
      });
      return result;
    }

    async function createExportMap(width, height, exportState, options = {}) {
      const container = document.createElement('div');
      container.className = 'export-map-container';
      container.style.width = `${width}px`;
      container.style.height = `${height}px`;
      document.body.appendChild(container);
      // MapLibre's zoom is viewport-size dependent. Increase the export zoom
      // by the pixel scale so a 600 DPI viewport shows the same geography as
      // the much smaller preview viewport instead of zooming out in practice.
      const previewWidth = Math.max(1, exportState.previewMapSize.width);
      const renderScale = (options.fullWidth || width) / previewWidth;
      const exportZoom = exportState.zoom + Math.log2(renderScale);
      const exportMap = new maplibregl.Map({
        container,
        preserveDrawingBuffer: true,
        pixelRatio: 1,
        attributionControl: false,
        interactive: false,
        style: createScaledMapStyle(map.getStyle(), renderScale),
        maxZoom: Math.max(24, exportZoom),
        center: options.center || exportState.center,
        zoom: exportZoom,
        bearing: exportState.bearing,
        pitch: exportState.pitch
      });
      try {
      CartivaWebGl.prepareMap(exportMap);
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Export map did not load in time.')), 30000);
        exportMap.once('load', () => { clearTimeout(timeout); resolve(); });
        exportMap.once('error', event => { clearTimeout(timeout); reject(event.error || new Error('Export map failed to load.')); });
      });
      const geoJsonDefinition = globalThis.CartivaGeoJson?.definition?.();
      if (geoJsonDefinition && !exportMap.getSource('cartiva-user-geojson')) {
        exportMap.addSource('cartiva-user-geojson', geoJsonDefinition.source);
        geoJsonDefinition.layers.forEach(layer => exportMap.addLayer(layer));
      }
      configureMapForRender(exportMap, exportState);
      applyExportLineWeight(exportMap, exportState);
      exportMap.resize();
      // Preserve the preview camera exactly. The preview and export dimensions
      // use the same aspect ratio, so center/zoom is more faithful than fitting
      // bounds again on the second MapLibre instance.
      exportMap.jumpTo({
        center: options.center || exportState.center,
        zoom: exportZoom,
        bearing: exportState.bearing,
        pitch: exportState.pitch
      });
      await updateTerrainColorization(exportMap, exportState);
      if (exportState.contourEnabled) await updateContours(exportMap, exportState);
      await waitForMapIdle(exportMap);
      if (!options.fullWidth) compareRenderBounds(exportMap, exportState);
      return { exportMap, container };
      } catch (error) {
        exportMap.remove();
        container.remove();
        throw error;
      }
    }

    /** Projects a virtual export tile center into geographic coordinates at any map bearing. */
    function getExportTileCenter(exportState, fullWidth, fullHeight, x, y) {
      const center = maplibregl.MercatorCoordinate.fromLngLat(exportState.center);
      const worldSize = 512 * 2 ** exportState.zoom * fullWidth / exportState.previewMapSize.width;
      const angle = exportState.bearing * Math.PI / 180;
      const offsetX = (x - fullWidth / 2) / worldSize;
      const offsetY = (y - fullHeight / 2) / worldSize;
      return new maplibregl.MercatorCoordinate(
        center.x + offsetX * Math.cos(angle) - offsetY * Math.sin(angle),
        center.y + offsetX * Math.sin(angle) + offsetY * Math.cos(angle)
      ).toLngLat().toArray();
    }

    /** Composites bounded WebGL tiles directly into the final print canvas. */
    async function drawExportMap(context, exportState, sourceWidth, sourceHeight, x, y, width, height) {
      const tileSize = 2048;
      const overlap = Math.min(512, Math.ceil(64 * sourceWidth / exportState.previewMapSize.width));
      let exportMap;
      let container;
      try {
        if (sourceWidth <= 4096 && sourceHeight <= 4096 || exportState.pitch !== 0) {
          const scale = Math.min(1, 4096 / Math.max(sourceWidth, sourceHeight));
          if (scale < 1) CartivaDiagnostics.record('image.export', 'Pitched map render resolution limited to the GPU budget.', { scale }, 'warn');
          ({ exportMap, container } = await createExportMap(Math.round(sourceWidth * scale), Math.round(sourceHeight * scale), exportState));
          drawCanvasInTiles(context, exportMap.getCanvas(), x, y, width, height);
          return;
        }
        const columns = Math.ceil(sourceWidth / tileSize), rows = Math.ceil(sourceHeight / tileSize);
        for (let row = 0; row < rows; row += 1) {
          for (let column = 0; column < columns; column += 1) {
            const left = column * tileSize, top = row * tileSize;
            const tileWidth = Math.min(tileSize, sourceWidth - left), tileHeight = Math.min(tileSize, sourceHeight - top);
            const renderWidth = tileWidth + 2 * overlap, renderHeight = tileHeight + 2 * overlap;
            const center = getExportTileCenter(exportState, sourceWidth, sourceHeight, left + tileWidth / 2, top + tileHeight / 2);
            setStatus(`3/5 Rendering map tile ${row * columns + column + 1}/${rows * columns}...`);
            if (!exportMap) {
              ({ exportMap, container } = await createExportMap(renderWidth, renderHeight, exportState, { fullWidth: sourceWidth, center }));
            } else {
              container.style.width = `${renderWidth}px`;
              container.style.height = `${renderHeight}px`;
              exportMap.resize();
              exportMap.jumpTo({ center });
              await updateTerrainColorization(exportMap, exportState);
              await waitForMapIdle(exportMap);
            }
            context.drawImage(exportMap.getCanvas(), overlap, overlap, tileWidth, tileHeight,
              x + left * width / sourceWidth, y + top * height / sourceHeight,
              tileWidth * width / sourceWidth, tileHeight * height / sourceHeight);
          }
        }
        CartivaDiagnostics.record('image.export', 'Tiled map rendering completed.', { columns, rows, sourceWidth, sourceHeight });
      } finally {
        exportMap?.remove();
        container?.remove();
      }
    }

    const refinedMapPreview = document.getElementById('refinedMapPreview');
    const previewStateIndicator = document.getElementById('previewStateIndicator');
    const REFINED_PREVIEW_MAX_SIDE = 3200;
    const REFINED_PREVIEW_ZOOM_BOOST = 2;
    const REFINED_PREVIEW_DELAY_MS = 600;
    let refinedPreviewToken = 0;
    let refinedPreviewUrl = '';
    let refinedPreviewRendering = false;
    let refinedPreviewPending = false;

    function setRefinedPreviewState(detailed) {
      const label = detailed ? 'Detailed preview loaded' : 'Limited preview';
      previewStateIndicator.classList.toggle('detailed', detailed);
      previewStateIndicator.classList.toggle('limited', !detailed);
      previewStateIndicator.setAttribute('aria-label', label);
      previewStateIndicator.title = label;
    }

    function hideRefinedPreview() {
      refinedPreviewToken += 1;
      clearTimeout(runtimeState.timers.refinedPreview);
      refinedMapPreview.classList.remove('ready');
      setRefinedPreviewState(false);
    }

    async function renderRefinedPreview(token) {
      if (token !== refinedPreviewToken || document.hidden || !runtimeState.mapReady) return;
      if (refinedPreviewRendering) {
        refinedPreviewPending = true;
        return;
      }
      refinedPreviewRendering = true;
      let refinedMap;
      let container;
      try {
        const exportState = createRenderSnapshot();
        const previewWidth = Math.max(1, exportState.previewMapSize.width);
        const previewHeight = Math.max(1, exportState.previewMapSize.height);
        const requestedScale = 2 ** REFINED_PREVIEW_ZOOM_BOOST;
        const scale = Math.max(1, Math.min(requestedScale, REFINED_PREVIEW_MAX_SIDE / Math.max(previewWidth, previewHeight)));
        const width = Math.round(previewWidth * scale);
        const height = Math.round(previewHeight * scale);
        ({ exportMap: refinedMap, container } = await createExportMap(width, height, exportState));
        if (token !== refinedPreviewToken) return;
        const buildingLayerIds = (refinedMap.getStyle()?.layers || [])
          .filter(layer => getLayerRole(layer) === 'building')
          .map(layer => layer.id);
        const buildingFeatures = buildingLayerIds.length
          ? refinedMap.queryRenderedFeatures({ layers: buildingLayerIds }).length
          : 0;
        const blob = await new Promise((resolve, reject) => {
          refinedMap.getCanvas().toBlob(result => result ? resolve(result) : reject(new Error('Refined preview encoding failed.')), 'image/png');
        });
        if (token !== refinedPreviewToken) return;
        const nextUrl = URL.createObjectURL(blob);
        refinedMapPreview.onload = () => {
          if (token !== refinedPreviewToken) {
            URL.revokeObjectURL(nextUrl);
            return;
          }
          if (refinedPreviewUrl) URL.revokeObjectURL(refinedPreviewUrl);
          refinedPreviewUrl = nextUrl;
          refinedMapPreview.classList.add('ready');
          setRefinedPreviewState(true);
          CartivaDiagnostics.record('preview.refine', 'High-fidelity preview rendered.', {
            location: exportState.city,
            center: exportState.center,
            width,
            height,
            detailZoom: exportState.zoom + Math.log2(scale),
            buildingFeatures
          });
        };
        refinedMapPreview.src = nextUrl;
      } catch (error) {
        if (token === refinedPreviewToken) CartivaDiagnostics.report('preview.refine', error);
      } finally {
        refinedMap?.remove();
        container?.remove();
        refinedPreviewRendering = false;
        if (refinedPreviewPending) {
          refinedPreviewPending = false;
          scheduleRefinedPreview();
        }
      }
    }

    function scheduleRefinedPreview() {
      hideRefinedPreview();
      if (document.hidden) return;
      const token = refinedPreviewToken;
      runtimeState.timers.refinedPreview = setTimeout(() => renderRefinedPreview(token), REFINED_PREVIEW_DELAY_MS);
    }

    globalThis.CartivaRefinedPreview = Object.freeze({
      hide: hideRefinedPreview,
      schedule: scheduleRefinedPreview
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) hideRefinedPreview();
      else scheduleRefinedPreview();
    });
    globalThis.addEventListener('pagehide', () => {
      hideRefinedPreview();
      if (refinedPreviewUrl) URL.revokeObjectURL(refinedPreviewUrl);
      refinedPreviewUrl = '';
    });

    async function runImageExport() {
      exportCancelBtn.disabled = true;
      exportDialogCloseBtn.disabled = true;
      const result = await CartivaOperations.run({
      area: 'image.export',
      button: exportConfirmBtn,
      startStatus: '1/5 Preparing export...',
      successNotification: exportResult => ({
        message: `Image exported: ${exportResult.filename}`,
        icon: 'image'
      }),
      errorPrefix: 'Export failed',
      errorNotificationPrefix: 'Poster export failed'
    }, async cleanup => {
      hideRefinedPreview();
        if (document.fonts) {
          await document.fonts.ready;
        }

        const exportState = createRenderSnapshot();
        const targetDims = getTargetDimensions(exportState.format, exportState.exportDpi);
        CartivaDiagnostics.record('image.export', 'Image export started.', {
          format: exportState.format,
          type: exportState.exportType,
          dpi: exportState.exportDpi,
          quality: exportState.exportQuality,
          dimensions: targetDims
        });
        validateExportSize(targetDims.width, targetDims.height, exportState);
        setStatus('2/5 Loading detailed map tiles...');

        const exportCanvas = document.createElement('canvas');
        cleanup(() => { exportCanvas.width = exportCanvas.height = 1; });
        exportCanvas.width = targetDims.width;
        exportCanvas.height = targetDims.height;
          const ctx = exportCanvas.getContext('2d');
          if (!ctx) throw new Error('Canvas rendering is unavailable.');
          if (exportState.outerBorderRadius > 0) {
            const exportRadius = exportState.outerBorderRadius * (targetDims.width / mapFrame.clientWidth);
            ctx.beginPath();
            ctx.roundRect(0, 0, targetDims.width, targetDims.height, exportRadius);
            ctx.clip();
          }

        const scaleFactor = targetDims.width / mapFrame.clientWidth;
        const bWidth = exportState.borderEnabled ? exportState.borderWidth * scaleFactor : 0;
        const mapWidth = Math.max(1, Math.round(targetDims.width - (bWidth * 2)));
        const mapHeight = Math.max(1, Math.round(targetDims.height - (bWidth * 2)));
        const qualityMultiplier = Math.max(1, Math.min(2, Number(exportState.exportQuality) || 1));
        const renderMapWidth = Math.max(1, Math.round(mapWidth * qualityMultiplier));
        const previewAspect = exportState.previewMapSize.width / exportState.previewMapSize.height;
        // MapLibre's geographic crop depends on viewport aspect ratio. Render
        // the source map at the preview aspect to avoid extra latitude in export.
        const sourceMapHeight = Math.max(1, Math.round(renderMapWidth / previewAspect));

        ctx.fillStyle = exportState.borderColor;
        ctx.fillRect(0, 0, targetDims.width, targetDims.height);
        if (exportState.shape !== 'none') {
          ctx.fillStyle = exportState.shapeColor;
          ctx.fillRect(bWidth, bWidth, mapWidth, mapHeight);
        }

        const contrastSetting = exportState.contrast;
        ctx.filter = `contrast(${contrastSetting}%) brightness(${exportState.brightness}%) saturate(${exportState.saturation}%)`;

      setStatus('3/5 Rendering map and layout...');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      if (exportState.innerBorderRadius > 0 || exportState.shape !== 'none') {
        const innerRadius = exportState.innerBorderRadius * scaleFactor;
        ctx.save();
        ctx.beginPath();
        if (exportState.shape === 'none') {
          ctx.roundRect(bWidth, bWidth, mapWidth, mapHeight, innerRadius);
          ctx.clip();
        } else {
          const shapePath = getShapePath(exportState.shape, mapWidth, mapHeight, exportState.shapeScale);
          ctx.translate(bWidth, bWidth);
          ctx.clip(shapePath);
          ctx.translate(-bWidth, -bWidth);
        }
      }
      await drawExportMap(ctx, exportState, renderMapWidth, sourceMapHeight, bWidth, bWidth, mapWidth, mapHeight);
      if (exportState.innerBorderRadius > 0 || exportState.shape !== 'none') ctx.restore();
      ctx.filter = 'none';

      drawInnerBorderOutline(ctx, exportState, bWidth, bWidth, mapWidth, mapHeight, scaleFactor);

      if (exportState.labelStyle !== 'none') {
        const hex = exportState.labelBgColor;
        const alpha = exportState.labelOpacity / 100;
        const r = parseInt(hex.slice(1,3), 16);
        const g = parseInt(hex.slice(3,5), 16);
        const b = parseInt(hex.slice(5,7), 16);
        
        const style = exportState.labelStyle;
        const fontChoice = exportState.labelFont;
        const previewRefWidth = exportState.previewMapSize.width;
        const proportionalScale = mapWidth / previewRefWidth;
        const measuredOverlay = exportState.overlay;

        const isBanner = style.startsWith('banner-');
        if (![isBanner, style === 'special-deck', style === 'special-minimal'].some(Boolean)) {
          const boxWidth = measuredOverlay.width * proportionalScale;
          const boxHeight = measuredOverlay.height * proportionalScale;
          const isBottomCorner = style.startsWith('corner-bottom-');
          const isCorner = style.startsWith('corner-');
          const isRightCorner = isCorner && style.endsWith('-right');
          const isLeftCorner = isCorner && style.endsWith('-left');
          const boxX = isLeftCorner
            ? bWidth
            : isRightCorner
              ? targetDims.width - bWidth - boxWidth
              : bWidth + measuredOverlay.x * proportionalScale;
          const boxY = isBottomCorner
            ? targetDims.height - bWidth - boxHeight
            : bWidth + measuredOverlay.y * proportionalScale;
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
          if (measuredOverlay.borderRadius > 0 && typeof ctx.roundRect === 'function') {
            ctx.beginPath();
            ctx.roundRect(boxX, boxY, boxWidth, boxHeight, measuredOverlay.borderRadius * proportionalScale);
            ctx.fill();
          } else {
            ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
          }

          measuredOverlay.children.forEach((child, index) => {
            const texts = [exportState.city, exportState.coordinates, exportState.country];
            const colors = [exportState.labelTextColor, exportState.labelCoordColor, exportState.labelCountryColor];
            ctx.fillStyle = colors[index];
            ctx.font = `${child.fontWeight} ${child.fontSize * proportionalScale}px ${fontChoice}`;
            if (child.textAlign === 'right') {
              ctx.textAlign = 'right';
              ctx.fillText(texts[index], boxX + boxWidth - child.x * proportionalScale, boxY + child.baselineY * proportionalScale);
            } else if (child.textAlign === 'left') {
              ctx.textAlign = 'left';
              ctx.fillText(texts[index], boxX + child.x * proportionalScale, boxY + child.baselineY * proportionalScale);
            } else {
              ctx.textAlign = 'center';
              ctx.fillText(texts[index], boxX + boxWidth / 2, boxY + child.baselineY * proportionalScale);
            }
          });
        } else if (isBanner) {
          const bannerHeight = 180 * proportionalScale;
          const isTop = style.includes('-top');
          const isLeft = style.endsWith('-left');
          const isRight = style.endsWith('-right');
          const bannerY = isTop ? bWidth : targetDims.height - bWidth - bannerHeight;
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
          ctx.fillRect(bWidth, bannerY, targetDims.width - (bWidth * 2), bannerHeight);

          ctx.textAlign = isLeft ? 'left' : isRight ? 'right' : 'center';
          const textX = isLeft
            ? bWidth + (40 * proportionalScale)
            : isRight
              ? targetDims.width - bWidth - (40 * proportionalScale)
              : targetDims.width / 2;
          ctx.fillStyle = exportState.labelTextColor;
          ctx.font = `800 ${38 * proportionalScale}px ${fontChoice}`;
          ctx.fillText(cityNameEl.textContent, textX, bannerY + (50 * proportionalScale));

          ctx.fillStyle = exportState.labelCoordColor;
          ctx.font = `600 ${20 * proportionalScale}px ${fontChoice}`;
          ctx.fillText(cityCoordsEl.textContent, textX, bannerY + (95 * proportionalScale));

          ctx.fillStyle = exportState.labelCountryColor;
          ctx.font = `700 ${22 * proportionalScale}px ${fontChoice}`;
          ctx.fillText(cityCountryEl.textContent, textX, bannerY + (140 * proportionalScale));

        } else if (style === 'special-deck') {
          const bannerHeight = 130 * proportionalScale;
          const bannerY = targetDims.height - bWidth - bannerHeight - (30 * proportionalScale);
          const margin = 30 * proportionalScale;

          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
          ctx.fillRect(bWidth + margin, bannerY, targetDims.width - (bWidth * 2) - (margin * 2), bannerHeight);

          ctx.textAlign = 'left';
          ctx.fillStyle = exportState.labelTextColor;
          ctx.font = `800 ${34 * proportionalScale}px ${fontChoice}`;
          ctx.fillText(cityNameEl.textContent, bWidth + margin + (30 * proportionalScale), bannerY + (50 * proportionalScale));

          ctx.fillStyle = exportState.labelCoordColor;
          ctx.font = `600 ${16 * proportionalScale}px ${fontChoice}`;
          ctx.fillText(cityCoordsEl.textContent, bWidth + margin + (30 * proportionalScale), bannerY + (90 * proportionalScale));

          ctx.textAlign = 'right';
          ctx.fillStyle = exportState.labelCountryColor;
          ctx.font = `700 ${20 * proportionalScale}px ${fontChoice}`;
          ctx.fillText(cityCountryEl.textContent, targetDims.width - bWidth - margin - (30 * proportionalScale), bannerY + (70 * proportionalScale));

        } else if (style === 'special-minimal') {
           const boxX = targetDims.width / 2;
           const boxY = targetDims.height - bWidth - (80 * proportionalScale);
           
           ctx.textAlign = 'center';
           ctx.shadowColor = 'rgba(0,0,0,0.4)';
           ctx.shadowBlur = 10 * proportionalScale;

           ctx.fillStyle = exportState.labelTextColor;
           ctx.font = `800 ${34 * proportionalScale}px ${fontChoice}`;
           ctx.fillText(cityNameEl.textContent, boxX, boxY);

           ctx.fillStyle = exportState.labelCoordColor;
           ctx.font = `600 ${16 * proportionalScale}px ${fontChoice}`;
           ctx.fillText(cityCoordsEl.textContent, boxX, boxY + (35 * proportionalScale));

           ctx.fillStyle = exportState.labelCountryColor;
           ctx.font = `700 ${18 * proportionalScale}px ${fontChoice}`;
           ctx.fillText(cityCountryEl.textContent, boxX, boxY + (70 * proportionalScale));
           
           ctx.shadowColor = 'transparent';
           ctx.shadowBlur = 0;

        }
      }

      drawExportAnnotations(ctx, exportState, targetDims.width, targetDims.height, mapWidth, bWidth);

        const mimeType = exportState.exportType;
        const baseFilename = `cartiva_${exportState.city.trim().replace(/\s+/g, '_')}_${exportState.exportDpi}dpi_${getFileTimestamp()}`;
        setStatus('4/5 Encoding output...');
        if (mimeType === 'image/svg+xml') {
          const filename = `${baseFilename}.svg`;
          downloadBlob(new Blob([canvasToSvg(exportCanvas, exportState)], { type: mimeType }), filename);
          if (exportState.includeExportMetadata) downloadExportMetadata(exportState, baseFilename);
          setStatus('5/5 Poster exported.');
          return { filename };
        }
        if (mimeType === 'application/pdf') {
          const pdfMimeType = globalThis.jspdf?.jsPDF ? 'image/png' : 'image/jpeg';
          const pdfBlob = await new Promise((resolve, reject) => {
            exportCanvas.toBlob(result => result ? resolve(result) : reject(new Error('PDF image encoding failed.')), pdfMimeType, pdfMimeType === 'image/jpeg' ? 1 : undefined);
          });
          const result = await pdfExporter.process('pdf', {
            blob: pdfBlob,
            filename: `${baseFilename}.pdf`,
            width: exportCanvas.width,
            height: exportCanvas.height,
            dpi: exportState.exportDpi
          });
          downloadBlob(result.blob, result.filename);
          if (exportState.includeExportMetadata) downloadExportMetadata(exportState, baseFilename);
          setStatus('5/5 Poster exported.');
          return { filename: result.filename };
        }
        const extension = mimeType.split('/')[1].replace('jpeg', 'jpg');
        let blob = await new Promise((resolve, reject) => {
          exportCanvas.toBlob(result => {
            if (result) resolve(result);
            else reject(new Error(`${extension.toUpperCase()} encoding failed.`));
          }, mimeType, mimeType === 'image/jpeg' ? 1 : undefined);
        });
        if (mimeType === 'image/png') blob = await addPngResolutionMetadata(blob, exportState.exportDpi);
        const filename = `${baseFilename}.${extension}`;
        downloadBlob(blob, filename);
        if (exportState.includeExportMetadata) downloadExportMetadata(exportState, baseFilename);
        CartivaDiagnostics.record('image.export', 'Image export completed.', { filename, bytes: blob.size });
        setStatus('5/5 Poster exported.');
        return { filename };
      });
      exportCancelBtn.disabled = false;
      exportDialogCloseBtn.disabled = false;
      if (result) {
        exportDialog.close();
        setTimeout(() => {
          if (statusMessage.textContent === '5/5 Poster exported.') setStatus('');
        }, 7000);
      }
    }

    exportConfirmBtn.addEventListener('click', runImageExport);
