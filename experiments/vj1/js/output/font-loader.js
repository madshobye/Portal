import { VJ1 } from "../constants.js";

export async function loadVjRenderFont() {
  await callPortalSetup();
  return getPortalFont() || await loadFontAsync(VJ1.renderFont);
}

export function applyFontToTarget(target, font) {
  if (!font || typeof target?.textFont !== "function") return;
  try {
    target.textFont(font);
  } catch (error) {
    console.warn("[VJ1_FONT_TARGET_FALLBACK]", { fallback: "target default font", message: error?.message || String(error) });
  }
}

export function applyFontToGlobal(font) {
  if (!font || typeof textFont !== "function") return;
  try {
    textFont(font);
  } catch (error) {
    console.warn("[VJ1_FONT_GLOBAL_FALLBACK]", { fallback: "global default font", message: error?.message || String(error) });
  }
}

async function callPortalSetup() {
  const setup = getPortalSetup();
  if (typeof setup !== "function") return;
  await setup();
}

function getPortalSetup() {
  try {
    return Function("return typeof pSetup === 'function' ? pSetup : null")();
  } catch (error) {
    console.warn("[VJ1_PORTAL_SETUP_UNAVAILABLE]", { fallback: "direct font loading", message: error?.message || String(error) });
    return null;
  }
}

function getPortalFont() {
  try {
    return Function("return typeof baseMonoFont !== 'undefined' ? baseMonoFont : (typeof baseFont !== 'undefined' ? baseFont : null)")();
  } catch (error) {
    console.warn("[VJ1_PORTAL_FONT_UNAVAILABLE]", { fallback: VJ1.renderFont, message: error?.message || String(error) });
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
      const maybeFont = loadFont(path, finish, (error) => {
        console.warn("[VJ1_RENDER_FONT_LOAD_FAILED]", { path, fallback: "renderer default font", message: error?.message || String(error || "load failed") });
        finish(null);
      });
      if (maybeFont && typeof maybeFont.then === "function") {
        maybeFont.then(finish).catch((error) => {
          console.warn("[VJ1_RENDER_FONT_LOAD_FAILED]", { path, fallback: "renderer default font", message: error?.message || String(error) });
          finish(null);
        });
      }
    } catch (error) {
      console.warn("[VJ1_RENDER_FONT_LOAD_FAILED]", { path, fallback: "renderer default font", message: error?.message || String(error) });
      finish(null);
    }
  });
}
