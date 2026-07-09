import { VJ1 } from "../constants.js";

export async function loadVjRenderFont() {
  await callPortalSetup();
  return getPortalFont() || await loadFontAsync(VJ1.renderFont);
}

export function applyFontToTarget(target, font) {
  if (!font || typeof target?.textFont !== "function") return;
  try {
    target.textFont(font);
  } catch {}
}

export function applyFontToGlobal(font) {
  if (!font || typeof textFont !== "function") return;
  try {
    textFont(font);
  } catch {}
}

async function callPortalSetup() {
  const setup = getPortalSetup();
  if (typeof setup !== "function") return;
  await setup();
}

function getPortalSetup() {
  try {
    return Function("return typeof pSetup === 'function' ? pSetup : null")();
  } catch {
    return null;
  }
}

function getPortalFont() {
  try {
    return Function("return typeof baseMonoFont !== 'undefined' ? baseMonoFont : (typeof baseFont !== 'undefined' ? baseFont : null)")();
  } catch {
    return null;
  }
}

function loadFontAsync(path) {
  if (typeof loadFont !== "function") return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (font) => {
      if (settled) return;
      settled = true;
      resolve(font || null);
    };
    try {
      const maybeFont = loadFont(path, finish, () => finish(null));
      if (maybeFont && typeof maybeFont.then === "function") {
        maybeFont.then(finish).catch(() => finish(null));
      }
    } catch {
      finish(null);
    }
  });
}
