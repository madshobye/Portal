(() => {
  function extractNegotiationFields(sdp, type) {
    const lines = String(sdp || "").split(/\r?\n/).filter(Boolean);
    const findValue = (prefix) => {
      const line = lines.find((entry) => entry.startsWith(prefix));
      return line ? line.slice(prefix.length).trim() : "";
    };

    return {
      iceUfrag: findValue("a=ice-ufrag:"),
      icePwd: findValue("a=ice-pwd:"),
      fingerprint: findValue("a=fingerprint:"),
      setup: findValue("a=setup:") || (type === "AB" ? "active" : "actpass"),
    };
  }

  function pickCandidates(candidates) {
    const list = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
    const selected = [];

    const host = list.find((candidate) => /\styp host(\s|$)/.test(candidate));
    if (host) selected.push(host);

    const srflx = list.find((candidate) => /\styp srflx(\s|$)/.test(candidate));
    if (srflx && !selected.includes(srflx)) selected.push(srflx);

    for (const candidate of list) {
      if (selected.length >= 3) break;
      if (!selected.includes(candidate)) selected.push(candidate);
    }

    return selected;
  }

  function createSignalBundle(type, sdp, candidates) {
    const fields = extractNegotiationFields(sdp, type);
    return {
      t: type,
      u: fields.iceUfrag,
      p: fields.icePwd,
      f: fields.fingerprint,
      a: fields.setup,
      c: pickCandidates(candidates),
    };
  }

  function makeSessionId(type, fingerprint, iceUfrag, icePwd) {
    const seed = `${type}|${fingerprint}|${iceUfrag}|${icePwd}`;
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash * 33 + seed.charCodeAt(i)) >>> 0;
    }
    return `1${String(hash).padStart(9, "0")}23456789`;
  }

  function buildSdpFromBundle(bundle) {
    const type = bundle?.t === "AB" ? "AB" : "OB";
    const setup = bundle?.a || (type === "AB" ? "active" : "actpass");
    const sessionId = makeSessionId(type, bundle?.f || "", bundle?.u || "", bundle?.p || "");

    return [
      "v=0",
      `o=- ${sessionId} 2 IN IP4 127.0.0.1`,
      "s=-",
      "t=0 0",
      "a=group:BUNDLE 0",
      "a=msid-semantic: WMS",
      "m=application 9 DTLS/SCTP 5000",
      "c=IN IP4 0.0.0.0",
      `a=ice-ufrag:${bundle?.u || ""}`,
      `a=ice-pwd:${bundle?.p || ""}`,
      "a=ice-options:trickle",
      `a=fingerprint:${bundle?.f || ""}`,
      `a=setup:${setup}`,
      "a=mid:0",
      "a=sctpmap:5000 webrtc-datachannel 1024",
      "",
    ].join("\r\n");
  }

  function bytesToBinary(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return binary;
  }

  function binaryToBytes(binary) {
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function toBundleString(bundle) {
    const json = JSON.stringify(bundle);
    const raw = new TextEncoder().encode(json);
    const bytes = globalThis.fflate?.zlibSync ? globalThis.fflate.zlibSync(raw, { level: 9 }) : raw;
    const compressed = !!globalThis.fflate?.zlibSync;
    const b64 = btoa(bytesToBinary(bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    return `${bundle.t}${compressed ? "Z" : ""}-` + b64;
  }

  function fromBundleString(value) {
    const trimmed = String(value || "").trim();
    const type = trimmed.slice(0, 2).toUpperCase();
    const compressionFlag = trimmed[2];
    let compressed = false;
    let offset = 3;

    if (type !== "OB" && type !== "AB") {
      throw new Error('Expected "OB-..." / "AB-..." or compressed "OBZ-..." / "ABZ-..."');
    }
    if (compressionFlag === "-") {
      compressed = false;
      offset = 3;
    } else if (compressionFlag === "Z" && trimmed[3] === "-") {
      compressed = true;
      offset = 4;
    } else {
      throw new Error('Expected "OB-..." / "AB-..." or compressed "OBZ-..." / "ABZ-..."');
    }

    const b64 = trimmed.slice(offset).replace(/-/g, "+").replace(/_/g, "/");
    const bytes = binaryToBytes(atob(b64));
    const out = compressed && globalThis.fflate?.unzlibSync ? globalThis.fflate.unzlibSync(bytes) : bytes;
    const json = new TextDecoder().decode(out);
    const bundle = JSON.parse(json);
    if (bundle.t !== type) throw new Error("Bundle type mismatch");
    return bundle;
  }

  function buildInviteLink(bundleString, room, inviteId, hostId) {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("connect", bundleString);
    url.searchParams.set("room", room);
    url.searchParams.set("invite", inviteId);
    url.searchParams.set("host", hostId);
    return url.toString();
  }

  function buildResponseLink(bundleString, room, inviteId, hostId) {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("response", bundleString);
    url.searchParams.set("room", room);
    url.searchParams.set("invite", inviteId);
    url.searchParams.set("host", hostId);
    return url.toString();
  }

  function tryCreateQrCode(value) {
    try {
      return value ? window.RtcChatV3Qr.encodeQr(value) : null;
    } catch (error) {
      console.warn("[rtcchat_v3] QR generation unavailable for current link", error);
      return null;
    }
  }

  function qrCodeToSvgDataUrl(qr) {
    if (!qr || !Number.isFinite(qr.size) || typeof qr.getModule !== "function") return "";
    const quiet = 4;
    const size = qr.size + quiet * 2;
    let cells = "";
    for (let y = 0; y < qr.size; y++) {
      for (let x = 0; x < qr.size; x++) {
        if (qr.getModule(x, y)) {
          cells += `<rect x="${x + quiet}" y="${y + quiet}" width="1" height="1" />`;
        }
      }
    }
    const svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">`,
      `<rect width="${size}" height="${size}" fill="#ffffff"/>`,
      `<g fill="#000000">${cells}</g>`,
      "</svg>",
    ].join("");
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  function extractBundleFromPossibleUrl(raw, paramName) {
    if (/^https?:\/\//i.test(raw)) {
      const url = new URL(raw);
      const value = url.searchParams.get(paramName);
      if (!value) throw new Error(`Missing ${paramName} in link`);
      return value;
    }
    return raw;
  }

  function extractResponseValue(raw) {
    if (!/^https?:\/\//i.test(raw)) {
      return raw;
    }

    const url = new URL(raw);
    const responseValue = url.searchParams.get("response");
    if (responseValue) {
      return responseValue;
    }

    if (url.searchParams.get("connect")) {
      throw new Error("That looks like an invite link, not a response link.");
    }

    throw new Error("No response was found in that link.");
  }

  function clearIncomingParams() {
    const url = new URL(window.location.href);
    if (url.search) {
      url.search = "";
      window.history.replaceState({}, "", url.toString());
    }
  }

  function bundleSummary(bundle) {
    const sdp = buildSdpFromBundle(bundle);
    return {
      type: bundle.t === "OB" ? "offer-bundle" : "answer-bundle",
      mode: "compact-lounge",
      payloadLength: JSON.stringify(bundle).length,
      sdpType: bundle.t === "OB" ? "offer" : "answer",
      sdpLength: sdp.length,
      candidateCount: Array.isArray(bundle.c) ? bundle.c.length : 0,
      candidates: Array.isArray(bundle.c) ? bundle.c : [],
      sdpPreview: sdp.split("\n").slice(0, 12),
    };
  }

  function logBundle(label, payload, bundle) {
    console.log(`[rtcchat_v3] ${label} string`);
    console.log(payload);
    console.log(`[rtcchat_v3] ${label} json`);
    console.log(JSON.stringify(bundleSummary(bundle), null, 2));
  }

  function logParsedBundle(label, payload, bundle) {
    console.log(`[rtcchat_v3] ${label} string`);
    console.log(payload);
    console.log(`[rtcchat_v3] ${label} parsed json`);
    console.log(JSON.stringify(bundleSummary(bundle), null, 2));
  }

  window.RtcChatV3BundleCodec = {
    createSignalBundle,
    buildSdpFromBundle,
    toBundleString,
    fromBundleString,
    buildInviteLink,
    buildResponseLink,
    tryCreateQrCode,
    qrCodeToSvgDataUrl,
    extractBundleFromPossibleUrl,
    extractResponseValue,
    clearIncomingParams,
    logBundle,
    logParsedBundle,
    bundleSummary,
  };
})();
