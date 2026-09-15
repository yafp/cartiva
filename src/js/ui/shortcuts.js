// Global keyboard shortcuts for map navigation and exports.
document.addEventListener('keydown', event => {
  if (event.target.matches('input, select, textarea')) return;
  if (event.key === '+' || event.key === '=') {
    event.preventDefault();
    map.zoomTo(map.getZoom() + 0.25, { duration: 150 });
  } else if (event.key === '-') {
    event.preventDefault();
    map.zoomTo(map.getZoom() - 0.25, { duration: 150 });
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'e') {
    event.preventDefault();
    exportBtn.click();
  } else if (event.key === '/') {
    event.preventDefault();
    searchInput.focus();
  } else if (/^[1-9]$/.test(event.key)) {
    event.preventDefault();
    const block = sectionBlocks[Number(event.key) - 1];
    block?.querySelector('.section-header').click();
  }
});