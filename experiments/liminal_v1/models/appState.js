(() => {
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createAppState(defaultState) {
    let state = clone(defaultState);
    const listeners = new Set();

    function getState() {
      return clone(state);
    }

    function setState(nextState) {
      state = clone(nextState);
      notify();
    }

    function update(updater) {
      setState(updater(getState()));
    }

    function subscribe(listener) {
      listeners.add(listener);
      listener(getState());
      return () => listeners.delete(listener);
    }

    function notify() {
      const snapshot = getState();
      for (const listener of listeners) {
        listener(snapshot);
      }
    }

    return {
      getState,
      setState,
      update,
      subscribe,
    };
  }

  window.LiminalV1Model = {
    createAppState,
  };
})();
