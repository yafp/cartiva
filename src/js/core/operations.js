// Shared lifecycle for asynchronous user operations.
(function attachOperations(global) {
  /**
   * Notifys notify for the Cartiva application.
   * @function notify
   * @param {*} notification - Input value.
   * @param {*} type - Input value.
   */
  function notify(notification, type) {
    if (!notification || typeof global.Toastify !== 'function') return;
    const details = typeof notification === 'string' ? { message: notification } : notification;
    const toast = global.Toastify({
      text: details.message,
      duration: type === 'error' ? -1 : 4500,
      close: true,
      gravity: 'top',
      position: 'right',
      stopOnFocus: true,
      style: {
        background: type === 'error' ? '#b91c1c' : '#047857',
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }
    });
    toast.showToast();
    if (type === 'error' && toast.toastElement) {
      toast.toastElement.tabIndex = 0;
      toast.toastElement.title = 'Click to confirm and dismiss';
      toast.toastElement.addEventListener('click', () => toast.hideToast(), { once: true });
      toast.toastElement.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') toast.hideToast();
      });
    }
    if (details.icon === 'image' && toast.toastElement) {
      const icon = document.createElement('span');
      icon.textContent = '\u{1F5BC}\uFE0F';
      icon.setAttribute('aria-hidden', 'true');
      toast.toastElement.prepend(icon);
    }
    toast.toastElement?.setAttribute('role', type === 'error' ? 'alert' : 'status');
  }

  /**
   * Runs run for the Cartiva application.
   * @function run
   * @param {*} options - Input value.
   * @param {*} task - Input value.
   */
  async function run(options, task) {
    const {
      area,
      button = null,
      label = null,
      busyLabel = null,
      idleLabel = null,
      startStatus = '',
      successStatus = '',
      errorPrefix = 'Operation failed',
      successNotification = '',
      errorNotificationPrefix = ''
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
      notify(typeof successNotification === 'function' ? successNotification(result) : successNotification, 'success');
      global.CartivaDiagnostics.record(area, 'Operation completed.', {
        durationMs: Math.round(performance.now() - startedAt)
      });
      return result;
    } catch (error) {
      if (error?.name !== 'AbortError') {
        global.CartivaDiagnostics.report(area, error);
        global.setStatus?.(`${errorPrefix}: ${error.message}`, true,
          `${errorNotificationPrefix || errorPrefix}: ${error.message}`);
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

  global.CartivaOperations = Object.freeze({ run, notify });
})(window);