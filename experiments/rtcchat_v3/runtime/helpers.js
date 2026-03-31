(() => {
  function createHelpers({ selfPeerId, identity }) {
    function sendJson(channel, value) {
      channel.send(JSON.stringify(value));
    }

    function getPeerInitial(name) {
      return identity.getUserInitial(name);
    }

    function getPeerProfile(peerId) {
      const presentUser = identity.getPresentUserForClient(peerId);
      return {
        id: peerId,
        name: presentUser.displayName,
        color: presentUser.color,
      };
    }

    function formatPeerList(peerIds) {
      return peerIds.map((peerId) => {
        const profile = getPeerProfile(peerId);
        return `${profile.name}`;
      }).join(", ");
    }

    function makeInviteId() {
      return `invite-${Math.random().toString(36).slice(2, 8)}`;
    }

    function makeMessageId() {
      return `${selfPeerId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    }

    function candidateToInit(candidate) {
      return {
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid ?? "0",
        sdpMLineIndex: candidate.sdpMLineIndex ?? 0,
      };
    }

    return {
      sendJson,
      getPeerInitial,
      getPeerProfile,
      formatPeerList,
      makeInviteId,
      makeMessageId,
      candidateToInit,
    };
  }

  window.RtcChatV3Helpers = {
    createHelpers,
  };
})();
