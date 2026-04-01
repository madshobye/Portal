(() => {
  function createAppController({ mount }) {
    const config = window.LiminalV1Config;
    const clientId = `client-${Math.random().toString(16).slice(2, 10)}`;
    const appStore = window.LiminalV1Apps.createAppStore();
    const appState = window.LiminalV1Model.createAppState({
      network: {
        clientId,
        mqttConnected: false,
        status: "connecting",
        peers: [],
        connectedPeerCount: 0,
        messages: [],
        events: [],
      },
      room: {
        id: config.DEFAULT_ROOM_NAME,
        name: config.DEFAULT_ROOM_NAME,
        appId: config.DEFAULT_APP_ID,
      },
      manualOnboarding: {
        visible: false,
        mode: "hidden",
        title: "",
        text: "",
        link: "",
        qrImageSrc: "",
        inviteId: "",
        pendingPeerId: "",
        responseValue: "",
      },
      ui: {
        debugOpen: false,
        onboarderEnabled: false,
      },
    });
    const actions = window.LiminalV1Actions.createAppActions(appState);
    let app = null;
    let view = null;
    const runtime = window.LiminalV1RuntimeService.createLiminalRuntime({
      config,
      clientId,
      actions,
      onData(payload, fromPeerId) {
        app?.receive(payload, fromPeerId);
      },
    });
    const manualOnboarding = window.LiminalV1ManualOnboarding.createManualOnboarding({
      onClose() {
        runtime.manualOnboarding.clear();
      },
      onApplyResponse(raw) {
        runtime.manualOnboarding.applyResponse(raw).catch((error) => {
          actions.addEvent({
            label: "Apply response failed",
            detail: String(error?.message || error),
          });
          actions.setManualOnboarding({
            visible: true,
            mode: "invite",
            title: "Apply Response Failed",
            text: String(error?.message || error),
          });
        });
      },
      onCopyLink(value) {
        runtime.manualOnboarding.copyLink(value);
      },
      onResponseInput(value) {
        actions.setManualOnboarding({
          responseValue: value,
        });
      },
    });
    let unsubscribe = null;

    async function openQr() {
      try {
        await runtime.manualOnboarding.showInvite();
      } catch (error) {
        actions.addEvent({
          label: "QR invite failed",
          detail: String(error?.message || error),
        });
        actions.setManualOnboarding({
          visible: true,
          mode: "invite",
          title: "QR Invite Failed",
          text: String(error?.message || error),
          link: "",
          qrImageSrc: "",
        });
      }
    }

    function start() {
      app = appStore.createApp(config.DEFAULT_APP_ID, {
        config,
        clientId,
        roomId: config.DEFAULT_ROOM_NAME,
        roomName: config.DEFAULT_ROOM_NAME,
        meshNetwork: runtime.meshNetwork,
        actions,
      });
      view = window.LiminalV1View.createLiminalView({
        mount,
        app,
        manualOnboarding,
        onToggleDebug: toggleDebug,
        onReconnect: () => runtime.reconnect(),
        onToggleOnboarder: toggleOnboarder,
        onQr: openQr,
      });
      view.create();
      app.start();
      unsubscribe = appState.subscribe(sync);
      runtime.start();
    }

    function sync(state = appState.getState()) {
      view.update(window.LiminalV1Selectors.selectViewState(state, config));
    }

    function stop() {
      unsubscribe?.();
      view?.destroy();
      app?.stop();
      runtime.stop();
      view = null;
      app = null;
    }

    function toggleDebug() {
      appState.update((state) => ({
        ...state,
        ui: {
          ...state.ui,
          debugOpen: !state.ui.debugOpen,
        },
      }));
    }

    function toggleOnboarder() {
      appState.update((state) => {
        const nextEnabled = !state.ui.onboarderEnabled;
        runtime.setOnboarderEnabled(nextEnabled);
        return {
          ...state,
          ui: {
            ...state.ui,
            onboarderEnabled: nextEnabled,
          },
        };
      });
    }

    return {
      start,
      stop,
      setDebugOpen(nextOpen) {
        appState.update((state) => ({
          ...state,
          ui: {
            ...state.ui,
            debugOpen: !!nextOpen,
          },
        }));
      },
      toggleDebug,
    };
  }

  window.LiminalV1Runtime = {
    createAppController,
  };
})();
