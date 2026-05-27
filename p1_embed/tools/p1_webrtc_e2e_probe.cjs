#!/usr/bin/env node
"use strict";

const { spawn } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const PEER_PROBE = path.join(ROOT, "p1_embed", "tools", "peerjs_webrtc_probe.cjs");
const SERIAL_REPL = path.join(ROOT, "p1_embed", "tools", "p1_serial_repl.py");

function parseArgs(argv) {
  const args = {
    peer: "p1-embed-f7a608",
    port: "/dev/cu.wchusbserial58741104521",
    timeoutMs: 45000,
    dataTimeoutMs: 15000,
    listenSeconds: 65,
    channel: "chrome",
    debugLevel: "debug",
    skipSelfTest: false,
    headful: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[i];
    };

    if (arg === "--peer") args.peer = next();
    else if (arg === "--serial-port") args.port = next();
    else if (arg === "--timeout") args.timeoutMs = Number(next());
    else if (arg === "--data-timeout") args.dataTimeoutMs = Number(next());
    else if (arg === "--listen") args.listenSeconds = Number(next());
    else if (arg === "--channel") args.channel = next();
    else if (arg === "--debug-level") args.debugLevel = next();
    else if (arg === "--skip-self-test") args.skipSelfTest = true;
    else if (arg === "--headful") args.headful = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`P1E WebRTC end-to-end probe

This runs the browser PeerJS probe while serial captures ESP32 protocol events.

Usage:
  node p1_embed/tools/p1_webrtc_e2e_probe.cjs --peer p1-embed-f7a608

Options:
  --peer <id>             ESP32 PeerJS id
  --serial-port <path>    Serial device path
  --timeout <ms>          Browser PeerJS timeout
  --data-timeout <ms>     Data channel response timeout
  --listen <seconds>      Serial capture window
  --channel <name>        Playwright browser channel, for example chrome
  --debug-level <level>   Firmware debug level before capture
  --skip-self-test        Skip browser-to-browser PeerJS self test
  --headful               Show the browser window
`);
}

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (!options.quiet) process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (!options.quiet) process.stderr.write(text);
    });
    child.on("error", (error) => resolve({ ok: false, code: -1, stdout, stderr: stderr + error.message }));
    child.on("close", (code, signal) => resolve({ ok: code === 0, code, signal, stdout, stderr }));
  });
}

function spawnSerialCapture(args) {
  const child = spawn("python3", [
    SERIAL_REPL,
    "--port", args.port,
    "--listen", String(args.listenSeconds),
  ], {
    cwd: ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const lines = [];
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    process.stdout.write(prefixLines("[serial] ", text));
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) lines.push(line.trim());
    }
  });
  child.stderr.on("data", (chunk) => process.stderr.write(prefixLines("[serial err] ", chunk.toString())));
  child.on("error", (error) => {
    lines.push(JSON.stringify({ type: "tool.error", message: error.message }));
  });
  return { child, lines };
}

function prefixLines(prefix, text) {
  return text
    .split(/(\r?\n)/)
    .map((part) => part.match(/^\r?\n$/) || part === "" ? part : prefix + part)
    .join("");
}

async function stopCapture(capture) {
  if (!capture || capture.child.killed) return;
  capture.child.kill("SIGINT");
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 1500);
    capture.child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function summarizeSerial(lines) {
  const summary = {
    webrtc: [],
    errors: [],
    status: null,
  };
  for (const line of lines) {
    let msg = null;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.type !== "evt") continue;
    const name = msg.name || "";
    const data = msg.data || {};
    if (name.startsWith("webrtc")) summary.webrtc.push({ name, data });
    if (name === "debug.error" || name === "script.error") summary.errors.push({ name, data });
    if (name === "device.status" && data.status) summary.status = data.status;
  }
  return summary;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log("P1E WebRTC end-to-end probe");
  console.log(`peer=${args.peer} serial=${args.port}`);

  console.log("\nSetting firmware debug level...");
  await run("python3", [
    SERIAL_REPL,
    "--port", args.port,
    "--cmd", "debug.set",
    "--data", JSON.stringify({ level: args.debugLevel }),
  ]);

  console.log("\nStarting serial capture...");
  const capture = spawnSerialCapture(args);
  await new Promise((resolve) => setTimeout(resolve, 1200));

  console.log("\nRunning headless browser probe...");
  const probeArgs = [
    PEER_PROBE,
    "--peer", args.peer,
    "--timeout", String(args.timeoutMs),
    "--data-timeout", String(args.dataTimeoutMs),
  ];
  if (args.channel) probeArgs.push("--channel", args.channel);
  if (args.skipSelfTest) probeArgs.push("--skip-self-test");
  if (args.headful) probeArgs.push("--headful");

  const probeResult = await run(process.execPath, probeArgs);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  await stopCapture(capture);

  console.log("\nReading final serial status...");
  const statusResult = await run("python3", [
    SERIAL_REPL,
    "--port", args.port,
    "--cmd", "status.get",
  ], { quiet: true });
  if (statusResult.ok) {
    if (statusResult.stdout) process.stdout.write(statusResult.stdout);
  } else {
    const lastLine = (statusResult.stderr || statusResult.stdout || "status.get failed")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .pop();
    console.log(`Final serial status read failed: ${lastLine}`);
  }

  const serialSummary = summarizeSerial(capture.lines);
  console.log("\nSerial summary:");
  console.log(JSON.stringify(serialSummary, null, 2));

  if (!probeResult.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
