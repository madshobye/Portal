(() => {
  function createMeshProtocol(deps) {
    const {
      SELF_PEER_ID,
      MESH_RETRY_DELAY_MS,
      getState,
      setState,
      renderUi,
      debugLog,
      stopReconnectLoop,
      updateOnboarderSubscription,
      scheduleReconnectAttempt,
      clearActiveInviteForEntry,
      cleanupEntryMqttSignal,
      publishOnboarderPresence,
      createSignalBundle,
      buildSdpFromBundle,
      candidateToInit,
      sendJson,
      addSystemMessage,
      handleIncomingChat,
    } = deps;

    const meshReconnectTimers = new Map();

    function state() {
      return getState();
    }

    function assign(patch) {
      setState(patch);
    }

    function clearMeshReconnect(peerId) {
      const timer = meshReconnectTimers.get(peerId);
      if (!timer) return;
      clearTimeout(timer);
      meshReconnectTimers.delete(peerId);
    }

    function clearAllMeshReconnects() {
      for (const peerId of meshReconnectTimers.keys()) {
        clearMeshReconnect(peerId);
      }
    }

    function scheduleMeshReconnect(peerId, relayPeerId, shouldInitiate, reason = "mesh-failed", delayMs = MESH_RETRY_DELAY_MS) {
      const s = state();
      if (s.isShuttingDown) return;
      if (!peerId || peerId === SELF_PEER_ID) return;
      if (!s.knownPeerIds.has(peerId)) return;
      if (meshReconnectTimers.has(peerId)) return;

      debugLog("mesh_reconnect_scheduled", {
        peerId,
        broker: relayPeerId || s.hostPeerId,
        init: !!shouldInitiate,
        reason,
        delayMs,
      });

      const timer = setTimeout(() => {
        meshReconnectTimers.delete(peerId);
        const nextState = state();
        if (nextState.isShuttingDown) return;
        if (!nextState.knownPeerIds.has(peerId)) return;

        debugLog("mesh_reconnect_attempt", {
          peerId,
          broker: relayPeerId || nextState.hostPeerId,
          init: !!shouldInitiate,
          reason,
        });
        maybeStartMeshConnection(peerId, relayPeerId || nextState.hostPeerId, shouldInitiate);
      }, delayMs);

      meshReconnectTimers.set(peerId, timer);
    }

    function createConnectionEntry({ key, peerId, kind, initiator }) {
      const entry = {
        key,
        peerId,
        kind,
        initiator,
        pc: new RTCPeerConnection({
          iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        }),
        dc: null,
        localCandidates: [],
        remoteCandidatesAdded: 0,
        state: "new",
        connectedIdentity: kind !== "bootstrap",
        meshTargets: new Set(),
        introducedPeers: new Set(),
        inviteId: "",
        relayPeerId: "",
        mqttSignal: null,
        localCandidateInits: [],
        pendingRemoteCandidates: [],
        seenRemoteCandidateKeys: new Set(),
      };

      entry.pc.onicecandidate = (event) => {
        const s = state();
        if (event.candidate?.candidate) {
          entry.localCandidates.push(event.candidate.candidate);
          const candidateInit = candidateToInit(event.candidate);
          entry.localCandidateInits.push(candidateInit);
          if (entry.mqttSignal?.publishTopic && s.onboarderMqttClient?.connected) {
            debugLog("mqtt_candidate_sent", {
              inviteId: entry.inviteId,
              peerId: entry.peerId,
              to: entry.mqttSignal.publishTopic,
              total: entry.localCandidateInits.length,
            });
            s.onboarderMqttClient.publish(
              entry.mqttSignal.publishTopic,
              JSON.stringify({
                type: "candidate",
                inviteId: entry.inviteId,
                fromPeerId: SELF_PEER_ID,
                candidate: candidateInit,
              })
            ).catch(() => {});
          }
        }
      };

      entry.pc.onconnectionstatechange = () => {
        const s = state();
        entry.state = entry.pc.connectionState || "unknown";
        if (entry.state === "failed") {
          const failedPeerId = entry.peerId;
          const failedRelayPeerId = entry.relayPeerId || s.hostPeerId;
          const failedInitiator = entry.initiator;
          const failedKind = entry.kind;
          addSystemMessage(`Connection failed for ${entry.peerId}.`);
          debugLog("pc_failed", { peerId: entry.peerId, kind: entry.kind });
          clearActiveInviteForEntry(entry, "failed");
          cleanupEntryMqttSignal(entry);
          s.connections.delete(entry.key);
          updateOnboarderSubscription();
          assign({ statusText: `Connection failed for ${entry.peerId}.` });
          if (failedKind === "mesh") {
            scheduleMeshReconnect(failedPeerId, failedRelayPeerId, failedInitiator, "pc-failed");
          }
          scheduleReconnectAttempt("pc-failed");
          renderUi();
        } else if (entry.state === "connected") {
          stopReconnectLoop();
          updateOnboarderSubscription();
          if (entry.kind === "mesh") {
            clearMeshReconnect(entry.peerId);
          }
          if (entry.mqttSignal) {
            cleanupEntryMqttSignal(entry);
          }
          if (entry.kind === "mesh") {
            assign({ statusText: `Mesh connected to ${entry.peerId}.` });
            debugLog("mesh_connected", { peerId: entry.peerId });
          } else if (entry.kind === "host" && s.role === "peer") {
            assign({
              phase: "connected",
              statusText: "Connected to the network.",
            });
            debugLog("host_connected", { peerId: entry.peerId });
          }
          renderUi();
        }
      };

      entry.pc.ondatachannel = (event) => {
        wireDataChannel(entry, event.channel);
      };

      return entry;
    }

    function wireDataChannel(entry, channel) {
      entry.dc = channel;
      channel.onopen = () => {
        const s = state();
        stopReconnectLoop();
        updateOnboarderSubscription();
        if (entry.kind === "mesh") {
          clearMeshReconnect(entry.peerId);
        }
        if (s.role === "peer" && entry.peerId === s.hostPeerId && entry.kind === "host") {
          sendHelloToHost();
        }

        if (entry.kind === "mesh") {
          s.knownPeerIds.add(entry.peerId);
          addSystemMessage(`Direct network link open with ${entry.peerId}.`);
          debugLog("dc_open", { peerId: entry.peerId, kind: entry.kind });
        }

        renderUi();
      };

      channel.onmessage = (event) => {
        handleChannelMessage(entry, event.data);
      };

      channel.onclose = () => {
        const s = state();
        const closedPeerId = entry.peerId;
        const closedRelayPeerId = entry.relayPeerId || s.hostPeerId;
        const closedInitiator = entry.initiator;
        const closedKind = entry.kind;
        if (entry.kind === "bootstrap") {
          clearActiveInviteForEntry(entry, "channel-close");
          cleanupEntryMqttSignal(entry);
          s.connections.delete(entry.key);
        } else if (s.connections.get(entry.key) === entry) {
          s.connections.delete(entry.key);
        }
        updateOnboarderSubscription();
        if (closedKind === "mesh") {
          scheduleMeshReconnect(closedPeerId, closedRelayPeerId, closedInitiator, "channel-close");
        }
        scheduleReconnectAttempt("channel-close");
        renderUi();
      };

      channel.onerror = (event) => {
        console.error("[rtcchat_v3] datachannel error", event);
      };
    }

    function sendHelloToHost() {
      const s = state();
      const hostEntry = s.connections.get(s.hostPeerId);
      if (!hostEntry?.dc || hostEntry.dc.readyState !== "open") return;
      debugLog("hello_sent", { to: s.hostPeerId, roomId: s.roomId });
      sendJson(hostEntry.dc, {
        type: "hello",
        peerId: SELF_PEER_ID,
        roomId: s.roomId,
      });
    }

    function handleChannelMessage(entry, raw) {
      let message = null;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }

      if (message.type === "hello" && entry.kind === "bootstrap") {
        debugLog("hello_recv", { from: message.peerId, via: entry.peerId });
        finalizeBootstrapPeer(entry, message);
        return;
      }

      if (message.type === "network-peers") {
        debugLog("network_peers_recv", {
          from: entry.peerId,
          count: (message.peers || []).length,
        });
        handleRoomPeers(message.peers || [], entry.peerId);
        return;
      }

      if (message.type === "mesh-connect") {
        debugLog("mesh_connect_recv", {
          from: entry.peerId,
          peerId: message.peerId,
          broker: message.brokerPeerId || entry.peerId,
          init: typeof message.shouldInitiate === "boolean" ? message.shouldInitiate : "auto",
        });
        maybeStartMeshConnection(
          message.peerId,
          message.brokerPeerId || entry.peerId,
          typeof message.shouldInitiate === "boolean" ? message.shouldInitiate : null
        );
        return;
      }

      if (message.type === "relay-signal") {
        if (message.targetPeerId) {
          forwardRelaySignal(entry, message);
        } else {
          handleRelayedSignal(message);
        }
        return;
      }

      if (message.type === "chat") {
        handleIncomingChat(message);
        return;
      }

      if (message.type === "peer-leaving") {
        handlePeerLeaving(entry, message);
      }
    }

    function handlePeerLeaving(entry, message) {
      const s = state();
      const peerId = String(message.peerId || entry.peerId || "").trim();
      if (!peerId || peerId === SELF_PEER_ID) return;
      removePeer(peerId, message.reason || "left");
      debugLog("peer_left", { peerId, reason: message.reason || "left" });
      assign({ statusText: `${peerId} left the room.` });
      renderUi();
    }

    function removePeer(peerId, reason = "left") {
      const s = state();
      clearMeshReconnect(peerId);
      const entry = s.connections.get(peerId);
      if (entry) {
        clearActiveInviteForEntry(entry, reason);
        cleanupEntryMqttSignal(entry);
        try {
          entry.dc?.close?.();
        } catch {}
        try {
          entry.pc?.close?.();
        } catch {}
        s.connections.delete(peerId);
      }
      s.knownPeerIds.delete(peerId);
      addSystemMessage(`${peerId} ${reason}.`);
      updateOnboarderSubscription();
      scheduleReconnectAttempt(`peer-${reason}`);
    }

    function finalizeBootstrapPeer(entry, message) {
      const s = state();
      const peerId = String(message.peerId || "").trim();
      if (!peerId || peerId === SELF_PEER_ID) return;

      const oldKey = entry.key;
      s.connections.delete(oldKey);

      entry.key = peerId;
      entry.peerId = peerId;
      entry.kind = "host";
      entry.connectedIdentity = true;
      s.connections.set(peerId, entry);

      s.knownPeerIds.add(peerId);
      addSystemMessage(`${peerId} joined the network.`);

      const existingMeshPeers = [...s.connections.values()]
        .filter((candidate) => candidate.peerId !== peerId && candidate.peerId !== SELF_PEER_ID && candidate.kind !== "bootstrap")
        .map((candidate) => candidate.peerId);

      debugLog("peer_joined", {
        peerId,
        existing: existingMeshPeers.length,
        broker: SELF_PEER_ID,
      });

      sendJson(entry.dc, {
        type: "network-peers",
        peers: existingMeshPeers,
      });
      debugLog("network_peers_sent", {
        to: peerId,
        count: existingMeshPeers.length,
      });

      for (const otherPeerId of existingMeshPeers) {
        if (entry.dc?.readyState === "open") {
          debugLog("mesh_connect_sent", {
            to: peerId,
            peerId: otherPeerId,
            broker: SELF_PEER_ID,
            init: true,
          });
          sendJson(entry.dc, {
            type: "mesh-connect",
            peerId: otherPeerId,
            brokerPeerId: SELF_PEER_ID,
            shouldInitiate: true,
          });
        }
      }

      if (s.activeInvite?.entryKey === oldKey) {
        assign({
          activeInvite: null,
          shareLink: "",
          qrCode: null,
          phase: "connected",
          statusText: `Peer ${peerId} connected. Network is ready.`,
        });
        publishOnboarderPresence().catch(() => {});
        renderUi();
      } else {
        renderUi();
      }
    }

    function handleRoomPeers(peerIds, relayPeerId = state().hostPeerId) {
      const s = state();
      for (const peerId of peerIds) {
        s.knownPeerIds.add(peerId);
        const entry = s.connections.get(peerId);
        if (entry && relayPeerId) {
          entry.relayPeerId = relayPeerId;
        }
      }
      renderUi();
    }

    function maybeStartMeshConnection(peerId, relayPeerId = state().hostPeerId, shouldInitiate = null) {
      const s = state();
      if (!peerId || peerId === SELF_PEER_ID || peerId === s.hostPeerId) return;
      s.knownPeerIds.add(peerId);
      let entry = s.connections.get(peerId);
      if (entry && entry.kind === "mesh") {
        if (relayPeerId) entry.relayPeerId = relayPeerId;
        if (typeof shouldInitiate === "boolean") {
          entry.initiator = shouldInitiate;
          if (shouldInitiate && !entry.dc) {
            debugLog("mesh_plan", { peerId, broker: relayPeerId, init: true, existing: true });
            startMeshOffer(entry);
          }
        }
        return;
      }

      entry = createConnectionEntry({
        key: peerId,
        peerId,
        kind: "mesh",
        initiator: typeof shouldInitiate === "boolean" ? shouldInitiate : SELF_PEER_ID < peerId,
      });
      entry.relayPeerId = relayPeerId;
      s.connections.set(peerId, entry);

      if (entry.initiator) {
        debugLog("mesh_plan", { peerId, broker: relayPeerId, init: true, existing: false });
        startMeshOffer(entry);
      } else {
        debugLog("mesh_plan", { peerId, broker: relayPeerId, init: false, existing: false });
        assign({ statusText: `Waiting for ${peerId} to initiate mesh link.` });
        renderUi();
      }
    }

    async function startMeshOffer(entry) {
      const s = state();
      if (!entry || entry.dc) return;
      entry.dc = entry.pc.createDataChannel(`mesh-${entry.peerId}`);
      wireDataChannel(entry, entry.dc);

      try {
        const offer = await entry.pc.createOffer();
        await entry.pc.setLocalDescription(offer);
        await waitForIceReady(entry);

        const bundle = createSignalBundle("OB", entry.pc.localDescription.sdp, entry.localCandidates);
        sendRelayToPeer(entry.peerId, {
          signalKind: "offer",
          bundle,
        }, entry.relayPeerId || s.hostPeerId);
        debugLog("mesh_offer_sent", {
          peerId: entry.peerId,
          broker: entry.relayPeerId || s.hostPeerId,
          cand: bundle.c.length,
        });
        assign({ statusText: `Brokering offer to ${entry.peerId}.` });
        renderUi();
      } catch (error) {
        console.error("[rtcchat_v3] mesh offer error", error);
        debugLog("mesh_offer_error", { peerId: entry.peerId, msg: String(error?.message || error) });
        assign({ statusText: `Mesh offer error for ${entry.peerId}: ${error?.message || error}` });
        scheduleMeshReconnect(entry.peerId, entry.relayPeerId || s.hostPeerId, entry.initiator, "offer-error");
        renderUi();
      }
    }

    function sendRelayToPeer(targetPeerId, signal, relayPeerId = state().hostPeerId) {
      const s = state();
      const relayEntry = s.connections.get(relayPeerId);
      if (!relayEntry?.dc || relayEntry.dc.readyState !== "open") {
        throw new Error("Relay channel is not open");
      }
      sendJson(relayEntry.dc, {
        type: "relay-signal",
        targetPeerId,
        fromPeerId: SELF_PEER_ID,
        signalKind: signal.signalKind,
        bundle: signal.bundle,
        brokerPeerId: relayPeerId,
      });
    }

    function forwardRelaySignal(fromEntry, message) {
      const s = state();
      const targetPeerId = String(message.targetPeerId || "").trim();
      if (!targetPeerId) return;
      const targetEntry = s.connections.get(targetPeerId);
      if (!targetEntry?.dc || targetEntry.dc.readyState !== "open") return;

      sendJson(targetEntry.dc, {
        type: "relay-signal",
        fromPeerId: message.fromPeerId,
        signalKind: message.signalKind,
        bundle: message.bundle,
        brokerPeerId: SELF_PEER_ID,
      });

      s.knownPeerIds.add(targetPeerId);
      if (message.fromPeerId) {
        s.knownPeerIds.add(message.fromPeerId);
      }
      renderUi();
    }

    async function handleRelayedSignal(message) {
      const s = state();
      const fromPeerId = String(message.fromPeerId || "").trim();
      if (!fromPeerId || fromPeerId === SELF_PEER_ID) return;
      s.knownPeerIds.add(fromPeerId);

      let entry = s.connections.get(fromPeerId);
      if (!entry) {
        entry = createConnectionEntry({
          key: fromPeerId,
          peerId: fromPeerId,
          kind: "mesh",
          initiator: false,
        });
        s.connections.set(fromPeerId, entry);
      }
      entry.relayPeerId = message.brokerPeerId || entry.relayPeerId || s.hostPeerId;

      try {
        if (message.signalKind === "offer") {
          await entry.pc.setRemoteDescription({ type: "offer", sdp: buildSdpFromBundle(message.bundle) });
          for (const candidate of message.bundle.c || []) {
            await entry.pc.addIceCandidate({ candidate, sdpMLineIndex: 0 });
            entry.remoteCandidatesAdded += 1;
          }

          const answer = await entry.pc.createAnswer();
          await entry.pc.setLocalDescription(answer);
          await waitForIceReady(entry);

          const bundle = createSignalBundle("AB", entry.pc.localDescription.sdp, entry.localCandidates);
          sendRelayToPeer(fromPeerId, {
            signalKind: "answer",
            bundle,
          }, entry.relayPeerId || s.hostPeerId);
          debugLog("mesh_answer_sent", {
            peerId: fromPeerId,
            broker: entry.relayPeerId || s.hostPeerId,
            cand: bundle.c.length,
          });
          assign({ statusText: `Answer brokered back to ${fromPeerId}.` });
          renderUi();
          return;
        }

        if (message.signalKind === "answer") {
          await entry.pc.setRemoteDescription({ type: "answer", sdp: buildSdpFromBundle(message.bundle) });
          for (const candidate of message.bundle.c || []) {
            await entry.pc.addIceCandidate({ candidate, sdpMLineIndex: 0 });
            entry.remoteCandidatesAdded += 1;
          }
          debugLog("mesh_answer_applied", { peerId: fromPeerId, cand: entry.remoteCandidatesAdded });
          assign({ statusText: `Mesh answer applied from ${fromPeerId}.` });
          renderUi();
        }
      } catch (error) {
        console.error("[rtcchat_v3] relayed signal error", error);
        debugLog("mesh_signal_error", {
          peerId: fromPeerId,
          kind: message.signalKind,
          msg: String(error?.message || error),
        });
        assign({ statusText: `Signal error with ${fromPeerId}: ${error?.message || error}` });
        scheduleMeshReconnect(fromPeerId, entry.relayPeerId || s.hostPeerId, entry.initiator, "signal-error");
        renderUi();
      }
    }

    function waitForIceReady(entry, timeoutMs = 1800, minCandidates = 2) {
      return new Promise((resolve) => {
        if (entry.pc.iceGatheringState === "complete" || entry.localCandidates.length >= minCandidates) {
          resolve();
          return;
        }

        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          entry.pc.removeEventListener("icegatheringstatechange", onChange);
          clearTimeout(timer);
          resolve();
        };

        const onChange = () => {
          if (entry.pc.iceGatheringState === "complete" || entry.localCandidates.length >= minCandidates) {
            finish();
          }
        };

        const timer = setTimeout(finish, timeoutMs);
        entry.pc.addEventListener("icegatheringstatechange", onChange);
      });
    }

    return {
      clearMeshReconnect,
      clearAllMeshReconnects,
      scheduleMeshReconnect,
      createConnectionEntry,
      wireDataChannel,
      sendHelloToHost,
      handleChannelMessage,
      handlePeerLeaving,
      removePeer,
      finalizeBootstrapPeer,
      handleRoomPeers,
      maybeStartMeshConnection,
      startMeshOffer,
      sendRelayToPeer,
      forwardRelaySignal,
      handleRelayedSignal,
      waitForIceReady,
    };
  }

  window.RtcChatV3MeshProtocol = {
    createMeshProtocol,
  };
})();
