export function createMqttSigninDialogController({
  dialog,
  title,
  form,
  usernameInput,
  passwordInput,
  cancelButton,
  remoteIdForAuth,
  normalizePeerId,
  deriveOnlineAuthKeyHex,
}) {
  function request({ remoteId, hello } = {}) {
    return new Promise((resolve, reject) => {
      if (!dialog) {
        reject(new Error("MQTT sign in required"));
        return;
      }
      const target = normalizePeerId(remoteId || remoteIdForAuth());
      const authDeviceId = normalizePeerId(hello?.deviceId || target);
      if (!target) {
        reject(new Error("MQTT board id is required for sign in"));
        return;
      }

      title.textContent = `MQTT sign in: ${target}`;
      form?.reset();
      usernameInput.value = "";
      usernameInput.defaultValue = "";
      passwordInput.value = "";
      passwordInput.defaultValue = "";

      const cleanup = () => {
        form?.removeEventListener("submit", submit);
        cancelButton?.removeEventListener("click", cancel);
        dialog.removeEventListener("cancel", cancel);
        dialog.removeEventListener("close", onClose);
      };
      const cancel = () => {
        cleanup();
        if (dialog.open) dialog.close("cancel");
        reject(new Error("MQTT sign in cancelled"));
      };
      const onClose = () => {
        if (dialog.returnValue === "ok") return;
        cleanup();
        reject(new Error("MQTT sign in cancelled"));
      };
      const submit = async (event) => {
        event?.preventDefault?.();
        const username = usernameInput.value.trim();
        const password = passwordInput.value;
        if (!username || !password) return;
        try {
          const keyHex = await deriveOnlineAuthKeyHex(authDeviceId, username, password);
          cleanup();
          if (dialog.open) dialog.close("ok");
          resolve({ username, keyHex });
        } catch (error) {
          cleanup();
          if (dialog.open) dialog.close("cancel");
          reject(error);
        } finally {
          passwordInput.value = "";
        }
      };

      form?.addEventListener("submit", submit);
      cancelButton?.addEventListener("click", cancel);
      dialog.addEventListener("cancel", cancel);
      dialog.addEventListener("close", onClose);
      dialog.showModal();
      usernameInput.focus();
    });
  }

  return { request };
}
