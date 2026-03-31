(() => {
  const config = window.RtcChatV3Config;

  function hashString(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash >>> 0);
  }

  function createNetworkClientId() {
    return `peer-${Math.random().toString(36).slice(2, 10)}`;
  }

  function createPresentUser(clientId) {
    const hash = hashString(clientId);
    const adjective = config.USER_NAME_ADJECTIVES[hash % config.USER_NAME_ADJECTIVES.length];
    const noun = config.USER_NAME_NOUNS[Math.floor(hash / config.USER_NAME_ADJECTIVES.length) % config.USER_NAME_NOUNS.length];
    const hue = hash % 360;
    return {
      userId: `user-${clientId}`,
      presentAtClientId: clientId,
      displayName: `${adjective} ${noun}`,
      color: `hsl(${hue}, 72%, 56%)`,
    };
  }

  function getPresentUserForClient(clientId) {
    return createPresentUser(clientId);
  }

  function getUserInitial(displayName) {
    return String(displayName || "?").trim().charAt(0).toUpperCase() || "?";
  }

  window.RtcChatV3Identity = {
    createNetworkClientId,
    createPresentUser,
    getPresentUserForClient,
    getUserInitial,
    hashString,
  };
})();
