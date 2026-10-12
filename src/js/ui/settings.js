// Application settings persist only after an explicit Save.
const previewBackgroundColor = $('previewBackgroundColor');
const savedBackground = localStorage.getItem('cartiva.previewBackground');
if (/^#[0-9a-f]{6}$/i.test(savedBackground || '')) previewBackgroundColor.value = savedBackground;
document.body.style.backgroundColor = previewBackgroundColor.value;

/** Returns a validated, saved ring count, defaulting to one ring. */
function savedPreviewCacheRings() {
  const value = localStorage.getItem('cartiva.previewCacheRings');
  return /^[0-4]$/.test(value || '') ? Number(value) : 1;
}
globalThis.CartivaPreviewCacheSettings = Object.freeze({ getRings: savedPreviewCacheRings });

$('appSettingsBtn').addEventListener('click', () => {
  previewBackgroundColor.value = savedPreviewColor();
  $('previewCacheRings').value = String(savedPreviewCacheRings());
  $('appSettingsDialog').showModal();
});

/** Returns the last saved color, ignoring invalid browser storage values. */
function savedPreviewColor() {
  const value = localStorage.getItem('cartiva.previewBackground');
  return /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#d1d5db';
}

$('appSettingsSaveBtn').addEventListener('click', () => {
  document.body.style.backgroundColor = previewBackgroundColor.value;
  localStorage.setItem('cartiva.previewBackground', previewBackgroundColor.value);
  localStorage.setItem('cartiva.previewCacheRings', $('previewCacheRings').value);
  $('appSettingsDialog').close();
  globalThis.CartivaRefinedPreview?.schedule();
});
$('appSettingsCancelBtn').addEventListener('click', () => $('appSettingsDialog').close());
$('appSettingsCloseBtn').addEventListener('click', () => $('appSettingsDialog').close());

$('sampleColorBtn').addEventListener('click', async () => {
  if (typeof EyeDropper === 'undefined') {
    setStatus('Color picking requires a browser with EyeDropper support.', true);
    return;
  }
  try {
    $('sampledColor').value = (await new EyeDropper().open()).sRGBHex;
  } catch (error) {
    if (error.name !== 'AbortError') CartivaDiagnostics.report('color.sample', error);
  }
});