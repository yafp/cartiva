|         |         |         |
| ------- | ------- | ------- |
| License | ![GitHub License](https://img.shields.io/github/license/yafp/cartiva.svg) | |
| Code | ![GitHub Issues Open](https://img.shields.io/github/issues-raw/yafp/cartiva.svg?style=flat) | ![GitHub Last Commit](https://img.shields.io/github/last-commit/yafp/cartiva.svg?style=flat) |
| Release | ![GitHub Current Release](https://img.shields.io/github/release/yafp/cartiva.svg?style=flat)  | ![GitHub Release Date](https://img.shields.io/github/release-date/yafp/cartiva.svg?style=flat) |

# cartiva
Create beautiful printable map art from any location in the world.

**cartiva** is a browser-based cartography tool that allows you to:

- Search for any location worldwide
- Customize colors, labels and terrain
- Export high-resolution artwork (images or 3D models)
- Save and reload projects
- Generate artistic map designs

You can find a **live demo** of the latest released version on [Github Pages](https://yafp.github.io/cartiva/index.html)

No installation required.

## Examples
![Cartiva Screenshot Prague](https://github.com/yafp/cartiva/blob/main/.github/examples/cartiva_PRAGUE_300dpi.png)
![Cartiva Screenshot Copenhagen](https://raw.githubusercontent.com/yafp/cartiva/refs/heads/main/.github/examples/cartiva_COPENHAGEN_300dpi.png)
![Cartiva Screenshot Hamburg](https://raw.githubusercontent.com/yafp/cartiva/refs/heads/main/.github/examples/cartiva_HAMBURG_300dpi.png)
![Cartiva Screenshot Heidelberg](https://raw.githubusercontent.com/yafp/cartiva/refs/heads/main/.github/examples/cartiva_HEIDELBERG_300dpi.png)


## Getting started
### As a service
Just use the demo on [Github Pages](https://yafp.github.io/cartiva/index.html)

### Locally
- Download [latest release](https://github.com/yafp/cartiva/releases)
- Extract
- Double-click the .html file within the `src` folder


## History & References
- Started in 2026.08
- Inspired by [Urbanmapdesign.com](https://www.urbanmapdesign.com).

## Developers
### JSDoc documentation
On each version release an action is re-generating the JSDoc files under
- https://yafp.github.io/cartiva/docs/js/


### Architecture boundaries

The application separates serializable project state from transient runtime state. UI controls update project state through one delegated form dispatcher, while MapLibre, geocoding, preset data, and export encoding are accessed through dedicated boundaries. Preview and all exporters consume one normalized render specification. The feature files remain classic scripts loaded in dependency order so the app stays dependency-free and can still be opened directly from the `src/index.html` file.

UI responsibilities are split between `src/js/ui.js` (state and control synchronization), `src/js/ui/preview.js` (preview and shapes), `src/js/ui/labels.js` (label geometry and contrast), `src/js/ui/settings.js` (saved application settings and color sampling), and `src/js/ui/events.js` (accordion and dialog event wiring). Classic scripts load these modules after the UI core and before the map.

Map layer controls are defined declaratively in `src/js/map/layer-registry.js`. The same definitions drive state synchronization, map styling, 3D feature limits, visibility, and materials.
`src/js/export/model-export.js` resolves visible feature styling for model exports;
`src/js/export/model-geometry.js` builds clipped, colored geometry and the dynamic
3MF material palette. `tests/browser-regressions.html` runs the general browser
suite together with the focused map-change regressions.

External provider URLs are centralized in `src/js/core/service-config.js`. This makes provider replacement, local testing, and future configuration injection possible without changing UI or rendering code.

### Maintenance features

#### October 11 preview caching and presets

- **#117:** The sidebar color-preset label includes the detected catalog count.
- **#116:** The detail indicator turns bright green after the visible map is
  loaded and dark green after all configured surrounding tile rings are loaded.
  Application Settings saves 0-4 rings (default: 1); each ring adds 256 preview
  pixels on every side. Zero disables surrounding preloading. Cancel discards
  changes. An isolated MapLibre map retains its loaded tiles between pans and
  expands one ring at a time only after visible detail is ready. Covered pans
  keep the aligned detailed image visible while the next rings refill. Zoom,
  rotation, design changes, or leaving the buffered area require new detail.
  The cache is in-memory, not an offline download. Its backing image is bounded
  by GPU limits and 4096 pixels per side, so larger ring settings may reduce
  supersampling. Pitched views retain visible detail but do not preload rings.

#### October 10 rendering and interface changes

- **#115, #111:** Print rendering uses hardware-aware tiles (512-3072px cores),
  conservative defaults when `navigator.deviceMemory` is unavailable, and GPU
  texture/renderbuffer limits. Completed scratch tiles are cleared, their backing
  stores are resized, and temporary contexts/maps are released. Rendering yields
  between tiles; JavaScript cannot explicitly force a browser garbage collection.
  Final canvas preflight also applies a conservative reported-memory budget.
- **#114, #103:** A dedicated offscreen pass shifts style camera stops and scales
  road/rail/water strokes, casings, labels, icons and halos by the physical
  poster's DPI-derived pixel size relative to the framed preview. Supersampling
  is downsampled into the final poster; fine/standard/bold line profiles remain
  available. GeoJSON simplification is disabled for the print pass to retain
  geometry detail. Provider vector tiles still have their original geometry
  limits. Browser canvas/GPU limits are enforced, not bypassed, and oversized
  pitched exports fail explicitly instead of silently lowering resolution.
- **#110, #112:** Every export has an accessible progress indicator; tiled image
  exports also display a live composite thumbnail and completed-tile percentage.
  Unknown-duration 3D stages use an indeterminate indicator. Export actions/tabs
  are locked while a job runs and restored on success or failure.
- **#106:** TIFF is a lossless baseline RGBA TIFF with unassociated transparency,
  bounded-strip encoding, and X/Y print-resolution tags. It is uncompressed
  (larger than PNG), not CMYK or a color-managed ICC workflow.
- **#102:** Standard formats use exact physical millimeters, including A-series,
  50x70cm/70x50cm and 3:4/4:3 posters (30x40cm/40x30cm). The responsive preview
  fits that exact aspect ratio, and safe/bleed guides scale with the paper rather
  than CSS screen millimeters.
- **#109, #105:** The right toolbar always has two icon columns in the requested
  functional groups. On narrow windows, the left sidebar collapses to an icon
  rail and expands over the preview on hover/focus; the toggle supports touch.
- **#104, #100:** Project load/save outcomes use notifications: successes last
  30 seconds, errors wait for acknowledgement. The model actions use labeled
  icons and the explicit names **Export .3mf** and **Export .stl**.
- **#113:** Geocoder responses discard provider IDs, timestamps, OSM metadata,
  and unused address fields before entering application caches/state. Imported
  GeoJSON and resolved model features also discard unused metadata; fields needed
  by map styling are retained.
- **#101, #72, #4:** Active drags use lightweight map geometry; settled detail is
  debounced. Spatial hysteresis measures accumulated movement from the last
  accepted detailed frame (24 CSS pixels, 0.08 zoom, 2 degrees rotation/pitch).
  Sub-threshold movements reuse the cached detailed image with camera alignment;
  its exposed edge strips show the current live map. The circular magnifier
  samples the detailed image when available, the live map otherwise, and clips
  its canvas without an obstructing square overlay.
- **#90, #86:** Boundary filters exclude numeric maritime segments, including
  the reported sea location. Contours use the same full geographic footprint,
  elevation sampling and styling in the preview and every image tile, preventing
  missing contours and tile-grid discontinuities.
- **#89:** STL/3MF collect features from an isolated detailed map, honoring live
  visibility and the building zoom threshold. Geographic geometry includes
  terrain, flattened water, nature/urban areas, roads/rail, buildings, boundaries,
  contours and user GeoJSON, with resolved per-layer/accent colors, opacity
  filtering, and the same overall color filters. Disabled terrain exports flat
  without an elevation request. Crossing paths/buildings are clipped, polygon
  holes are retained, and feature/coordinate/triangle safety limits fail
  explicitly rather than silently omitting geometry. 3MF carries a dynamic color
  palette; STL color support depends on the viewer.

3D exports represent geographic geometry, not a literal raster-to-solid poster:
text, sprite icons, poster labels, CSS shape masks, translucency and relief
shading are not meshed. Buildings use stylized 4mm extrusion rather than surveyed
heights. The model base and sides remain brown. Use image export for exact
poster-decoration and raster compositing fidelity.

PDF output preserves the selected physical paper size by converting image pixels to PDF points using the selected DPI. SVG output is raster-backed and preserves the exact poster render without duplicating labels.
Export preflight supports A4 PNG output at 600 DPI while still rejecting dimensions above the browser-safe 16,384-pixel side and 160-megapixel limits. Temporary export maps are cleaned up after failures, and large map transfers use bounded tile compositing.
Custom paper sizes, bleed/safe-area guides, GeoJSON overlays, and project migrations are available in the sidebar. Projects can be saved in the browser or transferred as JSON files. Provider details remain in export metadata but are not displayed in the interface.
Preview zoom, rotation, magnifier, and color-preset controls share one right-side toolbar with dividers between each functional group.
The right-side toolbar also opens external map services for the current coordinate and offers a browser-supported color eyedropper. Choosing a map service closes the centered dialog. The preset selector shows four map colors for each catalog entry. The left-side settings cog opens a centered dialog showing the saved preview surround color; Save commits it to local storage, while Cancel or closing discards changes. The surround color does not alter exports. The left sidebar shows a scrollbar when needed. Export options are divided into Images and 3D Models tabs. Optional 100-meter elevation contours are generated from the existing terrain service when enabled in Terrain; they require network access to elevation tiles.
URLs include `lat`, `lng`, `zoom`, `rotation`, and `preset` parameters. An unavailable preset falls back to Alpine Snow with a notification. Custom randomized colors are not encoded in the URL; save a project JSON to preserve them.
Quality profiles render the map at 1x, 1.5x, or 2x before downsampling with high-quality canvas filtering. The interactive preview remains capped at 2x device pixel ratio. After 600 ms of inactivity, a cancellable high-fidelity preview renders at up to two additional detail levels with a 3,200-pixel maximum visible-area side. Surrounding rings are loaded afterward; covered pans preserve detail, and only the latest queued camera is published. Export zoom is provider-clamped, print line weights can be adjusted, PNG exports receive DPI metadata, and PDF prefers lossless PNG embedding when jsPDF is available.
Contour lines render in both the live and high-detail previews above thematic map layers. Building visibility starts at a configurable zoom threshold, and 3D models use the enabled, visible map layers instead of separate Buildings/Streets export switches. The detail indicator also displays a yellow loading banner while high-detail rendering is pending.
STL and 3MF terrain exports include visible water, nature, urban land cover, boundaries, roads, and buildings. 3MF uses standard material colors; STL writes the common 15-bit per-facet color extension for viewers that support colored STL files.
Surface polygons are clipped to the 3D model bounds instead of being discarded at an edge. Distinct vector-tile fragments are retained, and terrain beneath water polygons uses the water material to prevent dry-colored gaps caused by intersecting surface meshes.
Map layers use a fixed cartographic order so previews and all export formats remain predictable. Legacy project files with a custom `layerOrder` field still load, but the value is normalized to the canonical order.

### Reliability and accessibility

The app uses `loglevel` for structured lifecycle, map, geocoder, project, and export logging. The default level is `info`; call `CartivaDiagnostics.setLevel('debug')` in the browser console to persist a different level, and inspect recent structured entries with `CartivaDiagnostics.list()`. Map, geocoder, and terrain failures are reported without preventing other features from working. Accordion headers expose keyboard focus, `Enter`/`Space` activation, and `aria-controls`; color inputs receive explicit accessible names.

Export completion and failure messages use Toastify JS. Errors remain visible until the user confirms them; operation progress is shown in the active export dialog.
About, export, settings, and external-map dialogs share a branded gray header; About links to the OpenStreetMap copyright page.
Image export settings are confirmed in a modal dialog. JSON export metadata is optional and can be enabled under `9. Misc`.

JavaScript API documentation is generated into `docs/js` by the `JSDoc` GitHub Actions workflow after each source push.

### Local development

Opening the HTML file directly remains supported for the main application, but a local HTTP server is recommended for worker and browser security behavior:

```powershell
python -m http.server 8080 --directory src
```

Then open `http://localhost:8080`. No package installation or build step is required.

Run the repository checks without installing Node.js:

```powershell
./tests/Test-cartiva.ps1
```

The validator checks script references, HTML IDs and labels, JSON parsing, duplicate classic-script function declarations, and English ASCII comments. `.editorconfig`, `jsconfig.json`, and the `Validate` GitHub Actions workflow keep these checks available in editors and continuous integration.



