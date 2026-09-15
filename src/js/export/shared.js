// Shared download and binary helpers used by project, image, STL, and 3MF exports.
function getFileTimestamp() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}_${hh}${min}${ss}`;
}

function downloadBlob(blob, filename) {
  CartivaDiagnostics.record('download', 'Preparing browser download.', { filename, bytes: blob.size, type: blob.type });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

function downloadExportMetadata(renderSpec, filename) {
  const metadata = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    appVersion: window.CartivaApp?.version || APP.VERSION,
    source: 'cartiva',
    city: renderSpec.city,
    coordinates: renderSpec.coordinates,
    country: renderSpec.country,
    camera: {
      center: renderSpec.center,
      zoom: renderSpec.zoom,
      bearing: renderSpec.bearing,
      pitch: renderSpec.pitch,
      bounds: renderSpec.bounds
    },
    format: renderSpec.format,
    exportDpi: renderSpec.exportDpi,
    exportQuality: renderSpec.exportQuality,
    printLineWeight: renderSpec.printLineWeight,
    preset: renderSpec.preset,
    layers: renderSpec.layers,
    layerOrder: renderSpec.layerOrder,
    effects: {
      contrast: renderSpec.contrast,
      brightness: renderSpec.brightness,
      saturation: renderSpec.saturation
    },
    providers: window.CartivaServices
  };
  downloadBlob(new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' }), `${filename}.json`);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}