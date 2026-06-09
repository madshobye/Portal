import { escapeRegex } from "./string-utils.js?v=0.1.87-ui559";
import { product } from "./app-config.js?v=0.1.87-ui744";

const CIRCUIT_COMMENT = `(?:${escapeRegex(product.circuitCommentPrefix)}|${escapeRegex(product.legacyCircuitCommentPrefix)})`;
const CIRCUIT_BOARD_COMMENT = `(?:${escapeRegex(product.circuitCommentPrefix)}|${escapeRegex(product.legacyCircuitCommentPrefix)})-board`;
const CIRCUIT_VIEW_COMMENT = `(?:${escapeRegex(product.circuitCommentPrefix)}|${escapeRegex(product.legacyCircuitCommentPrefix)})-view`;

export function normalizeCircuitBoardType(type) {
  return type === "esp32-d1-mini" ? "esp32-d1-mini" : "esp32-classic";
}

export function circuitComponentPin(component) {
  return String(
    component?.pins?.data
    || component?.pins?.signal
    || component?.pins?.trigger
    || component?.pins?.sda
    || component?.pins?.rx
    || component?.pin
    || "",
  ).replace(/\D+/g, "");
}

export function circuitComponentPlacementKey(component) {
  const pin = circuitComponentPin(component);
  if (pin) return `IO${pin}`;
  if (component?.type === "powerSupply") return `powerSupply-${String(component?.pins?.voltage || "V").replace(/[^A-Za-z0-9]+/g, "") || "V"}`;
  if (component?.type === "uiPanel") return "uiPanel";
  if (component?.type === "homeAssistant") return "homeAssistant";
  if (component?.type === "backEmfDiode") return `backEmfDiode-${String(component?.pins?.voltage || "V").replace(/[^A-Za-z0-9]+/g, "") || "V"}`;
  if (component?.id) return String(component.id);
  return "";
}

export function stripCircuitPlacementComments(code) {
  return String(code || "")
    .split("\n")
    .map(stripCircuitPlacementLine)
    .filter((line) => line !== null)
    .join("\n");
}

function stripCircuitPlacementLine(line) {
  if (new RegExp(`//\\s*${CIRCUIT_BOARD_COMMENT}:`, "i").test(line)) {
    const cleaned = line
      .replace(/\bcx\s*=\s*-?\d{1,3}\b/ig, "")
      .replace(/\bcy\s*=\s*-?\d{1,3}\b/ig, "")
      .replace(/\s+/g, " ")
      .replace(/\s+$/, "");
    return new RegExp(`//\\s*${CIRCUIT_BOARD_COMMENT}:\\s*type\\s*=`, "i").test(cleaned) ? cleaned : null;
  }
  if (!new RegExp(`//\\s*${CIRCUIT_COMMENT}:`, "i").test(line)) return line;
  const cleaned = line
    .replace(/\bside\s*=\s*(?:left|right)\b/ig, "")
    .replace(/\bx\s*=\s*-?\d{1,3}\b/ig, "")
    .replace(/\by\s*=\s*-?\d{1,3}\b/ig, "")
    .replace(/\s+/g, " ")
    .replace(/\s+$/, "");
  return new RegExp(`//\\s*${CIRCUIT_COMMENT}:\\s*$`, "i").test(cleaned) ? null : cleaned;
}

export function persistGeneratedCircuitLayoutPositions(code, model) {
  if (!model?.board) return code;
  let next = upsertCircuitBoardPlacementComment(
    code,
    normalizeCircuitBoardType(model.board.type),
    (model.board.x + model.board.w / 2) / 1680 * 100,
    (model.board.y + model.board.h / 2) / 1140 * 100,
  );
  const boardCenter = model.board.x + model.board.w / 2;
  (model.components || []).forEach((component) => {
    if (!Number.isFinite(component?.x) || !Number.isFinite(component?.y)) return;
    const key = circuitComponentPlacementKey(component);
    if (!key) return;
    const side = component.x < boardCenter ? "left" : "right";
    next = upsertCircuitPlacementComment(
      next,
      key,
      component.type || "unknown",
      side,
      component.x / 1680 * 100,
      component.y / 1140 * 100,
    );
  });
  return next;
}

export function upsertCircuitHintComment(code, pin, hint) {
  const lines = String(code || "").split("\n");
  const hintRe = new RegExp(`//\\s*${CIRCUIT_COMMENT}:\\s*(?:IO|GPIO)?\\s*${escapeRegex(pin)}\\b[^\\n]*`, "i");
  const existingIndex = lines.findIndex((line) => hintRe.test(line));
  if (existingIndex >= 0) {
    lines[existingIndex] = lines[existingIndex].replace(hintRe, (existing) => {
      const placement = existing.match(/\bside\s*=\s*(?:left|right)\b/ig)?.join(" ") || "";
      const xHint = existing.match(/\bx\s*=\s*-?\d{1,3}\b/ig)?.join(" ") || "";
      const yHint = existing.match(/\by\s*=\s*-?\d{1,3}\b/ig)?.join(" ") || "";
      return [hint, placement, xHint, yHint].filter(Boolean).join(" ");
    }).replace(/\s+$/, "");
    return lines.join("\n");
  }
  const targetIndex = findCircuitHintLine(lines, pin);
  if (targetIndex >= 0) {
    lines[targetIndex] = `${lines[targetIndex].replace(/\s+$/, "")} ${hint}`;
  } else {
    lines.unshift(hint);
  }
  return lines.join("\n");
}

export function upsertCircuitPlacementComment(code, key, type, side, x, y) {
  const roundedX = Number.isFinite(x) ? Math.round(Math.max(-50, Math.min(150, Number(x)))) : null;
  const roundedY = Math.round(Math.max(-50, Math.min(150, Number(y))));
  const normalizedKey = normalizeCircuitPlacementKey(key, type);
  const lines = String(code || "").split("\n");
  const hintRe = circuitPlacementHintRegex(normalizedKey);
  const existingIndex = lines.findIndex((line) => hintRe.test(line));
  const applyPlacement = (hint) => {
    let next = hint
      .replace(/\bside\s*=\s*(left|right)\b/ig, "")
      .replace(/\bx\s*=\s*-?\d{1,3}\b/ig, "")
      .replace(/\by\s*=\s*-?\d{1,3}\b/ig, "")
      .replace(/\s+/g, " ")
      .trim();
    return `${next} side=${side}${roundedX !== null ? ` x=${roundedX}` : ""} y=${roundedY}`;
  };
  if (existingIndex >= 0) {
    lines[existingIndex] = lines[existingIndex].replace(hintRe, (hint) => applyPlacement(hint)).replace(/\s+$/, "");
    return lines.join("\n");
  }
  const hint = `// ${product.circuitCommentPrefix}: ${normalizedKey} ${type || "unknown"} side=${side}${roundedX !== null ? ` x=${roundedX}` : ""} y=${roundedY}`;
  const pin = normalizedKey.match(/^IO(\d+)$/i)?.[1] || "";
  const targetIndex = pin ? findCircuitHintLine(lines, pin) : -1;
  if (targetIndex >= 0) {
    lines[targetIndex] = `${lines[targetIndex].replace(/\s+$/, "")} ${hint}`;
  } else {
    lines.unshift(hint);
  }
  return lines.join("\n");
}

function normalizeCircuitPlacementKey(key, type = "") {
  const text = String(key || "").trim();
  const pin = text.replace(/\D+/g, "");
  if (/^(IO|GPIO)?\d+$/i.test(text) && pin) return `IO${pin}`;
  if (type === "powerSupply" && /^powerSupply[-_]/i.test(text)) return text.replace(/^powerSupply/i, "powerSupply");
  if (type === "powerSupply" || /^power$/i.test(text) || /^powerSupply$/i.test(text)) return "powerSupply";
  if (type === "uiPanel" || /^ui/i.test(text)) return "uiPanel";
  if (type === "homeAssistant" || /^ha|home/i.test(text)) return "homeAssistant";
  if (/^backEmfDiode[-_]/i.test(text)) return text.replace(/^backEmfDiode/i, "backEmfDiode");
  if (/^diode[-_]/i.test(text)) return text.replace(/^diode/i, "backEmfDiode");
  if (type === "backEmfDiode" || /^(backEmfDiode|back|diode)$/i.test(text)) return "backEmfDiode";
  return text.replace(/\s+/g, "-") || String(type || "component");
}

function circuitPlacementHintRegex(key) {
  if (/^IO\d+$/i.test(key)) {
    const pin = key.replace(/\D+/g, "");
    return new RegExp(`//\\s*${CIRCUIT_COMMENT}:\\s*(?:IO|GPIO)?\\s*${escapeRegex(pin)}\\b[^\\n]*`, "i");
  }
  return new RegExp(`//\\s*${CIRCUIT_COMMENT}:\\s*${escapeRegex(key)}\\b[^\\n]*`, "i");
}

export function upsertCircuitBoardPlacementComment(code, type, cx, cy) {
  const lines = String(code || "").split("\n");
  const existingIndex = lines.findIndex((line) => new RegExp(`//\\s*${CIRCUIT_BOARD_COMMENT}:`, "i").test(line));
  const existing = existingIndex >= 0 ? lines[existingIndex] : "";
  const existingX = existing.match(/\bcx\s*=\s*(-?\d{1,3})\b/i)?.[1];
  const existingY = existing.match(/\bcy\s*=\s*(-?\d{1,3})\b/i)?.[1];
  const sourceX = Number.isFinite(Number(cx)) ? Number(cx) : Number(existingX ?? 50);
  const sourceY = Number.isFinite(Number(cy)) ? Number(cy) : Number(existingY ?? 50);
  const roundedX = Math.round(Math.max(-50, Math.min(150, sourceX)));
  const roundedY = Math.round(Math.max(-50, Math.min(150, sourceY)));
  const hint = `// ${product.circuitCommentPrefix}-board: type=${type} cx=${roundedX} cy=${roundedY}`;
  if (existingIndex >= 0) {
    lines[existingIndex] = hint;
  } else {
    lines.unshift(hint);
  }
  return lines.join("\n");
}

export function upsertCircuitViewportComment(code, zoom, panX, panY) {
  const roundedZoom = Math.round(Math.max(0.5, Math.min(4, Number(zoom))) * 100) / 100;
  const roundedPanX = Math.round(Math.max(-9999, Math.min(9999, Number(panX))));
  const roundedPanY = Math.round(Math.max(-9999, Math.min(9999, Number(panY))));
  const lines = String(code || "").split("\n");
  const hint = `// ${product.circuitCommentPrefix}-view: zoom=${roundedZoom.toFixed(2)} panX=${roundedPanX} panY=${roundedPanY}`;
  const existingIndex = lines.findIndex((line) => new RegExp(`//\\s*${CIRCUIT_VIEW_COMMENT}:`, "i").test(line));
  if (existingIndex >= 0) {
    lines[existingIndex] = hint;
  } else {
    const boardIndex = lines.findIndex((line) => new RegExp(`//\\s*${CIRCUIT_BOARD_COMMENT}:`, "i").test(line));
    lines.splice(boardIndex >= 0 ? boardIndex + 1 : 0, 0, hint);
  }
  return lines.join("\n");
}

export function componentDisplayName(component) {
  return component?.label || component?.type || "component";
}

function findCircuitHintLine(lines, pin) {
  const pinRe = new RegExp(`\\b${escapeRegex(pin)}\\b`);
  const pinVarRe = new RegExp(`\\bvar\\s+[A-Za-z_]\\w*pin\\s*=\\s*${escapeRegex(pin)}\\s*;`, "i");
  let fallback = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (new RegExp(`${CIRCUIT_COMMENT}:`, "i").test(line)) continue;
    if (pinVarRe.test(line)) return index;
    if (fallback < 0 && pinRe.test(line) && /\b(ledConfig|pinMode|digitalWrite|digitalRead|analogWrite|analogRead|touchRead|servoAttach|fanAttach|tone)\s*\(/.test(line)) {
      fallback = index;
    }
  }
  return fallback;
}
