import { product } from "./app-config.js?v=0.1.87-ui728";

export function normalizePeerId(value) {
  return String(value || "").trim().toLowerCase();
}

export function normalizeUsbHint(hint) {
  const vendor = Number(hint?.usbVendorId);
  const product = Number(hint?.usbProductId);
  if (!Number.isFinite(vendor) || !Number.isFinite(product)) return null;
  return { usbVendorId: vendor, usbProductId: product };
}

export function usbHintFromParams(params) {
  const usb = String(params.get("usb") || "").trim();
  const usbMatch = usb.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (usbMatch) {
    return normalizeUsbHint({
      usbVendorId: parseInt(usbMatch[1], 16),
      usbProductId: parseInt(usbMatch[2], 16),
    });
  }

  const vid = String(params.get("vid") || "").trim();
  const pid = String(params.get("pid") || "").trim();
  if (!vid || !pid) return null;
  return normalizeUsbHint({
    usbVendorId: parseInt(vid, 16),
    usbProductId: parseInt(pid, 16),
  });
}

export function usbHintLabel(hint) {
  const vendor = Number(hint?.usbVendorId);
  const product = Number(hint?.usbProductId);
  if (!Number.isFinite(vendor) || !Number.isFinite(product)) return "device";
  return `${vendor.toString(16).padStart(4, "0")}:${product.toString(16).padStart(4, "0")}`;
}

export function pickPortFromHint(ports, hint) {
  if (!hint || !Array.isArray(ports)) return null;
  const vendor = Number(hint.usbVendorId);
  const product = Number(hint.usbProductId);
  if (!Number.isFinite(vendor) || !Number.isFinite(product)) return null;
  return ports.find((port) => {
    const info = port.getInfo?.() || {};
    return info.usbVendorId === vendor && info.usbProductId === product;
  }) || null;
}

export function normalizeWebSocketUrl(value) {
  const raw = value.trim();
  if (!raw) throw new Error("WebSocket URL is required");
  const withScheme = /^wss?:\/\//i.test(raw) ? raw : `ws://${raw}`;
  const url = new URL(withScheme);
  if (!url.port) url.port = "81";
  if (!url.pathname || url.pathname === "") url.pathname = "/";
  return url.toString();
}

export function wsDisplayName(url) {
  if (!url) return "";
  try {
    const parsed = new URL(normalizeWebSocketUrl(url));
    return parsed.host || parsed.hostname || url;
  } catch {
    return url;
  }
}

export function defaultPeerIdFromWebSocket(value, fallback = `${product.deviceIdPrefix}-f7a608`) {
  try {
    const host = new URL(normalizeWebSocketUrl(value)).hostname;
    return normalizePeerId(host.replace(/\.local$/i, ""));
  } catch {
    return fallback;
  }
}

export function isLoopbackHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "::1" || host.startsWith("127.");
}
