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



