(() => {
  function createApp({
    config,
    clientId,
    roomId,
    roomName,
    meshNetwork,
    actions,
  }) {
    const messageChannel = window.TheLoungeComponents.createMessageChannel({
      onSend(text) {
        channelMessages?.send(text);
      },
    });
    let channelMessages = null;

    function start() {
      channelMessages = window.TheLoungeServices.createChannelMessageService({
        clientId,
        roomId,
        meshNetwork,
        onMessage(message) {
          actions.addMessage(message);
        },
        getProfile(targetClientId) {
          return window.LiminalV1Identity.getPeerProfile(targetClientId, config);
        },
      });
    }

    function stop() {
      channelMessages = null;
    }

    function receive(payload, fromPeerId) {
      channelMessages?.receive(payload, fromPeerId);
    }

    function createView(parent) {
      messageChannel.create(parent);
    }

    function updateView({
      title = roomName,
      messages = [],
      disabled = false,
    } = {}) {
      messageChannel.update({
        title,
        messages,
        disabled,
      });
    }

    function destroyView() {
      messageChannel.destroy();
    }

    return {
      id: "theLounge",
      start,
      stop,
      receive,
      createView,
      updateView,
      destroyView,
    };
  }

  window.LiminalV1TheLounge = {
    createApp,
  };
})();
