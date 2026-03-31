window.addEventListener("DOMContentLoaded", () => {
  window.RtcChatV3App.setup().catch((error) => {
    console.error("[rtcchat_v3] setup error", error);
  });
});

window.addEventListener("resize", () => {
  window.RtcChatV3App.windowResized();
});
