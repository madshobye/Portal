(() => {
  function createManualOnboarding({
    onClose = () => {},
    onApplyResponse = () => {},
    onCopyLink = () => {},
    onResponseInput = () => {},
  } = {}) {
    let shell;
    let card;
    let title;
    let text;
    let qrImage;
    let linkInput;
    let linkRow;
    let responseInput;
    let responseRow;
    let copyButton;
    let applyButton;
    let closeButton;

    function create(parent) {
      shell = parent.addAppShell();
      card = window.LiminalV1Base.createCardSection({
        className: "rtcchat-link-card liminal-manual-card",
        title: "QR Onboarding",
      });
      text = window.LiminalV1Base.createText("p", "rtcchat-text", "");
      qrImage = document.createElement("img");
      qrImage.className = "liminal-qr-image";
      qrImage.alt = "QR code";
      qrImage.hidden = true;

      linkInput = document.createElement("input");
      linkInput.className = "rtcchat-link";
      linkInput.type = "text";
      linkInput.readOnly = true;
      linkInput.spellcheck = false;

      copyButton = window.LiminalV1Base.createActionButton("Copy", "rtcchat-btn");
      copyButton.onClick(() => onCopyLink(linkInput.value));

      linkRow = document.createElement("div");
      linkRow.className = "liminal-link-row";
      linkRow.append(linkInput, copyButton.element);

      responseRow = document.createElement("div");
      responseRow.className = "liminal-response-row";
      responseInput = document.createElement("input");
      responseInput.className = "rtcchat-link";
      responseInput.type = "text";
      responseInput.spellcheck = false;
      responseInput.placeholder = "Paste response link here…";
      responseInput.addEventListener("input", () => {
        onResponseInput(responseInput.value);
      });

      applyButton = window.LiminalV1Base.createActionButton("Apply Response", "rtcchat-btn");
      closeButton = window.LiminalV1Base.createActionButton("Close", "rtcchat-btn secondary");
      applyButton.onClick(() => onApplyResponse(responseInput.value));
      closeButton.onClick(() => onClose());

      responseRow.append(responseInput, applyButton.element);
      card.append(text, qrImage, linkRow, responseRow);
      shell.element.append(card.element);
      card.element.append(createActionsRow());
      card.element.hidden = true;
      title = card;
      return card.element;
    }

    function createActionsRow() {
      const actions = document.createElement("div");
      actions.className = "rtcchat-actions";
      actions.append(closeButton.element);
      return actions;
    }

    function update({
      visible = false,
      titleText = "QR Onboarding",
      bodyText = "",
      link = "",
      qrImageSrc = "",
      mode = "hidden",
      responseValue = "",
    } = {}) {
      title.setTitle(titleText);
      text.setText(bodyText);
      card.element.hidden = !visible;
      linkInput.value = link || "";
      linkRow.hidden = !link;
      qrImage.hidden = !qrImageSrc;
      qrImage.src = qrImageSrc || "";
      responseRow.hidden = mode !== "invite";
      applyButton.setDisabled(mode !== "invite");
      if (responseInput.value !== (responseValue || "")) {
        responseInput.value = responseValue || "";
      }
      copyButton.setDisabled(!link);
    }

    function destroy() {
      card?.remove();
    }

    return {
      create,
      update,
      destroy,
      getResponseValue() {
        return responseInput?.value || "";
      },
      setResponseValue(value) {
        if (responseInput) {
          responseInput.value = value || "";
        }
      },
    };
  }

  window.LiminalV1ManualOnboarding = {
    createManualOnboarding,
  };
})();
