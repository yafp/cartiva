// EXPORT STATE BUILDER
// Constructs a comprehensive snapshot for high-resolution export:
// - All settings from controls/state
// - Map bounds and camera
// - Overlay geometry and label metrics for precise placement
// -----------------------------------------------------------------------------
    // The export and preview begin from the same normalized live render snapshot.
    /**
     * Creates render snapshot for the Cartiva application.
     * @function createRenderSnapshot
     */
    function createRenderSnapshot() {
      syncStateFromControls();
      // A paper-size change may still have a pending debounced live-map resize.
      const canvas = map.getCanvas();
      const container = map.getContainer();
      if (canvas.clientWidth !== container.clientWidth || canvas.clientHeight !== container.clientHeight) map.resize();
      return getExportState();
    }

    /**
     * Returns information about export state for the Cartiva application.
     * @function getExportState
     */
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
    let exportProgressActive = false;

    /**
     * Updates the accessible progress bar and a bounded composite thumbnail.
     * @param {number|null} percent - Completion percentage, or null for unknown work.
     * @param {HTMLCanvasElement} [canvas] - Current completed composite.
     */
    function updateExportProgress(percent, canvas) {
      if (!exportProgressActive) return;
      const bar = $('exportProgressBar');
      if (percent == null) {
        bar.removeAttribute('value');
        $('exportProgressPercent').textContent = 'Working...';
      } else {
        bar.value = Math.max(bar.value || 0, Math.max(0, Math.min(100, percent)));
        $('exportProgressPercent').textContent = `${Math.round(bar.value)}%`;
      }
      if (canvas) {
        const thumbnail = $('exportProgressThumbnail');
        thumbnail.hidden = false;
        const context = thumbnail.getContext('2d');
        if (!context) throw new Error('Export progress thumbnail is unavailable.');
        const scale = Math.min(thumbnail.width / canvas.width, thumbnail.height / canvas.height);
        context.clearRect(0, 0, thumbnail.width, thumbnail.height);
        context.drawImage(canvas, (thumbnail.width - canvas.width * scale) / 2,
          (thumbnail.height - canvas.height * scale) / 2, canvas.width * scale, canvas.height * scale);
      }
    }

    /**
     * Starts export feedback without claiming progress for unknown model work.
     * @param {string} area - Structured export operation name.
     */
    function startExportProgress(area) {
      exportProgressActive = true;
      ['exportConfirmBtn', 'stlExportBtn', 'threeMfExportBtn', 'exportImagesTab', 'exportModelsTab',
        'exportCancelBtn', 'exportDialogCloseBtn'].forEach(id => { $(id).disabled = true; });
      $('exportProgressVisual').hidden = false;
      $('exportProgressThumbnail').hidden = true;
      $('exportProgressBar').value = 0;
      updateExportProgress(area === 'image.export' ? 2 : null);
    }

    /** Releases feedback state after either success or failure. */
    function finishExportProgress() {
      exportProgressActive = false;
      ['exportConfirmBtn', 'stlExportBtn', 'threeMfExportBtn', 'exportImagesTab', 'exportModelsTab',
        'exportCancelBtn', 'exportDialogCloseBtn'].forEach(id => { $(id).disabled = false; });
      $('exportProgressVisual').hidden = true;
      const thumbnail = $('exportProgressThumbnail');
      thumbnail.getContext('2d')?.clearRect(0, 0, thumbnail.width, thumbnail.height);
    }

    globalThis.CartivaExportProgress = Object.freeze({
      start: startExportProgress, update: updateExportProgress,
      complete: () => updateExportProgress(100), finish: finishExportProgress
    });

    /**
     * Chooses a bounded tile budget from reported memory, CPU and WebGL limits.
     * @param {{deviceMemory?: number, hardwareConcurrency?: number}} [device] - Hardware hints.
     * @param {number} [gpuLimit] - Maximum supported texture/renderbuffer side.
     * @returns {{tileSize: number, maxRenderSide: number}} Rendering budget in pixels.
     */
    function getCanvasTileBudget(device = navigator, gpuLimit = 4096) {
      const memory = Number(device.deviceMemory);
      const cores = Number(device.hardwareConcurrency);
      let tileSize = !Number.isFinite(memory) ? 1024 : memory <= 1 ? 512
        : memory <= 2 ? 1024 : memory <= 4 ? 1536 : memory <= 8 ? 2048 : 3072;
      if (Number.isFinite(cores) && cores <= 2) tileSize = Math.min(tileSize, 1024);
      const maxRenderSide = Math.max(256, Math.min(4096, Number(gpuLimit) || 4096, tileSize + 1024));
      tileSize = Math.min(tileSize, Math.max(128, maxRenderSide - 128));
      return { tileSize, maxRenderSide };
    }

    /** Yields between tiles so feedback can paint and released buffers can be reclaimed. */
    function yieldExportFrame() {
      return new Promise(resolve => setTimeout(resolve, 0));
    }

    /**
     * Returns information about export tab for the Cartiva application.
     * @function selectExportTab
     * @param {*} models - Input value.
     */
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
        if (!Object.keys(runtimeState.operations).some(area => area.endsWith('.export'))) exportDialog.close();
      });
    });
    exportDialog.addEventListener('cancel', event => {
      if (Object.keys(runtimeState.operations).some(area => area.endsWith('.export'))) event.preventDefault();
    });
    const pdfExporter = CartivaPdfExporter.create();
    /**
     * Handles lat to tile for the Cartiva application.
     * @function lngLatToTile
     * @param {*} lng - Input value.
     * @param {*} lat - Input value.
     * @param {*} zoom - Input value.
     */
    function lngLatToTile(lng, lat, zoom) {
      const latitude = Math.max(-85.05112878, Math.min(85.05112878, lat));
      const scale = 2 ** zoom;
      return {
        x: ((lng + 180) / 360) * scale,
        y: (1 - Math.asinh(Math.tan(latitude * Math.PI / 180)) / Math.PI) / 2 * scale
      };
    }

    const elevationTileCache = CartivaCache.create(120);

    /**
     * Returns information about elevation grid for the Cartiva application.
     * @function getElevationGrid
     * @param {*} bounds - Input value.
     * @param {*} size - Input value.
     * @param {*} zoom - Input value.
     */
    async function getElevationGrid(bounds, size = 65, zoom = 12) {
      /**
       * Loads tile for the Cartiva application.
       * @function loadTile
       * @param {*} tileX - Input value.
       * @param {*} tileY - Input value.
       */
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
          let context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) {
            bitmap.close();
            throw new Error('Elevation tile canvas is unavailable.');
          }
          try {
            context.drawImage(bitmap, 0, 0);
            return context.getImageData(0, 0, 256, 256).data;
          } finally {
            bitmap.close();
            context.clearRect(0, 0, 256, 256);
            canvas.width = canvas.height = 1;
            context = null;
          }
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

    /**
     * Creates terrain mesh for the Cartiva application.
     * @function createTerrainMesh
     * @param {*} heights - Input value.
     * @param {*} size - Input value.
     * @param {*} bounds - Input value.
     * @param {*} exaggeration - Input value.
     * @param {*} cityFeatures - Input value.
     */
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

    /**
     * Creates terrain stl for the Cartiva application.
     * @function createTerrainStl
     * @param {*} mesh - Input value.
     * @param {*} colors - Input value.
     */
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

    /**
     * Rotates mesh to map bearing for the Cartiva application.
     * @function rotateMeshToMapBearing
     * @param {*} mesh - Input value.
     * @param {*} bearing - Input value.
     */
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

    /**
     * Creates stored zip for the Cartiva application.
     * @function createStoredZip
     * @param {*} files - Input value.
     */
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

    /**
     * Creates colored three mf for the Cartiva application.
     * @function createColoredThreeMf
     * @param {*} mesh - Input value.
     * @param {*} colors - Input value.
     */
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

    /**
     * Draws export annotations for the Cartiva application.
     * @function drawExportAnnotations
     * @param {*} context - Input value.
     * @param {*} exportState - Input value.
     * @param {*} width - Input value.
     * @param {*} height - Input value.
     * @param {*} mapWidth - Input value.
     * @param {*} borderWidth - Input value.
     */
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

    /**
    * Converts a canvas into an SVG document containing the exported artwork.
     * @function canvasToSvg
     * @param {*} canvas - Input value.
     * @param {*} exportState - Input value.
     */
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

    /**
     * Validates export size for the Cartiva application.
     * @function validateExportSize
     * @param {*} width - Input value.
     * @param {*} height - Input value.
     */
    function validateExportSize(width, height) {
      const pixels = width * height;
      const memory = Number(navigator.deviceMemory);
      const maxPixels = Number.isFinite(memory) && memory > 0
        ? Math.min(160000000, Math.floor(memory * 1024 ** 3 * 0.2 / 12))
        : 160000000;
      const maxSide = 16384;
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) throw new Error('Invalid export dimensions.');
      if (width > maxSide || height > maxSide || pixels > maxPixels) {
        throw new Error(`Export is too large for this browser (${width} × ${height}, ${(pixels / 1000000).toFixed(1)} MP; budget ${(maxPixels / 1000000).toFixed(1)} MP). Choose a smaller DPI or paper size.`);
      }
    }

    /**
     * Adds png resolution metadata for the Cartiva application.
     * @function addPngResolutionMetadata
     * @param {*} blob - Input value.
     * @param {*} dpi - Input value.
     */
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

    /**
     * Encodes baseline little-endian TIFF with lossless RGBA strips and physical DPI.
     * @param {HTMLCanvasElement} canvas - Completed poster.
     * @param {number} dpi - Output resolution in pixels per inch.
     * @returns {Promise<Blob>} Uncompressed TIFF with unassociated alpha.
     */
    async function canvasToTiff(canvas, dpi) {
      if (!Number.isFinite(dpi) || dpi <= 0) throw new Error('Invalid TIFF resolution.');
      const context = canvas.getContext('2d');
      if (!context) throw new Error('TIFF pixel readback is unavailable.');
      const rowsPerStrip = Math.max(1, Math.floor(1048576 / (canvas.width * 4)));
      const strips = Math.ceil(canvas.height / rowsPerStrip);
      const tagCount = 15;
      const ifdEnd = 8 + 2 + tagCount * 12 + 4;
      const bitsOffset = ifdEnd;
      const resolutionOffset = bitsOffset + 8;
      const offsetsOffset = resolutionOffset + 16;
      const countsOffset = offsetsOffset + (strips > 1 ? strips * 4 : 0);
      const pixelOffset = countsOffset + (strips > 1 ? strips * 4 : 0);
      const header = new Uint8Array(pixelOffset);
      const view = new DataView(header.buffer);
      header[0] = header[1] = 73;
      view.setUint16(2, 42, true);
      view.setUint32(4, 8, true);
      view.setUint16(8, tagCount, true);
      const bytesPerStrip = rowsPerStrip * canvas.width * 4;
      const tags = [
        [256, 4, 1, canvas.width], [257, 4, 1, canvas.height], [258, 3, 4, bitsOffset],
        [259, 3, 1, 1], [262, 3, 1, 2], [273, 4, strips, strips > 1 ? offsetsOffset : pixelOffset],
        [274, 3, 1, 1], [277, 3, 1, 4], [278, 4, 1, rowsPerStrip],
        [279, 4, strips, strips > 1 ? countsOffset : canvas.width * canvas.height * 4],
        [282, 5, 1, resolutionOffset], [283, 5, 1, resolutionOffset + 8],
        [284, 3, 1, 1], [296, 3, 1, 2], [338, 3, 1, 2]
      ];
      tags.forEach(([tag, type, count, value], index) => {
        const offset = 10 + index * 12;
        view.setUint16(offset, tag, true);
        view.setUint16(offset + 2, type, true);
        view.setUint32(offset + 4, count, true);
        if (type === 3 && count === 1) view.setUint16(offset + 8, value, true);
        else view.setUint32(offset + 8, value, true);
      });
      for (let channel = 0; channel < 4; channel += 1) view.setUint16(bitsOffset + channel * 2, 8, true);
      for (const offset of [resolutionOffset, resolutionOffset + 8]) {
        view.setUint32(offset, Math.round(dpi * 1000), true);
        view.setUint32(offset + 4, 1000, true);
      }
      const parts = [header];
      for (let index = 0; index < strips; index += 1) {
        const row = index * rowsPerStrip;
        const rows = Math.min(rowsPerStrip, canvas.height - row);
        const count = rows * canvas.width * 4;
        if (strips > 1) {
          view.setUint32(offsetsOffset + index * 4, pixelOffset + index * bytesPerStrip, true);
          view.setUint32(countsOffset + index * 4, count, true);
        }
        let pixels = context.getImageData(0, row, canvas.width, rows);
        parts.push(new Blob([pixels.data]));
        pixels = null;
        updateExportProgress(90 + 8 * (index + 1) / strips);
        await yieldExportFrame();
      }
      return new Blob(parts, { type: 'image/tiff' });
    }

    /**
    * Adjusts map line weights to match the selected print profile.
     * @function applyExportLineWeight
     * @param {*} targetMap - Input value.
     * @param {*} exportState - Input value.
     */
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

    /**
     * Draws canvas in tiles for the Cartiva application.
     * @function drawCanvasInTiles
     * @param {*} context - Input value.
     * @param {*} source - Input value.
     * @param {*} x - Input value.
     * @param {*} y - Input value.
     * @param {*} width - Input value.
     * @param {*} height - Input value.
     * @param {*} tileSize - Input value.
     */
    function drawCanvasInTiles(context, source, x, y, width, height, tileSize = getCanvasTileBudget().tileSize) {
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

    /**
     * Waits for map idle for the Cartiva application.
     * @function waitForMapIdle
     * @param {*} targetMap - Input value.
     * @param {*} timeoutMs - Input value.
     */
    function waitForMapIdle(targetMap, timeoutMs = 30000) {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          targetMap.off('idle', finish);
          reject(new Error('Map tiles did not finish loading in time.'));
        }, timeoutMs);
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

    /**
     * Handles render bounds for the Cartiva application.
     * @function compareRenderBounds
     * @param {*} exportMap - Input value.
     * @param {*} exportState - Input value.
     */
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
    function createScaledMapStyle(style, scale, printProfile = 'standard') {
      const result = JSON.parse(JSON.stringify(style));
      result.layers = result.layers.filter(layer => ![TERRAIN_COLOR_SOURCE_ID, TERRAIN_SOURCE_ID].includes(layer.source));
      delete result.sources[TERRAIN_COLOR_SOURCE_ID];
      delete result.sources[TERRAIN_SOURCE_ID];
      const offset = Math.log2(scale);
      const layoutPixels = new Set(['text-size', 'icon-size', 'text-padding', 'icon-padding', 'symbol-spacing']);
      const paintPixels = new Set(['text-halo-width', 'text-halo-blur', 'icon-halo-width', 'icon-halo-blur']);
      const linePixels = new Set(['line-width', 'line-gap-width', 'line-offset', 'line-blur']);
      const profileScale = { fine: 0.78, standard: 1, bold: 1.28 }[printProfile] || 1;
      result.layers.forEach(layer => {
        if (layer.minzoom != null) layer.minzoom = Math.max(0, Math.min(24, layer.minzoom + offset));
        if (layer.maxzoom != null) layer.maxzoom = Math.max(0, Math.min(24, layer.maxzoom + offset));
        layer.layout ||= {};
        if (layer.type === 'symbol' && layer.layout['text-field'] != null && layer.layout['text-size'] == null) layer.layout['text-size'] = 16;
        for (const group of ['layout', 'paint']) {
          Object.entries(layer[group] || {}).forEach(([key, value]) => {
            let multiplier = (group === 'layout' ? layoutPixels : paintPixels).has(key) ? scale : 1;
            if (group === 'paint' && linePixels.has(key)) multiplier = scale * profileScale;
            layer[group][key] = shiftStyleZoom(value, offset, multiplier);
          });
        }
      });
      // User GeoJSON is re-tiled at print zoom without screen-oriented simplification.
      Object.values(result.sources).forEach(source => {
        if (source.type === 'geojson') {
          source.tolerance = 0;
          source.maxzoom = 24;
        }
      });
      return result;
    }

    /**
     * Creates export map for the Cartiva application.
     * @function createExportMap
     * @param {*} width - Input value.
     * @param {*} height - Input value.
     * @param {*} exportState - Input value.
     * @param {*} options - Input value.
     */
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
        style: createScaledMapStyle(map.getStyle(), renderScale, options.preview ? 'standard' : exportState.printLineWeight),
        maxZoom: Math.max(24, exportZoom),
        center: options.center || exportState.center,
        zoom: exportZoom,
        bearing: exportState.bearing,
        pitch: exportState.pitch
      });
      try {
      CartivaWebGl.prepareMap(exportMap);
      await new Promise((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeout);
          exportMap.off('load', loaded);
          exportMap.off('error', failed);
        };
        const loaded = () => { cleanup(); resolve(); };
        const failed = event => { cleanup(); reject(event.error || new Error('Export map failed to load.')); };
        const timeout = setTimeout(() => failed({ error: new Error('Export map did not load in time.') }), 30000);
        exportMap.once('load', loaded);
        exportMap.once('error', failed);
      });
      const geoJsonDefinition = globalThis.CartivaGeoJson?.definition?.();
      if (geoJsonDefinition && !exportMap.getSource('cartiva-user-geojson')) {
        exportMap.addSource('cartiva-user-geojson', geoJsonDefinition.source);
        geoJsonDefinition.layers.forEach(layer => exportMap.addLayer(layer));
      }
      configureMapForRender(exportMap, exportState);
      const buildingThreshold = Number.isFinite(Number(exportState.buildingMinZoom))
        ? Number(exportState.buildingMinZoom) : 10.5;
      configureBuildingZoom(exportMap, { ...exportState, buildingMinZoom: buildingThreshold + Math.log2(renderScale) });
      exportMap.getStyle().layers.filter(layer => getLayerRole(layer) === 'building').forEach(layer => {
        exportMap.setLayerZoomRange(layer.id, Math.max(0, buildingThreshold + Math.log2(renderScale)),
          Math.max(24, exportZoom + 1, buildingThreshold + Math.log2(renderScale) + 1));
      });
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
      if (exportState.contourEnabled) await updateContours(exportMap, exportState, { bounds: exportState.bounds });
      const contourLayer = exportMap.getStyle().layers.find(layer => layer.id.includes('contour') && layer.type === 'line');
      if (contourLayer) {
        const contourWidth = Number(exportState.contourWidth) || 0.8;
        exportMap.setPaintProperty(contourLayer.id, 'line-width', contourWidth * renderScale);
      }
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
      const liveCanvas = map.getCanvas();
      const gl = liveCanvas.getContext('webgl2') || liveCanvas.getContext('webgl');
      const gpuLimit = gl ? Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)) : 4096;
      const { tileSize, maxRenderSide } = getCanvasTileBudget(navigator, gpuLimit);
      const overlap = Math.min(Math.floor((maxRenderSide - tileSize) / 2),
        Math.max(64, Math.ceil(64 * sourceWidth / exportState.previewMapSize.width)));
      let exportMap;
      let container;
      let tileCanvas;
      let tileContext;
      updateExportProgress(10);
      CartivaDiagnostics.record('image.tiles', 'Selected hardware-aware canvas budget.', {
        tileSize, maxRenderSide, memoryGb: navigator.deviceMemory ?? null, overlap
      });
      try {
        if (sourceWidth <= tileSize && sourceHeight <= tileSize) {
          ({ exportMap, container } = await createExportMap(sourceWidth, sourceHeight, exportState));
          drawCanvasInTiles(context, exportMap.getCanvas(), x, y, width, height);
          updateExportProgress(85, context.canvas);
          await yieldExportFrame();
          return;
        }
        if (exportState.pitch !== 0) {
          throw new Error('This pitched view exceeds the device GPU budget. Set map pitch to zero or reduce paper size/DPI; resolution will not be silently reduced.');
        }
        const columns = Math.ceil(sourceWidth / tileSize), rows = Math.ceil(sourceHeight / tileSize);
        tileCanvas = document.createElement('canvas');
        tileContext = tileCanvas.getContext('2d');
        if (!tileContext) throw new Error('Tile composite context is unavailable.');
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
              if (exportState.contourEnabled) {
                await updateContours(exportMap, exportState, { bounds: exportState.bounds });
                const contour = exportMap.getStyle().layers.find(layer => layer.id.includes('contour') && layer.type === 'line');
                if (contour) exportMap.setPaintProperty(contour.id, 'line-width',
                  (Number(exportState.contourWidth) || 0.8) * sourceWidth / exportState.previewMapSize.width);
              }
              await waitForMapIdle(exportMap);
            }
            tileCanvas.width = tileWidth;
            tileCanvas.height = tileHeight;
            try {
              tileContext.drawImage(exportMap.getCanvas(), overlap, overlap, tileWidth, tileHeight,
                0, 0, tileWidth, tileHeight);
              context.drawImage(tileCanvas, 0, 0, tileWidth, tileHeight,
                x + left * width / sourceWidth, y + top * height / sourceHeight,
                tileWidth * width / sourceWidth, tileHeight * height / sourceHeight);
            } finally {
              tileContext.clearRect(0, 0, tileWidth, tileHeight);
              tileCanvas.width = tileCanvas.height = 1;
            }
            updateExportProgress(10 + 75 * (row * columns + column + 1) / (rows * columns), context.canvas);
            await yieldExportFrame();
          }
        }
        CartivaDiagnostics.record('image.export', 'Tiled map rendering completed.', { columns, rows, sourceWidth, sourceHeight });
      } finally {
        if (tileCanvas) tileCanvas.width = tileCanvas.height = 1;
        tileContext = null;
        tileCanvas = null;
        exportMap?.remove();
        container?.remove();
      }
    }

    const refinedMapPreview = document.getElementById('refinedMapPreview');
    const previewStateIndicator = document.getElementById('previewStateIndicator');
    const previewLoadingBanner = document.getElementById('previewLoadingBanner');
    const REFINED_PREVIEW_MAX_SIDE = 3200;
    const REFINED_PREVIEW_ZOOM_BOOST = 2;
    const REFINED_PREVIEW_DELAY_MS = 600;
    let refinedPreviewToken = 0;
    let refinedPreviewUrl = '';
    let refinedPreviewRendering = false;
    let refinedPreviewPending = false;
    let refinedPreviewCamera = null;
    let refinedPreviewDesign = '';
    let refinedPreviewPadding = 0;
    let refinedPreviewRingsLoaded = 0;
    let cachedDetailMap = null;
    let cachedDetailContainer = null;
    let cachedDetailDesign = '';

    /** Releases the isolated map and its tile cache at invalidation or shutdown. */
    function releaseDetailTileCache() {
      cachedDetailMap?.remove();
      cachedDetailContainer?.remove();
      cachedDetailMap = cachedDetailContainer = null;
      cachedDetailDesign = '';
    }

    /** Tests whether a same-orientation pan is wholly covered by buffered detail. */
    function hasBufferedDetail(extraPadding = 0) {
      if (!refinedPreviewUrl || !refinedPreviewCamera
        || refinedPreviewDesign !== getRefinedPreviewDesign()) return false;
      if (map.getZoom() !== refinedPreviewCamera.zoom
        || map.getBearing() !== refinedPreviewCamera.bearing
        || map.getPitch() !== refinedPreviewCamera.pitch) return false;
      const center = map.project(refinedPreviewCamera.center);
      const viewport = map.getContainer();
      return Math.abs(center.x - viewport.clientWidth / 2) + extraPadding <= refinedPreviewPadding + 0.01
        && Math.abs(center.y - viewport.clientHeight / 2) + extraPadding <= refinedPreviewPadding + 0.01;
    }

    /**
     * Captures the render-affecting design and viewport size without camera/name churn.
     * @returns {string} Stable detail-cache key.
     */
    function getRefinedPreviewDesign() {
      const { center, zoom, bearing, pitch, city, coordinates, country, ...design } = state;
      return JSON.stringify({ design, width: map.getContainer().clientWidth,
        height: map.getContainer().clientHeight, rings: CartivaPreviewCacheSettings.getRings(),
        overlay: globalThis.CartivaGeoJson?.definition?.() });
    }

    /** Restores a detailed image after sub-threshold movement using the current camera. */
    function restoreBufferedDetail() {
      const oldCenter = map.project(refinedPreviewCamera.center);
      const container = map.getContainer();
      const scale = 2 ** (map.getZoom() - refinedPreviewCamera.zoom);
      const rotation = refinedPreviewCamera.bearing - map.getBearing();
      refinedMapPreview.style.transform = `translate(${oldCenter.x - container.clientWidth / 2}px, ${oldCenter.y - container.clientHeight / 2}px) rotate(${rotation}deg) scale(${scale})`;
      refinedMapPreview.classList.add('ready');
      setRefinedPreviewState(true, refinedPreviewRingsLoaded > 0
        && hasBufferedDetail(CartivaPreviewCacheSettings.getRings() * 256));
    }

    /**
     * Sets refined preview state for the Cartiva application.
     * @function setRefinedPreviewState
     * @param {*} detailed - Input value.
     */
    function setRefinedPreviewState(detailed, cached = false) {
      const label = cached ? 'Detailed preview and surrounding tiles loaded'
        : detailed ? 'Detailed preview loaded' : 'Limited preview';
      previewStateIndicator.classList.toggle('detailed', detailed);
      previewStateIndicator.classList.toggle('cached', detailed && cached);
      previewStateIndicator.classList.toggle('limited', !detailed);
      previewStateIndicator.setAttribute('aria-label', label);
      previewStateIndicator.title = label;
      previewLoadingBanner.hidden = detailed;
    }

    /**
     * Handles refined preview for the Cartiva application.
     * @function hideRefinedPreview
     */
    function hideRefinedPreview({ preserveImage = false } = {}) {
      refinedPreviewToken += 1;
      clearTimeout(runtimeState.timers.refinedPreview);
      if (preserveImage && hasBufferedDetail()) restoreBufferedDetail();
      else {
        refinedMapPreview.classList.remove('ready');
        setRefinedPreviewState(false);
      }
      if (!preserveImage) {
        refinedPreviewDesign = '';
        refinedMapPreview.style.transform = '';
      }
    }

    /** Aligns buffered detail continuously during a pan, hiding it only outside coverage. */
    function updateBufferedDetail() {
      if (hasBufferedDetail()) restoreBufferedDetail();
      else {
        refinedMapPreview.classList.remove('ready');
        setRefinedPreviewState(false);
      }
    }
    map.on('move', updateBufferedDetail);

    /** Decodes a completed ring off-DOM before replacing the visible detail image. */
    async function publishDetailRing(targetMap, token, exportState, design, padding, ring) {
      const blob = await new Promise((resolve, reject) => targetMap.getCanvas().toBlob(
        result => result ? resolve(result) : reject(new Error('Refined preview encoding failed.')), 'image/png'));
      if (token !== refinedPreviewToken) return false;
      const nextUrl = URL.createObjectURL(blob);
      const image = new Image();
      try {
        image.src = nextUrl;
        await image.decode();
        if (token !== refinedPreviewToken) { URL.revokeObjectURL(nextUrl); return false; }
        const previousUrl = refinedPreviewUrl;
        refinedMapPreview.src = nextUrl;
        refinedPreviewUrl = nextUrl;
        refinedPreviewCamera = { center: exportState.center, zoom: exportState.zoom,
          bearing: exportState.bearing, pitch: exportState.pitch };
        refinedPreviewDesign = design;
        refinedPreviewPadding = padding;
        refinedPreviewRingsLoaded = ring;
        refinedMapPreview.style.width = `${exportState.previewMapSize.width + padding * 2}px`;
        refinedMapPreview.style.height = `${exportState.previewMapSize.height + padding * 2}px`;
        refinedMapPreview.style.left = refinedMapPreview.style.top = `${-padding}px`;
        restoreBufferedDetail();
        if (previousUrl) URL.revokeObjectURL(previousUrl);
        return true;
      } catch (error) {
        URL.revokeObjectURL(nextUrl);
        throw error;
      }
    }

    /**
     * Renders refined preview for the Cartiva application.
     * @function renderRefinedPreview
     * @param {*} token - Input value.
     */
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
        const detailDesign = getRefinedPreviewDesign();
        const previewWidth = Math.max(1, exportState.previewMapSize.width);
        const previewHeight = Math.max(1, exportState.previewMapSize.height);
        const rings = exportState.pitch === 0 ? CartivaPreviewCacheSettings.getRings() : 0;
        const requestedScale = 2 ** REFINED_PREVIEW_ZOOM_BOOST;
        const liveCanvas = map.getCanvas();
        const gl = liveCanvas.getContext('webgl2') || liveCanvas.getContext('webgl');
        const gpuLimit = gl ? Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)) : 4096;
        const scale = Math.min(requestedScale, REFINED_PREVIEW_MAX_SIDE / Math.max(previewWidth, previewHeight),
          Math.min(4096, gpuLimit) / (Math.max(previewWidth, previewHeight) + rings * 512));
        const width = Math.round(previewWidth * scale);
        const height = Math.round(previewHeight * scale);
        if (cachedDetailDesign !== detailDesign) releaseDetailTileCache();
        if (!cachedDetailMap) {
          ({ exportMap: cachedDetailMap, container: cachedDetailContainer } =
            await createExportMap(width, height, exportState, { preview: true }));
          cachedDetailContainer.classList.add('preview-cache-map-container');
          cachedDetailDesign = detailDesign;
        }
        refinedMap = cachedDetailMap;
        container = cachedDetailContainer;
        container.style.width = `${width}px`;
        container.style.height = `${height}px`;
        refinedMap.resize();
        refinedMap.jumpTo({ center: exportState.center, zoom: exportState.zoom + Math.log2(scale),
          bearing: exportState.bearing, pitch: exportState.pitch });
        await updateTerrainColorization(refinedMap, exportState);
        if (exportState.contourEnabled) await updateContours(refinedMap, exportState, { bounds: refinedMap.getBounds().toArray() });
        await waitForMapIdle(refinedMap);
        if (token !== refinedPreviewToken) return;
        const buildingLayerIds = (refinedMap.getStyle()?.layers || [])
          .filter(layer => getLayerRole(layer) === 'building')
          .map(layer => layer.id);
        const buildingFeatures = buildingLayerIds.length
          ? refinedMap.queryRenderedFeatures({ layers: buildingLayerIds }).length
          : 0;
        if (!hasBufferedDetail() || refinedPreviewPadding === 0) {
          if (!await publishDetailRing(refinedMap, token, exportState, detailDesign, 0, 0)) return;
        }
          CartivaDiagnostics.record('preview.refine', 'High-fidelity preview rendered.', {
            location: exportState.city,
            center: exportState.center,
            width,
            height,
            detailZoom: exportState.zoom + Math.log2(scale),
            buildingFeatures
          });
        for (let ring = 1; ring <= rings; ring += 1) {
          if (token !== refinedPreviewToken) return;
          const padding = ring * 256;
          container.style.width = `${Math.floor((previewWidth + padding * 2) * scale)}px`;
          container.style.height = `${Math.floor((previewHeight + padding * 2) * scale)}px`;
          refinedMap.resize();
          await updateTerrainColorization(refinedMap, exportState);
          if (exportState.contourEnabled) await updateContours(refinedMap, exportState, { bounds: refinedMap.getBounds().toArray() });
          await waitForMapIdle(refinedMap);
          if (ring === rings || !hasBufferedDetail(padding)) {
            if (!await publishDetailRing(refinedMap, token, exportState, detailDesign, padding, ring)) return;
          }
          CartivaDiagnostics.record('preview.cache', 'Surrounding tile ring loaded.', { ring, rings, padding });
          await yieldExportFrame();
        }
      } catch (error) {
        if (token === refinedPreviewToken) {
          previewLoadingBanner.hidden = true;
          releaseDetailTileCache();
          CartivaDiagnostics.report('preview.refine', error);
        }
      } finally {
        refinedPreviewRendering = false;
        if (refinedPreviewPending) {
          refinedPreviewPending = false;
          scheduleRefinedPreview();
        }
      }
    }

    /**
     * Schedules refined preview for the Cartiva application.
     * @function scheduleRefinedPreview
     */
    function scheduleRefinedPreview({ preserveImage = false } = {}) {
      hideRefinedPreview({ preserveImage: true });
      if (document.hidden || Object.keys(runtimeState.operations).some(area => area.endsWith('.export'))) return;
      const currentCamera = { center: map.getCenter().toArray(), zoom: map.getZoom(),
        bearing: map.getBearing(), pitch: map.getPitch() };
      if (CartivaPreviewCacheSettings.getRings() === 0
        && refinedPreviewUrl && refinedPreviewCamera && refinedPreviewDesign === getRefinedPreviewDesign()
        && globalThis.CartivaMapDetailPolicy
        && !CartivaMapDetailPolicy.isSignificant(refinedPreviewCamera, currentCamera, map)) {
        restoreBufferedDetail();
        return;
      }
      previewLoadingBanner.hidden = refinedMapPreview.classList.contains('ready');
      const token = refinedPreviewToken;
      runtimeState.timers.refinedPreview = setTimeout(() => renderRefinedPreview(token), REFINED_PREVIEW_DELAY_MS);
    }

    globalThis.CartivaRefinedPreview = Object.freeze({
      hide: hideRefinedPreview,
      schedule: scheduleRefinedPreview,
      hasBufferedDetail,
      isRendering: () => refinedPreviewRendering
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) hideRefinedPreview();
      else scheduleRefinedPreview();
    });
    globalThis.addEventListener('pagehide', () => {
      hideRefinedPreview();
      releaseDetailTileCache();
      if (refinedPreviewUrl) URL.revokeObjectURL(refinedPreviewUrl);
      refinedPreviewUrl = '';
    });

    /**
     * Runs image export for the Cartiva application.
     * @function runImageExport
     */
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
        updateExportProgress(90, exportCanvas);
        await yieldExportFrame();
        if (mimeType === 'image/tiff') {
          const filename = `${baseFilename}.tiff`;
          const blob = await canvasToTiff(exportCanvas, exportState.exportDpi);
          downloadBlob(blob, filename);
          if (exportState.includeExportMetadata) downloadExportMetadata(exportState, baseFilename);
          CartivaDiagnostics.record('image.export', 'TIFF export completed.', { filename, bytes: blob.size });
          setStatus('5/5 Poster exported.');
          return { filename };
        }
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
      }
    }

    exportConfirmBtn.addEventListener('click', runImageExport);
