(() => {
  function createChannelMessageService({
    clientId,
    roomId,
    meshNetwork,
    onMessage = () => {},
    getProfile = () => ({ name: clientId, color: "#1f6fff" }),
  }) {
    function send(text) {
      const payload = {
        type: "chat",
        roomId,
        text,
        author: clientId,
        timestamp: Date.now(),
      };

      meshNetwork.broadcast(payload);
      const selfProfile = getProfile(clientId);
      onMessage({
        kind: "self",
        author: selfProfile.name,
        authorInitial: selfProfile.name.slice(0, 1).toUpperCase(),
        authorColor: selfProfile.color,
        text,
        timestamp: payload.timestamp,
      });
    }

    function receive(payload, fromPeerId) {
      if (!payload || payload.type !== "chat" || payload.roomId !== roomId) {
        return;
      }

      const profile = getProfile(fromPeerId);
      onMessage({
        kind: "peer",
        author: profile.name,
        authorInitial: profile.name.slice(0, 1).toUpperCase(),
        authorColor: profile.color,
        text: payload.text,
        timestamp: payload.timestamp || Date.now(),
      });
    }

    return {
      send,
      receive,
    };
  }

  window.TheLoungeServices = {
    createChannelMessageService,
  };
})();
