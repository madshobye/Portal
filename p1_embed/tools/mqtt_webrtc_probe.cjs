#!/usr/bin/env node
"use strict";

const { randomUUID } = require("crypto");

function parseArgs(argv) {
  const args = {
    device: "p1-embed-f7a608",
    host: "public.cloud.shiftr.io",
    username: "public",
    password: "public",
    root: "p1e-webrtc-v1",
    timeoutMs: 45000,
    dataTimeoutMs: 15000,
    mqttUrl: "https://unpkg.com/mqtt/dist/mqtt.min.js",
    headful: false,
    channel: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[i];
    };
    if (arg === "--device") args.device = next();
    else if (arg === "--host") args.host = next();
    else if (arg === "--username") args.username = next();
    else if (arg === "--password") args.password = next();
    else if (arg === "--root") args.root = next();
    else if (arg === "--timeout") args.timeoutMs = Number(next());
    else if (arg === "--data-timeout") args.dataTimeoutMs = Number(next());
    else if (arg === "--mqtt-url") args.mqttUrl = next();
    else if (arg === "--channel") args.channel = next();
    else if (arg === "--headful") args.headful = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  args.device = String(args.device || "").trim().toLowerCase();
  if (!args.device) throw new Error("--device is required");
  if (!Number.isFinite(args.timeoutMs)) throw new Error("--timeout must be a number");
  if (!Number.isFinite(args.dataTimeoutMs)) throw new Error("--data-timeout must be a number");
  return args;
}

function printHelp() {
  console.log(`MQTT/WebRTC probe for P1E

Usage:
  node p1_embed/tools/mqtt_webrtc_probe.cjs --device p1-embed-f7a608

Options:
  --device <id>          ESP32 device id (default: p1-embed-f7a608)
  --host <host>          Shiftr MQTT host (default: public.cloud.shiftr.io)
  --username <name>      MQTT username/instance (default: public)
  --password <secret>    MQTT password/token (default: public)
  --root <topic>         Collision-resistant root topic
  --timeout <ms>         WebRTC open timeout (default: 45000)
  --data-timeout <ms>    Protocol response timeout (default: 15000)
  --headful              Show Chromium
  --channel <name>       Playwright browser channel
`);
}

async function loadPlaywright() {
  try {
    return require("playwright");
  } catch (error) {
    throw new Error(`Could not load playwright: ${error.message}`);
  }
}

async function launchBrowser(chromium, args) {
  const attempts = [];
  if (args.channel) attempts.push({ channel: args.channel });
  attempts.push({});
  attempts.push({ channel: "chrome" });
  attempts.push({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });

  let lastError = null;
  for (const attempt of attempts) {
    try {
      return await chromium.launch({ headless: !args.headful, ...attempt });
    } catch (error) {
      lastError = error;
      console.error(`Launch failed: ${error.message}`);
    }
  }
  throw lastError;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { chromium } = await loadPlaywright();
  const browser = await launchBrowser(chromium, args);
  const page = await browser.newPage();
  page.on("console", (message) => console.log(message.text()));
  page.on("pageerror", (error) => console.error(`[page error] ${error.message}`));

  try {
    await page.setContent(renderPage(args), { waitUntil: "load", timeout: args.timeoutMs });
    const result = await page.evaluate(async (options) => window.runP1eMqttWebRtcProbe(options), {
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

function renderPage(args) {
  return `<!doctype html>
<meta charset="utf-8">
<title>P1E MQTT WebRTC Probe</title>
<script src="${escapeHtml(args.mqttUrl)}"></script>
<script>
(() => {
  const log = (scope, message, data) => {
    console.log("[" + new Date().toISOString() + "] " + scope + " " + message + (data === undefined ? "" : " " + JSON.stringify(data)));
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const timeout = (label, ms) => new Promise((_, reject) => setTimeout(() => reject(new Error(label + " timeout")), ms));
  const topicTo = (root, id) => "/" + root + "/to/" + id;
  const topicPresence = (root) => "/" + root + "/presence";

  function parseProtocolMessage(text) {
    const value = String(text || "").trim();
    if (!value) return null;
    try { return JSON.parse(value); } catch {}
    return null;
  }

  function waitMqttConnect(client, ms) {
    return Promise.race([
      new Promise((resolve, reject) => {
        client.once("connect", resolve);
        client.once("error", reject);
      }),
      timeout("mqtt connect", ms),
    ]);
  }

  function waitDataChannelOpen(channel, ms) {
    return Promise.race([
      new Promise((resolve, reject) => {
        channel.onopen = () => resolve();
        channel.onerror = () => reject(new Error("datachannel error"));
        channel.onclose = () => reject(new Error("datachannel closed before open"));
      }),
      timeout("datachannel open", ms),
    ]);
  }

  function waitJsonResponse(channel, id, ms) {
    return Promise.race([
      new Promise((resolve) => {
        channel.onmessage = async (event) => {
          const text = typeof event.data === "string" ? event.data : await event.data.text();
          log("data", "in", { text: text.slice(0, 240) });
          const parsed = parseProtocolMessage(text);
          if (parsed && parsed.type === "res" && String(parsed.id) === String(id)) resolve(parsed);
        };
      }),
      timeout("protocol response", ms),
    ]);
  }

  function signalSummary(message) {
    const payload = message.payload || {};
    const sdp = payload.sdp && payload.sdp.sdp || "";
    const candidate = payload.candidate && payload.candidate.candidate || "";
    const sdpCandidates = sdp.match(/^a=candidate:.*$/gmi) || [];
    return {
      type: message.type,
      src: message.src || "",
      dst: message.dst || "",
      sdpType: payload.sdp && payload.sdp.type || "",
      sdpBytes: sdp.length || 0,
      sdpCandidates: sdpCandidates.map(summarizeCandidate),
      candidate: candidate ? candidate.slice(0, 80) : "",
    };
  }

  function summarizeCandidate(candidate) {
    const text = String(candidate || "");
    const typ = (text.match(/\\styp\\s+(\\S+)/) || [])[1] || "?";
    const proto = (text.match(/\\s(udp|tcp)\\s/i) || [])[1] || "?";
    const address = (text.match(/\\s(\\S+)\\s\\d+\\styp\\s/) || [])[1] || "?";
    const port = (text.match(/\\s(\\d+)\\styp\\s/) || [])[1] || "?";
    return typ + "/" + proto.toLowerCase() + "/" + address + ":" + port;
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
      const pair = selected || pairs.find((item) => item.nominated) || pairs.find((item) => item.state === "succeeded") || pairs[0];
      if (!pair) return;
      log(label, "stats", {
        pairState: pair.state || "",
        nominated: Boolean(pair.nominated),
        requestsSent: pair.requestsSent || 0,
        responsesReceived: pair.responsesReceived || 0,
        currentRoundTripTime: pair.currentRoundTripTime || 0,
        local: formatStatsCandidate(locals.get(pair.localCandidateId)),
        remote: formatStatsCandidate(remotes.get(pair.remoteCandidateId)),
      });
    } catch (error) {
      log(label, "stats error", { message: error.message || String(error) });
    }
  }

  function formatStatsCandidate(candidate) {
    if (!candidate) return "?";
    return [
      candidate.candidateType || "?",
      String(candidate.protocol || "?").toLowerCase(),
      (candidate.address || candidate.ip || "?") + ":" + (candidate.port || "?"),
    ].join("/");
  }

  window.runP1eMqttWebRtcProbe = async (options) => {
    if (!window.mqtt) throw new Error("mqtt.js browser bundle did not load");
    const clientId = "p1e-web-mqtt-" + options.runId;
    const mqttUrl = "wss://" + encodeURIComponent(options.username) + ":" + encodeURIComponent(options.password) + "@" + options.host;
    const inbox = topicTo(options.root, clientId);
    const deviceInbox = topicTo(options.root, options.device);
    const result = { ok: false, clientId, inbox, deviceInbox, events: [] };
    const client = window.mqtt.connect(mqttUrl, {
      clientId,
      username: options.username,
      password: options.password,
      clean: true,
      reconnectPeriod: 0,
      connectTimeout: Math.min(options.timeoutMs, 15000),
    });

    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    const channel = pc.createDataChannel("p1e", { ordered: true });
    const connectionId = "mqtt_" + options.runId;

    const publish = (message) => {
      const payload = JSON.stringify(message);
      log("mqtt", "publish", signalSummary(message));
      client.publish(deviceInbox, payload);
    };

    client.on("message", async (topic, payload) => {
      const text = new TextDecoder().decode(payload);
      let message = null;
      try { message = JSON.parse(text); } catch (error) {
        log("mqtt", "bad json", { topic, text: text.slice(0, 120) });
        return;
      }
      log("mqtt", "message", signalSummary(message));
      result.events.push(signalSummary(message));
      const inner = message.payload || {};
      if (message.type === "ANSWER" && inner.sdp && inner.sdp.sdp) {
        await pc.setRemoteDescription({ type: "answer", sdp: inner.sdp.sdp });
      } else if (message.type === "CANDIDATE" && inner.candidate && inner.candidate.candidate) {
        try {
          await pc.addIceCandidate(inner.candidate);
        } catch (error) {
          log("webrtc", "candidate error", { message: error.message });
        }
      }
    });

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      publish({
        type: "CANDIDATE",
        src: clientId,
        dst: options.device,
        payload: {
          candidate: {
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid || "0",
            sdpMLineIndex: event.candidate.sdpMLineIndex || 0,
          },
          type: "data",
          connectionId,
        },
      });
    };
    pc.oniceconnectionstatechange = () => {
      log("webrtc", "ice", { state: pc.iceConnectionState });
      logStats(pc, "webrtc");
    };
    pc.onconnectionstatechange = () => {
      log("webrtc", "connection", { state: pc.connectionState });
      logStats(pc, "webrtc");
    };

    try {
      log("mqtt", "connecting", { mqttUrl: "wss://" + options.host, clientId });
      await waitMqttConnect(client, options.timeoutMs);
      log("mqtt", "connected", { clientId });
      await new Promise((resolve, reject) => client.subscribe(inbox, (error) => error ? reject(error) : resolve()));
      client.publish(topicPresence(options.root), JSON.stringify({ type: "WEB_ONLINE", src: clientId, dst: options.device }));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      publish({
        type: "OFFER",
        src: clientId,
        dst: options.device,
        payload: {
          sdp: { type: "offer", sdp: offer.sdp },
          type: "data",
          connectionId,
          metadata: null,
          label: connectionId,
          reliable: false,
          serialization: "raw",
        },
      });

      await waitDataChannelOpen(channel, options.timeoutMs);
      log("data", "open");
      const responsePromise = waitJsonResponse(channel, "mqtt-probe-1", options.dataTimeoutMs);
      channel.send(JSON.stringify({ type: "cmd", id: "mqtt-probe-1", name: "status.get", data: {} }));
      const response = await responsePromise;
      result.ok = true;
      result.response = response;
      channel.close();
      pc.close();
      client.end(true);
      await sleep(50);
      return result;
    } catch (error) {
      result.error = error.message || String(error);
      try { pc.close(); } catch {}
      try { client.end(true); } catch {}
      return result;
    }
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
