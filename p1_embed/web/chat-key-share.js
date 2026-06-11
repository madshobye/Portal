import { product } from "./app-config.js?v=0.1.87-ui748";

const KEY_SHARE_END_MARKER = ":xobit-key-end";
const KEY_SHARE_PAYLOAD_PATTERN = "[A-Za-z0-9_-]{80,}";
const KEY_SHARE_PREFIXES = () => [product.keySharePrefix, product.legacyKeySharePrefix, "v1:"];

export function cryptoAvailable() {
  return Boolean(globalThis.crypto?.subtle && globalThis.crypto?.getRandomValues);
}

export function isEncryptedChatKeyShare(text = "") {
  return Boolean(extractEncryptedChatKeyShare(text));
}

export async function createEncryptedChatKeyShareToken({
  apiKey,
  password,
  days = 7,
} = {}) {
  if (!cryptoAvailable()) throw new Error("WebCrypto is not available");
  if (!apiKey) throw new Error("No API key stored");
  if (!password) throw new Error("Enter a share password");
  const boundedDays = Math.max(1, Math.min(365, Math.round(Number(days) || 7)));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveChatKeyShareCryptoKey(password, salt);
  const payload = {
    apiKey,
    exp: Date.now() + boundedDays * 24 * 60 * 60 * 1000,
  };
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded));
  const share = {
    v: 1,
    alg: "PBKDF2-SHA256+A256GCM",
    iter: 150000,
    salt: base64UrlEncode(salt),
    iv: base64UrlEncode(iv),
    ct: base64UrlEncode(cipher),
  };
  return {
    days: boundedDays,
    token: `${product.keySharePrefix}${base64UrlEncode(new TextEncoder().encode(JSON.stringify(share)))}${KEY_SHARE_END_MARKER}`,
  };
}

export async function decryptEncryptedChatKeyShare(token, password) {
  if (!cryptoAvailable()) throw new Error("WebCrypto is not available");
  if (!password) return null;
  const share = parseEncryptedChatKeyShare(token);
  const salt = base64UrlDecode(share.salt);
  const iv = base64UrlDecode(share.iv);
  const cipher = base64UrlDecode(share.ct);
  const key = await deriveChatKeyShareCryptoKey(password, salt, Number(share.iter) || 150000);
  let decrypted;
  try {
    decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  } catch {
    throw new Error("Encrypted key password did not work");
  }
  const payload = JSON.parse(new TextDecoder().decode(decrypted));
  if (!payload?.apiKey || typeof payload.apiKey !== "string") throw new Error("Encrypted key payload is invalid");
  if (Number(payload.exp) && Date.now() > Number(payload.exp)) throw new Error("Encrypted key share has expired");
  return payload.apiKey;
}

function parseEncryptedChatKeyShare(token) {
  const raw = extractEncryptedChatKeyShare(token);
  if (!raw) throw new Error(`Not a ${product.name} encrypted key share`);
  const prefix = raw.startsWith(product.keySharePrefix)
    ? product.keySharePrefix
    : raw.startsWith(product.legacyKeySharePrefix)
      ? product.legacyKeySharePrefix
      : "v1:";
  const share = parseEncryptedChatKeySharePayload(raw.slice(prefix.length));
  if (!share || share.v !== 1 || !share.salt || !share.iv || !share.ct) {
    throw new Error("Encrypted key share is invalid");
  }
  return share;
}

export function extractEncryptedChatKeyShare(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const prefixPattern = KEY_SHARE_PREFIXES().map(escapeRegex).join("|");
  const marked = new RegExp(`(?:${prefixPattern})${KEY_SHARE_PAYLOAD_PATTERN}${escapeRegex(KEY_SHARE_END_MARKER)}`).exec(raw);
  if (marked) return marked[0].slice(0, -KEY_SHARE_END_MARKER.length);
  const loose = new RegExp(`(?:${prefixPattern})${KEY_SHARE_PAYLOAD_PATTERN}`).exec(raw);
  return loose?.[0] || "";
}

function escapeRegex(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseEncryptedChatKeySharePayload(payload) {
  let candidate = String(payload || "").replace(new RegExp(`${escapeRegex(KEY_SHARE_END_MARKER)}.*$`), "");
  while (candidate.length >= 80) {
    try {
      return JSON.parse(new TextDecoder().decode(base64UrlDecode(candidate)));
    } catch {
      candidate = candidate.slice(0, -1);
    }
  }
  throw new Error("Encrypted key share is invalid");
}

async function deriveChatKeyShareCryptoKey(password, salt, iterations = 150000) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function base64UrlEncode(bytes) {
  const chars = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(chars).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(text) {
  const normalized = String(text || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}
