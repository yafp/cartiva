# cartiva

## About
cartiva is a small, self-contained creative cartography web-app.

- Select a location
- configure a few parameters
- generate and export a high-resolution graphics for printing

Inspired by [Urbanmapdesign.com](https://www.urbanmapdesign.com).

## Demo
You can find a live demo of the latest released version on [Github Pages](https://yafp.github.io/cartiva/index.html)

## Usage
### Locally
- Download [latest release](https://github.com/yafp/cartiva/releases)
- Extract
- Double-click the .html file within the `src` folder

### As a service
Just use the demo linked above.

## Developers
### Structure

- `src/index.html` contains the application markup.
- `src/cartiva.css` contains all presentation styles.
- `src/js/preset-data.js` contains the palette catalog and normalized preset data.
- `src/data/preset-catalog.json` contains the editable preset display catalog; the JS data module remains as a direct-file-compatible runtime fallback for palette values.
- `src/js/app.js` is the small composition root loaded after the feature runtimes.
- `src/js/ui.js` owns persistent design state, delegated form handling, preview rendering, labels, and layout controls.
- `src/js/ui/projects.js` owns project, history, user preset, and GeoJSON actions.
- `src/js/ui/shortcuts.js` owns global keyboard commands.
- `src/js/map.js` owns MapLibre initialization, map layers, terrain, annotations, and map interactions.
- `src/js/location.js` owns search, reverse geocoding, and location persistence.
- `src/js/export.js` owns image rendering and the shared terrain/mesh algorithms.
- `src/js/export/model-export.js` owns STL and 3MF export orchestration.
- `src/js/export/shared.js` owns downloads, metadata, timestamps, and binary checksums.
- `src/js/pdf-exporter.js` owns the PDF worker adapter.
- `src/js/core/runtime-state.js` contains transient history, timers, controllers, and active operations that are never persisted.
- `src/js/core/render-spec.js` creates the immutable render specification shared by preview, image, STL, and 3MF rendering.
- `src/js/core/operations.js` provides consistent logging, status, control state, failure handling, and cleanup for asynchronous operations.
- `src/js/core/` also contains project persistence, caching, diagnostics, and external service configuration.
- `src/js/map/layer-registry.js` owns MapLibre style-layer role detection.
- `src/js/map/style-adapter.js` normalizes provider layers into application roles.
- `src/js/services/geocoder.js` owns the Nominatim network boundary.
- `src/js/presets/preset-service.js` validates and exposes preset data.
- `src/js/export/export-contract.js` defines the serializable export request shape.
- `src/js/export-worker.js` contains the PDF encoding worker.

### Architecture boundaries

The application separates serializable project state from transient runtime state. UI controls update project state through one delegated form dispatcher, while MapLibre, geocoding, preset data, and export encoding are accessed through dedicated boundaries. Preview and all exporters consume one normalized render specification. The feature files remain classic scripts loaded in dependency order so the app stays dependency-free and can still be opened directly from the `src/index.html` file.

Map layer controls are defined declaratively in `src/js/map/layer-registry.js`. The same definitions drive state synchronization, map styling, 3D feature limits, visibility, and materials.

External provider URLs are centralized in `src/js/core/service-config.js`. This makes provider replacement, local testing, and future configuration injection possible without changing UI or rendering code.

### Maintenance features

PDF output preserves the selected physical paper size by converting image pixels to PDF points using the selected DPI. SVG output is raster-backed and preserves the exact poster render without duplicating labels.
Export preflight supports A4 PNG output at 600 DPI while still rejecting dimensions above the browser-safe 16,384-pixel side and 160-megapixel limits. Temporary export maps are cleaned up after failures, and large map transfers use bounded tile compositing.
Custom paper sizes, bleed/safe-area guides, undo/redo history, GeoJSON overlays, project migrations, and bounded preset storage are available in the sidebar. Provider details remain in export metadata but are not displayed in the interface.
Quality profiles render the map at 1x, 1.5x, or 2x before downsampling with high-quality canvas filtering. Preview rendering is capped at 2x device pixel ratio, export zoom is provider-clamped, print line weights can be adjusted, PNG exports receive DPI metadata, and PDF prefers lossless PNG embedding when jsPDF is available.
STL and 3MF terrain exports include visible water, nature, urban land cover, boundaries, roads, and buildings. 3MF uses standard material colors; STL writes the common 15-bit per-facet color extension for viewers that support colored STL files.
Map layers use a fixed cartographic order so previews and all export formats remain predictable. Legacy project files with a custom `layerOrder` field still load, but the value is normalized to the canonical order.

### Reliability and accessibility

The app uses `loglevel` for structured lifecycle, map, geocoder, project, and export logging. The default level is `info`; call `CartivaDiagnostics.setLevel('debug')` in the browser console to persist a different level, and inspect recent structured entries with `CartivaDiagnostics.list()`. Map, geocoder, and terrain failures are reported without preventing other features from working. Accordion headers expose keyboard focus, `Enter`/`Space` activation, and `aria-controls`; color inputs receive explicit accessible names.

### Local development

Opening the HTML file directly remains supported for the main application, but a local HTTP server is recommended for worker and browser security behavior:

```powershell
python -m http.server 8080 --directory src
```

Then open `http://localhost:8080`. No package installation or build step is required.

Run the repository checks without installing Node.js:

```powershell
./scripts/Test-Cartiva.ps1
```

The validator checks script references, HTML IDs and labels, JSON parsing, duplicate classic-script function declarations, and English ASCII comments. `.editorconfig`, `jsconfig.json`, and the `Validate` GitHub Actions workflow keep these checks available in editors and continuous integration.






