# AGENTS.md
## Project Overview
CARTIVA is a web-based project which offers the user an easy way to
- Select a location on a map
- Zoom in/zoom out to select the proper spot in detail
- Define a series of settings to change the colors, borders etc
- Export the map as high-resolution / high-quality graphic file which can be used for printing in big-scale.

CARTIVA is designed to be easily useable as more or less 1 file (.html) for the user plus the css,js part.
User should be able to use it without a particular web-server or similar.

## Architecture
The idea is to use
- HTML and CSS for the User-interface
- Javascript for the actual code
- Add additional libraries and/or dependencies only if it is needed.

## Coding Standards
- Language is english
- Comments should be added where-ever it makes sense to ensure new people can easily contribute
- Code should always follow best practise - and be designed in a scaleable way
- Ensure all relevant parts are logged as well - using the logging framework in use

## UI/UX Rules
- UI/UX should be rather simple (do not overwhelm the user with eye-candy)
- UI elements should feature tooltips to explain their function
- Use colors apart from the defaults only where needed. Default-colors are as follows
  - Red = Error-context
  - Orange = Warning context
  - Green = OK/Success context
  - White, black, gray = normal UI elements
- Display notifications to the user on relevant steps (but only there - do not spam)
- Should be useable on different devices with different browsers & resolutions (platform-independant)
- If a process takes more time - user should be informed


## File Organization
- All source files needed for the actual product are located in the folder 'src'
- All files outside of 'src' might be used for testing, documentation etc

## Performance Requirements
- Product should be usuable on normal devices - no need for latest / high-tech devices


## Testing Requirements
- Execute tests
  
## AI Working Instructions
- Whenever you create a new version/update - please ensure all new code is tested & commented
- Existing test routines should be executed
- README.md files should be updated
- Version-number should be updated
