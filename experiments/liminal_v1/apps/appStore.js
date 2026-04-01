(() => {
  const registry = {
    theLounge(deps) {
      return window.LiminalV1TheLounge.createApp(deps);
    },
  };

  function createAppStore() {
    function createApp(appId, deps) {
      const factory = registry[appId];
      if (!factory) {
        throw new Error(`Unknown app: ${appId}`);
      }
      return factory(deps);
    }

    return {
      createApp,
      listApps() {
        return Object.keys(registry);
      },
    };
  }

  window.LiminalV1Apps = {
    createAppStore,
  };
})();
