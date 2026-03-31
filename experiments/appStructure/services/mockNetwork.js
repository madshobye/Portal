(() => {
  function createMockNetworkService({ appState }) {
    let phaseTimer = null;
    let pulseTimer = null;

    function start() {
      setNetwork({
        status: "connecting",
        peerCount: 0,
        clientId: "client-local",
      });

      clearTimeout(phaseTimer);
      phaseTimer = window.setTimeout(() => {
        setNetwork({
          status: "connected",
          peerCount: 2,
          clientId: "client-local",
        });
      }, 700);

      clearInterval(pulseTimer);
      pulseTimer = window.setInterval(() => {
        const current = appState.getState().network;
        if (current.status !== "connected") return;

        const nextCount = current.peerCount >= 4 ? 2 : current.peerCount + 1;
        setNetwork({
          ...current,
          peerCount: nextCount,
        });
      }, 5000);
    }

    function stop() {
      clearTimeout(phaseTimer);
      clearInterval(pulseTimer);
    }

    function reconnect() {
      stop();
      start();
    }

    function setNetwork(nextNetwork) {
      appState.update((state) => ({
        ...state,
        network: {
          ...state.network,
          ...nextNetwork,
        },
      }));
    }

    return {
      start,
      stop,
      reconnect,
    };
  }

  window.AppStructureServices = {
    createMockNetworkService,
  };
})();
