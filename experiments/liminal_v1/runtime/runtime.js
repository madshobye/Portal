(() => {
  function createLiminalRuntime({
    config,
    clientId,
    actions,
    onData = () => {},
  }) {
    let onboarding = null;
    let manualOnboarding = null;
    let onboarderEnabled = false;
    let onboardingTransitionLocked = false;

    const meshNetwork = window.LiminalV1MeshNetwork.createMeshNetworkService({
      config,
      clientId,
      sendSignal(targetId, message) {
        return onboarding?.sendSignal(targetId, message);
      },
      isTransportConnected() {
        return onboarding?.isConnected?.() || false;
      },
      onStateChange: handleNetworkStateChange,
      onData(payload, fromPeerId) {
        onData(payload, fromPeerId);
      },
      onEvent(event) {
        actions.addEvent(event);
      },
    });

    function start() {
      ensureOnboarding();

      if (!manualOnboarding) {
        manualOnboarding = window.LiminalV1ManualOnboardingService.createManualOnboardingService({
          config,
          clientId,
          meshNetwork,
          actions,
        });
      }

      meshNetwork.start();
      manualOnboarding.start().catch((error) => {
        console.warn("[liminal_v1] manual onboarding start failed", error);
      });
      syncOnboardingMode({
        connectedPeerCount: 0,
      });
    }

    function ensureManualOnboarding() {
      if (!manualOnboarding) {
        manualOnboarding = window.LiminalV1ManualOnboardingService.createManualOnboardingService({
          config,
          clientId,
          meshNetwork,
          actions,
        });
      }
      return manualOnboarding;
    }

    function ensureOnboarding() {
      if (onboarding) {
        return onboarding;
      }

      onboarding = window.LiminalV1Onboarding.createOnboardingService({
        config,
        clientId,
        servingEnabled: onboarderEnabled,
        onMqttStateChange(connected) {
          actions.setMqttConnected(connected);
          actions.addEvent({
            label: connected ? "MQTT connected" : "MQTT disconnected",
            detail: connected ? "Transport online" : "Transport offline",
          });
          if (!connected) {
            actions.setStatus("connecting");
          }
          meshNetwork.emitState();
        },
        onPeerSeen(peer) {
          actions.addEvent({
            label: "Peer seen",
            detail: peer.id,
          });
          meshNetwork.handlePeerSeen(peer);
        },
        onPeerLeft(peerId) {
          actions.addEvent({
            label: "Peer left",
            detail: peerId,
          });
          meshNetwork.handlePeerLeft(peerId);
        },
        onSignal(message) {
          meshNetwork.handleSignal(message).catch((error) => {
            console.warn("[liminal_v1] signal handling failed", error);
          });
        },
      });

      return onboarding;
    }

    function showManualInvite() {
      return ensureManualOnboarding().showInvite();
    }

    function applyManualResponse(raw) {
      return ensureManualOnboarding().applyResponse(raw);
    }

    function clearManualOnboarding() {
      return ensureManualOnboarding().clear();
    }

    function copyManualLink(value) {
      return ensureManualOnboarding().copyLink(value);
    }

    function stop() {
      const activeOnboarding = onboarding;
      onboarding = null;
      activeOnboarding?.stop();
      meshNetwork.stop();
      manualOnboarding = null;
    }

    function reconnect() {
      actions.addEvent({
        label: "Reconnect requested",
        detail: "Repairing onboarding and missing edges",
      });

      if (!onboarding?.isConnected() || onboarding?.isSuspended?.()) {
        onboarding?.resume?.().catch((error) => {
          console.warn("[liminal_v1] reconnect failed", error);
          actions.addEvent({
            label: "Reconnect failed",
            detail: String(error?.message || error),
          });
        });
      }

      meshNetwork.repairConnections();
    }

    function handleNetworkStateChange(nextNetworkState) {
      actions.setClientId(nextNetworkState.clientId);
      actions.setStatus(nextNetworkState.status);
      actions.setPeers(nextNetworkState.peers);
      actions.setConnectedPeerCount(nextNetworkState.connectedPeerCount);
      if (onboardingTransitionLocked) {
        return;
      }
      syncOnboardingMode(nextNetworkState);
    }

    function syncOnboardingMode(nextNetworkState) {
      if (onboardingTransitionLocked) {
        return;
      }

      const activeOnboarding = ensureOnboarding();
      activeOnboarding.setServingEnabled?.(onboarderEnabled);

      if (nextNetworkState.connectedPeerCount > 0) {
        if (!onboarderEnabled) {
          activeOnboarding.suspend?.().catch((error) => {
            console.warn("[liminal_v1] suspend onboarding failed", error);
          });
        } else if (activeOnboarding.isSuspended?.() || !activeOnboarding.isConnected?.()) {
          activeOnboarding.resume?.().catch((error) => {
            console.warn("[liminal_v1] resume onboarding while serving failed", error);
            actions.addEvent({
              label: "MQTT serve resume failed",
              detail: String(error?.message || error),
            });
          });
        }
        return;
      }

      if (nextNetworkState.connectedPeerCount === 0 && (activeOnboarding.isSuspended?.() || !activeOnboarding.isConnected?.())) {
        const starter = activeOnboarding.isSuspended?.() ? activeOnboarding.resume?.bind(activeOnboarding) : activeOnboarding.start?.bind(activeOnboarding);
        starter?.().catch((error) => {
          console.warn("[liminal_v1] resume onboarding failed", error);
          actions.addEvent({
            label: "MQTT resume failed",
            detail: String(error?.message || error),
          });
        });
      }
    }

    function setOnboarderEnabled(nextEnabled) {
      onboarderEnabled = !!nextEnabled;
      ensureOnboarding().setServingEnabled?.(onboarderEnabled);
      syncOnboardingMode({
        connectedPeerCount: meshNetwork ? actions.getState().network.connectedPeerCount : 0,
      });
    }

    return {
      start,
      stop,
      reconnect,
      setOnboarderEnabled,
      meshNetwork,
      manualOnboarding: {
        showInvite: showManualInvite,
        applyResponse: applyManualResponse,
        clear: clearManualOnboarding,
        copyLink: copyManualLink,
      },
    };
  }

  window.LiminalV1RuntimeService = {
    createLiminalRuntime,
  };
})();
