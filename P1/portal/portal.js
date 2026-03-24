let v_major = 1;
let v_minor = 169;
let pVersion =v_major + "." +v_minor
let baseFont;
let baseMonoFont;
let simplexNoise;
let portalFontGuardInstalled = false;
let portalUserSetTextFont = false;
let portalResizeListenersInstalled = false;
let portalResizeSettleTimers = [];

function portalOverlayEnabled() {
  // Support both:
  //   const showOverlay = false;   // global lexical
  //   window.showOverlay = false;  // window property
  let lexicalValue;
  try {
    lexicalValue = (typeof showOverlay !== "undefined") ? showOverlay : undefined;
  } catch {
    lexicalValue = undefined;
  }
  if (typeof lexicalValue !== "undefined") return !!lexicalValue;
  if (typeof window.showOverlay !== "undefined") return !!window.showOverlay;
  return true;
}

function resolveBaseURL() {
  const normalizeDirURL = (raw) => {
    try {
      const u = new URL(raw, window.location.href);
      return u.href.endsWith("/") ? u.href : `${u.href}/`;
    } catch {
      return null;
    }
  };

  const isLocalDevHost = (hostname) => {
    if (!hostname) return false;
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".localdomain")
    );
  };

  const fromExplicitOverride = () => {
    try {
      const qp = new URLSearchParams(window.location.search);
      const fromQuery = qp.get("portalBaseURL");
      if (fromQuery) return normalizeDirURL(fromQuery);
    } catch {}
    if (typeof window.PORTAL_BASE_URL === "string" && window.PORTAL_BASE_URL) {
      return normalizeDirURL(window.PORTAL_BASE_URL);
    }
    return null;
  };

  const fromScriptSrc = (src) => {
    try {
      const u = new URL(src, window.location.href);
      const marker = "/portal/portal.js";
      const idx = u.pathname.lastIndexOf(marker);
      if (idx === -1) return null;
      const basePath = u.pathname.slice(0, idx + 1);
      return `${u.origin}${basePath}`;
    } catch {
      return null;
    }
  };

  const explicit = fromExplicitOverride();
  if (explicit) return explicit;

  const current = fromScriptSrc(document.currentScript?.src);
  if (current) {
    try {
      const scriptURL = new URL(current);
      const pageURL = new URL(window.location.href);
      if (isLocalDevHost(pageURL.hostname) && scriptURL.origin !== pageURL.origin) {
        return `${pageURL.origin}${scriptURL.pathname}`;
      }
    } catch {}
    return current;
  }

  const loaded = [...document.scripts]
    .map((s) => fromScriptSrc(s.src))
    .find(Boolean);
  if (loaded) {
    try {
      const scriptURL = new URL(loaded);
      const pageURL = new URL(window.location.href);
      if (isLocalDevHost(pageURL.hostname) && scriptURL.origin !== pageURL.origin) {
        return `${pageURL.origin}${scriptURL.pathname}`;
      }
    } catch {}
    return loaded;
  }

  return new URL("./", window.location.href).href;
}

let baseURL = resolveBaseURL();
const PORTAL_VERSION_STORAGE_KEY = "portal.version.lastLoaded";

const portalVersionCacheState = (() => {
  let changed = false;
  try {
    const last = localStorage.getItem(PORTAL_VERSION_STORAGE_KEY);
    changed = last !== pVersion;
    if (changed) localStorage.setItem(PORTAL_VERSION_STORAGE_KEY, pVersion);
  } catch {}
  return {
    changed,
    token: `_pv=${encodeURIComponent(pVersion)}`,
  };
})();

function shouldBustByVersion(url) {
  if (!portalVersionCacheState.changed) return false;
  try {
    const u = new URL(url, window.location.origin);
    if (u.searchParams.has("_pv")) return false;

    const portalBase = new URL(baseURL, window.location.href);
    const samePortalOrigin = u.origin === portalBase.origin;
    const underPortalPath =
      u.pathname.startsWith(portalBase.pathname) ||
      u.pathname.includes("/Portal/");

    return samePortalOrigin && underPortalPath;
  } catch {
    return false;
  }
}

const LIBRARIES = [
  "https://cdnjs.cloudflare.com/ajax/libs/webfont/1.6.28/webfontloader.js",
  "https://cdnjs.cloudflare.com/ajax/libs/crypto-js/3.1.2/rollups/aes.js",
 "portal/pNoise.js",
  "portal/uiSlim2.js",
 "portal/qrCodeGen.js",
 "portal/SoundFile.js"
];

function resolveSketchURL() {
  const fromExplicitOverride = () => {
    try {
      const qp = new URLSearchParams(window.location.search);
      const fromQuery = qp.get("portalSketch");
      if (fromQuery) return fromQuery;
    } catch {}
    if (typeof window.PORTAL_SKETCH_URL === "string" && window.PORTAL_SKETCH_URL) {
      return window.PORTAL_SKETCH_URL;
    }
    if (typeof window.urlToSketch === "string" && window.urlToSketch) {
      return window.urlToSketch;
    }
    return null;
  };

  const toEditorSketchUrl = (u) => {
    if (u.hostname.includes("editor.p5js.org")) return u.href;

    if (!u.hostname.includes("preview.p5js.org")) return null;

    // Common preview shape: /<user>/sketches/<id>
    if (u.pathname.includes("/sketches/")) {
      return `https://editor.p5js.org${u.pathname}`;
    }

    // Fallback if preview uses query params
    const user = u.searchParams.get("user") || u.searchParams.get("username");
    const sketch =
      u.searchParams.get("sketch") ||
      u.searchParams.get("project") ||
      u.searchParams.get("id");
    if (user && sketch) {
      return `https://editor.p5js.org/${user}/sketches/${sketch}`;
    }

    // Some runners keep the useful route in hash
    const hash = (u.hash || "").replace(/^#/, "");
    if (hash.includes("/sketches/")) {
      const route = hash.startsWith("/") ? hash : `/${hash}`;
      return `https://editor.p5js.org${route}`;
    }

    return null;
  };

  const scanObjectForEditorUrl = (obj, depth = 0, seen = new Set()) => {
    if (!obj || depth > 1 || seen.has(obj)) return null;
    seen.add(obj);

    const isEditorPath = (s) =>
      typeof s === "string" && /https?:\/\/editor\.p5js\.org\/[^/]+\/sketches\/[^/?#]+/i.test(s);

    const normalize = (s) => {
      const m = s.match(/https?:\/\/editor\.p5js\.org\/[^/]+\/sketches\/[^/?#]+/i);
      return m ? m[0] : null;
    };

    try {
      const keys = Object.keys(obj).slice(0, 200);
      for (const k of keys) {
        let v;
        try { v = obj[k]; } catch { continue; }
        if (isEditorPath(v)) return normalize(v);
        if (v && typeof v === "object") {
          const nested = scanObjectForEditorUrl(v, depth + 1, seen);
          if (nested) return nested;
        }
      }
    } catch {}
    return null;
  };

  const explicit = fromExplicitOverride();
  if (explicit) return explicit;

  const candidates = [window.location?.href, document.referrer];
  try { candidates.push(window.parent?.location?.href); } catch {}
  try { candidates.push(window.top?.location?.href); } catch {}

  // Chrome-specific hint; often only origin, but include it as a last-resort signal.
  try {
    const ao = window.location?.ancestorOrigins;
    if (ao && ao.length) candidates.push(...ao);
  } catch {}

  for (const raw of candidates) {
    if (!raw) continue;
    try {
      const u = new URL(raw);
      if (!/^https?:$/.test(u.protocol)) continue;

      const p5EditorUrl = toEditorSketchUrl(u);
      if (p5EditorUrl) return p5EditorUrl;

      // Generic hosted sketch URLs
      return u.href;
    } catch {}
  }

  const scanned = scanObjectForEditorUrl(window);
  if (scanned) return scanned;

  return "";
}

function isShareableSketchURL(raw) {
  if (!raw || typeof raw !== "string") return false;
  try {
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol)) return false;
    if (u.hostname.includes("preview.p5js.org")) return false;
    if (u.protocol === "blob:") return false;
    if (
      u.hostname === "localhost" ||
      u.hostname === "127.0.0.1" ||
      u.hostname === "::1" ||
      u.hostname.endsWith(".local") ||
      u.hostname.endsWith(".localdomain")
    ) return false;

    // For p5 editor, only allow canonical sketch URLs.
    if (u.hostname.includes("editor.p5js.org")) {
      return /\/[^/]+\/sketches\/[^/?#]+/.test(u.pathname);
    }
    return true;
  } catch {
    return false;
  }
}

//let urlToSketch ="";
let sketchQRCode;
let sketchQRCodeValid = false;

function isValidQRCodeObject(qr) {
  return !!(
    qr &&
    Number.isFinite(Number(qr.size)) &&
    Number(qr.size) > 0 &&
    typeof qr.getModule === "function"
  );
}

let pSetupRun = false;

function installLegacyUiAutopatchGuard() {
  const state = (window.__portalLegacyUiAutopatchGuard ??= {
    installed: false,
    inSketchDraw: false,
    warned: new Set(),
  });
  if (state.installed) return state;

  const wrap = (name) => {
    const original = window[name];
    if (typeof original !== "function") return;
    if (original.__portalLegacyGuardWrapped) return;

    const wrapped = function(...args) {
      if (state.inSketchDraw && !state.warned.has(name)) {
        state.warned.add(name);
        const err = new Error(
          `Legacy Portal UI call detected: ${name}() was called inside sketch draw(). ` +
          `Portal now auto-calls this from pSetup(), so remove the manual call from the sketch.`
        );
        console.error(err);
      }
      return original.apply(this, args);
    };
    wrapped.__portalLegacyGuardWrapped = true;
    window[name] = wrapped;
  };

  wrap("uiUpdateSimple");
  wrap("uiShowInfo");
  state.installed = true;
  return state;
}

async function pSetup() {
	if(pSetupRun)
	{
		console.log("pSetup called twice");
		return;
	}
	pSetupRun = true;
 // print("## Portal v: " + pVersion);
 
  console.log("## https://learn.hobye.dk/portal v:" + pVersion);
  console.log(baseURL);

  await loadLibraries();
  baseFont = await loadFont(baseURL + "assets/Rubik-Light.ttf");
  baseMonoFont = await loadFont(baseURL + "assets/RobotoMono-Regular.ttf");
  const legacyUiGuard = installLegacyUiAutopatchGuard();
  installPortalFontGuard();
  installPortalResizeListeners();
  
  textFont(baseFont);
  if (typeof window.draw === "function") {
    const originalDraw = window.draw;
    window.draw = function() {
      uiUpdateSimple();
      legacyUiGuard.inSketchDraw = true;
      try {
        originalDraw();
      } finally {
        legacyUiGuard.inSketchDraw = false;
      }
      if (portalOverlayEnabled() && uiShowInfo) uiShowInfo();
    };
  }
  
  
  
  if (typeof urlToSketch === "undefined" || !urlToSketch) {
    window.urlToSketch = resolveSketchURL();
  }

  if (isShareableSketchURL(window.urlToSketch || urlToSketch)) {
    const sourceUrl = window.urlToSketch || urlToSketch;
    window.urlToSketch = sourceUrl;
    const fullUrl = sourceUrl
      .replace("/sketches/", "/full/")
      .replace("/present/", "/full/");
    try {
      const qr = createQRCode(fullUrl);
      sketchQRCode = isValidQRCodeObject(qr) ? qr : undefined;
      sketchQRCodeValid = !!sketchQRCode;
    } catch (e) {
      console.warn("Portal QR generation failed:", e);
      sketchQRCode = undefined;
      sketchQRCodeValid = false;
    }
  } else {
    sketchQRCode = undefined;
    sketchQRCodeValid = false;
  }
}


function sNoise(step) {
  simplexNoise.noise2D(0, millis() / 1000);
}

function pDraw() {
  //translate(-width/2,-height/2);
}

function pDebugDash(show) {
  if (show) {
    textSize(20);
    text(pVersion, 50, 50);
  }
}

function _portalResolveCanvasResizeTarget() {
  const viewportWidth = Math.round(Math.max(
    Number(window.visualViewport?.width || 0),
    Number(window.innerWidth || 0),
    Number(document.documentElement?.clientWidth || 0),
    Number(document.body?.clientWidth || 0),
    Number(windowWidth || 0)
  ));
  const viewportHeight = Math.round(Math.max(
    Number(window.visualViewport?.height || 0),
    Number(window.innerHeight || 0),
    Number(document.documentElement?.clientHeight || 0),
    Number(document.body?.clientHeight || 0),
    Number(windowHeight || 0)
  ));

  if (typeof window.PORTAL_CANVAS_RESIZE_MODE === "string") {
    const mode = window.PORTAL_CANVAS_RESIZE_MODE.toLowerCase();
    if (mode === "none") return null;
    if (mode === "window") {
      return { width: viewportWidth, height: viewportHeight };
    }
  }

  const canvasEl =
    (typeof document !== "undefined" && document.querySelector("canvas")) || null;
  if (!canvasEl) {
    return { width: viewportWidth, height: viewportHeight };
  }

  const parent = canvasEl.parentElement;
  if (!parent || parent === document.body || parent.tagName === "MAIN") {
    return { width: viewportWidth, height: viewportHeight };
  }

  const rect = parent.getBoundingClientRect?.();
  const parentWidth = Math.floor(rect?.width || 0);
  const parentHeight = Math.floor(rect?.height || 0);

  const fillsWindowWidth = Math.abs(parentWidth - viewportWidth) <= 4;
  const fillsWindowHeight = Math.abs(parentHeight - viewportHeight) <= 4;

  if (fillsWindowWidth && fillsWindowHeight) {
    return { width: viewportWidth, height: viewportHeight };
  }

  if (parentWidth > 0 && parentHeight > 0) {
    return { width: parentWidth, height: parentHeight };
  }

  return { width: viewportWidth, height: viewportHeight };
}

function _portalShouldUseVisualViewportResize() {
  if (typeof window.PORTAL_CANVAS_RESIZE_MODE === "string") {
    const mode = window.PORTAL_CANVAS_RESIZE_MODE.toLowerCase();
    if (mode === "none") return false;
    if (mode === "window") return true;
  }

  const canvasEl =
    (typeof document !== "undefined" && document.querySelector("canvas")) || null;
  if (!canvasEl) return true;

  const parent = canvasEl.parentElement;
  if (!parent || parent === document.body) return true;
  if (parent.tagName === "MAIN") return true;

  const rect = parent.getBoundingClientRect?.();
  const parentWidth = Math.floor(rect?.width || 0);
  const parentHeight = Math.floor(rect?.height || 0);
  const viewportWidth = Math.round(window.visualViewport?.width || window.innerWidth || 0);
  const viewportHeight = Math.round(window.visualViewport?.height || window.innerHeight || 0);

  const fillsWindowWidth = Math.abs(parentWidth - viewportWidth) <= 4;
  const fillsWindowHeight = Math.abs(parentHeight - viewportHeight) <= 4;
  return fillsWindowWidth && fillsWindowHeight;
}

function _portalClearResizeSettleTimers() {
  for (const id of portalResizeSettleTimers) {
    try {
      window.clearTimeout(id);
    } catch {}
  }
  portalResizeSettleTimers = [];
}

function _portalApplyResolvedCanvasResizeOnce() {
  if (typeof resizeCanvas !== "function") return;
  const target = _portalResolveCanvasResizeTarget();
  if (!target) return;
  resizeCanvas(target.width, target.height);
}

function _portalApplyResolvedCanvasResize() {
  _portalClearResizeSettleTimers();
  _portalApplyResolvedCanvasResizeOnce();
  for (const delay of [120, 300]) {
    const id = window.setTimeout(() => {
      _portalApplyResolvedCanvasResizeOnce();
    }, delay);
    portalResizeSettleTimers.push(id);
  }
}

function windowResized() {
  _portalApplyResolvedCanvasResize();
}

function installPortalResizeListeners() {
  if (portalResizeListenersInstalled) return;
  portalResizeListenersInstalled = true;

  if (typeof document !== "undefined") {
    document.addEventListener("fullscreenchange", () => {
      _portalApplyResolvedCanvasResize();
    });
  }

  if (window.visualViewport && typeof window.visualViewport.addEventListener === "function") {
    window.visualViewport.addEventListener("resize", () => {
      if (!_portalShouldUseVisualViewportResize()) return;
      _portalApplyResolvedCanvasResize();
    });
  }
}

function fullScreenToggle() {
  try {
    const fs = fullscreen();
    const result = fullscreen(!fs);
    if (result && typeof result.catch === "function") {
      result.catch((err) => {
        const msg = err?.message || String(err || "fullscreen failed");
        console.warn("fullScreenToggle failed:", msg);
      });
    }
  } catch (err) {
    const msg = err?.message || String(err || "fullscreen failed");
    console.warn("fullScreenToggle failed:", msg);
  }
}

async function loadLibraries() {
  // Pause drawing until libraries are ready
  noLoop();

  // Start async load; when finished, resume the sketch
  await loadAllLibraries(LIBRARIES)
    .then(() => {
      loading = false;
    })
    .catch((err) => {
      statusMsg = err.message;
      console.error(err);
    })
    .finally(() => {
      if (!loading) loop();
    });
}
// 2) Tiny loader that returns a Promise for each script
function loadScript(url) {
  return new Promise((resolve, reject) => {
    if (url.startsWith("portal/")) url = baseURL + url;

    const normalizeSrc = (src) => {
      try {
        const u = new URL(src, window.location.origin);
        u.search = "";
        u.hash = "";
        return u.href;
      } catch {
        return src;
      }
    };

    const normalizedUrl = normalizeSrc(url);
    if ([...document.scripts].some((s) => normalizeSrc(s.src) === normalizedUrl))
      return resolve(url);

    if (shouldBustByVersion(url)) {
      url += url.includes("?")
        ? `&${portalVersionCacheState.token}`
        : `?${portalVersionCacheState.token}`;
    }

    const s = document.createElement("script");
    s.src = url;
    s.async = true;
    s.onload = () => {
      // console.log("Script loaded: " + url);
      resolve(url);
    };
    s.onerror = () => reject(new Error(`Failed to load: ${url}`));
    document.head.appendChild(s);
  });
}
// ✅ Works with p5.js v2+
// Example: const cam = await setupWebcamera(false, 640, 480, true, false);

async function setupWebcamera(
  front = true,
  w = 640,
  h = 480,
  flipped = false,
  maxTarget = false
) {
  const requestedW = Math.max(1, Number(w) || 640);
  const requestedH = Math.max(1, Number(h) || 480);
  const useMaxTarget = !!maxTarget;

  const constraints = {
    video: {
      width: { ideal: requestedW },
      height: { ideal: requestedH },
      facingMode: front ? { ideal: "user" } : { ideal: "environment" },
    },
    audio: false,
  };
  print(constraints);

  const video = createCapture(constraints, { flipped });
  video.size(requestedW, requestedH);
  video.attribute("playsinline", "");
  video.elt.muted = true;
  video.elt.autoplay = true;
  video.hide();

  await _waitForWebcameraReady(video);
  await _applyTargetResolution(video, {
    requestedW,
    requestedH,
    maxTarget: useMaxTarget,
  });
  syncVideoDimensions(video);
  _dispatchWebcameraReady(video, {
    front,
    flipped,
    requestedW,
    requestedH,
    maxTarget: useMaxTarget,
  });

  return video;
}

function syncVideoDimensions(p5Vid) {
  const el = p5Vid?.elt;
  if (!el) return;

  const realW = el.videoWidth;
  const realH = el.videoHeight;

  if (realW > 0 && realH > 0) {
    p5Vid.width  = realW;
    p5Vid.height = realH;

    el.width  = realW;
    el.height = realH;

    // this sets CSS width/height for the <video>, doesn't affect pixels in draw()
    p5Vid.size(realW, realH);
  }
}

async function _waitForWebcameraReady(p5Vid, timeoutMs = 4000) {
  const el = p5Vid?.elt;
  if (!el) return;

  const isReady = () =>
    el.readyState >= 2 &&
    Number(el.videoWidth) > 0 &&
    Number(el.videoHeight) > 0;

  try {
    el.setAttribute?.("playsinline", "");
    await el.play?.();
  } catch {}

  if (isReady()) {
    syncVideoDimensions(p5Vid);
    return;
  }

  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.removeEventListener?.("loadeddata", onReady);
      el.removeEventListener?.("loadedmetadata", onReady);
      el.removeEventListener?.("playing", onReady);
      clearTimeout(timer);
      resolve();
    };
    const onReady = () => {
      if (isReady()) finish();
    };
    const timer = setTimeout(finish, timeoutMs);

    el.addEventListener?.("loadeddata", onReady);
    el.addEventListener?.("loadedmetadata", onReady);
    el.addEventListener?.("playing", onReady);
  });

  syncVideoDimensions(p5Vid);
}

async function _applyTargetResolution(
  p5Vid,
  { requestedW = 640, requestedH = 480, maxTarget = false } = {}
) {
  const track = p5Vid?.elt?.srcObject?.getVideoTracks?.()?.[0];
  if (!track || typeof track.getCapabilities !== "function") return;

  const caps = track.getCapabilities() || {};
  const targetW = maxTarget
    ? _pickMaxCapabilityValue(caps.width, requestedW)
    : _pickClosestCapabilityValue(caps.width, requestedW);
  const targetH = maxTarget
    ? _pickMaxCapabilityValue(caps.height, requestedH)
    : _pickClosestCapabilityValue(caps.height, requestedH);

  if (!(targetW > 0 && targetH > 0) || typeof track.applyConstraints !== "function") return;

  try {
    await track.applyConstraints({
      width: { ideal: targetW },
      height: { ideal: targetH },
    });
    await _waitForWebcameraReady(p5Vid, 2500);
  } catch (err) {
    console.warn("setupWebcamera: could not apply target resolution constraints", err);
  }
}

function _pickClosestCapabilityValue(capability, requestedValue) {
  const requested = Math.max(1, Number(requestedValue) || 1);
  if (capability == null) return requested;

  const min = Number(capability.min);
  const max = Number(capability.max);
  const stepRaw = Number(capability.step);

  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= 0) {
    return requested;
  }

  const clamped = constrain(requested, min, max);
  if (!Number.isFinite(stepRaw) || stepRaw <= 0) {
    return Math.round(clamped);
  }

  const offset = clamped - min;
  const steps = offset / stepRaw;
  const lower = min + Math.floor(steps) * stepRaw;
  const upper = min + Math.ceil(steps) * stepRaw;
  const closest = Math.abs(lower - clamped) <= Math.abs(upper - clamped) ? lower : upper;
  return constrain(Math.round(closest), Math.round(min), Math.round(max));
}

function _pickMaxCapabilityValue(capability, fallbackValue) {
  if (capability == null) return Math.max(1, Number(fallbackValue) || 1);
  const max = Number(capability.max);
  if (!Number.isFinite(max) || max <= 0) {
    return Math.max(1, Number(fallbackValue) || 1);
  }
  return Math.round(max);
}

function _dispatchWebcameraReady(
  p5Vid,
  {
    front = true,
    flipped = false,
    requestedW = 0,
    requestedH = 0,
    maxTarget = false,
  } = {}
) {
  const el = p5Vid?.elt;
  if (!el) return;

  const detail = {
    video: p5Vid,
    width: Number(el.videoWidth || p5Vid.width || 0),
    height: Number(el.videoHeight || p5Vid.height || 0),
    requestedWidth: Number(requestedW || 0),
    requestedHeight: Number(requestedH || 0),
    front: !!front,
    flipped: !!flipped,
    maxTarget: !!maxTarget,
  };

  const ev = new CustomEvent("portal:webcamera-ready", { detail });
  window.dispatchEvent(ev);
  el.dispatchEvent(new CustomEvent("portal:webcamera-ready", { detail }));
}


function isLocal(url) {
  try {
    const parsedUrl = new URL(url, window.location.origin);
    const { hostname, origin } = parsedUrl;
    const isMdnsLikeHost =
      hostname.endsWith(".local") || hostname.endsWith(".localdomain");

    // Local if it's same-origin or localhost/127.x.x.x
    return (
      origin === window.location.origin ||
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      isMdnsLikeHost
    );
  } catch (e) {
    console.error("Invalid URL:", e);
    return false;
  }
}

// 3) Load all libraries (Promise that resolves when *all* are ready)
function loadAllLibraries(urls) {
  return Promise.all(urls.map(loadScript));
}

function loadGoogleFont(names) {
  return new Promise((resolve, reject) => {
    const families = Array.isArray(names) ? names : [names];
    WebFont.load({
      google: { families },
      active: () => resolve(families),
      inactive: () => reject(new Error("Failed to load fonts: " + families)),
    });
  });
}

function storedDecrypt(secretKeyVariable) {
  let name = Object.keys(secretKeyVariable)[0];
  let encryptedKey = Object.values(secretKeyVariable)[0];
  if (!encryptedKey || encryptedKey == "") {
    encryptKeyPrompt(name);
  }
  let password = getStoredKey(name, "password");

  return decryptKey(encryptedKey, password);
}

function getStoredKey(name, promptTxt = "key") {
  let keDecrypted = getKey(name);
  if (!keDecrypted) {
    keyDecrypted = prompt("Please enter " + promptTxt + "(" + name + "):", "");
    if (keyDecrypted) {
      storeKey(name, keyDecrypted);
      return keyDecrypted;
    } else {
      return null;
    }
  }
  return keDecrypted;
}

function decryptKey(encryptedKey, password) {
  if (password) {
    let decryptedKey = CryptoJS.AES.decrypt(encryptedKey, password);
    return decryptedKey.toString(CryptoJS.enc.Utf8);
  }
}

function deCryptKeyPrompt(secretKeyVariable) {
  let name = Object.keys(secretKeyVariable)[0];
  let encryptedKey = Object.values(secretKeyVariable)[0];
  if (!encryptedKey || encryptedKey == "") {
    encryptKeyPrompt(name);
  }
  let password = getStoredKey(name, "password");

  return decryptKey(encryptedKey, password);
}

function encryptKey(key, password) {
  if (key && password) {
    return CryptoJS.AES.encrypt(key, password);
  }
}

function encryptKeyPrompt(variablename) {
  let key = prompt("Please enter key:", "");
  let password = prompt("Please enter password for " + variablename, "");
  let encryptedKey = encryptKey(key, password);
  print("##### INSERT THE CODE BELOW IN YOUR SKETCH ###");
  print("let " + variablename + ' ="' + encryptedKey + '"');
}

let storage_password = "sdlkjwelkfjwelkj"; // local storage password, not perfect but better than storing values in clear text.
function storeKey(name, key) {
  keyEncrypted = encryptKey(key, storage_password);
  window.localStorage.setItem(name, keyEncrypted);
}

function getKey(name) {
  let keyEncrypted = window.localStorage.getItem(name);
  if (keyEncrypted) return decryptKey(keyEncrypted, storage_password);
  else return null;
}

function pointFromAngle(x0, y0, length, degrees) {
  const radians = (degrees * Math.PI) / 180;
  const x = x0 + Math.cos(radians) * length;
  const y = y0 + Math.sin(radians) * length;
  return { x, y };
}

function generateID() {
  let length = Math.floor(Math.random() * 6) + 5;
  const consonants = [
    "b",
    "c",
    "d",
    "f",
    "g",
    "h",
    "j",
    "k",
    "l",
    "m",
    "n",
    "p",
    "qu",
    "r",
    "s",
    "t",
    "v",
    "w",
    "x",
    "y",
    "z",
    "bl",
    "cl",
    "fl",
    "gl",
    "pl",
    "sl",
    "br",
    "cr",
    "dr",
    "fr",
    "gr",
    "pr",
    "tr",
    "ch",
    "sh",
    "th",
    "wh",
    "wr",
  ];

  const vowels = [
    "a",
    "e",
    "i",
    "o",
    "u",
    "ae",
    "ai",
    "ea",
    "ee",
    "ie",
    "oa",
    "oo",
    "ou",
    "ue",
  ];

  let word = "";
  let useConsonant = Math.random() > 0.5; // random start with consonant or vowel

  while (word.length < length) {
    if (useConsonant) {
      word += consonants[Math.floor(Math.random() * consonants.length)];
    } else {
      word += vowels[Math.floor(Math.random() * vowels.length)];
    }
    useConsonant = !useConsonant; // alternate consonant/vowel
  }

  // Capitalize first letter for realism
  return word.charAt(0).toUpperCase() + word.slice(1, length);
}

function getData(url) {
  return fetch(url)
    .then((res) => res.json())
    .then((out) => {
      console.log("Got JSON", out);
      return out;
    })
    .catch((err) => {
      throw err;
    });
}


function getP5Instance() {
  if (window.p5?.instance) return window.p5.instance;
  if (window._globalP5Instance) return window._globalP5Instance;

  for (const v of Object.values(window)) {
    if (
      v &&
      window.p5 &&
      v instanceof window.p5 &&
      typeof v._setProperty === "function"
    ) return v;
  }
  return null;
}

function installPortalFontGuard() {
  if (portalFontGuardInstalled) return;
  portalFontGuardInstalled = true;

  const originalTextFont = window.textFont;
  if (typeof originalTextFont === "function") {
    window.textFont = function(...args) {
      if (args.length > 0 && args[0]) {
        portalUserSetTextFont = true;
      }
      return originalTextFont.apply(this, args);
    };
    window.textFont.__portalOriginal = originalTextFont;
  }
}

function portalEnsureWebglDefaultFontAfterSetup() {
  const p = getP5Instance();
  if (!p || !baseFont) return;

  const renderer = p?._renderer;
  const isWebgl = !!(renderer && renderer.isP3D);
  if (!isWebgl) return;
  if (portalUserSetTextFont) return;

  const applyTextFont =
    window.textFont?.__portalOriginal ||
    window.textFont;
  if (typeof applyTextFont !== "function") return;

  try {
    applyTextFont.call(window, baseFont);
    console.warn("Error no font for WEBGL - Portal set the default");
  } catch (err) {
    console.warn("Portal could not apply default WEBGL font:", err);
  }
}
