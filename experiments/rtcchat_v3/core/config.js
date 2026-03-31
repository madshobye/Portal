window.RtcChatV3Config = {
  VERSION: 11,
  ROOM_SIGNAL_CHANNEL: "rtchat-v3-room",
  LOCAL_RESPONSE_CHANNEL: "rtcchat-v3-local-response",
  LOCAL_RESPONSE_KEY: "rtcchat-v3-local-response",
  ONBOARDER_ENABLED_KEY: "rtcchat-v3-onboarder-enabled",
  MQTT_BROKER: "wss://public:public@public.cloud.shiftr.io",
  DEBUG_TOPIC: "portal/rtcchat/debug",
  ONBOARDER_DISCOVERY_TOPIC: "portal/rtcchat_v3/onboarder/presence",
  ONBOARDER_REQUEST_TOPIC_PREFIX: "portal/rtcchat_v3/onboarder/request",
  RECONNECT_INITIAL_DELAY_MS: 1500,
  RECONNECT_RETRY_DELAY_MS: 4000,
  MESH_RETRY_DELAY_MS: 2500,
  USER_NAME_ADJECTIVES: [
    "Amber", "Brisk", "Calm", "Daring", "Echo", "Frost", "Golden", "Harbor",
    "Indigo", "Jolly", "Kind", "Lively", "Mellow", "North", "Opal", "Pine",
    "Quiet", "River", "Solar", "Tidal",
  ],
  USER_NAME_NOUNS: [
    "Badger", "Comet", "Drift", "Falcon", "Field", "Finch", "Forest", "Harbor",
    "Leaf", "Lynx", "Meadow", "Otter", "Peak", "Quartz", "Reef", "Sparrow",
    "Stone", "Vale", "Willow", "Wren",
  ],
};
