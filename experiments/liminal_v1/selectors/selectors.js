(() => {
  function decoratePeer(peer, config) {
    return {
      ...peer,
      ...window.LiminalV1Identity.getPeerProfile(peer.id, config),
    };
  }

  function selectToggleLabel(network) {
    if (network.status === "connected") {
      return `${network.connectedPeerCount}/${network.peers.length} Connected`;
    }

    if (network.status === "online") {
      return "Waiting";
    }

    if (network.status === "connecting") {
      return "Connecting";
    }

    return "Disconnected";
  }

  function selectDebugSummary(network, room, config) {
    const selfProfile = window.LiminalV1Identity.getPeerProfile(network.clientId, config);
    return [
      `You: ${selfProfile.name}`,
      `Net: ${config.NETWORK_NAME}`,
      `Room: ${room.name}`,
      `MQTT: ${network.mqttConnected ? "online" : "offline"}`,
      `Peers known: ${network.peers.length}`,
      `Peers connected: ${network.connectedPeerCount}`,
      `Messages: ${(network.messages || []).length}`,
    ].join("  |  ");
  }

  function selectDebugDetail(network, config) {
    if (network.peers.length === 0) {
      return "No peers discovered yet.";
    }

    return network.peers
      .map((peer) => decoratePeer(peer, config))
      .map((peer) => {
        const status = peer.connected ? "connected" : peer.connectionState;
        return `${peer.name}  ${status}`;
      })
      .join("\n");
  }

  function selectViewState(state, config) {
    const { network, room, ui, manualOnboarding } = state;

    return {
      debug: {
        isOpen: ui.debugOpen,
        label: selectToggleLabel(network),
        title: "Debug",
        text: selectDebugSummary(network, room, config),
        detail: selectDebugDetail(network, config),
        onboarderLabel: ui.onboarderEnabled ? "Onboarder: On" : "Onboarder: Off",
      },
      manualOnboarding: {
        visible: !!manualOnboarding?.visible,
        mode: manualOnboarding?.mode || "hidden",
        titleText: manualOnboarding?.title || "QR Onboarding",
        bodyText: manualOnboarding?.text || "",
        link: manualOnboarding?.link || "",
        qrImageSrc: manualOnboarding?.qrImageSrc || "",
        responseValue: manualOnboarding?.responseValue || "",
      },
      app: {
        appId: room.appId,
        title: room.name,
        messages: network.messages || [],
        disabled: network.connectedPeerCount === 0,
      },
    };
  }

  window.LiminalV1Selectors = {
    selectViewState,
  };
})();
