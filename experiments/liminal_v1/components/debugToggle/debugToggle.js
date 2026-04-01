(() => {
  function createDebugToggle({ onToggle = () => {} } = {}) {
    let shell;
    let toggleButton;
    let infoCard;
    let reconnectButton;
    let onboarderButton;
    let qrButton;
    let onReconnect = () => {};
    let onToggleOnboarder = () => {};
    let onQr = () => {};

    function create(parent) {
      shell = parent.addAppShell();
      toggleButton = shell.addToggleButton("Disconnected");
      infoCard = shell.addInfoCard();
      reconnectButton = window.LiminalV1Base.createActionButton("Reconnect");
      onboarderButton = window.LiminalV1Base.createActionButton("Onboarder: On", "rtcchat-btn secondary");
      qrButton = window.LiminalV1Base.createActionButton("+", "rtcchat-btn secondary");

      reconnectButton.onClick(() => onReconnect());
      onboarderButton.onClick(() => onToggleOnboarder());
      qrButton.onClick(() => {
        Promise.resolve(onQr()).catch((error) => {
          console.warn("[liminal_v1] qr action failed", error);
        });
      });

      toggleButton.onClick(() => {
        onToggle();
      });

      return shell;
    }

    function update({
      isOpen = false,
      label = "Disconnected",
      title = "Debug",
      text = "This is the first placeholder for the liminal app shell.",
      detail = "",
      onboarderLabel = "Onboarder: On",
    } = {}) {
      toggleButton.setText(label);
      infoCard.setVisible(isOpen);
      infoCard.setTitle(title);
      infoCard.setText(text);
      infoCard.setDetail(detail);
      onboarderButton.setText(onboarderLabel);
      infoCard.setActions([reconnectButton, onboarderButton, qrButton]);
    }

    function setReconnectHandler(handler) {
      onReconnect = typeof handler === "function" ? handler : () => {};
    }

    function setQrHandler(handler) {
      onQr = typeof handler === "function" ? handler : () => {};
    }

    function setOnboarderHandler(handler) {
      onToggleOnboarder = typeof handler === "function" ? handler : () => {};
    }

    function destroy() {
      shell?.element?.parentElement?.remove();
    }

    return {
      create,
      update,
      setReconnectHandler,
      setOnboarderHandler,
      setQrHandler,
      destroy,
    };
  }

  window.LiminalV1DebugToggle = {
    createDebugToggle,
  };
})();
