window.GrumpyNurseV3FaceView = (() => {
  let faceAnimation = null;
  let canvasDebugVisible = false;
  let faceDebugState = null;

  function create() {
    if (!window.PortalFaceAnimation) return null;
    faceAnimation = new PortalFaceAnimation({
      skinTone: [240, 228, 214],
      paperTone: [236, 233, 225],
      inkTone: [17, 17, 17],
      accentTone: [216, 31, 38],
      hairTone: [18, 20, 24],
    });
    return faceAnimation;
  }

  function update({ currentMood, conversationStarted, askInFlight, speaking, listening }) {
    if (!faceAnimation) return;

    const thinking = askInFlight ? 1 : 0;
    const waitingForUser = conversationStarted && !thinking && !speaking && !!listening;

    let valence = currentMood.valence;
    let arousal = currentMood.arousal;
    let dominance = currentMood.dominance;
    let tension = currentMood.tension;
    let gazeX = 0;
    let gazeY = -0.05;
    let headTurn = 0;
    let headTilt = 0;
    let headPitch = 0;

    if (!conversationStarted) {
      valence = currentMood.valence * 0.5;
      arousal = Math.min(0.05, currentMood.arousal * 0.3);
      dominance = currentMood.dominance * 0.35;
      tension = currentMood.tension * 0.45;
      gazeY = -0.15;
    } else if (thinking) {
      arousal += 0.08;
      tension += 0.12;
      gazeX = -0.38;
      gazeY = -0.18;
      headTurn = -0.18;
    } else if (speaking) {
      arousal += 0.14;
      dominance += 0.12;
      tension += 0.12;
      gazeY = -0.02;
      headPitch = 0.06;
    } else if (waitingForUser || listening) {
      gazeX = 0.06 * Math.sin(frameCount * 0.02);
      gazeY = 0.02;
      headTilt = 0.04 * Math.sin(frameCount * 0.018);
    }

    valence = constrain(valence, -1, 1);
    arousal = constrain(arousal, -1, 1);
    dominance = constrain(dominance, -1, 1);
    tension = constrain(tension, 0, 1);

    const appliedListening = listening ? 1 : waitingForUser ? 0.5 : 0;

    faceAnimation.setTarget({
      valence,
      arousal,
      dominance,
      tension,
      speaking: speaking ? 1 : 0,
      listening: appliedListening,
      thinking,
      gazeX,
      gazeY,
      headTurn,
      headTilt,
      headPitch,
    });

    faceDebugState = {
      currentMood: { ...currentMood },
      applied: {
        valence,
        arousal,
        dominance,
        tension,
        speaking: speaking ? 1 : 0,
        listening: appliedListening,
        thinking,
        gazeX,
        gazeY,
        headTurn,
        headTilt,
        headPitch,
      },
      status: {
        conversationStarted,
        waitingForUser,
        speechListening: !!listening,
        speechOutput: !!speaking,
        askInFlight: !!askInFlight,
      },
    };
  }

  function render({ deltaSeconds, x, y, w, h }) {
    if (!faceAnimation) return;
    faceAnimation.update(deltaSeconds);
    faceAnimation.render({ x, y, w, h });
  }

  function toggleDebug() {
    canvasDebugVisible = !canvasDebugVisible;
  }

  function drawDebugOverlay() {
    if (!canvasDebugVisible) return;
    const mood = faceDebugState?.currentMood || {};
    const applied = faceDebugState?.applied || {};
    const status = faceDebugState?.status || {};
    const lines = [
      "Face Debug",
      `mood: ${String(mood.label || "grumpy")}`,
      `valence: ${Number(mood.valence || 0).toFixed(2)}`,
      `arousal: ${Number(mood.arousal || 0).toFixed(2)}`,
      `dominance: ${Number(mood.dominance || 0).toFixed(2)}`,
      `tension: ${Number(mood.tension || 0).toFixed(2)}`,
      "",
      `speaking: ${Number(applied.speaking || 0).toFixed(2)}`,
      `listening: ${Number(applied.listening || 0).toFixed(2)}`,
      `thinking: ${Number(applied.thinking || 0).toFixed(2)}`,
      "",
      `started: ${status.conversationStarted ? "yes" : "no"}`,
      `waiting: ${status.waitingForUser ? "yes" : "no"}`,
      `speech listening: ${status.speechListening ? "yes" : "no"}`,
      `speech output: ${status.speechOutput ? "yes" : "no"}`,
      `ask in flight: ${status.askInFlight ? "yes" : "no"}`,
    ];

    push();
    noStroke();
    fill(17, 17, 17, 210);
    rect(18, 18, Math.min(280, width - 36), Math.min(272, height - 36), 12);
    fill(247, 245, 239);
    textAlign(LEFT, TOP);
    textFont("Helvetica Neue");
    textSize(12);
    textLeading(16);
    text(lines.join("\n"), 32, 32, Math.min(248, width - 64), Math.min(240, height - 64));
    pop();
  }

  return {
    create,
    update,
    render,
    toggleDebug,
    drawDebugOverlay,
  };
})();
