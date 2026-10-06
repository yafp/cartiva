// Label contrast is shared by preview controls and random design.
/**
 * Handles luminance for the Cartiva application.
 * @function relativeLuminance
 * @param {*} hex - Input value.
 */
function relativeLuminance(hex) {
  const channels = [1, 3, 5].map(index => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/**
 * Updates contrast warning for the Cartiva application.
 * @function updateContrastWarning
 */
function updateContrastWarning() {
  const background = relativeLuminance(state.labelBgColor);
  const ratios = [state.labelTextColor, state.labelCoordColor, state.labelCountryColor].map(color => {
    const foreground = relativeLuminance(color);
    return (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05);
  });
  const minimum = Math.min(...ratios);
  const warning = $('contrastWarning');
  const passes = minimum >= 4.5 || state.labelStyle === 'none' || state.labelOpacity < 50;
  warning.textContent = passes
    ? `Text contrast: ${minimum.toFixed(1)}:1`
    : `Low text contrast: ${minimum.toFixed(1)}:1 (aim for 4.5:1)`;
  warning.classList.toggle('good', passes);
}

const mapLabelOverlay = document.getElementById('mapLabelOverlay');
const opacityNum = document.getElementById('opacityNum');

/** Captures the preview label geometry for canvas export. */
function getLabelRenderModel(targetMap = map) {
  const mapRect = targetMap.getContainer().getBoundingClientRect();
  const overlayRect = mapLabelOverlay.getBoundingClientRect();
  const previewScale = targetMap.getContainer().clientWidth / mapRect.width;
  const children = [cityNameEl, cityCoordsEl, cityCountryEl].map(element => {
    const rect = element.getBoundingClientRect();
    const computed = getComputedStyle(element);
    return {
      x: (rect.left - overlayRect.left) * previewScale,
      baselineY: (rect.top - overlayRect.top + parseFloat(computed.fontSize)) * previewScale,
      fontSize: parseFloat(computed.fontSize) * previewScale,
      fontWeight: computed.fontWeight,
      textAlign: computed.textAlign,
      color: computed.color
    };
  });
  return {
    x: (overlayRect.left - mapRect.left) * previewScale,
    y: (overlayRect.top - mapRect.top) * previewScale,
    width: overlayRect.width * previewScale,
    height: overlayRect.height * previewScale,
    borderRadius: parseFloat(getComputedStyle(mapLabelOverlay).borderRadius) * previewScale,
    children
  };
}