export const VJ1_MINIMUM_CHROME_MAJOR = 150;

const reportedHosts = new WeakMap();

export function reportBrowserCompatibility({ host = globalThis, mode = "control" } = {}) {
  if (!host || (typeof host !== "object" && typeof host !== "function")) return null;
  const prior = reportedHosts.get(host);
  if (prior) return prior;

  const browser = chromeBrowserIdentity(host.navigator || {});
  const missing = requiredBrowserCapabilities(host, mode);
  const gpu = probeWebGl2(host);
  if (!gpu.supported) missing.push("WebGL2");
  else if (gpu.maxTextureSize < 8192 || gpu.maxRenderbufferSize < 8192) {
    missing.push(`GPU texture/renderbuffer size >= 8192 (found ${gpu.maxTextureSize}/${gpu.maxRenderbufferSize})`);
  }
  const wrongBrowser = !browser.isGoogleChrome;
  const oldBrowser = browser.major > 0 && browser.major < VJ1_MINIMUM_CHROME_MAJOR;
  const supported = !wrongBrowser && !oldBrowser && !missing.length;
  const status = { browser, gpu, missing, wrongBrowser, oldBrowser, supported };
  reportedHosts.set(host, status);
  if (supported) return status;

  host.console?.warn?.("[VJ1_BROWSER_UNSUPPORTED]", {
    expected: `Google Chrome ${VJ1_MINIMUM_CHROME_MAJOR}+ with WebGL2 and the required modern browser APIs`,
    detected: browser.label,
    wrongBrowser,
    oldBrowser,
    missing,
    gpu,
    message: "VJ1 targets current Google Chrome on a capable GPU. Unsupported environments may fail; compatibility render fallbacks are not part of the supported architecture.",
  });
  return status;
}

export function assertP5RenderCapabilities(host = globalThis) {
  const missing = [
    ["p5.createFramebuffer", host.createFramebuffer],
    ["p5.createGraphics", host.createGraphics],
    ["p5.createImage", host.createImage],
    ["p5.loadFont", host.loadFont],
    ["p5.textFont", host.textFont],
  ].filter(([, value]) => typeof value !== "function").map(([name]) => name);
  if (!missing.length) return Object.freeze({ supported: true, missing: [] });
  const error = new Error(`VJ1_RENDER_CAPABILITY_REQUIRED:${missing.join(",")}`);
  error.code = "VJ1_RENDER_CAPABILITY_REQUIRED";
  error.missing = missing;
  throw error;
}

export function chromeBrowserIdentity(navigatorValue = {}) {
  const brands = Array.from(navigatorValue.userAgentData?.brands || []);
  const googleBrand = brands.find((brand) => brand?.brand === "Google Chrome");
  const userAgent = String(navigatorValue.userAgent || "");
  const chromeMatch = userAgent.match(/(?:Chrome|CriOS)\/(\d+)/);
  const excludedChromiumShell = /(?:Edg|OPR|Opera|SamsungBrowser)\//.test(userAgent);
  const major = Number(googleBrand?.version || chromeMatch?.[1]) || 0;
  const isGoogleChrome = !!googleBrand || (!!chromeMatch && !excludedChromiumShell);
  return {
    isGoogleChrome,
    major,
    label: isGoogleChrome ? `Google Chrome ${major || "unknown"}` : (userAgent || "unknown browser"),
  };
}

function requiredBrowserCapabilities(host, mode) {
  const required = [
    ["BroadcastChannel", host.BroadcastChannel],
    ["Worker", host.Worker],
    ["OffscreenCanvas", host.OffscreenCanvas],
    ["createImageBitmap", host.createImageBitmap],
    ["requestAnimationFrame", host.requestAnimationFrame],
    ["requestIdleCallback", host.requestIdleCallback],
    ["ResizeObserver", host.ResizeObserver],
    ["IntersectionObserver", host.IntersectionObserver],
    ["PerformanceObserver", host.PerformanceObserver],
    ["structuredClone", host.structuredClone],
    ["HTMLVideoElement.requestVideoFrameCallback", host.HTMLVideoElement?.prototype?.requestVideoFrameCallback],
    ["HTMLVideoElement.cancelVideoFrameCallback", host.HTMLVideoElement?.prototype?.cancelVideoFrameCallback],
    ["navigator.mediaDevices.getDisplayMedia", host.navigator?.mediaDevices?.getDisplayMedia],
  ];
  if (mode === "control") {
    required.push(["showDirectoryPicker", host.showDirectoryPicker]);
    required.push(["FileSystemObserver", host.FileSystemObserver]);
  }
  return required.filter(([, value]) => typeof value !== "function").map(([name]) => name);
}

function probeWebGl2(host) {
  const canvas = host.document?.createElement?.("canvas");
  if (!canvas?.getContext) return { supported: typeof host.WebGL2RenderingContext === "function", maxTextureSize: 0, maxRenderbufferSize: 0 };
  let gl = null;
  try {
    gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      failIfMajorPerformanceCaveat: true,
    });
    if (!gl) return { supported: false, maxTextureSize: 0, maxRenderbufferSize: 0 };
    return {
      supported: true,
      maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0,
      maxRenderbufferSize: Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)) || 0,
    };
  } catch (error) {
    return { supported: false, maxTextureSize: 0, maxRenderbufferSize: 0, message: error?.message || String(error) };
  } finally {
    gl?.getExtension?.("WEBGL_lose_context")?.loseContext?.();
  }
}
