(() => {
  function compactDetails(details) {
    const compact = {};
    for (const [key, value] of Object.entries(details || {})) {
      if (value == null || value === "") continue;
      if (typeof value === "string" && value.length > 80) {
        compact[key] = value.slice(0, 77) + "...";
      } else {
        compact[key] = value;
      }
    }
    return compact;
  }

  async function createDebugBus({ MqttClient, broker, topic, clientId, contextProvider, onUnavailable }) {
    let mqttClient = null;

    async function init() {
      try {
        mqttClient = await new MqttClient({
          broker,
          clientId,
          autoConnect: false,
        }).init();
        await mqttClient.connect();
        publish("debug_online");
      } catch (error) {
        console.warn("[rtcchat_v3] debug mqtt unavailable", error);
        if (typeof onUnavailable === "function") {
          onUnavailable(error);
        }
      }
    }

    function buildPayload(event, details = {}) {
      return {
        t: new Date().toISOString(),
        event,
        ...contextProvider(),
        ...compactDetails(details),
      };
    }

    function publish(event, details = {}) {
      const payload = buildPayload(event, details);
      console.log("[rtcchat_v3:debug]", payload);
      if (!mqttClient?.connected) return;
      mqttClient.publish(topic, JSON.stringify(payload)).catch(() => {});
    }

    return {
      init,
      publish,
    };
  }

  window.RtcChatV3DebugBus = {
    createDebugBus,
  };
})();
