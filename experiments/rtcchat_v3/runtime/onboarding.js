(() => {
  function createOnboardingRuntime(deps) {
    const {
      DEFAULT_ROOM_NAME,
      RECONNECT_RETRY_DELAY_MS,
      getState,
      setState,
      renderUi,
      renderMessages,
      debugLog,
      scheduleReconnectAttempt,
      stopReconnectLoop,
      clearDiscoveredOnboarders,
      waitForAvailableOnboarder,
      publishOnboarderPresence,
      updateOnboarderSubscription,
      getConnectedPeerIds,
      closeAllConnections,
      createConnectionEntry,
      wireDataChannel,
      cleanupEntryMqttSignal,
      clearActiveInviteForEntry,
      waitForIceReady,
      waitForInitialCandidates,
      createSignalBundle,
      toBundleString,
      fromBundleString,
      buildSdpFromBundle,
      logBundle,
      logParsedBundle,
      tryCreateQrCode,
      makeInviteId,
      subscribeMqttTopic,
      addInitialMqttCandidates,
      extractResponseValue,
      buildInviteLink,
      buildResponseLink,
      clearIncomingParams,
    } = deps;

    function state() {
      return getState();
    }

    function assign(patch) {
      setState(patch);
    }

    async function handleIncomingLink() {
      const params = new URLSearchParams(window.location.search);
      const connectValue = params.get("connect");
      const responseValue = params.get("response");
      const room = params.get("room");
      const inviteId = params.get("invite");
      const host = params.get("host");

      if (connectValue && inviteId && host) {
        await startAsJoinerFromLink(connectValue, room, inviteId, host);
        return;
      }

      if (responseValue && inviteId) {
        forwardResponseToLocalInviter({
          type: "rtcchat-v3-response",
          inviteId,
          responseValue,
          roomId: room || DEFAULT_ROOM_NAME,
          sentAt: Date.now(),
        });
        return;
      }

      assign({ role: "idle", phase: "reconnecting", statusText: "Connecting..." });
      renderUi();
      scheduleReconnectAttempt("startup", 0);
    }

    async function tryJoinViaOnboarder(timeoutMs = 4000) {
      const s = state();
      if (!s.onboarderMqttClient?.connected) return false;

      assign({ statusText: "Connecting..." });
      renderUi();

      const onboarder = await waitForAvailableOnboarder(timeoutMs);
      if (!onboarder?.requestTopic) {
        assign({ statusText: "Connecting..." });
        renderUi();
        return false;
      }

      const requestId = `req-${Math.random().toString(36).slice(2, 10)}`;
      debugLog("onboarder_pick", {
        onboarderId: onboarder.peerId,
        roomId: onboarder.roomId,
      });

      const response = await new Promise((resolve) => {
        const timer = setTimeout(() => {
          state().onboarderWaiters.delete(requestId);
          resolve(null);
        }, timeoutMs);

        state().onboarderWaiters.set(requestId, (payload) => {
          clearTimeout(timer);
          state().onboarderWaiters.delete(requestId);
          resolve(payload);
        });

        state().onboarderMqttClient.publish(
          onboarder.requestTopic,
          JSON.stringify({
            requesterId: state().SELF_PEER_ID,
            requestId,
            replyTopic: state().onboarderReplyTopic,
            targetOnboarderId: onboarder.peerId,
          })
        ).catch(() => {
          clearTimeout(timer);
          state().onboarderWaiters.delete(requestId);
          resolve(null);
        });
      });

      if (response?.offerSdp && response?.peerSignalTopic && response?.hostSignalTopic) {
        try {
          debugLog("onboarder_join", {
            hostId: response.hostId || "",
            inviteId: response.inviteId || "",
            roomId: response.roomId || "",
            mode: "mqtt",
          });
          await startAsJoinerViaMqtt(response);
          return true;
        } catch (error) {
          debugLog("onboarder_join_error", { mode: "mqtt", msg: String(error?.message || error) });
          assign({ statusText: `Onboarder error: ${error?.message || error}` });
          renderUi();
          return false;
        }
      }

      if (!response?.link) {
        assign({ statusText: "Connecting..." });
        renderUi();
        return false;
      }

      try {
        const url = new URL(response.link);
        const connectValue = url.searchParams.get("connect");
        const room = url.searchParams.get("room") || response.roomId || DEFAULT_ROOM_NAME;
        const inviteId = url.searchParams.get("invite") || response.inviteId || "";
        const host = url.searchParams.get("host") || response.hostId || "";
        if (!connectValue || !inviteId || !host) {
          throw new Error("Onboarder response was missing connect details.");
        }
        debugLog("onboarder_join", { hostId: host, inviteId, roomId: room });
        await startAsJoinerFromLink(connectValue, room, inviteId, host, {
          mqttResponseTopic: response.responseTopic || "",
          viaOnboarder: true,
        });
        return true;
      } catch (error) {
        debugLog("onboarder_join_error", { msg: String(error?.message || error) });
        assign({ statusText: `Onboarder error: ${error?.message || error}` });
        renderUi();
        return false;
      }
    }

    async function initializeHostRoom(options = {}) {
      const forceManualInvite = !!options.forceManualInvite;
      const s = state();
      stopReconnectLoop();
      clearDiscoveredOnboarders();
      closeAllConnections();
      s.connections.clear();
      assign({ knownPeerIds: new Set([s.SELF_PEER_ID]) });
      s.appliedResponseSignatures.clear();
      s.applyingResponseInviteIds.clear();
      assign({
        role: "host",
        phase: "hosting",
        roomId: DEFAULT_ROOM_NAME,
        hostPeerId: s.SELF_PEER_ID,
        shareLink: "",
        qrCode: null,
        activeInvite: null,
        statusText: s.onboarderEnabled && !forceManualInvite
          ? "Network ready. Waiting for MQTT onboarding..."
          : "Creating lounge invite...",
      });
      renderMessages();
      renderUi();
      debugLog("room_init", { role: state().role, roomId: state().roomId });
      updateOnboarderSubscription();
      if (state().onboarderEnabled && !forceManualInvite) {
        assign({ phase: "hosting" });
        renderUi();
        publishOnboarderPresence().catch(() => {});
        return;
      }
      await createHostInvite();
    }

    function clearInviteView() {
      const s = state();
      assign({ shareLink: "", qrCode: null });
      if (s.activeInvite) {
        assign({
          phase: s.activeInvite ? "awaiting-response" : getConnectedPeerIds().length > 0 ? "connected" : "hosting",
          statusText: s.activeInvite ? "Awaiting peer response..." : "Network ready.",
        });
      } else if (s.role === "peer") {
        assign({ phase: "joining", statusText: "Waiting for the network to accept response." });
      }
      renderUi();
    }

    async function createHostInvite(options = {}) {
      const silent = !!options.silent;
      const s = state();
      if (s.role !== "host" && s.role !== "peer") return;
      if (s.activeInvite?.entryKey) {
        const stale = s.connections.get(s.activeInvite.entryKey);
        if (stale && !stale.connectedIdentity) {
          try { stale.dc?.close?.(); } catch {}
          try { stale.pc?.close?.(); } catch {}
          s.connections.delete(s.activeInvite.entryKey);
        }
      }

      const inviteId = makeInviteId();
      const entryKey = `invite:${inviteId}`;
      const entry = createConnectionEntry({
        key: entryKey,
        peerId: entryKey,
        kind: "bootstrap",
        initiator: true,
      });
      entry.inviteId = inviteId;
      entry.dc = entry.pc.createDataChannel("rtchat-room");
      wireDataChannel(entry, entry.dc);
      s.connections.set(entryKey, entry);
      assign({ activeInvite: { inviteId, entryKey } });
      publishOnboarderPresence().catch(() => {});

      const previousPhase = state().phase;
      const previousStatus = state().statusText;
      if (!silent) {
        assign({ phase: "hosting", statusText: "Creating invite link..." });
        renderUi();
      }

      try {
        const offer = await entry.pc.createOffer();
        await entry.pc.setLocalDescription(offer);
        await waitForIceReady(entry);
        const bundle = createSignalBundle("OB", entry.pc.localDescription.sdp, entry.localCandidates);
        const bundleString = toBundleString(bundle);
        assign({
          shareLink: buildInviteLink(bundleString, state().roomId, inviteId, state().SELF_PEER_ID),
        });
        assign({ qrCode: tryCreateQrCode(state().shareLink) });
        logBundle("HOST INVITE", bundleString, bundle);
        debugLog("invite_ready", {
          inviteId,
          roomId: state().roomId,
          role: state().role,
          len: state().shareLink.length,
          cand: bundle.c.length,
        });
        if (silent) {
          assign({ phase: previousPhase, statusText: "Onboarder invite ready." });
        } else {
          assign({
            phase: "show-invite",
            statusText: state().qrCode
              ? "Invite ready. Share it with the next peer."
              : "Invite ready. QR unavailable for this link, use copy/share.",
          });
        }
        renderUi();
      } catch (error) {
        debugLog("invite_error", { msg: String(error?.message || error) });
        assign({ statusText: silent ? previousStatus : `Invite error: ${error?.message || error}` });
        renderUi();
      }
    }

    async function startAsJoinerFromLink(linkValue, room, inviteId, hostId, options = {}) {
      const mqttResponseTopic = options.mqttResponseTopic || "";
      const viaOnboarder = !!options.viaOnboarder;
      stopReconnectLoop();
      clearDiscoveredOnboarders();
      closeAllConnections();
      const s = state();
      s.connections.clear();
      assign({ knownPeerIds: new Set([s.SELF_PEER_ID, hostId]) });
      assign({
        role: "peer",
        phase: "joining",
        roomId: room || DEFAULT_ROOM_NAME,
        hostPeerId: hostId,
        shareLink: "",
        qrCode: null,
        activeInvite: null,
        statusText: "Applying invite link and building response...",
      });
      renderMessages();
      renderUi();
      debugLog("join_start", { inviteId, roomId: state().roomId, hostId });
      updateOnboarderSubscription();

      const hostEntry = createConnectionEntry({
        key: hostId,
        peerId: hostId,
        kind: "host",
        initiator: false,
      });
      s.connections.set(hostId, hostEntry);

      try {
        const bundle = fromBundleString(linkValue);
        logParsedBundle("JOIN OFFER", linkValue, bundle);
        await hostEntry.pc.setRemoteDescription({ type: "offer", sdp: buildSdpFromBundle(bundle) });
        for (const candidate of bundle.c || []) {
          await hostEntry.pc.addIceCandidate({ candidate, sdpMLineIndex: 0 });
          hostEntry.remoteCandidatesAdded += 1;
        }
        const answer = await hostEntry.pc.createAnswer();
        await hostEntry.pc.setLocalDescription(answer);
        await waitForIceReady(hostEntry);
        const answerBundle = createSignalBundle("AB", hostEntry.pc.localDescription.sdp, hostEntry.localCandidates);
        const answerString = toBundleString(answerBundle);
        assign({
          shareLink: buildResponseLink(answerString, state().roomId, inviteId, state().hostPeerId),
        });
        assign({ qrCode: tryCreateQrCode(state().shareLink) });
        logBundle("JOIN ANSWER", answerString, answerBundle);
        debugLog("response_ready", {
          inviteId,
          roomId: state().roomId,
          hostId,
          len: state().shareLink.length,
          cand: answerBundle.c.length,
        });

        if (mqttResponseTopic && state().onboarderMqttClient?.connected) {
          await state().onboarderMqttClient.publish(
            mqttResponseTopic,
            JSON.stringify({
              type: "rtcchat-v3-onboarder-response",
              inviteId,
              responseValue: answerString,
              roomId: state().roomId,
              fromPeerId: state().SELF_PEER_ID,
            })
          );
          assign({
            shareLink: "",
            qrCode: null,
            phase: "joining",
            statusText: "Response sent to onboarder. Waiting for host...",
          });
          debugLog("response_forwarded_mqtt", {
            inviteId,
            roomId: state().roomId,
            hostId,
            viaOnboarder,
          });
        } else {
          assign({
            phase: "show-response",
            statusText: state().qrCode
              ? "Response ready. Paste it into the host tab."
              : "Response ready. QR unavailable for this link, use copy/share.",
          });
        }
        renderUi();
      } catch (error) {
        debugLog("join_error", { inviteId, msg: String(error?.message || error) });
        assign({ statusText: `Join error: ${error?.message || error}` });
        renderUi();
      }
    }

    async function startAsJoinerViaMqtt(response) {
      stopReconnectLoop();
      clearDiscoveredOnboarders();
      closeAllConnections();
      const s = state();
      s.connections.clear();
      assign({ knownPeerIds: new Set([s.SELF_PEER_ID, response.hostId]) });
      assign({
        role: "peer",
        phase: "joining",
        roomId: response.roomId || DEFAULT_ROOM_NAME,
        hostPeerId: response.hostId || "",
        shareLink: "",
        qrCode: null,
        activeInvite: null,
        statusText: "Applying onboarder offer...",
      });
      renderMessages();
      renderUi();
      debugLog("join_start", { inviteId: response.inviteId, roomId: state().roomId, hostId: state().hostPeerId, mode: "mqtt" });
      updateOnboarderSubscription();

      const hostEntry = createConnectionEntry({
        key: state().hostPeerId,
        peerId: state().hostPeerId,
        kind: "host",
        initiator: false,
      });
      hostEntry.inviteId = response.inviteId || "";
      hostEntry.mqttSignal = {
        role: "peer",
        publishTopic: response.hostSignalTopic,
        subscribeTopic: response.peerSignalTopic,
      };
      s.connections.set(state().hostPeerId, hostEntry);
      await subscribeMqttTopic(response.peerSignalTopic, (result) => deps.handleInviteMqttSignal(hostEntry, result));

      try {
        await hostEntry.pc.setRemoteDescription({ type: "offer", sdp: response.offerSdp });
        await addInitialMqttCandidates(hostEntry, response.candidates || []);
        const answer = await hostEntry.pc.createAnswer();
        await hostEntry.pc.setLocalDescription(answer);
        await waitForInitialCandidates(hostEntry, 350, 1);
        await state().onboarderMqttClient.publish(
          response.hostSignalTopic,
          JSON.stringify({
            type: "answer",
            inviteId: response.inviteId,
            fromPeerId: state().SELF_PEER_ID,
            sdp: hostEntry.pc.localDescription.sdp,
            candidates: hostEntry.localCandidateInits.slice(),
          })
        );
        debugLog("mqtt_answer_sent", {
          inviteId: response.inviteId,
          to: response.hostSignalTopic,
          cand: hostEntry.localCandidateInits.length,
          sdpLen: hostEntry.pc.localDescription.sdp.length,
        });
        assign({
          phase: "joining",
          statusText: "Response sent to onboarder. Waiting for host...",
        });
        debugLog("response_forwarded_mqtt", {
          inviteId: response.inviteId,
          roomId: state().roomId,
          hostId: state().hostPeerId,
          cand: hostEntry.localCandidateInits.length,
        });
        renderUi();
      } catch (error) {
        debugLog("join_error", { inviteId: response.inviteId, mode: "mqtt", msg: String(error?.message || error) });
        assign({ statusText: `Join error: ${error?.message || error}` });
        renderUi();
      }
    }

    async function applyPastedResponseLink() {
      const s = state();
      if (!s.activeInvite) return;
      const raw = String(s.responsePasteInputEl?.value || "").trim();
      if (!raw) {
        assign({ statusText: "Paste a response link first." });
        renderUi();
        return;
      }
      const entry = s.connections.get(s.activeInvite.entryKey);
      if (!entry) {
        assign({ statusText: "No pending invite is waiting for a response." });
        renderUi();
        return;
      }
      try {
        const responseValue = extractResponseValue(raw);
        await applyInviteResponse(s.activeInvite.inviteId, responseValue);
        s.responsePasteInputEl.value = "";
      } catch (error) {
        assign({ statusText: `Response error: ${error?.message || error}` });
        renderUi();
      }
    }

    function initLocalResponseRelay() {
      if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel(deps.LOCAL_RESPONSE_CHANNEL);
        assign({ localResponseChannel: channel });
        channel.onmessage = (event) => {
          handleLocalResponseSignal(event?.data);
        };
      }
      window.addEventListener("storage", (event) => {
        if (event.key !== deps.LOCAL_RESPONSE_KEY || !event.newValue) return;
        try {
          handleLocalResponseSignal(JSON.parse(event.newValue));
        } catch {}
      });
    }

    function forwardResponseToLocalInviter(payload) {
      try { state().localResponseChannel?.postMessage?.(payload); } catch {}
      try {
        localStorage.setItem(deps.LOCAL_RESPONSE_KEY, JSON.stringify(payload));
        setTimeout(() => {
          try { localStorage.removeItem(deps.LOCAL_RESPONSE_KEY); } catch {}
        }, 50);
      } catch {}
      assign({
        role: "peer",
        phase: "joining",
        statusText: "Response forwarded to the inviter tab. You can close this tab.",
        shareLink: "",
        qrCode: null,
      });
      clearIncomingParams();
      debugLog("response_forwarded", { inviteId: payload.inviteId, roomId: payload.roomId || state().roomId });
      renderUi();
    }

    async function handleLocalResponseSignal(data) {
      if (!data || data.type !== "rtcchat-v3-response") return;
      if (!state().activeInvite || data.inviteId !== state().activeInvite.inviteId) return;
      try {
        await applyInviteResponse(data.inviteId, data.responseValue);
      } catch (error) {
        debugLog("response_relay_error", {
          inviteId: data.inviteId,
          msg: String(error?.message || error),
        });
        assign({ statusText: `Response relay error: ${error?.message || error}` });
        renderUi();
      }
    }

    async function applyInviteResponse(inviteId, responseValue) {
      const s = state();
      if (!s.activeInvite || s.activeInvite.inviteId !== inviteId) {
        throw new Error("No matching pending invite for that response.");
      }
      if (s.applyingResponseInviteIds.has(inviteId)) return;
      const entry = s.connections.get(s.activeInvite.entryKey);
      if (!entry) throw new Error("No pending invite is waiting for a response.");
      const bundle = fromBundleString(responseValue);
      const responseSignature = `${inviteId}:${JSON.stringify(bundle)}`;
      if (s.appliedResponseSignatures.has(responseSignature)) return;
      logParsedBundle("HOST RESPONSE", responseValue, bundle);
      s.applyingResponseInviteIds.add(inviteId);
      assign({ statusText: "Applying response..." });
      renderUi();
      const signalingState = entry.pc?.signalingState || "";
      if (signalingState !== "have-local-offer") {
        if (signalingState === "stable") {
          s.appliedResponseSignatures.add(responseSignature);
          s.applyingResponseInviteIds.delete(inviteId);
          return;
        }
        s.applyingResponseInviteIds.delete(inviteId);
        throw new Error(`Invite is not waiting for an answer (state: ${signalingState})`);
      }

      try {
        await entry.pc.setRemoteDescription({ type: "answer", sdp: buildSdpFromBundle(bundle) });
        s.appliedResponseSignatures.add(responseSignature);
        entry.remoteCandidatesAdded = 0;
        for (const candidate of bundle.c || []) {
          await entry.pc.addIceCandidate({ candidate, sdpMLineIndex: 0 });
          entry.remoteCandidatesAdded += 1;
        }
        assign({
          shareLink: "",
          qrCode: null,
          phase: "joining",
          statusText: "Response accepted. Waiting for peer hello...",
        });
        debugLog("response_applied", {
          inviteId,
          peerId: entry.peerId,
          cand: entry.remoteCandidatesAdded,
        });
        renderUi();
      } finally {
        s.applyingResponseInviteIds.delete(inviteId);
      }
    }

    function copyShareLink() {
      const link = state().shareLink;
      if (!link) return;
      navigator.clipboard?.writeText?.(link).catch(() => {});
      advanceInviteFlow(true);
    }

    function advanceInviteFlow(fromCopy = false) {
      const s = state();
      if (s.phase === "show-invite") {
        assign({
          shareLink: "",
          qrCode: null,
          phase: s.activeInvite ? "awaiting-response" : "hosting",
          statusText: s.activeInvite
            ? "Awaiting connection..."
            : fromCopy ? "Invite copied." : "Invite dismissed.",
        });
      } else if (s.phase === "show-response") {
        assign({
          shareLink: "",
          qrCode: null,
          phase: "joining",
          statusText: "Response ready. Return to the original inviter tab.",
        });
      }
      renderUi();
    }

    return {
      handleIncomingLink,
      tryJoinViaOnboarder,
      initializeHostRoom,
      clearInviteView,
      createHostInvite,
      startAsJoinerFromLink,
      startAsJoinerViaMqtt,
      applyPastedResponseLink,
      initLocalResponseRelay,
      forwardResponseToLocalInviter,
      handleLocalResponseSignal,
      applyInviteResponse,
      copyShareLink,
      advanceInviteFlow,
    };
  }

  window.RtcChatV3Onboarding = {
    createOnboardingRuntime,
  };
})();
