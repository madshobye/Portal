#!/usr/bin/env node
"use strict";

const { randomUUID } = require("crypto");

const DEFAULT_BASE_URL = "https://127.0.0.1:8082";
const DEFAULT_DEVICE = "p1-embed-f7a608";

async function main() {
  const device = String(process.argv[2] || DEFAULT_DEVICE).trim().toLowerCase();
  const baseUrl = String(process.argv[3] || DEFAULT_BASE_URL).replace(/\/$/, "");
  const { chromium } = require("playwright");
  const browser = await launchBrowser(chromium);
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  page.on("console", (message) => console.log(message.text()));
  page.on("pageerror", (error) => console.error(`[page error] ${error.message}`));

  try {
    await page.goto(`${baseUrl}/p1_embed/web/?debug=1`, { waitUntil: "domcontentloaded", timeout: 30000 });
    const runId = randomUUID().slice(0, 8);
    const result = await page.evaluate(async ({ device, runId }) => {
      const [
        { MqttWebRtcTransport, MQTT_WEBRTC_TRANSPORT_VERSION },
        { ProtocolClient },
        { P1_MSGPACK_VERSION },
      ] = await Promise.all([
        import(`./protocol/MqttWebRtcTransport.js?v=module-probe-${runId}`),
        import(`./protocol/ProtocolClient.js?v=module-probe-${runId}`),
        import(`./protocol/P1MsgPack.js?v=module-probe-${runId}`),
      ]);
      const log = (message, data = undefined) => console.log("[module-probe] " + message + (data === undefined ? "" : " " + JSON.stringify(data)));
      const events = [];
      const transport = new MqttWebRtcTransport({
        localId: "p1e-web-mqtt-" + runId,
        connectTimeoutMs: 90000,
      });
      const client = new ProtocolClient(transport, { timeoutMs: 20000 });
      transport.addEventListener("state", (event) => {
        const detail = event.detail || {};
        events.push(detail);
        if (detail.state === "diagnostic") log("diagnostic", detail);
        else log("state", detail);
      });
      client.addEventListener("event", (event) => log("event", event.detail.event));
      client.addEventListener("raw", (event) => log("raw", event.detail.line));
      client.addEventListener("error", (event) => log("error", { message: event.detail.error?.message || String(event.detail.error || "") }));

      try {
        log("version", { version: MQTT_WEBRTC_TRANSPORT_VERSION, msgpack: P1_MSGPACK_VERSION, device });
        await transport.connect({ remoteId: device });
        log("connected");
        const info = await client.requestMsgPack("system.info", {}, { timeoutMs: 20000 });
        const status = await client.requestMsgPack("status.light", {}, { timeoutMs: 20000 });
        await transport.disconnect();
        return { ok: true, events, info, status };
      } catch (error) {
        try { await transport.disconnect(); } catch {}
        return { ok: false, events, error: error.message || String(error) };
      }
    }, { device, runId });
    console.log("");
    console.log("Result:");
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

async function launchBrowser(chromium) {
  const attempts = [
    { channel: "chrome" },
    {},
    { executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
  ];
  let lastError = null;
  for (const attempt of attempts) {
    try {
      return await chromium.launch({ headless: true, ...attempt });
    } catch (error) {
      lastError = error;
      console.error(`Launch failed: ${error.message}`);
    }
  }
  throw lastError;
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
