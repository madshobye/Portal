(() => {
  function createViewportRuntime({ getMessagesEl, onLayout }) {
    function updateViewportHeight() {
      const top = window.visualViewport?.offsetTop || 0;
      const height = window.visualViewport?.height || window.innerHeight;
      document.documentElement.style.setProperty("--rtcchat-app-top", `${Math.round(top)}px`);
      document.documentElement.style.setProperty("--rtcchat-app-height", `${Math.round(height)}px`);
    }

    function keepChatVisible() {
      const messagesEl = getMessagesEl();
      if (!messagesEl) return;
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function handleViewportChange() {
      updateViewportHeight();
      keepChatVisible();
      onLayout();
    }

    function requestViewportRefresh() {
      const delays = [0, 80, 180, 320];
      for (const delay of delays) {
        setTimeout(() => {
          updateViewportHeight();
          keepChatVisible();
          onLayout();
        }, delay);
      }
    }

    function installViewportTracking() {
      updateViewportHeight();
      if (window.visualViewport) {
        window.visualViewport.addEventListener("resize", handleViewportChange);
        window.visualViewport.addEventListener("scroll", handleViewportChange);
      }
    }

    return {
      installViewportTracking,
      handleViewportChange,
      updateViewportHeight,
      keepChatVisible,
      requestViewportRefresh,
    };
  }

  window.RtcChatV3Viewport = {
    createViewportRuntime,
  };
})();
