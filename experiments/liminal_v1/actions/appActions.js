(() => {
  function clonePeer(peer) {
    return { ...peer };
  }

  function clonePeers(peers) {
    return peers.map(clonePeer);
  }

  function cloneMessages(messages) {
    return messages.map((message) => ({ ...message }));
  }

  function cloneEvents(events) {
    return events.map((event) => ({ ...event }));
  }

  function cloneManualOnboarding(value) {
    return { ...(value || {}) };
  }

  function createAppActions(appState) {
    function patchNetwork(patch) {
      appState.update((state) => ({
        ...state,
        network: {
          ...state.network,
          ...patch,
        },
      }));
    }

    function setPeers(peers) {
      appState.update((state) => ({
        ...state,
        network: {
          ...state.network,
          peers: clonePeers(peers),
        },
      }));
    }

    return {
      setClientId(clientId) {
        patchNetwork({ clientId });
      },
      setMqttConnected(mqttConnected) {
        patchNetwork({ mqttConnected });
      },
      setStatus(status) {
        patchNetwork({ status });
      },
      setPeers,
      setConnectedPeerCount(connectedPeerCount) {
        patchNetwork({ connectedPeerCount });
      },
      setMessages(messages) {
        patchNetwork({ messages: cloneMessages(messages) });
      },
      setRoom(room) {
        appState.update((state) => ({
          ...state,
          room: {
            ...state.room,
            ...room,
          },
        }));
      },
      addEvent(event) {
        appState.update((state) => ({
          ...state,
          network: {
            ...state.network,
            events: [
              { ...event },
              ...(state.network.events || []),
            ].slice(0, 24),
          },
        }));
      },
      setEvents(events) {
        patchNetwork({ events: cloneEvents(events) });
      },
      addMessage(message) {
        appState.update((state) => ({
          ...state,
          network: {
            ...state.network,
            messages: [...(state.network.messages || []), { ...message }],
          },
        }));
      },
      setManualOnboarding(manualOnboarding) {
        appState.update((state) => ({
          ...state,
          manualOnboarding: {
            ...state.manualOnboarding,
            ...cloneManualOnboarding(manualOnboarding),
          },
        }));
      },
      getState() {
        return appState.getState();
      },
      resetNetwork() {
        patchNetwork({
          mqttConnected: false,
          status: "connecting",
          peers: [],
          connectedPeerCount: 0,
          messages: [],
          events: [],
        });
      },
    };
  }

  window.LiminalV1Actions = {
    createAppActions,
  };
})();
