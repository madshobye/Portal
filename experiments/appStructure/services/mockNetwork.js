(() => {
  function createMockNetworkService() {
    let phaseTimer = null;
    let pulseTimer = null;
    const listeners = new Set();
    let networkState = {
      status: "idle",
      peerCount: 0,
      peers: [],
      messages: [],
    };

    function start() {
      setNetwork({
        status: "connecting",
        peerCount: 0,
        peers: [],
        messages: [],
      });

      clearTimeout(phaseTimer);
      phaseTimer = window.setTimeout(() => {
        setNetwork({
          status: "connected",
          peerCount: 2,
          peers: [
            { id: "peer-1", name: "North Reef", status: "online" },
            { id: "peer-2", name: "Kind Quartz", status: "online" },
          ],
          messages: [
            { id: "msg-1", author: "System", text: "Connected to liminalNet." },
            { id: "msg-2", author: "North Reef", text: "Welcome to theLounge." },
          ],
        });
      }, 700);

      clearInterval(pulseTimer);
      pulseTimer = window.setInterval(() => {
        if (networkState.status !== "connected") return;

        const nextCount = networkState.peerCount >= 4 ? 2 : networkState.peerCount + 1;
        const nextPeers = Array.from({ length: nextCount }, (_value, index) => ({
          id: `peer-${index + 1}`,
          name: ["North Reef", "Kind Quartz", "Amber Comet", "Opal Stone"][index],
          status: "online",
        }));
        setNetwork({
          ...networkState,
          peerCount: nextCount,
          peers: nextPeers,
          messages: [
            ...networkState.messages.slice(-3),
            {
              id: `msg-${Date.now()}`,
              author: "System",
              text: `Peer count changed to ${nextCount}.`,
            },
          ],
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

    function subscribe(listener) {
      listeners.add(listener);
      listener({ ...networkState });
      return () => listeners.delete(listener);
    }

    function emit() {
      const snapshot = {
        ...networkState,
        peers: networkState.peers.map((peer) => ({ ...peer })),
        messages: networkState.messages.map((message) => ({ ...message })),
      };

      for (const listener of listeners) {
        listener(snapshot);
      }
    }

    function setNetwork(nextNetwork) {
      networkState = {
        ...networkState,
        ...nextNetwork,
      };
      emit();
    }

    return {
      start,
      stop,
      reconnect,
      subscribe,
    };
  }

  window.AppStructureServices = {
    ...(window.AppStructureServices || {}),
    createMockNetworkService,
  };
})();
