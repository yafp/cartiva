// Transient application state that must never be persisted in project files.
(function attachRuntimeState(global) {
  global.CartivaRuntime = {
    mapReady: false,
    timers: Object.create(null),
    controllers: Object.create(null),
    operations: Object.create(null)
  };
})(window);