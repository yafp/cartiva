// Render the current state into the interactive preview.
function renderPreview() {
  if (!runtimeState.mapReady) return;
  globalThis.CartivaRefinedPreview?.hide();
  const renderSpec = CartivaRenderSpec.create(state);
  contrastNum.textContent = renderSpec.contrast;
  brightnessNum.textContent = renderSpec.brightness;
  saturationNum.textContent = renderSpec.saturation;
  $('shapeScaleVal').textContent = renderSpec.shapeScale;
  mapEl.style.filter = `contrast(${renderSpec.contrast}%) brightness(${renderSpec.brightness}%) saturate(${renderSpec.saturation}%)`;
  $('refinedMapPreview').style.filter = mapEl.style.filter;
  opacityNum.textContent = renderSpec.labelOpacity;
  mapLabelOverlay.style.display = renderSpec.labelStyle === 'none' ? 'none' : 'block';
  if (renderSpec.labelStyle !== 'none') {
    mapLabelOverlay.className = `map-label-overlay ${renderSpec.labelStyle}`;
    mapLabelOverlay.style.fontFamily = renderSpec.labelFont;
    const hex = renderSpec.labelBgColor;
    const alpha = renderSpec.labelOpacity / 100;
    const rgb = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
    mapLabelOverlay.style.backgroundColor = renderSpec.labelStyle === 'special-minimal'
      ? 'transparent'
      : `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
    cityNameEl.style.color = renderSpec.labelTextColor;
    cityCoordsEl.style.color = renderSpec.labelCoordColor;
    cityCountryEl.style.color = renderSpec.labelCountryColor;
    [cityNameEl, cityCoordsEl, cityCountryEl].forEach(element => {
      element.style.fontFamily = renderSpec.labelFont;
    });
  }
  borderWidthVal.textContent = renderSpec.borderWidth;
  $('outerBorderRadiusVal').textContent = renderSpec.outerBorderRadius;
  $('innerBorderRadiusVal').textContent = renderSpec.innerBorderRadius;
  borderUiItems.forEach(item => {
    item.style.display = renderSpec.borderEnabled ? 'flex' : 'none';
  });
  mapFrame.style.border = renderSpec.borderEnabled
    ? `${renderSpec.borderWidth}px solid ${renderSpec.borderColor}`
    : 'none';
  mapFrame.style.backgroundColor = renderSpec.borderEnabled ? renderSpec.borderColor : '#ffffff';
  mapFrame.style.borderRadius = `${renderSpec.outerBorderRadius}px`;
  mapEl.style.borderRadius = `${renderSpec.innerBorderRadius}px`;
  $('refinedMapPreview').style.borderRadius = mapEl.style.borderRadius;
  const outline = $('innerBorderOutline');
  outline.style.display = renderSpec.borderEnabled && renderSpec.innerOutlineEnabled ? 'block' : 'none';
  outline.style.border = `${renderSpec.innerOutlineWidth}px solid ${renderSpec.innerOutlineColor}`;
  outline.style.borderRadius = mapEl.style.borderRadius;
  $('innerOutlineWidthVal').textContent = renderSpec.innerOutlineWidth;
  $('innerOutlineColor').disabled = $('innerOutlineWidth').disabled = !renderSpec.innerOutlineEnabled;
  mapFrame.className = `map-frame ratio-${renderSpec.format}`;
  if (renderSpec.format === 'custom') mapFrame.style.aspectRatio = `${renderSpec.customWidthMm} / ${renderSpec.customHeightMm}`;
  else mapFrame.style.removeProperty('aspect-ratio');
  document.body.classList.toggle('guides-visible', renderSpec.guidesEnabled);
  const safeGuide = mapFrame.querySelector('.safe-guide');
  if (safeGuide) safeGuide.style.inset = `${Math.max(0, renderSpec.safeMm)}mm`;
  renderShapeMask(renderSpec);
  renderMapAnnotations();
  applyMapState(map, renderSpec);
  updateOutputDimensions();
  updateContrastWarning();
  schedulePreviewRenderSync();
}

function updateStateFromControls() {
  syncStateFromControls();
  renderPreview();
}

function getShapePath(shape, width, height, scalePercent = 100) {
  const svgPath = getShapeSvgPath(shape);
  const path = new Path2D(svgPath);
  const scale = Math.max(0.25, Math.min(1, Number(scalePercent) / 100));
  const transform = new DOMMatrix([
    width / 100 * scale, 0, 0, height / 100 * scale,
    width / 2 * (1 - scale), height / 2 * (1 - scale)
  ]);
  return new Path2D(path, transform);
}

function getShapeSvgPath(shape) {
  if (shape === 'circle') return 'M 50 10 A 40 40 0 1 1 49.99 10 Z';
  if (shape === 'heart') return 'M 50 88 C 5 58 5 25 27 15 C 40 9 49 20 50 31 C 51 20 60 9 73 15 C 95 25 95 58 50 88 Z';
  if (shape === 'star') return 'M 50 8 L 61 36 L 91 38 L 68 57 L 76 88 L 50 70 L 24 88 L 32 57 L 9 38 L 39 36 Z';
  if (shape === 'house') return 'M 10 45 L 50 10 L 90 45 L 82 45 L 82 90 L 60 90 L 60 63 L 40 63 L 40 90 L 18 90 L 18 45 Z';
  if (shape === 'diamond') return 'M 50 7 L 92 50 L 50 93 L 8 50 Z';
  if (shape === 'cross') return 'M 35 8 L 65 8 L 65 35 L 92 35 L 92 65 L 65 65 L 65 92 L 35 92 L 35 65 L 8 65 L 8 35 L 35 35 Z';
  if (shape === 'cloud') return 'M 22 79 C 7 79 4 57 17 50 C 13 31 34 19 48 31 C 57 12 85 21 84 43 C 101 48 96 79 77 79 Z';
  return '';
}

function renderShapeMask(renderSpec = CartivaRenderSpec.create(state)) {
  const mask = $('shapeMask');
  if (renderSpec.shape === 'none') {
    mask.style.display = 'none';
    return;
  }
  mask.style.display = 'block';
  $('shapeCutoutPath').setAttribute('d', getShapeSvgPath(renderSpec.shape));
  const scale = Math.max(0.25, Math.min(1, Number(renderSpec.shapeScale) / 100));
  $('shapeCutoutPath').setAttribute('transform', `translate(50 50) scale(${scale}) translate(-50 -50)`);
  $('shapeMaskColor').setAttribute('fill', renderSpec.shapeColor);
}