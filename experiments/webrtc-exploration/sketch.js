let pc = null;
let dc = null;

let role = "idle"; // idle | starter | joiner
let stage = "idle"; // idle | making-offer | waiting-answer | waiting-offer | making-answer | connecting | connected
let statusText = "Choose Start or Join.";
let localCandidates = [];
let remoteCandidatesAdded = 0;

async function setup() {
  createCanvas(windowWidth, windowHeight);
  textFont("monospace");
  textSize(14);

  await loadScript("portal/uiSlim2.js");
}

function draw() {
  background(245);

  drawStatus();
  drawControls();
}

function drawStatus() {
  fill(20);
  noStroke();
  textSize(24);
  text("WebRTC Exploration", 28, 42);

  textSize(14);
  fill(40);
  text(`Role: ${role}`, 28, 78);
  text(`Stage: ${stage}`, 28, 102);
  text(`Status: ${statusText}`, 28, 126);
  text(`Local ICE gathered: ${localCandidates.length}`, 28, 150);
  text(`Remote ICE added: ${remoteCandidatesAdded}`, 28, 174);
  text(`Connection: ${pc?.connectionState || "-"}`, 28, 198);
  text(`DataChannel: ${dc?.readyState || "-"}`, 28, 222);

  fill(70);
  text("Console output:", 28, 264);
  text("- compact copy/paste string", 28, 288);
  text("- readable JSON summary", 28, 312);
  text("- parsed JSON summary when you paste", 28, 336);
}

function drawControls() {
  uiListStart({ x: 28, y: 380, width: 260, dir: "vertical" });
  uiText("Actions", { bgColor: "#e5e7eb", hAlign: "center" });

  if (role === "idle") {
    if (uiButton("Start Connection").clicked) {
      startAsStarter();
    }
    if (uiButton("Join Connection").clicked) {
      prepareJoiner();
    }
  } else if (role === "starter" && stage === "waiting-answer") {
    if (uiButton("Paste Answer Bundle").clicked) {
      pasteAnswerBundle();
    }
  } else if (role === "joiner" && stage === "waiting-offer") {
    if (uiButton("Paste Offer Bundle").clicked) {
      pasteOfferBundle();
    }
  }

  if (role !== "idle") {
    if (uiButton("Reset").clicked) {
      resetConnection();
    }
  }

  uiListEnd();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function resetConnection() {
  try {
    dc?.close?.();
  } catch {}
  try {
    pc?.close?.();
  } catch {}

  pc = null;
  dc = null;
  role = "idle";
  stage = "idle";
  statusText = "Choose Start or Join.";
  localCandidates = [];
  remoteCandidatesAdded = 0;
}

function newPeerConnection() {
  localCandidates = [];
  remoteCandidatesAdded = 0;

  pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  pc.onicecandidate = (event) => {
    if (event.candidate?.candidate) {
      localCandidates.push(event.candidate.candidate);
    }
  };

  pc.onconnectionstatechange = () => {
    const state = pc?.connectionState || "unknown";
    if (state === "connected") {
      stage = "connected";
      statusText = "Connected.";
    } else if (stage !== "idle") {
      statusText = `PeerConnection: ${state}`;
    }
  };

  pc.ondatachannel = (event) => {
    wireDataChannel(event.channel);
  };

  return pc;
}

function wireDataChannel(channel) {
  dc = channel;
  dc.onopen = () => {
    stage = "connected";
    statusText = "DataChannel open.";
  };
  dc.onclose = () => {
    if (stage !== "idle") statusText = "DataChannel closed.";
  };
  dc.onerror = (event) => {
    console.error("[webrtc] datachannel error", event);
  };
}

function waitForIceComplete(connection) {
  return new Promise((resolve) => {
    if (connection.iceGatheringState === "complete") {
      resolve();
      return;
    }

    const onChange = () => {
      if (connection.iceGatheringState === "complete") {
        connection.removeEventListener("icegatheringstatechange", onChange);
        resolve();
      }
    };

    connection.addEventListener("icegatheringstatechange", onChange);
  });
}

async function startAsStarter() {
  if (pc) return;

  role = "starter";
  stage = "making-offer";
  statusText = "Creating offer bundle...";
  newPeerConnection();

  wireDataChannel(pc.createDataChannel("portal"));

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceComplete(pc);

    const bundle = {
      t: "OB",
      s: pc.localDescription.sdp,
      c: localCandidates,
    };

    const payload = toBundleString(bundle);
    logBundle("COPY OFFER", payload, bundle);
    await copyToClipboard(payload);

    stage = "waiting-answer";
    statusText = "Offer copied and logged. Give it to the joiner, then paste the answer bundle here.";
  } catch (error) {
    console.error("[webrtc] starter error", error);
    statusText = `Starter error: ${error?.message || error}`;
  }
}

function prepareJoiner() {
  if (pc) return;
  role = "joiner";
  stage = "waiting-offer";
  statusText = "Paste the offer bundle from the starter.";
  newPeerConnection();
}

async function pasteOfferBundle() {
  if (!pc || role !== "joiner") return;

  const pasted = window.prompt('Paste the "OB-..." offer bundle here:');
  if (!pasted) return;

  try {
    const bundle = fromBundleString(pasted);
    logParsedBundle("PASTED OFFER", pasted, bundle);

    stage = "making-answer";
    statusText = "Applying offer and creating answer...";

    await pc.setRemoteDescription({ type: "offer", sdp: bundle.s });
    for (const candidate of bundle.c) {
      await pc.addIceCandidate({ candidate, sdpMLineIndex: 0 });
      remoteCandidatesAdded += 1;
    }

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIceComplete(pc);

    const answerBundle = {
      t: "AB",
      s: pc.localDescription.sdp,
      c: localCandidates,
    };

    const payload = toBundleString(answerBundle);
    logBundle("COPY ANSWER", payload, answerBundle);
    await copyToClipboard(payload);

    stage = "connecting";
    statusText = "Answer copied and logged. Give it back to the starter.";
  } catch (error) {
    console.error("[webrtc] joiner error", error);
    statusText = `Joiner error: ${error?.message || error}`;
  }
}

async function pasteAnswerBundle() {
  if (!pc || role !== "starter") return;

  const pasted = window.prompt('Paste the "AB-..." answer bundle here:');
  if (!pasted) return;

  try {
    const bundle = fromBundleString(pasted);
    logParsedBundle("PASTED ANSWER", pasted, bundle);

    stage = "connecting";
    statusText = "Applying answer bundle...";

    await pc.setRemoteDescription({ type: "answer", sdp: bundle.s });
    for (const candidate of bundle.c) {
      await pc.addIceCandidate({ candidate, sdpMLineIndex: 0 });
      remoteCandidatesAdded += 1;
    }

    statusText = "Answer accepted. Waiting for connection...";
  } catch (error) {
    console.error("[webrtc] answer error", error);
    statusText = `Answer error: ${error?.message || error}`;
  }
}

function toBundleString(bundle) {
  const json = JSON.stringify(bundle);
  const b64 = btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `${bundle.t}-` + b64;
}

function fromBundleString(value) {
  const trimmed = String(value || "").trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed);
  }

  const type = trimmed.slice(0, 2).toUpperCase();
  if ((type !== "OB" && type !== "AB") || trimmed[2] !== "-") {
    throw new Error('Expected "OB-..." or "AB-..."');
  }

  const b64 = trimmed
    .slice(3)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const json = decodeURIComponent(escape(atob(b64)));
  const bundle = JSON.parse(json);

  if (bundle.t !== type) {
    throw new Error("Bundle type mismatch");
  }

  return bundle;
}

function bundleSummary(bundle) {
  return {
    type: bundle.t === "OB" ? "offer-bundle" : "answer-bundle",
    sdpType: bundle.t === "OB" ? "offer" : "answer",
    sdpLength: bundle.s?.length || 0,
    candidateCount: Array.isArray(bundle.c) ? bundle.c.length : 0,
    candidates: Array.isArray(bundle.c) ? bundle.c : [],
    sdpPreview: String(bundle.s || "").split("\n").slice(0, 12),
  };
}

function logBundle(label, payload, bundle) {
  console.log(`[webrtc] ${label} string`);
  console.log(payload);
  console.log(`[webrtc] ${label} json`);
  console.log(JSON.stringify(bundleSummary(bundle), null, 2));
}

function logParsedBundle(label, payload, bundle) {
  console.log(`[webrtc] ${label} string`);
  console.log(payload);
  console.log(`[webrtc] ${label} parsed json`);
  console.log(JSON.stringify(bundleSummary(bundle), null, 2));
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    console.log("[webrtc] clipboard copy failed; use console output");
  }
}
