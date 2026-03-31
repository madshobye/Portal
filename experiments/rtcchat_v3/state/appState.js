(() => {
  function createAppState({ storage, config, identity }) {
    const selfClientId = identity.createNetworkClientId();
    const currentUser = identity.createPresentUser(selfClientId);
    return {
      network: {
        selfClientId,
      },
      identity: {
        currentUser,
      },
      toggles: {
        onboarderEnabled: storage.getItem(config.ONBOARDER_ENABLED_KEY) === "1",
        infoVisible: false,
      },
    };
  }

  window.RtcChatV3State = {
    createAppState,
  };
})();
