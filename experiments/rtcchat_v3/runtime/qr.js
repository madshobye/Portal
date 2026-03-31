(() => {
  function encodeQr(text) {
    if (typeof globalThis.createQRCode === "function") {
      return globalThis.createQRCode(String(text || ""));
    }
    if (typeof globalThis.qrcodegenSetup === "function") {
      globalThis.qrcodegenSetup();
    }
    const lib = globalThis.qrcodegen?.QrCode;
    if (!lib) {
      throw new Error("qrcodegen is not loaded");
    }
    return lib.encodeText(String(text || ""), lib.Ecc.MEDIUM);
  }

  window.RtcChatV3Qr = {
    encodeQr,
  };
})();
