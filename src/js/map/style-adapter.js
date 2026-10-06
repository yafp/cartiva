// Provider style adapter. The rest of the app works with normalized roles.
(function attachStyleAdapter(global) {
  /**
  * Assigns a normalized Cartiva role to a provider style layer.
   * @function classify
   * @param {*} layer - Input value.
   * @param {*} roleRegistry - Input value.
   */
  function classify(layer, roleRegistry = global.CartivaLayerRegistry) {
    return roleRegistry.getRole(layer);
  }
  /**
   * Groups layers for the Cartiva application.
   * @function groupLayers
   * @param {*} style - Input value.
   * @param {*} roleRegistry - Input value.
   */
  function groupLayers(style, roleRegistry = global.CartivaLayerRegistry) {
    const groups = {};
    (style?.layers || []).forEach(layer => {
      const role = classify(layer, roleRegistry);
      if (!role) return;
      (groups[role] ||= []).push(layer);
    });
    return groups;
  }
  global.CartivaStyleAdapter = Object.freeze({ classify, groupLayers });
})(window);
