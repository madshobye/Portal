(() => {
  const { el } = window.RtcChatV3DomUi;

  function createRtcChatView({ defaultRoomName, onToggleInfo, onClearInvite, onCopyLink, onAdvanceInvite, onApplyResponse, onSendMessage }) {
    const refs = {};

    refs.appEl = el("div", { className: "rtcchat-app" });
    refs.panelEl = el("div", { className: "rtcchat-panel" });

    refs.topToggleEl = el("button", {
      className: "rtcchat-top-toggle",
      props: { type: "button" },
      on: { click: onToggleInfo },
    });

    refs.statusCardEl = el("section", { className: "rtcchat-card rtcchat-status" });
    refs.titleEl = el("h1", { className: "rtcchat-title" });
    refs.statusTextEl = el("p", { className: "rtcchat-text" });
    refs.peersTextEl = el("p", { className: "rtcchat-text" });
    refs.connectionsTextEl = el("p", { className: "rtcchat-text" });
    refs.actionsEl = el("div", { className: "rtcchat-actions" });
    refs.statusCardEl.append(refs.titleEl, refs.statusTextEl, refs.peersTextEl, refs.connectionsTextEl, refs.actionsEl);

    refs.linkCardEl = el("section", { className: "rtcchat-card rtcchat-link-card", hidden: true });
    refs.linkTopRowEl = el("div", { className: "rtcchat-link-toprow" });
    refs.linkTitleEl = el("div", { className: "rtcchat-link-title", hidden: true });
    refs.linkAnchorEl = el("a", {
      className: "rtcchat-share-anchor",
      hidden: true,
      attrs: { href: "#", target: "_blank", rel: "noreferrer" },
    });
    refs.linkCloseBtnEl = el("button", {
      className: "rtcchat-link-close",
      props: { type: "button" },
      text: "×",
      attrs: { "aria-label": "Close link panel" },
      on: { click: onClearInvite },
    });
    refs.linkTextEl = el("input", {
      className: "rtcchat-link",
      props: { type: "text", readOnly: true, spellcheck: false },
    });
    refs.linkCopyBtnEl = el("button", {
      className: "rtcchat-btn",
      props: { type: "button" },
      text: "Copy Link",
      on: { click: onCopyLink },
    });
    refs.linkNextBtnEl = el("button", {
      className: "rtcchat-btn secondary",
      props: { type: "button" },
      text: "Next",
      on: { click: onAdvanceInvite },
    });
    refs.linkTopRowEl.append(refs.linkTitleEl, refs.linkAnchorEl, refs.linkCloseBtnEl);
    refs.linkCardEl.append(refs.linkTopRowEl, refs.linkTextEl, refs.linkCopyBtnEl, refs.linkNextBtnEl);

    refs.responsePasteCardEl = el("section", {
      className: "rtcchat-card rtcchat-link-card rtcchat-response-card",
      hidden: true,
    });
    refs.responseTopRowEl = el("div", { className: "rtcchat-link-toprow" });
    refs.responseCloseBtnEl = el("button", {
      className: "rtcchat-link-close",
      props: { type: "button" },
      text: "×",
      attrs: { "aria-label": "Close response panel" },
      on: { click: onClearInvite },
    });
    refs.responseTopRowEl.append(refs.responseCloseBtnEl);
    refs.responsePasteInputEl = el("input", {
      className: "rtcchat-link",
      props: { type: "text", spellcheck: false },
      attrs: { placeholder: "Paste response link here…" },
      on: {
        keydown: (event) => {
          if (event.key === "Enter") onApplyResponse();
        },
      },
    });
    refs.responsePasteBtnEl = el("button", {
      className: "rtcchat-btn",
      props: { type: "button" },
      text: "Apply Response",
      on: { click: onApplyResponse },
    });
    refs.responsePasteCardEl.append(refs.responseTopRowEl, refs.responsePasteInputEl, refs.responsePasteBtnEl);

    refs.stageEl = el("section", { className: "rtcchat-stage" });
    refs.qrImageEl = el("img", {
      className: "rtcchat-qr-image",
      hidden: true,
      attrs: { alt: "QR code", decoding: "async" },
    });
    refs.stageCardEl = el("div", { className: "rtcchat-stage-card" }, [refs.qrImageEl]);
    refs.stageEl.append(refs.stageCardEl);

    refs.chatCardEl = el("section", { className: "rtcchat-card rtcchat-chat", hidden: true });
    refs.messagesEl = el("div", { className: "rtcchat-messages" });
    refs.composerEl = el("div", { className: "rtcchat-composer" });
    refs.composerInputEl = el("input", {
      className: "rtcchat-input",
      props: { type: "text" },
      attrs: { placeholder: `Type into ${defaultRoomName}…` },
      on: {
        keydown: (event) => {
          if (event.key === "Enter") onSendMessage();
        },
      },
    });
    refs.sendBtnEl = el("button", {
      className: "rtcchat-btn",
      props: { type: "button" },
      text: "Send",
      on: { click: onSendMessage },
    });
    refs.composerEl.append(refs.composerInputEl, refs.sendBtnEl);
    refs.chatCardEl.append(refs.messagesEl, refs.composerEl);

    refs.panelEl.append(
      refs.topToggleEl,
      refs.statusCardEl,
      refs.linkCardEl,
      refs.responsePasteCardEl,
      refs.stageEl,
      refs.chatCardEl
    );
    refs.appEl.append(refs.panelEl);
    document.body.appendChild(refs.appEl);

    function renderChrome(model) {
      refs.topToggleEl.textContent = model.topToggleLabel;
      refs.statusCardEl.hidden = !model.topPanelVisible;

      refs.titleEl.textContent = model.titleText;
      refs.titleEl.style.setProperty("--rtcchat-accent", model.titleColor || "inherit");
      refs.statusTextEl.textContent = model.statusText;
      refs.peersTextEl.textContent = model.peersText;
      refs.connectionsTextEl.textContent = model.connectionsText;

      refs.panelEl.classList.toggle("qr-mode", model.qrMode);
      refs.statusCardEl.classList.toggle("qr-mode", model.qrMode);
      refs.titleEl.classList.toggle("qr-mode", model.qrMode);
      refs.statusTextEl.classList.toggle("qr-mode", model.qrMode);
      refs.actionsEl.classList.toggle("qr-mode", model.qrMode);

      refs.linkCardEl.hidden = !(model.showInviteLink && model.shareLink);
      refs.responsePasteCardEl.hidden = !model.showResponsePaste;
      refs.stageEl.classList.toggle("active", model.qrMode);
      refs.qrImageEl.hidden = !model.showQrImage;
      refs.qrImageEl.src = model.qrImageSrc || "";

      refs.linkTitleEl.hidden = true;
      refs.linkAnchorEl.hidden = true;
      refs.linkTextEl.value = model.shareLink || "";
      refs.linkAnchorEl.href = model.shareLink || "#";
      refs.linkCopyBtnEl.disabled = !model.shareLink;
      refs.linkNextBtnEl.disabled = !model.shareLink;

      refs.chatCardEl.hidden = !model.showChat;
      refs.composerInputEl.disabled = !model.showChat;
      refs.sendBtnEl.disabled = !model.showChat;
      refs.actionsEl.replaceChildren(...model.actions.map((action) => {
        return el("button", {
          className: action.secondary ? "rtcchat-btn secondary" : "rtcchat-btn",
          props: { type: "button", disabled: !!action.disabled },
          text: action.label,
          on: { click: action.onClick },
        });
      }));
    }

    function renderMessages(messages, { getPeerProfile, getPeerInitial, onRendered }) {
      refs.messagesEl.replaceChildren(...messages.map((msg) => {
        if (msg.type === "system") {
          return el("div", {
            className: "rtcchat-bubble system",
            text: msg.text,
          });
        }

        const profile = getPeerProfile(msg.authorId);
        const avatar = el("div", {
          className: "rtcchat-avatar",
          text: getPeerInitial(profile.name),
        });
        avatar.style.setProperty("--rtcchat-avatar-bg", profile.color);

        const meta = el("div", { className: "rtcchat-meta", text: profile.name });
        const body = el("div", { text: msg.text });
        const bubble = el("div", { className: `rtcchat-bubble ${msg.type}` }, [meta, body]);
        return el("div", { className: `rtcchat-message ${msg.type}` }, [avatar, bubble]);
      }));

      if (typeof onRendered === "function") onRendered();
    }

    return {
      refs,
      renderChrome,
      renderMessages,
    };
  }

  window.RtcChatV3View = {
    createRtcChatView,
  };
})();
