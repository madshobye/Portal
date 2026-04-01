(() => {
  function createManualOnboardingService({
    config,
    clientId,
    meshNetwork,
    actions,
  }) {
    const codec = window.LiminalV1ManualCodec;

    async function start() {
      await handleIncomingLink();
    }

    async function showInvite() {
      const inviteId = makeInviteId();
      actions.setManualOnboarding({
        visible: true,
        mode: "invite",
        title: "QR Invite Ready",
        text: "Scan this code or open the link on another client, then paste the response here.",
        link: "",
        qrImageSrc: "",
        inviteId,
        pendingPeerId: "",
      });

      try {
        const result = await meshNetwork.createManualInvite(inviteId);
        const bundleString = codec.toBundleString(result.bundle);
        const link = codec.buildInviteLink(bundleString, config.DEFAULT_ROOM_NAME, inviteId, clientId);
        const qr = window.LiminalV1Qr.encodeQr(link);
        actions.setManualOnboarding({
          visible: true,
          mode: "invite",
          title: "QR Invite Ready",
          text: "Scan this code or open the link on another client, then paste the response here.",
          link,
          qrImageSrc: codec.qrCodeToSvgDataUrl(qr),
          inviteId,
          pendingPeerId: "",
        });
        actions.addEvent({
          label: "QR invite ready",
          detail: inviteId,
        });
      } catch (error) {
        actions.addEvent({
          label: "QR invite failed",
          detail: String(error?.message || error),
        });
        actions.setManualOnboarding({
          visible: true,
          mode: "invite",
          title: "QR Invite Failed",
          text: String(error?.message || error),
          link: "",
          qrImageSrc: "",
          inviteId,
          pendingPeerId: "",
        });
      }
    }

    async function applyResponse(raw) {
      const state = actions.getState();
      const inviteId = state.manualOnboarding?.inviteId;
      if (!inviteId) {
        throw new Error("No pending invite is waiting for a response.");
      }

      const candidateRaw = String(raw || state.manualOnboarding?.responseValue || "").trim();
      if (!candidateRaw) {
        throw new Error("Paste a response link first.");
      }

      actions.setManualOnboarding({
        visible: true,
        mode: "invite",
        title: "Applying Response",
        text: "Applying response and waiting for the peer connection...",
      });

      const responseValue = codec.extractValue(candidateRaw, "response");
      const responseUrl = /^https?:\/\//i.test(candidateRaw) ? new URL(candidateRaw) : null;
      const responderId = responseUrl?.searchParams.get("peer") || state.manualOnboarding?.pendingPeerId || "";
      const bundle = codec.fromBundleString(responseValue);

      await meshNetwork.applyManualResponse({
        inviteId,
        responderId,
        bundle,
      });

      actions.addEvent({
        label: "QR response applied",
        detail: inviteId,
      });
      clear();
    }

    function clear() {
      actions.setManualOnboarding({
        visible: false,
        mode: "hidden",
        title: "",
        text: "",
        link: "",
        qrImageSrc: "",
        inviteId: "",
        pendingPeerId: "",
        responseValue: "",
      });
    }

    async function handleIncomingLink() {
      const url = new URL(window.location.href);
      const connectValue = url.searchParams.get("connect");
      const responseValue = url.searchParams.get("response");
      const inviteId = url.searchParams.get("invite") || "";
      const roomId = url.searchParams.get("room") || config.DEFAULT_ROOM_NAME;
      const hostId = url.searchParams.get("host") || "";
      const peerId = url.searchParams.get("peer") || clientId;

      if (connectValue && inviteId && hostId) {
        await joinFromInvite({
          inviteId,
          hostId,
          roomId,
          connectValue,
        });
        clearIncomingParams();
        return true;
      }

      if (responseValue && inviteId) {
        actions.setManualOnboarding({
          visible: true,
          mode: "response",
          title: "QR Response Ready",
          text: "Return to the original inviter and paste or open this response link there.",
          link: String(url),
          qrImageSrc: codec.qrCodeToSvgDataUrl(window.LiminalV1Qr.encodeQr(String(url))),
          inviteId,
          pendingPeerId: peerId,
          responseValue,
        });
        clearIncomingParams();
        return true;
      }

      return false;
    }

    async function joinFromInvite({ inviteId, hostId, roomId, connectValue }) {
      const offerBundle = codec.fromBundleString(connectValue);
      const result = await meshNetwork.joinManualInvite({
        inviteId,
        hostId,
        roomId,
        bundle: offerBundle,
      });
      const responseValue = codec.toBundleString(result.bundle);
      const link = codec.buildResponseLink(responseValue, roomId, inviteId, clientId);
      const qr = window.LiminalV1Qr.encodeQr(link);
      actions.setManualOnboarding({
        visible: true,
        mode: "response",
        title: "QR Response Ready",
        text: "Return to the inviter and paste or scan this response there.",
        link,
        qrImageSrc: codec.qrCodeToSvgDataUrl(qr),
        inviteId,
        pendingPeerId: clientId,
        responseValue,
      });
      actions.addEvent({
        label: "QR response ready",
        detail: inviteId,
      });
    }

    async function copyLink(value) {
      if (!value) return;
      await navigator.clipboard?.writeText(value).catch(() => {});
      const state = actions.getState();
      const mode = state.manualOnboarding?.mode || "hidden";
      actions.addEvent({
        label: "Link copied",
        detail: state.manualOnboarding?.inviteId || "",
      });
      if (mode === "response") {
        clear();
        return;
      }

      actions.setManualOnboarding({
        visible: true,
        mode,
        title: state.manualOnboarding?.title || "QR Onboarding",
        text: "Link copied. Keep this panel open until you apply the response.",
      });
    }

    function clearIncomingParams() {
      const url = new URL(window.location.href);
      if (url.search) {
        url.search = "";
        window.history.replaceState({}, "", url.toString());
      }
    }

    function makeInviteId() {
      return `invite-${Math.random().toString(36).slice(2, 8)}`;
    }

    return {
      start,
      showInvite,
      applyResponse,
      clear,
      copyLink,
    };
  }

  window.LiminalV1ManualOnboardingService = {
    createManualOnboardingService,
  };
})();
