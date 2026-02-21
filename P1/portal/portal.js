let v_major = 1;
let v_minor = 17;
let pVersion =v_major + "." +v_minor
let baseFont;
let baseMonoFont;
let simplexNoise;

function resolveBaseURL() {
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

  const current = fromScriptSrc(document.currentScript?.src);
  if (current) return current;

  const loaded = [...document.scripts]
    .map((s) => fromScriptSrc(s.src))
    .find(Boolean);
  if (loaded) return loaded;

  return new URL("./", window.location.href).href;
}

let baseURL = resolveBaseURL();

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

let pSetupRun = false;

async function pSetup() {
	if(pSetupRun)
	{
		console.log("pSetup called twice");
		return;
	}
	pSetupRun = true;
 // print("## Portal v: " + pVersion);
  print("## https://learn.hobye.dk/portal v:" + pVersion);
  print(baseURL);
  await loadLibraries();
  baseFont = await loadFont(baseURL + "assets/Rubik-Light.ttf");
  baseMonoFont = await loadFont(baseURL + "assets/RobotoMono-Regular.ttf");
  
  textFont(baseFont);
  const originalDraw = draw;
  draw = function() {
    uiUpdateSimple();
    originalDraw();
    if(uiShowInfo)uiShowInfo();
  };
  
  
  
  if (typeof urlToSketch === "undefined" || !urlToSketch) {
    window.urlToSketch = resolveSketchURL();
  }

  if (isShareableSketchURL(window.urlToSketch || urlToSketch)) {
    const sourceUrl = window.urlToSketch || urlToSketch;
    window.urlToSketch = sourceUrl;
    const fullUrl = sourceUrl
      .replace("/sketches/", "/full/")
      .replace("/present/", "/full/");
    sketchQRCode = createQRCode(fullUrl);
  } else {
    sketchQRCode = undefined;
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

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function fullScreenToggle() {
  var fs = fullscreen();
  fullscreen(!fs);
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

    if (isLocal(url)) {
      const bust = `_cb=${Date.now()}`;
      url += url.includes("?") ? `&${bust}` : `?${bust}`;
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
// Example: const cam = setupWebcamera(320, 240, true, true);

function setupWebcamera(front = true, w = 640, h = 480,flipped = false) {
  // Choose the facing mode
   /* mandatory: {
        minWidth: 1280,
        minHeight: 720
      },*/
  
  
  const constraints = {
    video: {
    
      width:   w ,
      height:  h ,
     
      facingMode: front ? { ideal: "user" } : { ideal: "environment" }
    
    },
    audio: false
  };
 print(constraints);

  // Use p5.js v2 `flipped` option directly
  const video = createCapture(constraints, { flipped });
 // print(video.getCapabilities());
  // Configure the video element
  video.size(w, h);
  video.attribute("playsinline", "");  // iOS support
  video.elt.muted = true;
  video.elt.autoplay = true;
  video.hide();                        // Hide the DOM element (draw with image())

  return video; // return the p5.MediaElement
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


function isLocal(url) {
  try {
    const parsedUrl = new URL(url, window.location.origin);
    const { hostname, origin } = parsedUrl;

    // Local if it's same-origin or localhost/127.x.x.x
    return (
      origin === window.location.origin ||
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1"
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
