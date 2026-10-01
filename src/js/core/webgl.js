// Context-local compatibility for MapLibre's raw texture uploads.
(function attachWebGlSupport(global) {
  const prepared = new WeakSet();

  /** Disables DOM-only pixel conversions for raw buffers, preserving the caller's GL state. */
  function prepareContext(context) {
    if (!context || prepared.has(context)) return;
    prepared.add(context);
    const flags = [context.UNPACK_FLIP_Y_WEBGL, context.UNPACK_PREMULTIPLY_ALPHA_WEBGL];
    const values = new Map(flags.map(flag => [flag, context.getParameter(flag)]));
    const pixelStore = context.pixelStorei.bind(context);
    context.pixelStorei = (parameter, value) => {
      if (values.has(parameter)) values.set(parameter, value);
      return pixelStore(parameter, value);
    };
    for (const method of ['texImage2D', 'texSubImage2D']) {
      const upload = context[method].bind(context);
      context[method] = (...args) => {
        const raw = args.length >= 9 && (args[8] == null || ArrayBuffer.isView(args[8]) || typeof args[8] === 'number');
        if (!raw) return upload(...args);
        const activeFlags = flags.filter(flag => values.get(flag));
        activeFlags.forEach(flag => pixelStore(flag, false));
        try {
          return upload(...args);
        } finally {
          activeFlags.forEach(flag => pixelStore(flag, values.get(flag)));
        }
      };
    }
  }

  /** Prepares only application-owned map contexts, including contexts restored after GPU loss. */
  function prepareMap(targetMap) {
    const canvas = targetMap.getCanvas();
    const prepare = () => prepareContext(canvas.getContext('webgl2') || canvas.getContext('webgl'));
    prepare();
    canvas.addEventListener('webglcontextrestored', prepare);
  }

  global.CartivaWebGl = Object.freeze({ prepareContext, prepareMap });
})(window);