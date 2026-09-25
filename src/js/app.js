// cartiva application composition root
// Feature runtimes are loaded in dependency order from index.html.
// shared services -> preset data/service -> UI -> map -> location -> export.
//
// Keeping this file intentionally small makes startup wiring easy to inspect.
window.CartivaApp = Object.freeze({
  version: APP.VERSION,
  modules: ['ui', 'projects', 'map', 'location', 'image-export', 'model-export']
});
window.CartivaDiagnostics?.record('application', 'Application modules initialized.', window.CartivaApp);
