// Transient application state that must never be persisted in project files.
(function attachRuntimeState(global) {
  global.CartivaRuntime = {
    mapReady: false,
    history: {
      past: [],
      future: [],
      snapshot: '',
      applying: false
    },
    timers: Object.create(null),
    controllers: Object.create(null),
    operations: Object.create(null)
  };
})(window);