// Structured diagnostics backed by loglevel, with a small in-memory history.
(function attachDiagnostics(global) {
  const events = [];
  const logger = global.log?.getLogger ? global.log.getLogger('cartiva') : global.console;
  const configuredLevel = global.localStorage?.getItem('cartiva.logLevel') || 'info';
  logger.setDefaultLevel?.(configuredLevel);

  function record(area, message, details = {}, level = 'info') {
    const event = { time: new Date().toISOString(), level, area, message, details };
    events.push(event);
    if (events.length > 200) events.shift();
    const write = typeof logger[level] === 'function' ? logger[level] : logger.info;
    write?.call(logger, `[cartiva:${area}] ${message}`, details);
    return event;
  }
  function report(area, error, details = {}) {
    const message = error instanceof Error ? error.message : String(error);
    return record(area, message, { ...details, stack: error?.stack }, 'error');
  }
  function list() { return events.slice(); }
  function clear() { events.length = 0; }
  function setLevel(level) {
    logger.setLevel?.(level);
    global.localStorage?.setItem('cartiva.logLevel', level);
    record('logging', `Log level changed to ${level}.`);
  }
  global.CartivaLog = logger;
  global.CartivaDiagnostics = Object.freeze({ record, report, list, clear, setLevel });
  record('application', 'Logging initialized.', { level: configuredLevel, framework: 'loglevel' });

  const interactiveSelector = [
    'button', 'a[href]', 'input:not([type="hidden"])', 'select', 'textarea',
    '[role="button"]', '[role="option"]', '[role="link"]', '#map'
  ].join(',');
  document.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    const element = event.target.closest(interactiveSelector);
    if (!element) return;
    const label = element.getAttribute('aria-label')
      || element.getAttribute('title')
      || element.labels?.[0]?.textContent
      || element.textContent
      || element.id
      || element.tagName.toLowerCase();
    record('interaction.click', 'User activated an interactive element.', {
      id: element.id || null,
      element: element.tagName.toLowerCase(),
      type: element.getAttribute('type') || null,
      label: label.replace(/\s+/g, ' ').trim().slice(0, 120)
    });
  }, { capture: true });
})(window);
