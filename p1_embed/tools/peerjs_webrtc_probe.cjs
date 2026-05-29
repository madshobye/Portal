#!/usr/bin/env node
"use strict";

const { randomUUID } = require("crypto");

function parseArgs(argv) {
  const args = {
    peer: "p1-embed-f7a608",
    host: "0.peerjs.com",
    port: 443,
    path: "/",
    key: "peerjs",
    secure: true,
    timeoutMs: 30000,
    dataTimeoutMs: 10000,
    peerjsUrl: "https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js",
    channel: "",
    headful: false,
    skipSelfTest: false,
    skipDeviceTest: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[i];
    };

    if (arg === "--peer") args.peer = next();
    else if (arg === "--host") args.host = next();
    else if (arg === "--port") args.port = Number(next());
    else if (arg === "--path") args.path = next();
    else if (arg === "--key") args.key = next();
    else if (arg === "--timeout") args.timeoutMs = Number(next());
    else if (arg === "--data-timeout") args.dataTimeoutMs = Number(next());
    else if (arg === "--peerjs-url") args.peerjsUrl = next();
    else if (arg === "--channel") args.channel = next();
    else if (arg === "--headful") args.headful = true;
    else if (arg === "--skip-self-test") args.skipSelfTest = true;
    else if (arg === "--skip-device-test") args.skipDeviceTest = true;
    else if (arg === "--insecure") args.secure = false;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.port)) throw new Error("--port must be a number");
  if (!Number.isFinite(args.timeoutMs)) throw new Error("--timeout must be a number");
  if (!Number.isFinite(args.dataTimeoutMs)) throw new Error("--data-timeout must be a number");
  args.peer = String(args.peer || "").trim().toLowerCase();
  if (!args.peer && !args.skipDeviceTest) throw new Error("--peer is required for the ESP32 device test");
  return args;
}

function printHelp() {
  console.log(`PeerJS/WebRTC probe for P1E

Usage:
  node p1_embed/tools/peerjs_webrtc_probe.cjs --peer p1-embed-f7a608

Options:
  --peer <id>            ESP32 PeerJS id (default: p1-embed-f7a608)
  --host <host>          PeerJS host (default: 0.peerjs.com)
  --port <port>          PeerJS port (default: 443)
  --path <path>          PeerJS path (default: /)
  --key <key>            PeerJS key (default: peerjs)
  --insecure             Use ws/http PeerJS signaling instead of wss/https
  --timeout <ms>         Hub/device open timeout (default: 30000)
  --data-timeout <ms>    Protocol response timeout after open (default: 10000)
  --headful              Show the Chromium window
  --skip-self-test       Skip browser-to-browser PeerJS loopback test
  --skip-device-test     Skip ESP32 device test
  --peerjs-url <url>     PeerJS browser bundle URL
  --channel <name>       Playwright browser channel, for example chrome
`);
}

async function loadPlaywright() {
  try {
    return require("playwright");
  } catch (error) {
    const hint = [
      "Could not load the 'playwright' package.",
      "Run with the Codex bundled runtime like:",
      "  NODE_PATH=/path/to/node_modules \\",
      "  /path/to/node \\",
      "  p1_embed/tools/peerjs_webrtc_probe.cjs --peer p1-embed-f7a608",
      "",
      `Original error: ${error.message}`,
    ].join("\n");
    throw new Error(hint);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { chromium } = await loadPlaywright();
  const browser = await launchBrowser(chromium, args);
  const page = await browser.newPage();

  page.on("console", (message) => console.log(message.text()));
  page.on("pageerror", (error) => console.error(`[page error] ${error.message}`));

  try {
    await page.setContent(renderProbePage(args), { waitUntil: "load", timeout: args.timeoutMs });
    const result = await page.evaluate(async (options) => window.runP1ePeerProbe(options), {
      ...args,
      runId: randomUUID().slice(0, 8),
    });

    console.log("");
    console.log("Result:");
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

async function launchBrowser(chromium, args) {
  const attempts = [];
  if (args.channel) attempts.push({ channel: args.channel });
  attempts.push({});
  attempts.push({ channel: "chrome" });
  attempts.push({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  attempts.push({ channel: "msedge" });

  let lastError = null;
  const failures = [];
  for (const attempt of attempts) {
    try {
      const label = launchLabel(attempt);
      console.log(`Launching ${label}`);
      return await chromium.launch({ headless: !args.headful, ...attempt });
    } catch (error) {
      lastError = error;
      failures.push(error.message || String(error));
      console.error(`Launch failed (${launchLabel(attempt)}): ${error.message}`);
    }
  }
  if (lastError) {
    lastError.message = `${lastError.message}\n\nLaunch attempts:\n${failures.map((item) => `- ${item.split("\n")[0]}`).join("\n")}`;
  }
  throw lastError;
}

function launchLabel(attempt) {
  if (attempt.channel) return `channel ${attempt.channel}`;
  if (attempt.executablePath) return attempt.executablePath;
  return "bundled chromium";
}

function renderProbePage(args) {
  return `<!doctype html>
<meta charset="utf-8">
<title>P1E PeerJS Probe</title>
<script src="${escapeHtml(args.peerjsUrl)}"></script>
<script>
(() => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function now() {
    return new Date().toISOString();
  }

  function log(scope, message, data) {
    const suffix = data === undefined ? "" : " " + JSON.stringify(data);
    console.log("[" + now() + "] " + scope + " " + message + suffix);
  }

  function createPeer(id, options) {
    return new Peer(id, {
      host: options.host,
      port: options.port,
      path: options.path,
      key: options.key,
      secure: options.secure,
      debug: 0,
    });
  }

  function oncePeerOpen(peer, label, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(label + " open timeout")), timeoutMs);
      peer.on("open", (id) => {
        clearTimeout(timer);
        log(label, "open", { id });
        resolve(id);
      });
      peer.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  function peerErrorString(error) {
    return error && error.message ? error.message : String(error || "unknown error");
  }

  function getPc(conn) {
    return conn && (conn.peerConnection || conn._peerConnection || conn._pc || conn.pc) || null;
  }

  function candidateSummary(candidate) {
    const text = String(candidate || "");
    if (!text) return "";
    const protocol = (text.match(/\\s(udp|tcp)\\s/i) || [])[1] || "?";
    const type = (text.match(/\\styp\\s+(\\S+)/) || [])[1] || "?";
    const address = (text.match(/\\s(\\S+)\\s\\d+\\styp\\s/) || [])[1] || "?";
    const port = (text.match(/\\s(\\d+)\\styp\\s/) || [])[1] || "?";
    return type + "/" + protocol.toLowerCase() + "/" + address + ":" + port;
  }

  function attachDiagnostics(conn, label) {
    const pc = getPc(conn);
    if (!pc || typeof pc.addEventListener !== "function") {
      log(label, "no RTCPeerConnection found");
      return;
    }

    const state = (reason) => log(label, reason, {
      iceConnectionState: pc.iceConnectionState,
      iceGatheringState: pc.iceGatheringState,
      signalingState: pc.signalingState,
      connectionState: pc.connectionState || "",
    });

    pc.addEventListener("icecandidate", (event) => {
      log(label, "local candidate", {
        candidate: event.candidate ? candidateSummary(event.candidate.candidate) : "complete",
      });
    });
    pc.addEventListener("iceconnectionstatechange", () => {
      state("ice state");
      logStats(pc, label);
    });
    pc.addEventListener("icegatheringstatechange", () => state("ice gathering"));
    pc.addEventListener("signalingstatechange", () => state("signaling"));
    if ("connectionState" in pc) pc.addEventListener("connectionstatechange", () => state("connection"));
    state("attached");
  }

  function attachPeerSocketDiagnostics(peer, label) {
    const socket = peer && peer.socket;
    if (!socket || typeof socket.send !== "function" || socket._p1eProbeWrapped) return;
    const send = socket.send.bind(socket);
    socket._p1eProbeWrapped = true;
    socket.send = (message) => {
      log(label, "signal out", summarizeSignalMessage(message));
      return send(message);
    };
  }

  function attachConnectionSignalingDiagnostics(conn, label) {
    if (!conn || typeof conn.handleMessage !== "function" || conn._p1eProbeWrapped) return;
    const handleMessage = conn.handleMessage.bind(conn);
    conn._p1eProbeWrapped = true;
    conn.handleMessage = (message) => {
      log(label, "signal in", summarizeSignalMessage(message));
      return handleMessage(message);
    };
  }

  function summarizeSignalMessage(message) {
    const summary = {
      type: message && message.type || "?",
      src: message && message.src || "",
      dst: message && message.dst || "",
    };
    const payload = message && message.payload || {};
    const candidate = payload.candidate && payload.candidate.candidate || "";
    const sdp = payload.sdp && payload.sdp.sdp || "";
    if (payload.sdp && payload.sdp.type) summary.sdpType = payload.sdp.type;
    if (sdp) {
      summary.candidates = (sdp.match(/^a=candidate:/gmi) || []).length;
      summary.setup = (sdp.match(/^a=setup:(\S+)/mi) || [])[1] || "";
    }
    if (candidate) summary.candidate = candidateSummary(candidate);
    return summary;
  }

  async function logStats(pc, label) {
    if (typeof pc.getStats !== "function") return;
    try {
      const stats = await pc.getStats();
      const locals = new Map();
      const remotes = new Map();
      const pairs = [];
      let selected = null;
      stats.forEach((report) => {
        if (report.type === "local-candidate") locals.set(report.id, report);
        if (report.type === "remote-candidate") remotes.set(report.id, report);
        if (report.type === "candidate-pair") {
          pairs.push(report);
          if (report.selected) selected = report;
        }
        if (report.type === "transport" && report.selectedCandidatePairId) {
          const pair = stats.get(report.selectedCandidatePairId);
          if (pair) selected = pair;
        }
      });
      const pair = selected || pairs.find((item) => item.state && item.state !== "failed") || pairs[0];
      if (!pair) return;
      log(label, "candidate pair", {
        state: pair.state,
        nominated: pair.nominated,
        requestsSent: pair.requestsSent,
        responsesReceived: pair.responsesReceived,
        local: formatStatsCandidate(locals.get(pair.localCandidateId)),
        remote: formatStatsCandidate(remotes.get(pair.remoteCandidateId)),
      });
    } catch (error) {
      log(label, "stats error", { message: peerErrorString(error) });
    }
  }

  function formatStatsCandidate(candidate) {
    if (!candidate) return "?";
    const type = candidate.candidateType || "?";
    const protocol = String(candidate.protocol || "?").toLowerCase();
    const address = candidate.address || candidate.ip || "?";
    const port = candidate.port || "?";
    return type + "/" + protocol + "/" + address + ":" + port;
  }

  function waitConnectionOpen(conn, label, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(label + " data channel timeout")), timeoutMs);
      conn.on("open", () => {
        clearTimeout(timer);
        log(label, "data channel open");
        resolve();
      });
      conn.on("close", () => {
        clearTimeout(timer);
        reject(new Error(label + " closed before open"));
      });
      conn.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  function waitJsonResponse(conn, id, label, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(label + " response timeout")), timeoutMs);
      conn.on("data", async (data) => {
        const text = await decodeData(data);
        log(label, "data", { text: text.slice(0, 300) });
        const parsed = parseProtocolMessage(text);
        if (parsed && parsed.type === "res" && String(parsed.id) === String(id)) {
          clearTimeout(timer);
          resolve(parsed);
        }
      });
    });
  }

  async function decodeData(data) {
    if (typeof data === "string") return data;
    if (data instanceof Blob) return data.text();
    if (data instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(data));
    if (data instanceof Uint8Array) return new TextDecoder().decode(data);
    return String(data || "");
  }

  function parseProtocolMessage(text) {
    const value = String(text || "").trim();
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch {}
    const starts = ['{"type":"res"', '{"type":"evt"', '{"type":"cmd"'];
    let start = -1;
    for (const marker of starts) {
      const index = value.indexOf(marker);
      if (index >= 0 && (start < 0 || index < start)) start = index;
    }
    if (start < 0) return null;
    const end = findJsonEnd(value, start);
    if (end < 0) return null;
    try {
      return JSON.parse(value.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  function findJsonEnd(text, start) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\\\") escaped = true;
        else if (ch === '"') inString = false;
      } else if (ch === '"') {
        inString = true;
      } else if (ch === "{") {
        depth += 1;
      } else if (ch === "}") {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  async function runSelfTest(options) {
    const suffix = options.runId;
    const deviceId = "p1e-probe-device-" + suffix;
    const clientId = "p1e-probe-client-" + suffix;
    log("self", "starting", { deviceId, clientId });

    const device = createPeer(deviceId, options);
    const client = createPeer(clientId, options);
    await Promise.all([
      oncePeerOpen(device, "self device", options.timeoutMs),
      oncePeerOpen(client, "self client", options.timeoutMs),
    ]);
    attachPeerSocketDiagnostics(device, "self device");
    attachPeerSocketDiagnostics(client, "self client");

    device.on("connection", (conn) => {
      log("self device", "incoming connection", { peer: conn.peer });
      attachConnectionSignalingDiagnostics(conn, "self device");
      attachDiagnostics(conn, "self device");
      conn.on("data", async (data) => {
        const text = await decodeData(data);
        log("self device", "data", { text });
        const message = parseProtocolMessage(text);
        conn.send(JSON.stringify({ type: "res", id: message && message.id || "self", ok: true, data: { selfTest: true } }));
      });
    });

    const conn = client.connect(deviceId, { serialization: "raw", reliable: true, label: "p1e" });
    attachConnectionSignalingDiagnostics(conn, "self client");
    attachDiagnostics(conn, "self client");
    await waitConnectionOpen(conn, "self client", options.timeoutMs);
    const responsePromise = waitJsonResponse(conn, "self", "self client", options.dataTimeoutMs);
    conn.send(JSON.stringify({ type: "cmd", id: "self", name: "status.get", data: {} }));
    const response = await responsePromise;
    conn.close();
    await sleep(50);
    client.destroy();
    device.destroy();
    return { ok: true, response };
  }

  async function runDeviceTest(options) {
    const clientId = "p1e-node-" + options.runId;
    log("device", "starting", { clientId, remoteId: options.peer });
    const peer = createPeer(clientId, options);
    await oncePeerOpen(peer, "device client", options.timeoutMs);
    attachPeerSocketDiagnostics(peer, "device client");

    const conn = peer.connect(options.peer, { serialization: "raw", reliable: true, label: "p1e" });
    attachConnectionSignalingDiagnostics(conn, "device client");
    attachDiagnostics(conn, "device client");
    await waitConnectionOpen(conn, "device client", options.timeoutMs);

    const responsePromise = waitJsonResponse(conn, "probe-1", "device client", options.dataTimeoutMs);
    conn.send(JSON.stringify({ type: "cmd", id: "probe-1", name: "status.get", data: {} }));
    const response = await responsePromise;
    conn.close();
    await sleep(50);
    peer.destroy();
    return { ok: true, response };
  }

  window.runP1ePeerProbe = async (options) => {
    if (!window.Peer) throw new Error("PeerJS browser bundle did not load");
    const result = { ok: true, selfTest: null, deviceTest: null };

    if (!options.skipSelfTest) {
      try {
        result.selfTest = await runSelfTest(options);
      } catch (error) {
        result.ok = false;
        result.selfTest = { ok: false, error: peerErrorString(error) };
        log("self", "failed", result.selfTest);
      }
    }

    if (!options.skipDeviceTest) {
      try {
        result.deviceTest = await runDeviceTest(options);
      } catch (error) {
        result.ok = false;
        result.deviceTest = { ok: false, error: peerErrorString(error) };
        log("device", "failed", result.deviceTest);
      }
    }

    return result;
  };
})();
</script>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
