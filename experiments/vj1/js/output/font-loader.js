import { VJ1 } from "../constants.js";

export async function loadVjRenderFont() {
  await callPortalSetup();
  const font = getPortalFont() || await loadFontAsync(VJ1.renderFont);
  if (!font) throw new Error(`VJ1_RENDER_FONT_REQUIRED:${VJ1.renderFont}`);
  return font;
}

export function applyFontToTarget(target, font) {
  if (!font || typeof target?.textFont !== "function") return;
  try {
    target.textFont(font);
  } catch (error) {
    console.error("[VJ1_FONT_TARGET_FAILED]", { message: error?.message || String(error) });
    throw error;
  }
}

export function applyFontToGlobal(font) {
  if (!font || typeof textFont !== "function") return;
  try {
    textFont(font);
  } catch (error) {
    console.error("[VJ1_FONT_GLOBAL_FAILED]", { message: error?.message || String(error) });
    throw error;
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
  if (typeof loadFont !== "function") return Promise.reject(new Error("VJ1_RENDER_CAPABILITY_REQUIRED:p5.loadFont"));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (font) => {
      if (settled) return;
      settled = true;
      resolve(font || null);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error || "load failed")));
    };
    try {
      const maybeFont = loadFont(path, finish, (error) => {
        const failure = error instanceof Error ? error : new Error(String(error || "load failed"));
        console.error("[VJ1_RENDER_FONT_LOAD_FAILED]", { path, message: failure.message });
        fail(failure);
      });
      if (maybeFont && typeof maybeFont.then === "function") {
        maybeFont.then(finish).catch((error) => {
          console.error("[VJ1_RENDER_FONT_LOAD_FAILED]", { path, message: error?.message || String(error) });
          fail(error);
        });
      }
    } catch (error) {
      console.error("[VJ1_RENDER_FONT_LOAD_FAILED]", { path, message: error?.message || String(error) });
      fail(error);
    }
  });
}
