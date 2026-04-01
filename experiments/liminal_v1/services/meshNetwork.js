(() => {
  function createMeshNetworkService({
    config,
    clientId,
    sendSignal = async () => {},
    isTransportConnected = () => false,
    onStateChange = () => {},
    onData = () => {},
    onEvent = () => {},
  }) {
    const peers = new Map();
    let pruneTimer = null;
    const retryTimers = new Map();

    function start() {
      clearInterval(pruneTimer);
      pruneTimer = window.setInterval(() => {
        const now = Date.now();
        for (const entry of peers.values()) {
          if (entry.signalMode === "manual") {
            continue;
          }
          if (now - entry.lastSeenAt > config.PEER_STALE_AFTER_MS) {
            if (entry.dc?.readyState === "open" || entry.connectionState === "connected") {
              entry.presence = "offline";
              continue;
            }
            removePeer(entry.id);
          }
        }
        emitState();
      }, config.HEARTBEAT_INTERVAL_MS);
    }

    function stop() {
      clearInterval(pruneTimer);
      clearRetryTimers();
      for (const entry of peers.values()) {
        closePeerConnection(entry, true);
      }
      peers.clear();
      emitState("disconnected");
    }

    function handlePeerSeen({ id, lastSeenAt }) {
      const entry = ensurePeer(id);
      entry.lastSeenAt = lastSeenAt;
      entry.presence = "online";
      if (entry.connectionState === "failed" || entry.connectionState === "closed") {
        entry.retrying = true;
      }
      maybeInitiateConnection(entry).catch((error) => {
        console.warn("[liminal_v1] initiate error", error);
      });
      emitState();
    }

    function handlePeerLeft(peerId) {
      const entry = peers.get(peerId);
      if (!entry) {
        emitState();
        return;
      }

      if (entry.dc?.readyState === "open" || entry.connectionState === "connected") {
        entry.presence = "offline";
      } else {
        removePeer(peerId);
      }
      emitState();
    }

    async function handleSignal(message) {
      if (!message?.from || message.from === clientId) {
        return;
      }

      const entry = ensurePeer(message.from);
      entry.lastSeenAt = Date.now();
      const pc = ensurePeerConnection(entry);

      if (message.type === "offer") {
        await pc.setRemoteDescription(new RTCSessionDescription(message.description));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await flushQueuedCandidates(entry);
        await sendSignal(entry.id, {
          type: "answer",
          description: pc.localDescription,
        });
        return;
      }

      if (message.type === "answer") {
        if (pc.signalingState === "have-local-offer") {
          await pc.setRemoteDescription(new RTCSessionDescription(message.description));
          await flushQueuedCandidates(entry);
        }
        return;
      }

      if (message.type === "candidate") {
        const candidate = new RTCIceCandidate(message.candidate);
        if (pc.remoteDescription) {
          await pc.addIceCandidate(candidate);
        } else {
          entry.candidateQueue.push(candidate);
        }
      }
    }

    function ensurePeer(peerId) {
      if (peers.has(peerId)) {
        return peers.get(peerId);
      }

      const entry = {
        id: peerId,
        lastSeenAt: Date.now(),
        presence: "online",
        connectionState: "known",
        pc: null,
        dc: null,
        localCandidates: [],
        candidateQueue: [],
        makingOffer: false,
        retrying: false,
        signalMode: "mqtt",
      };
      peers.set(peerId, entry);
      return entry;
    }

    async function maybeInitiateConnection(entry) {
      if (clientId > entry.id) {
        return;
      }

      if (entry.pc && entry.connectionState !== "failed" && entry.connectionState !== "closed") {
        return;
      }

      const pc = ensurePeerConnection(entry);
      if (entry.makingOffer || pc.signalingState !== "stable") {
        return;
      }

      entry.makingOffer = true;
      entry.connectionState = "connecting";
      entry.signalMode = "mqtt";
      entry.localCandidates = [];
      emitState();

      try {
        createDataChannel(entry);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await sendSignal(entry.id, {
          type: "offer",
          description: pc.localDescription,
        });
      } finally {
        entry.makingOffer = false;
      }
    }

    function ensurePeerConnection(entry) {
      if (entry.pc) {
        return entry.pc;
      }

      const pc = new RTCPeerConnection({
        iceServers: config.ICE_SERVERS,
      });

      entry.pc = pc;
      entry.connectionState = "connecting";
      entry.localCandidates = [];

      pc.onicecandidate = ({ candidate }) => {
        if (!candidate) return;
        entry.localCandidates.push(candidate.candidate);
        if (entry.signalMode !== "mqtt") {
          return;
        }
        sendSignal(entry.id, {
          type: "candidate",
          candidate,
        }).catch(() => {});
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if (state === "connected") {
          entry.connectionState = "connected";
          entry.retrying = false;
          clearRetry(entry.id);
          onEvent({
            label: "Peer connected",
            detail: entry.id,
          });
        } else if (state === "failed" || state === "closed" || state === "disconnected") {
          entry.connectionState = state;
          closePeerConnection(entry, false);
          scheduleRetry(entry.id);
          onEvent({
            label: "Peer edge failed",
            detail: `${entry.id} ${state}`,
          });
        } else {
          entry.connectionState = state;
        }
        emitState();
      };

      pc.ondatachannel = (event) => {
        attachDataChannel(entry, event.channel);
      };

      return pc;
    }

    function createDataChannel(entry) {
      if (entry.dc) return entry.dc;
      const channel = entry.pc.createDataChannel("mesh");
      attachDataChannel(entry, channel);
      return channel;
    }

    function attachDataChannel(entry, channel) {
      entry.dc = channel;

      channel.onopen = () => {
        entry.connectionState = "connected";
        entry.retrying = false;
        clearRetry(entry.id);
        emitState();
      };

      channel.onmessage = (event) => {
        let payload = null;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }
        onData(payload, entry.id);
      };

      channel.onclose = () => {
        if (entry.connectionState !== "closed") {
          entry.connectionState = "closed";
        }
        scheduleRetry(entry.id);
        emitState();
      };
    }

    function broadcast(payload) {
      const message = JSON.stringify(payload);
      for (const entry of peers.values()) {
        if (entry.dc?.readyState === "open") {
          try {
            entry.dc.send(message);
          } catch {}
        }
      }
    }

    async function flushQueuedCandidates(entry) {
      while (entry.candidateQueue.length > 0) {
        const candidate = entry.candidateQueue.shift();
        try {
          await entry.pc.addIceCandidate(candidate);
        } catch {}
      }
    }

    function closePeerConnection(entry, removeChannel = true) {
      try {
        entry.dc?.close();
      } catch {}
      try {
        entry.pc?.close();
      } catch {}
      if (removeChannel) {
        entry.dc = null;
      }
      entry.pc = null;
      entry.localCandidates = [];
    }

    function removePeer(peerId) {
      const entry = peers.get(peerId);
      if (!entry) return;
      clearRetry(peerId);
      closePeerConnection(entry, true);
      peers.delete(peerId);
    }

    function scheduleRetry(peerId) {
      if (retryTimers.has(peerId)) return;
      const entry = peers.get(peerId);
      if (!entry || clientId > peerId) return;
      entry.retrying = true;
      emitState();

      const timer = window.setTimeout(() => {
        retryTimers.delete(peerId);
        const current = peers.get(peerId);
        if (!current) return;
        current.retrying = false;
        maybeInitiateConnection(current).catch((error) => {
          console.warn("[liminal_v1] retry initiate error", error);
        });
      }, config.RECONNECT_DELAY_MS);

      retryTimers.set(peerId, timer);
    }

    function clearRetry(peerId) {
      const timer = retryTimers.get(peerId);
      if (!timer) return;
      clearTimeout(timer);
      retryTimers.delete(peerId);
    }

    function clearRetryTimers() {
      for (const timer of retryTimers.values()) {
        clearTimeout(timer);
      }
      retryTimers.clear();
    }

    function emitState(status = null) {
      const peerList = Array.from(peers.values())
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((entry) => ({
          id: entry.id,
          connectionState: entry.connectionState,
          presence: entry.presence,
          connected: entry.dc?.readyState === "open",
          retrying: entry.retrying,
        }));

      onStateChange({
        clientId,
        status: status || deriveStatus(peerList),
        peers: peerList,
        connectedPeerCount: peerList.filter((peer) => peer.connected).length,
      });
    }

    function deriveStatus(peerList) {
      if (peerList.some((peer) => peer.connected)) return "connected";
      if (!isTransportConnected()) return "connecting";
      if (peerList.length > 0) return "connecting";
      return "online";
    }

    return {
      start,
      stop,
      handlePeerSeen,
      handlePeerLeft,
      handleSignal,
      emitState,
      broadcast,
      repairConnections() {
        for (const entry of peers.values()) {
          maybeInitiateConnection(entry).catch((error) => {
            console.warn("[liminal_v1] repair initiate error", error);
          });
        }
      },
      async createManualInvite(inviteId) {
        const entryKey = `manual:${inviteId}`;
        const entry = ensurePeer(entryKey);
        entry.signalMode = "manual";
        entry.localCandidates = [];
        entry.connectionState = "connecting";
        clearRetry(entryKey);
        closePeerConnection(entry, true);
        const pc = ensurePeerConnection(entry);
        createDataChannel(entry);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await waitForIceGathering(entry);
        return {
          inviteId,
          bundle: window.LiminalV1ManualCodec.createSignalBundle("OB", pc.localDescription.sdp, entry.localCandidates),
        };
      },
      async joinManualInvite({ inviteId, hostId, bundle }) {
        const entry = ensurePeer(hostId);
        entry.signalMode = "manual";
        entry.localCandidates = [];
        clearRetry(hostId);
        closePeerConnection(entry, true);
        const pc = ensurePeerConnection(entry);
        await pc.setRemoteDescription({
          type: "offer",
          sdp: window.LiminalV1ManualCodec.buildSdpFromBundle(bundle),
        });
        for (const candidate of bundle.c || []) {
          try {
            await pc.addIceCandidate({
              candidate,
              sdpMid: "0",
              sdpMLineIndex: 0,
            });
          } catch {}
        }
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await waitForIceGathering(entry);
        return {
          inviteId,
          bundle: window.LiminalV1ManualCodec.createSignalBundle("AB", pc.localDescription.sdp, entry.localCandidates),
        };
      },
      async applyManualResponse({ inviteId, responderId, bundle }) {
        const oldKey = `manual:${inviteId}`;
        const entry = peers.get(oldKey);
        if (!entry) {
          throw new Error("No pending manual invite was found.");
        }
        if (responderId) {
          peers.delete(oldKey);
          entry.id = responderId;
          entry.signalMode = "mqtt";
          peers.set(responderId, entry);
        }
        await entry.pc.setRemoteDescription({
          type: "answer",
          sdp: window.LiminalV1ManualCodec.buildSdpFromBundle(bundle),
        });
        for (const candidate of bundle.c || []) {
          try {
            await entry.pc.addIceCandidate({
              candidate,
              sdpMid: "0",
              sdpMLineIndex: 0,
            });
          } catch {}
        }
        emitState();
      },
    };

    async function waitForIceGathering(entry) {
      const pc = entry.pc;
      if (!pc) return;
      if (pc.iceGatheringState === "complete") {
        return;
      }
      await new Promise((resolve) => {
        const handle = () => {
          if (pc.iceGatheringState === "complete") {
            pc.removeEventListener("icegatheringstatechange", handle);
            resolve();
          }
        };
        pc.addEventListener("icegatheringstatechange", handle);
        window.setTimeout(() => {
          pc.removeEventListener("icegatheringstatechange", handle);
          resolve();
        }, 1500);
      });
    }
  }

  window.LiminalV1MeshNetwork = {
    createMeshNetworkService,
  };
})();
