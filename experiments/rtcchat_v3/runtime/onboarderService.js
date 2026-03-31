(() => {
  function createOnboarderService(deps) {
    const {
      SELF_PEER_ID,
      NETWORK_NAME,
      MQTT_TOPIC_PREFIX,
      ONBOARDER_DISCOVERY_TOPIC,
      MQTT_BROKER,
      getState,
      setState,
      debugLog,
      renderUi,
      scheduleReconnectAttempt,
      clearInviteView,
      createConnectionEntry,
      wireDataChannel,
      cleanupEntryMqttSignal,
      clearActiveInviteForEntry,
      waitForInitialCandidatesRef,
      subscribeMqttTopic,
      waitForIceReady,
      getConnectedPeerIds,
      makeInviteId,
      updateOnboarderSubscriptionRef,
      publishOnboarderPresenceRef,
    } = deps;

    function state() {
      return getState();
    }

    function assign(patch) {
      setState(patch);
    }

    async function initOnboarderMqtt() {
      try {
        const s = state();
        const client = await new window.RtcChatV3MqttClient({
          broker: MQTT_BROKER,
          clientId: `${SELF_PEER_ID}-onboard`,
          autoConnect: false,
          onMessage: (result) => {
            handleOnboarderMqttMessage(result);
          },
        }).init();
        await client.connect();
        assign({ onboarderMqttClient: client });
        await subscribeMqttTopic(ONBOARDER_DISCOVERY_TOPIC, handleOnboarderPresenceMessage);
        await subscribeMqttTopic(s.onboarderReplyTopic, (result) => {
          let payload;
          try {
            payload = JSON.parse(result.message);
          } catch {
            return;
          }
          const waiter = state().onboarderWaiters.get(payload.requestId);
          if (waiter) waiter(payload);
        });
        await subscribeMqttTopic(s.onboarderResponseTopic, handleOnboarderResponseMessage);
        await updateOnboarderSubscription();
      } catch (error) {
        console.warn("[rtcchat_v3] onboarder mqtt unavailable", error);
      }
    }

    function handleOnboarderMqttMessage(result) {
      const s = state();
      const topicHandler = s.mqttTopicHandlers.get(result?.topic);
      if (topicHandler) {
        topicHandler(result);
        return;
      }
      if (result?.topic === s.onboarderRequestTopic) {
        if (s.onboarderEnabled) {
          answerOnboarderRequest(result).catch((error) => {
            console.error("[rtcchat_v3] onboarder request error", error);
            debugLog("onboarder_error", {
              msg: error?.message || String(error),
            });
          });
        }
        return;
      }
      if (result?.topic === s.onboarderResponseTopic) {
        handleOnboarderResponseMessage(result);
      }
    }

    function handleOnboarderPresenceMessage(result) {
      const s = state();
      if (!result?.message) return;
      let payload;
      try {
        payload = JSON.parse(result.message);
      } catch {
        return;
      }
      if (s.role !== "idle" && s.phase !== "reconnecting") return;
      if (!payload?.peerId || payload.peerId === SELF_PEER_ID) return;
      s.discoveredOnboarders.set(payload.peerId, {
        ...payload,
        seenAt: Date.now(),
      });
      debugLog("onboarder_presence_seen", {
        onboarderId: payload.peerId,
        available: payload.available,
        roomId: payload.roomId,
      });
    }

    function clearDiscoveredOnboarders() {
      const s = state();
      if (s.discoveredOnboarders.size === 0) return;
      s.discoveredOnboarders.clear();
      debugLog("onboarder_presence_cleared");
    }

    async function unsubscribeMqttTopic(topic) {
      const s = state();
      if (!topic || !s.onboarderMqttClient?.connected) return;
      s.mqttTopicHandlers.delete(topic);
      try {
        await s.onboarderMqttClient.unsubscribe(topic);
        debugLog("mqtt_topic_unsub", { topic });
      } catch {}
    }

    function handleOnboarderResponseMessage(result) {
      const s = state();
      if (!result?.message) return;
      let payload;
      try {
        payload = JSON.parse(result.message);
      } catch {
        return;
      }
      if (payload?.type !== "rtcchat-v3-onboarder-response") return;
      s.applyInviteResponse(payload.inviteId, payload.responseValue).catch((error) => {
        console.error("[rtcchat_v3] onboarder response error", error);
        debugLog("onboarder_response_error", {
          inviteId: payload?.inviteId,
          from: payload?.fromPeerId,
          msg: String(error?.message || error),
        });
        assign({ statusText: `Onboarder response error: ${error?.message || error}` });
        renderUi();
      });
    }

    async function updateOnboarderSubscription() {
      const s = state();
      if (!s.onboarderMqttClient?.connected) return;
      const shouldServe = deps.canAdvertiseOnboarder();
      try {
        if (shouldServe) {
          await s.onboarderMqttClient.subscribe(s.onboarderRequestTopic);
          startOnboarderPresence();
          await publishOnboarderPresence();
          debugLog("onboarder_service_online", { topic: s.onboarderRequestTopic });
        } else {
          stopOnboarderPresence();
          await s.onboarderMqttClient.unsubscribe(s.onboarderRequestTopic);
          debugLog("onboarder_service_offline", { topic: s.onboarderRequestTopic });
        }
      } catch (error) {
        console.warn("[rtcchat_v3] onboarder subscription update failed", error);
      }
    }

    function toggleOnboarderMode() {
      const s = state();
      const next = !s.onboarderEnabled;
      assign({ onboarderEnabled: next });
      s.persistOnboarderEnabled(next);
      if (next && s.activeInvite && s.phase === "show-invite") {
        clearInviteView();
        assign({ statusText: "Onboarder mode enabled. Waiting for MQTT onboarding..." });
      } else {
        assign({ statusText: next ? "Onboarder mode enabled." : "Onboarder mode disabled." });
      }
      debugLog(next ? "onboarder_enabled" : "onboarder_disabled", {
        roomId: s.roomId,
        activeInvite: !!s.activeInvite,
      });
      renderUi();
      updateOnboarderSubscription();
      if (next && s.role === "idle" && getConnectedPeerIds().length === 0 && !s.activeInvite) {
        scheduleReconnectAttempt("onboarder-enabled", 0);
      }
    }

    function startOnboarderPresence() {
      if (!deps.canAdvertiseOnboarder()) return;
      stopOnboarderPresence();
      const timer = setInterval(() => {
        publishOnboarderPresence().catch(() => {});
      }, 3000);
      assign({ onboarderPresenceTimer: timer });
    }

    function stopOnboarderPresence() {
      const s = state();
      if (s.onboarderPresenceTimer) {
        clearInterval(s.onboarderPresenceTimer);
        assign({ onboarderPresenceTimer: null });
      }
    }

    async function publishOnboarderPresence() {
      const s = state();
      if (!deps.canAdvertiseOnboarder()) return;
      if (!s.onboarderMqttClient?.connected) return;
      const available = !(s.activeInvite && !s.shareLink);
      const payload = {
        type: "onboarder-presence",
        peerId: SELF_PEER_ID,
        network: NETWORK_NAME,
        roomId: s.roomId,
        available,
        requestTopic: s.onboarderRequestTopic,
        ts: Date.now(),
      };
      await s.onboarderMqttClient.publish(ONBOARDER_DISCOVERY_TOPIC, JSON.stringify(payload));
      debugLog("onboarder_presence_pub", { available, roomId: s.roomId, topic: s.onboarderRequestTopic });
    }

    function pruneOnboarders() {
      const s = state();
      const now = Date.now();
      for (const [peerId, info] of s.discoveredOnboarders.entries()) {
        if (now - (info.seenAt || 0) > 10000) {
          s.discoveredOnboarders.delete(peerId);
        }
      }
    }

    function getAvailableOnboarders() {
      const s = state();
      pruneOnboarders();
      return [...s.discoveredOnboarders.values()].filter((info) => info.available && info.requestTopic);
    }

    async function waitForAvailableOnboarder(timeoutMs = 2500) {
      const immediate = getAvailableOnboarders()[0];
      if (immediate) return immediate;
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        const candidate = getAvailableOnboarders()[0];
        if (candidate) return candidate;
      }
      return null;
    }

    async function answerOnboarderRequest(result) {
      const s = state();
      if (!result?.message || !s.onboarderMqttClient?.connected) return;
      let payload;
      try {
        payload = JSON.parse(result.message);
      } catch {
        return;
      }

      const requestId = payload?.requestId;
      const replyTopic = payload?.replyTopic;
      if (!requestId || !replyTopic) return;

      debugLog("onboarder_request", {
        requestId,
        from: payload.requesterId || "-",
        replyTopic,
      });

      const connectedPeerIds = getConnectedPeerIds();
      const canBroker =
        s.role === "host" ||
        connectedPeerIds.length > 0 ||
        s.phase === "hosting" ||
        s.phase === "connected";

      if (!canBroker) {
        await publishOnboarderReply(replyTopic, requestId, {
          available: false,
          reason: "not-connected",
          roomId: s.roomId,
        });
        return;
      }

      if (s.activeInvite && !s.shareLink) {
        await publishOnboarderReply(replyTopic, requestId, {
          available: false,
          reason: "busy",
          roomId: s.roomId,
          inviteId: s.activeInvite.inviteId,
        });
        return;
      }

      if (s.activeInvite && s.activeInvite.mqttOnly && s.activeInvite.offerSdp) {
        await publishOnboarderReply(replyTopic, requestId, {
          available: true,
          roomId: s.roomId,
          inviteId: s.activeInvite.inviteId,
          hostId: SELF_PEER_ID,
          responseTopic: s.onboarderResponseTopic,
          offerSdp: s.activeInvite.offerSdp,
          candidates: s.activeInvite.initialCandidates || [],
          peerSignalTopic: s.activeInvite.peerSignalTopic,
          hostSignalTopic: s.activeInvite.hostSignalTopic,
        });
        return;
      }

      assign({ statusText: "Preparing onboarder invite..." });
      renderUi();
      const mqttInvite = await createMqttOnboarderInvite();

      if (!mqttInvite) {
        await publishOnboarderReply(replyTopic, requestId, {
          available: false,
          reason: "invite-unavailable",
          roomId: s.roomId,
        });
        return;
      }

      await publishOnboarderReply(replyTopic, requestId, {
        available: true,
        roomId: s.roomId,
        inviteId: mqttInvite.inviteId,
        hostId: SELF_PEER_ID,
        responseTopic: s.onboarderResponseTopic,
        offerSdp: mqttInvite.offerSdp,
        candidates: mqttInvite.initialCandidates,
        peerSignalTopic: mqttInvite.peerSignalTopic,
        hostSignalTopic: mqttInvite.hostSignalTopic,
      });
    }

    async function publishOnboarderReply(replyTopic, requestId, extra = {}) {
      const s = state();
      const payload = {
        requestId,
        fromPeerId: SELF_PEER_ID,
        ...extra,
      };
      await s.onboarderMqttClient.publish(replyTopic, JSON.stringify(payload));
      debugLog(extra.available ? "onboarder_reply" : "onboarder_unavailable", {
        requestId,
        to: replyTopic,
        inviteId: extra.inviteId,
        roomId: extra.roomId,
        reason: extra.reason,
        mode: extra.offerSdp ? "mqtt" : extra.link ? "link" : undefined,
      });
    }

    async function createMqttOnboarderInvite() {
      const s = state();
      if (s.role !== "host" && s.role !== "peer") return null;
      if (s.activeInvite?.entryKey) {
        const stale = s.connections.get(s.activeInvite.entryKey);
        if (stale && !stale.connectedIdentity) {
          clearActiveInviteForEntry(stale, "replaced");
          cleanupEntryMqttSignal(stale);
          try { stale.dc?.close?.(); } catch {}
          try { stale.pc?.close?.(); } catch {}
          s.connections.delete(s.activeInvite.entryKey);
        }
      }

      const inviteId = makeInviteId();
      const entryKey = `invite:${inviteId}`;
      const hostSignalTopic = `${MQTT_TOPIC_PREFIX}/signal/${inviteId}/host`;
      const peerSignalTopic = `${MQTT_TOPIC_PREFIX}/signal/${inviteId}/peer`;

      const entry = createConnectionEntry({
        key: entryKey,
        peerId: entryKey,
        kind: "bootstrap",
        initiator: true,
      });
      entry.inviteId = inviteId;
      entry.mqttSignal = {
        role: "host",
        publishTopic: peerSignalTopic,
        subscribeTopic: hostSignalTopic,
      };
      entry.dc = entry.pc.createDataChannel("rtchat-room");
      wireDataChannel(entry, entry.dc);
      s.connections.set(entryKey, entry);
      assign({
        activeInvite: {
          inviteId,
          entryKey,
          mqttOnly: true,
          hostSignalTopic,
          peerSignalTopic,
        },
      });
      publishOnboarderPresence().catch(() => {});

      await subscribeMqttTopic(hostSignalTopic, (result) => handleInviteMqttSignal(entry, result));
      debugLog("mqtt_invite_topics_ready", {
        inviteId,
        hostTopic: hostSignalTopic,
        peerTopic: peerSignalTopic,
      });

      try {
        const offer = await entry.pc.createOffer();
        await entry.pc.setLocalDescription(offer);
        await waitForInitialCandidatesRef(entry, 350, 1);

        const nextState = state();
        nextState.activeInvite.offerSdp = entry.pc.localDescription.sdp;
        nextState.activeInvite.initialCandidates = entry.localCandidateInits.slice();

        debugLog("invite_ready", {
          inviteId,
          roomId: nextState.roomId,
          role: nextState.role,
          mode: "mqtt",
          cand: nextState.activeInvite.initialCandidates.length,
          sdpLen: nextState.activeInvite.offerSdp.length,
        });

        return {
          inviteId,
          offerSdp: nextState.activeInvite.offerSdp,
          initialCandidates: nextState.activeInvite.initialCandidates,
          hostSignalTopic,
          peerSignalTopic,
        };
      } catch (error) {
        console.error("[rtcchat_v3] mqtt invite error", error);
        debugLog("invite_error", { mode: "mqtt", msg: String(error?.message || error) });
        cleanupEntryMqttSignal(entry);
        s.connections.delete(entryKey);
        assign({ activeInvite: null });
        return null;
      }
    }

    function handleInviteMqttSignal(entry, result) {
      if (!result?.message || !entry) return;
      let payload;
      try {
        payload = JSON.parse(result.message);
      } catch {
        return;
      }
      debugLog("mqtt_signal_recv", {
        inviteId: payload.inviteId || entry.inviteId,
        sig: payload.type,
        topic: result.topic,
        from: payload.fromPeerId,
        cand: payload.candidates?.length,
        hasSdp: !!payload.sdp,
      });

      if (payload.type === "answer" && entry.initiator) {
        applyMqttAnswerToEntry(entry, payload).catch((error) => {
          console.error("[rtcchat_v3] mqtt answer error", error);
          debugLog("response_relay_error", {
            inviteId: payload.inviteId,
            mode: "mqtt",
            msg: String(error?.message || error),
          });
        });
        return;
      }

      if (payload.type === "candidate") {
        addRemoteCandidateToEntry(entry, payload.candidate).catch(() => {});
      }
    }

    async function applyMqttAnswerToEntry(entry, payload) {
      if (!payload?.sdp) return;
      if (entry.pc.signalingState === "stable") return;
      debugLog("mqtt_answer_apply_start", {
        inviteId: payload.inviteId,
        from: payload.fromPeerId,
        cand: payload.candidates?.length || 0,
        sdpLen: payload.sdp.length,
      });
      await entry.pc.setRemoteDescription({ type: "answer", sdp: payload.sdp });
      await flushPendingRemoteCandidates(entry);
      await addInitialMqttCandidates(entry, payload.candidates || []);

      assign({
        shareLink: "",
        qrCode: null,
        phase: "joining",
        statusText: "Response accepted. Waiting for peer hello...",
      });
      debugLog("response_applied", {
        inviteId: payload.inviteId,
        peerId: entry.peerId,
        mode: "mqtt",
        cand: entry.remoteCandidatesAdded,
      });
      renderUi();
    }

    async function addInitialMqttCandidates(entry, candidates) {
      if (candidates?.length) {
        debugLog("mqtt_initial_candidates", {
          inviteId: entry.inviteId,
          peerId: entry.peerId,
          count: candidates.length,
        });
      }
      for (const candidate of candidates || []) {
        await addRemoteCandidateToEntry(entry, candidate);
      }
    }

    async function addRemoteCandidateToEntry(entry, candidate) {
      if (!entry || !candidate?.candidate) return;
      const key = JSON.stringify(candidate);
      if (entry.seenRemoteCandidateKeys.has(key)) return;
      entry.seenRemoteCandidateKeys.add(key);

      if (!entry.pc.remoteDescription) {
        entry.pendingRemoteCandidates.push(candidate);
        debugLog("mqtt_candidate_queued", {
          inviteId: entry.inviteId,
          peerId: entry.peerId,
          pending: entry.pendingRemoteCandidates.length,
        });
        return;
      }

      await entry.pc.addIceCandidate(candidate);
      entry.remoteCandidatesAdded += 1;
      debugLog("mqtt_candidate_applied", {
        inviteId: entry.inviteId,
        peerId: entry.peerId,
        total: entry.remoteCandidatesAdded,
      });
    }

    async function flushPendingRemoteCandidates(entry) {
      if (!entry?.pc.remoteDescription || !entry.pendingRemoteCandidates.length) return;
      const pending = entry.pendingRemoteCandidates.splice(0);
      debugLog("mqtt_candidate_flush", {
        inviteId: entry.inviteId,
        peerId: entry.peerId,
        count: pending.length,
      });
      for (const candidate of pending) {
        await entry.pc.addIceCandidate(candidate);
        entry.remoteCandidatesAdded += 1;
      }
    }

    function waitForInitialCandidates(entry, timeoutMs = 350, minCandidates = 1) {
      return new Promise((resolve) => {
        if (entry.localCandidateInits.length >= minCandidates) {
          resolve();
          return;
        }
        setTimeout(resolve, timeoutMs);
      });
    }

    return {
      initOnboarderMqtt,
      handleOnboarderMqttMessage,
      handleOnboarderPresenceMessage,
      clearDiscoveredOnboarders,
      unsubscribeMqttTopic,
      handleOnboarderResponseMessage,
      updateOnboarderSubscription,
      toggleOnboarderMode,
      startOnboarderPresence,
      stopOnboarderPresence,
      publishOnboarderPresence,
      pruneOnboarders,
      getAvailableOnboarders,
      waitForAvailableOnboarder,
      answerOnboarderRequest,
      publishOnboarderReply,
      createMqttOnboarderInvite,
      handleInviteMqttSignal,
      applyMqttAnswerToEntry,
      addInitialMqttCandidates,
      addRemoteCandidateToEntry,
      flushPendingRemoteCandidates,
      waitForInitialCandidates,
    };
  }

  window.RtcChatV3OnboarderService = {
    createOnboarderService,
  };
})();
