(() => {
  function hashString(value) {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
      hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
    }
    return hash;
  }

  function getPeerProfile(clientId, config = window.LiminalV1Config) {
    const hash = hashString(clientId);
    const adjectives = config.USER_NAME_ADJECTIVES;
    const nouns = config.USER_NAME_NOUNS;
    const adjective = adjectives[hash % adjectives.length];
    const noun = nouns[Math.floor(hash / adjectives.length) % nouns.length];
    const hue = hash % 360;

    return {
      clientId,
      name: `${adjective} ${noun}`,
      color: `hsl(${hue}, 72%, 56%)`,
    };
  }

  window.LiminalV1Identity = {
    getPeerProfile,
  };
})();
