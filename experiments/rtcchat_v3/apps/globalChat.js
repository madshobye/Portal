(() => {
  function createGlobalChatRuntime(deps) {
    const {
      SELF_PEER_ID,
      SELF_PROFILE,
      getState,
      renderMessages,
      renderUi,
      debugLog,
      makeMessageId,
      sendJson,
    } = deps;

    const chatMessages = [];
    const seenChatIds = new Set();

    function state() {
      return getState();
    }

    function getMessages() {
      return chatMessages;
    }

    function sendMessage(textOverride = null) {
      const s = state();
      const text = String(textOverride ?? s.composerInputEl?.value ?? "").trim();
      if (!text) return;

      const msg = {
        type: "chat",
        id: makeMessageId(),
        from: SELF_PEER_ID,
        fromName: SELF_PROFILE.displayName,
        fromColor: SELF_PROFILE.color,
        text,
      };

      let sent = 0;
      for (const entry of s.connections.values()) {
        if (entry.dc?.readyState === "open") {
          sendJson(entry.dc, msg);
          sent += 1;
        }
      }

      if (sent > 0) {
        seenChatIds.add(msg.id);
        addChatMessage("self", text, SELF_PEER_ID);
        if (s.composerInputEl) s.composerInputEl.value = "";
        debugLog("chat_send", { sent, len: text.length });
        s.setStatusText?.(`Sent to ${sent} peer${sent === 1 ? "" : "s"}.`);
        renderUi();
      }
    }

    function handleIncomingChat(message) {
      if (!message.id || seenChatIds.has(message.id)) return;
      seenChatIds.add(message.id);
      debugLog("chat_recv", { from: message.from, len: String(message.text || "").length });
      addChatMessage("peer", message.text, message.from);
    }

    function addSystemMessage(text) {
      chatMessages.push({ type: "system", text });
      renderMessages();
    }

    function addChatMessage(type, text, authorId = SELF_PEER_ID) {
      chatMessages.push({ type, text, authorId });
      renderMessages();
    }

    return {
      getMessages,
      sendMessage,
      handleIncomingChat,
      addSystemMessage,
      addChatMessage,
    };
  }

  window.RtcChatV3GlobalChat = {
    createGlobalChatRuntime,
  };
})();
