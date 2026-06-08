export function createRevisionNameDialog({
  dialog,
  input,
  createButton,
  cancelButton,
  normalizeName,
} = {}) {
  function requestName(defaultName = "Revision") {
    const fallback = normalizeName(defaultName) || "Revision";
    if (!dialog || !input) {
      const requested = window.prompt("Revision name", fallback);
      return Promise.resolve(requested === null ? null : (normalizeName(requested) || fallback));
    }
    input.value = fallback;
    return new Promise((resolve) => {
      let settled = false;
      const cleanup = () => {
        dialog.removeEventListener("close", onClose);
        dialog.removeEventListener("cancel", onCancel);
        input.removeEventListener("keydown", onKeydown);
        createButton?.removeEventListener("click", onCreate);
        cancelButton?.removeEventListener("click", onCancel);
      };
      const finish = (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const onClose = () => {
        if (dialog.returnValue === "ok") {
          finish(normalizeName(input.value) || fallback);
        } else {
          finish(null);
        }
      };
      const onCancel = (event) => {
        event?.preventDefault?.();
        if (dialog.open) dialog.close("cancel");
      };
      const onCreate = () => {
        if (dialog.open) dialog.close("ok");
      };
      const onKeydown = (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onCreate();
        }
      };
      dialog.addEventListener("close", onClose);
      dialog.addEventListener("cancel", onCancel);
      input.addEventListener("keydown", onKeydown);
      createButton?.addEventListener("click", onCreate);
      cancelButton?.addEventListener("click", onCancel);
      dialog.showModal();
      window.setTimeout(() => {
        input.focus();
        input.select();
      }, 0);
    });
  }

  return { requestName };
}
