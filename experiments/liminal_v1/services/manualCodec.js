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
    const bytes = new TextEncoder().encode(json);
    const b64 = btoa(bytesToBinary(bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    return `${bundle.t}-` + b64;
  }

  function fromBundleString(value) {
    const trimmed = String(value || "").trim();
    const type = trimmed.slice(0, 2).toUpperCase();
    if ((type !== "OB" && type !== "AB") || trimmed[2] !== "-") {
      throw new Error('Expected "OB-..." or "AB-..."');
    }
    const b64 = trimmed.slice(3).replace(/-/g, "+").replace(/_/g, "/");
    const bytes = binaryToBytes(atob(b64));
    const json = new TextDecoder().decode(bytes);
    const bundle = JSON.parse(json);
    if (bundle.t !== type) {
      throw new Error("Bundle type mismatch");
    }
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

  function buildResponseLink(bundleString, room, inviteId, peerId) {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("response", bundleString);
    url.searchParams.set("room", room);
    url.searchParams.set("invite", inviteId);
    url.searchParams.set("peer", peerId);
    return url.toString();
  }

  function extractValue(raw, paramName) {
    if (!/^https?:\/\//i.test(String(raw || "").trim())) {
      return String(raw || "").trim();
    }

    const url = new URL(raw);
    const value = url.searchParams.get(paramName);
    if (!value) {
      throw new Error(`Missing ${paramName} in link`);
    }
    return value;
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

  window.LiminalV1ManualCodec = {
    createSignalBundle,
    buildSdpFromBundle,
    toBundleString,
    fromBundleString,
    buildInviteLink,
    buildResponseLink,
    extractValue,
    qrCodeToSvgDataUrl,
  };
})();
