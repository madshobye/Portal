(() => {
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createPersistenceService({ storageKey }) {
    function load(defaultState) {
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return clone(defaultState);
        return merge(defaultState, JSON.parse(raw));
      } catch (_error) {
        return clone(defaultState);
      }
    }

    function save(state) {
      localStorage.setItem(storageKey, JSON.stringify(state));
    }

    function merge(base, saved) {
      return {
        ...clone(base),
        ...saved,
        network: {
          ...clone(base.network || {}),
          ...(saved.network || {}),
        },
        user: {
          ...clone(base.user || {}),
          ...(saved.user || {}),
        },
        ui: {
          ...clone(base.ui || {}),
          ...(saved.ui || {}),
        },
        rooms: {
          ...clone(base.rooms || {}),
          ...(saved.rooms || {}),
          theLounge: {
            ...(clone(base.rooms?.theLounge || {})),
            ...(saved.rooms?.theLounge || {}),
          },
        },
      };
    }

    return {
      load,
      save,
    };
  }

  window.AppStructureServices = {
    ...(window.AppStructureServices || {}),
    createPersistenceService,
  };
})();
