# AGENTS.md
## Project Overview
CARTIVA is a web-based project which offers the user an easy way to
- Select a location on a map
- Zoom in/zoom out to select the proper spot in detail
- Define a series of settings to change the colors, borders etc
- Export the map as high-resolution / high-quality graphic file which can be used for printing in big-scale.

CARTIVA is designed to be easily usable as more or less 1 file (.html) for the user plus the css, js part.
User should be able to use it without a particular web-server or similar.

## Architecture
The idea is to use
- HTML and CSS for the User-interface
- JavaScript for the actual code
- Add additional libraries and/or dependencies only if it is needed.

## Coding Standards
- Language is english
- Comments should be added where-ever it makes sense to ensure new people can easily contribute
- Create JSdoc headers for all JavaScript functions - following this example

`
/**
 * Renders a custom map tile grid based on the provided configuration options.
 * 
 * @async
 * @function renderTileGrid
 * @param {Object} options - Configuration options for the rendering engine.
 * @param {string} options.projection - The target map projection format (e.g., 'EPSG:3857').
 * @param {number} [options.zoom=10] - Initial zoom level for the generated tiles.
 * @param {string[]} [options.layers=['base']] - An array of active layer identifiers.
 * @param {TileProgressCallback} [onProgress] - Optional callback reporting rendering progress.
 * @returns {Promise<HTMLCanvasElement>} A promise resolving to the fully rendered canvas element.
 * @throws {TypeError} Throws an error if the projection string is invalid or missing.
 * @example
 * const canvas = await renderTileGrid({
 *   projection: 'EPSG:3857',
 *   zoom: 12,
 *   layers: ['base', 'labels']
 * }, (progress) => {
 *   console.log(`Rendering: ${progress}%`);
 * });
 */
`

- Code should always follow best practice - and be designed in a scale-able way
- Ensure all relevant parts are logged as well - using the logging framework in use

## UI/UX Rules
- UI/UX should be rather simple (do not overwhelm the user with eye-candy)
- UI elements should feature tool tips to explain their function
- Use colors apart from the defaults only where needed. Default-colors are as follows
  - Red = Error-context
  - Orange = Warning context
  - Green = OK/Success context
  - White, black, gray = normal UI elements
- Display notifications to the user on relevant steps (but only there - do not spam)
- Should be usable on different devices with different browsers & resolutions (platform-independent)
- If a process takes more time - user should be informed


## File Organization
- All source files needed for the actual product are located in the folder 'src'
- All files outside of 'src' might be used for testing, documentation etc

## Performance Requirements
- Product should be usable on normal devices - no need for latest / high-tech devices


## Testing Requirements
- Execute tests
  
## AI Working Instructions
- Whenever you create a new version/update - please ensure all new code is tested & commented
- Existing test routines should be executed
- README.md files should be updated
- Version-number should be updated
