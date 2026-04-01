(() => {
  function createLiminalView({
    mount,
    app = null,
    manualOnboarding = null,
    onToggleDebug = () => {},
    onReconnect = () => {},
    onToggleOnboarder = () => {},
    onQr = () => {},
  }) {
    const root = window.LiminalV1Base.createRoot(mount);
    const debugToggle = window.LiminalV1DebugToggle.createDebugToggle({
      onToggle: onToggleDebug,
    });

    function create() {
      debugToggle.create(root);
      debugToggle.setReconnectHandler(onReconnect);
      debugToggle.setOnboarderHandler(onToggleOnboarder);
      debugToggle.setQrHandler(onQr);
      manualOnboarding?.create?.(root);
      app?.createView?.(root);
    }

    function update({
      debug = {},
      manualOnboarding: manualOnboardingState = {},
      app: appState = {},
    } = {}) {
      debugToggle.update(debug);
      manualOnboarding?.update?.(manualOnboardingState);
      app?.updateView?.(appState);
    }

    function destroy() {
      debugToggle.destroy();
      manualOnboarding?.destroy?.();
      app?.destroyView?.();
    }

    return {
      create,
      update,
      destroy,
    };
  }

  window.LiminalV1View = {
    createLiminalView,
  };
})();
