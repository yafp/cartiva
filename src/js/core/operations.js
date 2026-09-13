// Shared lifecycle for asynchronous user operations.
(function attachOperations(global) {
  async function run(options, task) {
    const {
      area,
      button = null,
      label = null,
      busyLabel = null,
      idleLabel = null,
      startStatus = '',
      successStatus = '',
      errorPrefix = 'Operation failed'
    } = options;
    const cleanups = [];
    const previousLabel = label?.textContent;
    const startedAt = performance.now();
    if (button) button.disabled = true;
    if (label && busyLabel) label.textContent = busyLabel;
    if (startStatus) global.setStatus?.(startStatus);
    global.CartivaRuntime.operations[area] = { startedAt: Date.now() };
    global.CartivaDiagnostics.record(area, 'Operation started.');
    try {
      const result = await task(cleanup => cleanups.push(cleanup));
      if (successStatus) global.setStatus?.(successStatus);
      global.CartivaDiagnostics.record(area, 'Operation completed.', {
        durationMs: Math.round(performance.now() - startedAt)
      });
      return result;
    } catch (error) {
      if (error?.name !== 'AbortError') {
        global.CartivaDiagnostics.report(area, error);
        global.setStatus?.(`${errorPrefix}: ${error.message}`, true);
      }
      return null;
    } finally {
      while (cleanups.length) {
        try { await cleanups.pop()(); } catch (error) { global.CartivaDiagnostics.report(`${area}.cleanup`, error); }
      }
      delete global.CartivaRuntime.operations[area];
      if (label) label.textContent = idleLabel || previousLabel;
      if (button) button.disabled = false;
    }
  }

  global.CartivaOperations = Object.freeze({ run });
})(window);