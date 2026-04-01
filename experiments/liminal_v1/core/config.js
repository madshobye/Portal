(() => {
  window.LiminalV1Config = {
    VERSION: 17,
    APP_NAME: "liminal_v1",
    NETWORK_NAME: "liminalNet",
    DEFAULT_APP_ID: "theLounge",
    DEFAULT_ROOM_NAME: "theLounge",
    MQTT_BROKER: "wss://public:public@public.cloud.shiftr.io",
    MQTT_TOPIC_PREFIX: "portal/liminalNet",
    PRESENCE_TOPIC: "portal/liminalNet/presence",
    SIGNAL_TOPIC_PREFIX: "portal/liminalNet/signal",
    HEARTBEAT_INTERVAL_MS: 3000,
    PEER_STALE_AFTER_MS: 10000,
    RECONNECT_DELAY_MS: 2000,
    ICE_SERVERS: [
      { urls: "stun:stun.l.google.com:19302" },
    ],
    USER_NAME_ADJECTIVES: [
      "Amber", "Brisk", "Calm", "Daring", "Echo", "Frost", "Golden", "Harbor",
      "Indigo", "Jolly", "Kind", "Liminal", "Mellow", "North", "Opal", "Pine",
      "Quiet", "River", "Solar", "Tidal",
    ],
    USER_NAME_NOUNS: [
      "Badger", "Comet", "Drift", "Falcon", "Field", "Finch", "Forest", "Harbor",
      "Leaf", "Lynx", "Meadow", "Otter", "Peak", "Quartz", "Reef", "Sparrow",
      "Stone", "Vale", "Willow", "Wren",
    ],
  };
})();
