(() => {
  function createOnboardingService({
    config,
    clientId,
    servingEnabled = false,
    onMqttStateChange = () => {},
    onPeerSeen = () => {},
    onPeerLeft = () => {},
    onSignal = () => {},
  }) {
    const mqttClient = new window.LiminalV1MqttClient({
      broker: config.MQTT_BROKER,
      clientId: `${config.APP_NAME}_${clientId}`,
      onConnect: handleMqttConnect,
      onMessage: handleMqttMessage,
      onDisconnect: handleMqttDisconnect,
      onError: handleMqttError,
    });

    let heartbeatTimer = null;
    let reconnectTimer = null;
    let stopped = false;
    let suspended = false;
    let onboarderServingEnabled = !!servingEnabled;

    function getSignalTopic(targetId) {
      return `${config.SIGNAL_TOPIC_PREFIX}/${targetId}`;
    }

    async function start() {
      stopped = false;
      suspended = false;
      try {
        await mqttClient.connect();
      } catch (error) {
        onMqttStateChange(false);
        scheduleReconnect();
        throw error;
      }
    }

    function stop() {
      if (stopped) {
        return;
      }

      stopped = true;
      suspended = false;
      clearInterval(heartbeatTimer);
      clearTimeout(reconnectTimer);
      heartbeatTimer = null;
      reconnectTimer = null;

      if (mqttClient.connected) {
        publishLeave().catch(() => {});
      }

      mqttClient.disconnect();
      onMqttStateChange(false);
    }

    async function reconnect() {
      stop();
      await start();
    }

    async function suspend() {
      if (stopped || suspended) {
        return;
      }

      suspended = true;
      clearInterval(heartbeatTimer);
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
      mqttClient.disconnect();
      onMqttStateChange(false);
    }

    async function resume() {
      if (stopped) {
        return;
      }

      suspended = false;
      if (mqttClient.connected) {
        return;
      }

      try {
        await mqttClient.connect();
      } catch (error) {
        onMqttStateChange(false);
        scheduleReconnect();
        throw error;
      }
    }

    async function sendSignal(targetId, message) {
      await mqttClient.publish(getSignalTopic(targetId), {
        ...message,
        from: clientId,
        to: targetId,
      });
    }

    async function handleMqttConnect() {
      onMqttStateChange(true);
      await mqttClient.subscribe(config.PRESENCE_TOPIC);
      await mqttClient.subscribe(getSignalTopic(clientId));
      await syncServingState();
    }

    function handleMqttDisconnect() {
      onMqttStateChange(false);
      if (!suspended) {
        scheduleReconnect();
      }
    }

    function handleMqttError() {
      onMqttStateChange(false);
      if (!suspended) {
        scheduleReconnect();
      }
    }

    function startHeartbeatLoop() {
      clearInterval(heartbeatTimer);
      heartbeatTimer = window.setInterval(() => {
        publishPresence().catch(() => {});
      }, config.HEARTBEAT_INTERVAL_MS);
    }

    async function stopHeartbeatLoop() {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    async function syncServingState() {
      if (!mqttClient.connected) {
        await stopHeartbeatLoop();
        return;
      }

      startHeartbeatLoop();
      await publishPresence();
    }

    async function publishPresence() {
      await mqttClient.publish(config.PRESENCE_TOPIC, {
        type: "presence",
        clientId,
        serving: onboarderServingEnabled,
        timestamp: Date.now(),
      });
    }

    async function publishLeave() {
      await mqttClient.publish(config.PRESENCE_TOPIC, {
        type: "leave",
        clientId,
        timestamp: Date.now(),
      });
    }

    function handleMqttMessage({ topic, payload }) {
      let message = null;
      try {
        message = JSON.parse(payload);
      } catch {
        return;
      }

      if (topic === config.PRESENCE_TOPIC) {
        handlePresenceMessage(message);
        return;
      }

      if (topic === getSignalTopic(clientId)) {
        onSignal(message);
      }
    }

    function handlePresenceMessage(message) {
      if (!message?.clientId || message.clientId === clientId) {
        return;
      }

      if (message.type === "leave") {
        onPeerLeft(message.clientId);
        return;
      }

      onPeerSeen({
        id: message.clientId,
        serving: !!message.serving,
        lastSeenAt: Date.now(),
      });
    }

    function scheduleReconnect() {
      if (stopped || suspended || reconnectTimer) return;
      reconnectTimer = window.setTimeout(async () => {
        reconnectTimer = null;
        if (stopped || suspended) return;
        try {
          await mqttClient.connect();
        } catch {
          scheduleReconnect();
        }
      }, config.RECONNECT_DELAY_MS);
    }

    function setServingEnabled(nextEnabled) {
      onboarderServingEnabled = !!nextEnabled;
      syncServingState().catch(() => {});
    }

    return {
      start,
      stop,
      reconnect,
      suspend,
      resume,
      sendSignal,
      setServingEnabled,
      isConnected() {
        return mqttClient.connected;
      },
      isSuspended() {
        return suspended;
      },
      isServingEnabled() {
        return onboarderServingEnabled;
      },
    };
  }

  window.LiminalV1Onboarding = {
    createOnboardingService,
  };
})();
