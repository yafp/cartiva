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

    exportBtn.addEventListener('click', () => {
      updateOutputDimensions();
      setStatus('');
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
      const minimum = Math.min(...heights);
      const maximum = Math.max(...heights);
      const reliefMm = Math.min(50, 16 * exaggeration / 100);
      const heightAt = index => 2 + ((heights[index] - minimum) / Math.max(maximum - minimum, 1)) * reliefMm;
      const vertexAt = (row, column, base = false) => [column * widthMm / (size - 1), row * depthMm / (size - 1), base ? 0 : heightAt(row * size + column)];
      const triangles = [];
      const triangleMaterials = [];
      const add = (a, b, c, material = 'terrain') => { triangles.push(a, b, c); triangleMaterials.push(material); };
      // Ear clipping handles concave building/water footprints more safely than
      // a triangle fan, which can create overlapping or inverted faces.
      const triangulatePolygon = points => {
        const vertices = points.map((point, index) => ({ point, index }));
        const area = vertices.reduce((sum, current, index) => {
          const next = vertices[(index + 1) % vertices.length].point;
          return sum + current.point[0] * next[1] - next[0] * current.point[1];
        }, 0) / 2;
        const orientation = area >= 0 ? 1 : -1;
        const cross = (a, b, c) => ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) * orientation;
        const inside = (point, a, b, c) => {
          const ab = cross(a, b, point), bc = cross(b, c, point), ca = cross(c, a, point);
          return ab >= -0.0001 && bc >= -0.0001 && ca >= -0.0001;
        };
        const result = [];
        while (vertices.length > 3) {
          let clipped = false;
          for (let index = 0; index < vertices.length; index += 1) {
            const previous = vertices[(index - 1 + vertices.length) % vertices.length];
            const current = vertices[index];
            const next = vertices[(index + 1) % vertices.length];
            if (cross(previous.point, current.point, next.point) <= 0) continue;
            if (vertices.some(candidate => candidate !== previous && candidate !== current && candidate !== next && inside(candidate.point, previous.point, current.point, next.point))) continue;
            result.push([previous.index, current.index, next.index]);
            vertices.splice(index, 1);
            clipped = true;
            break;
          }
          if (!clipped) return null;
        }
        if (vertices.length === 3) result.push(vertices.map(vertex => vertex.index));
        return result;
      };
      const terrainHeightAt = (x, y) => {
        const column = Math.max(0, Math.min(size - 1, Math.round(x / widthMm * (size - 1))));
        const row = Math.max(0, Math.min(size - 1, Math.round(y / depthMm * (size - 1))));
        return heightAt(row * size + column);
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
        const rings = feature.geometry?.type === 'Polygon'
          ? [coordinates?.[0]]
          : feature.geometry?.type === 'MultiPolygon'
            ? coordinates?.map(polygon => polygon[0])
            : [];
        return rings.filter(Boolean).map(clipRingToModelBounds).filter(ring => ring.length >= 3).map(ring => ({
          ring,
          minX: Math.min(...ring.map(point => point[0])),
          maxX: Math.max(...ring.map(point => point[0])),
          minY: Math.min(...ring.map(point => point[1])),
          maxY: Math.max(...ring.map(point => point[1]))
        }));
      });
      const terrainMaterialAt = vertices => {
        const point = [
          vertices.reduce((sum, vertex) => sum + vertex[0], 0) / vertices.length,
          vertices.reduce((sum, vertex) => sum + vertex[1], 0) / vertices.length
        ];
        return waterPolygons.some(polygon =>
          point[0] >= polygon.minX && point[0] <= polygon.maxX &&
          point[1] >= polygon.minY && point[1] <= polygon.maxY &&
          pointIsInsideRing(point, polygon.ring)
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
      const addSurface = (ring, material, height) => {
        const points = clipRingToModelBounds(ring);
        if (points.length < 3) return;
        const top = points.map(([x, y]) => [x, y, terrainHeightAt(x, y) + height]);
        if (top.length < 3) return;
        const trianglesForTop = triangulatePolygon(top);
        if (trianglesForTop) trianglesForTop.forEach(([a, b, c]) => add(top[a], top[b], top[c], material));
        top.forEach((point, index) => {
          const next = top[(index + 1) % top.length];
          const base = [point[0], point[1], terrainHeightAt(point[0], point[1])];
          const nextBase = [next[0], next[1], terrainHeightAt(next[0], next[1])];
          add(point, next, base, material); add(next, nextBase, base, material);
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
        add(baseTopRight, baseBottomLeft, baseTopLeft); add(baseBottomRight, baseBottomLeft, baseTopRight);
      }
      for (let index = 0; index < size - 1; index += 1) {
        [[vertexAt(0, index), vertexAt(0, index + 1), vertexAt(0, index + 1, true), vertexAt(0, index, true)], [vertexAt(size - 1, index + 1), vertexAt(size - 1, index), vertexAt(size - 1, index, true), vertexAt(size - 1, index + 1, true)], [vertexAt(index + 1, 0), vertexAt(index, 0), vertexAt(index, 0, true), vertexAt(index + 1, 0, true)], [vertexAt(index, size - 1), vertexAt(index + 1, size - 1), vertexAt(index + 1, size - 1, true), vertexAt(index, size - 1, true)]].forEach(([a, b, c, d]) => { add(a, b, c); add(a, c, d); });
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
      cityFeatures.water?.forEach(feature => {
        const coordinates = feature.geometry?.coordinates;
        if (feature.geometry?.type === 'Polygon') addSurface(coordinates[0], 'water', 0.35);
        if (feature.geometry?.type === 'MultiPolygon') coordinates.forEach(polygon => addSurface(polygon[0], 'water', 0.35));
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
      const materialIndex = { terrain: 0, forest: 1, landCover: 2, water: 3, boundary: 4, road: 5, building: 6 };
      const color = hex => `${hex.toUpperCase()}FF`;
      const vertices = mesh.triangles.map(vertex => `<vertex x="${vertex[0]}" y="${vertex[1]}" z="${vertex[2]}"/>`).join('');
      const triangles = mesh.triangleMaterials.map((material, index) => `<triangle v1="${index * 3}" v2="${index * 3 + 1}" v3="${index * 3 + 2}" pid="1" p1="${materialIndex[material]}"/>`).join('');
      const model = `<?xml version="1.0" encoding="UTF-8"?><model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" unit="millimeter" xml:lang="en-US"><resources><basematerials id="1"><base name="Land" displaycolor="${color(colors.terrain)}"/><base name="Nature" displaycolor="${color(colors.forest)}"/><base name="Urban areas" displaycolor="${color(colors.landCover)}"/><base name="Water" displaycolor="${color(colors.water)}"/><base name="Boundaries" displaycolor="${color(colors.boundary)}"/><base name="Streets" displaycolor="${color(colors.road)}"/><base name="Buildings" displaycolor="${color(colors.building)}"/></basematerials><object id="2" type="model" pid="1" pindex="0"><mesh><vertices>${vertices}</vertices><triangles>${triangles}</triangles></mesh></object></resources><build><item objectid="2"/></build></model>`;
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

    async function createExportMap(width, height, exportState) {
      const container = document.createElement('div');
      container.className = 'export-map-container';
      container.style.width = `${width}px`;
      container.style.height = `${height}px`;
      document.body.appendChild(container);
      // MapLibre's zoom is viewport-size dependent. Increase the export zoom
      // by the pixel scale so a 600 DPI viewport shows the same geography as
      // the much smaller preview viewport instead of zooming out in practice.
      const previewWidth = Math.max(1, exportState.previewMapSize.width);
      const exportZoom = Math.min(
        exportState.zoom + Math.log2(width / previewWidth),
        Number(CartivaServices.maxExportZoom || 18)
      );
      const exportMap = new maplibregl.Map({
        container,
        preserveDrawingBuffer: true,
        pixelRatio: 1,
        attributionControl: false,
        interactive: false,
        style: MAP_STYLE_URL,
        center: exportState.center,
        zoom: exportZoom,
        bearing: exportState.bearing,
        pitch: exportState.pitch
      });
      await new Promise((resolve, reject) => {
        exportMap.once('load', resolve);
        exportMap.once('error', event => reject(event.error || new Error('Export map failed to load.')));
      });
      const geoJsonDefinition = globalThis.CartivaGeoJson?.definition?.();
      if (geoJsonDefinition) {
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
        center: exportState.center,
        zoom: exportZoom,
        bearing: exportState.bearing,
        pitch: exportState.pitch
      });
      await updateTerrainColorization(exportMap, exportState);
      await waitForMapIdle(exportMap);
      compareRenderBounds(exportMap, exportState);
      return { exportMap, container };
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
      let exportMap;
      let container;
      cleanup(() => {
        exportMap?.remove();
        container?.remove();
      });
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
        validateExportSize(renderMapWidth, sourceMapHeight, exportState);

        ctx.fillStyle = exportState.borderColor;
        ctx.fillRect(0, 0, targetDims.width, targetDims.height);
        if (exportState.shape !== 'none') {
          ctx.fillStyle = exportState.shapeColor;
          ctx.fillRect(bWidth, bWidth, mapWidth, mapHeight);
        }

        const contrastSetting = exportState.contrast;
        ctx.filter = `contrast(${contrastSetting}%) brightness(${exportState.brightness}%) saturate(${exportState.saturation}%)`;

      ({ exportMap, container } = await createExportMap(renderMapWidth, sourceMapHeight, exportState));
      setStatus('3/5 Rendering map and layout...');
      const mapCanvas = exportMap.getCanvas();
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
      drawCanvasInTiles(ctx, mapCanvas, bWidth, bWidth,
        targetDims.width - (bWidth * 2), targetDims.height - (bWidth * 2));
      if (exportState.innerBorderRadius > 0 || exportState.shape !== 'none') ctx.restore();
      ctx.filter = 'none';

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
