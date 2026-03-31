(() => {
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createAppState({ storageKey, defaultState }) {
    let state = loadState();
    const listeners = new Set();

    function loadState() {
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return clone(defaultState);
        return mergeState(defaultState, JSON.parse(raw));
      } catch (_error) {
        return clone(defaultState);
      }
    }

    function mergeState(base, saved) {
      return {
        ...clone(base),
        ...saved,
        network: {
          ...clone(base.network || {}),
          ...(saved.network || {}),
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

    function saveState() {
      localStorage.setItem(storageKey, JSON.stringify(state));
    }

    function notify() {
      const snapshot = clone(state);
      for (const listener of listeners) {
        listener(snapshot);
      }
    }

    function getState() {
      return clone(state);
    }

    function setState(nextState) {
      state = clone(nextState);
      saveState();
      notify();
    }

    function update(updater) {
      const nextState = updater(clone(state));
      setState(nextState);
    }

    function subscribe(listener) {
      listeners.add(listener);
      listener(getState());
      return () => listeners.delete(listener);
    }

    return {
      getState,
      setState,
      update,
      subscribe,
    };
  }

  window.AppStructureModel = {
    createAppState,
  };
})();
