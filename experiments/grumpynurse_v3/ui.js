window.GrumpyNurseV3UI = (() => {
  function buildUi(actions = {}) {
    const refs = {};

    refs.appRoot = createDiv("");
    refs.appRoot.id("grumpy-nurse-app");

    refs.shellEl = createDiv("");
    refs.shellEl.class("gn-shell");
    refs.shellEl.parent(refs.appRoot);

    refs.adminEl = createDiv("");
    refs.adminEl.class("gn-admin");
    refs.adminEl.parent(refs.shellEl);

    const header = createDiv("");
    header.class("gn-header");
    header.parent(refs.adminEl);

    const titleWrap = createDiv("");
    titleWrap.parent(header);

    const title = createDiv("Grumpy Nurse 3");
    title.class("gn-title");
    title.parent(titleWrap);

    const subtitle = createDiv("Exhibition voice roleplay.");
    subtitle.class("gn-subtitle");
    subtitle.parent(titleWrap);

    const headerRight = createDiv("");
    headerRight.class("gn-header-right");
    headerRight.parent(header);

    refs.statusEl = createDiv("Loading...");
    refs.statusEl.class("gn-status");
    refs.statusEl.parent(headerRight);

    const toolbar = createDiv("");
    toolbar.class("gn-toolbar");
    toolbar.parent(headerRight);

    refs.modelSelectEl = createSelect();
    refs.modelSelectEl.parent(toolbar);
    refs.modelSelectEl.class("gn-btn gn-btn-secondary");

    refs.languageSelectEl = createSelect();
    refs.languageSelectEl.parent(toolbar);
    refs.languageSelectEl.class("gn-btn gn-btn-secondary");

    refs.voiceSelectEl = createSelect();
    refs.voiceSelectEl.parent(toolbar);
    refs.voiceSelectEl.class("gn-btn gn-btn-secondary");

    refs.debugButton = createButton("Debug: OFF");
    refs.debugButton.parent(toolbar);
    refs.debugButton.class("gn-btn gn-btn-secondary");
    refs.debugButton.mousePressed(() => {
      actions.onToggleDebug?.();
    });

    refs.listenButton = createButton("Start Listening");
    refs.listenButton.parent(toolbar);
    refs.listenButton.class("gn-btn gn-btn-secondary");
    refs.listenButton.mousePressed(() => {
      actions.onToggleListening?.();
    });

    const consoleTitle = createDiv("Console");
    consoleTitle.class("gn-console-title");
    consoleTitle.parent(refs.adminEl);

    refs.adminConsoleEl = createDiv("");
    refs.adminConsoleEl.class("gn-console");
    refs.adminConsoleEl.parent(refs.adminEl);

    refs.mainEl = createDiv("");
    refs.mainEl.class("gn-main");
    refs.mainEl.parent(refs.shellEl);

    refs.conversationEl = createDiv("");
    refs.conversationEl.class("gn-conversation");
    refs.conversationEl.parent(refs.mainEl);

    refs.canvasColumnEl = createDiv("");
    refs.canvasColumnEl.class("gn-canvas-column");
    refs.canvasColumnEl.parent(refs.conversationEl);

    refs.canvasHostEl = createDiv("");
    refs.canvasHostEl.class("gn-canvas-host");
    refs.canvasHostEl.parent(refs.canvasColumnEl);

    refs.taskEl = null;
    refs.chatEl = null;
    refs.optionsEl = null;
    refs.introEl = null;
    refs.startConversationButton = null;
    refs.adminToggleButton = null;

    return refs;
  }

  return {
    buildUi,
  };
})();
