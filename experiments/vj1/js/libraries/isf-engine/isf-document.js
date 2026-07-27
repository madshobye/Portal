const ISF_HEADER = /\/\*\s*(\{[\s\S]*?\})\s*\*\//;
const GLSL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const INPUT_TYPES = new Set(["event", "bool", "long", "float", "point2D", "color", "image", "audio", "audioFFT"]);

export function parseIsfDocument(source = "", { path = "" } = {}) {
  const text = String(source || "");
  const match = text.match(ISF_HEADER);
  if (!match) throw isfError("VJ1_ISF_HEADER_MISSING", path, "ISF source must begin with a commented JSON object");
  let metadata;
  try {
    metadata = JSON.parse(match[1]);
  } catch (error) {
    throw isfError("VJ1_ISF_HEADER_INVALID", path, error?.message || "Invalid ISF JSON header");
  }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw isfError("VJ1_ISF_HEADER_INVALID", path, "ISF metadata must be an object");
  }
  const version = String(metadata.ISFVSN || "2.0");
  if (!/^2(?:\.|$)/.test(version)) {
    throw isfError("VJ1_ISF_VERSION_UNSUPPORTED", path, `ISF ${version} is unsupported; VJ1 implements ISF 2.x`);
  }
  const inputs = normalizeInputs(metadata.INPUTS, path);
  const passes = normalizePasses(metadata.PASSES, path);
  const imageNames = inputs.filter((input) => input.type === "image").map((input) => input.name);
  const kind = imageNames.includes("startImage") && imageNames.includes("endImage") && inputs.some((input) => input.name === "progress")
    ? "transition"
    : imageNames.includes("inputImage") ? "effect" : "generator";
  const fragmentSource = `${text.slice(0, match.index)}${text.slice((match.index || 0) + match[0].length)}`.trim();
  if (!/\bvoid\s+main\s*\(/.test(fragmentSource)) {
    throw isfError("VJ1_ISF_MAIN_MISSING", path, "ISF fragment source must declare void main()");
  }
  const dynamic = /\b(?:TIME|TIMEDELTA|FRAMEINDEX|DATE)\b/.test(fragmentSource)
    || inputs.some((input) => ["event", "audio", "audioFFT"].includes(input.type))
    || passes.some((pass) => pass.persistent);
  return Object.freeze({
    format: "isf@2",
    path: String(path || ""),
    version,
    name: String(metadata.LABEL || fileStem(path) || "ISF Shader"),
    description: String(metadata.DESCRIPTION || ""),
    credit: String(metadata.CREDIT || ""),
    categories: Object.freeze(Array.isArray(metadata.CATEGORIES) ? metadata.CATEGORIES.map(String) : []),
    metadata: Object.freeze({ ...metadata }),
    inputs: Object.freeze(inputs),
    passes: Object.freeze(passes),
    kind,
    fragmentSource,
    dynamic,
    // The compiler virtualizes gl_FragCoord through normalized boundary UVs.
    // Multipass targets remain full-boundary until their own ROI views exist.
    roiSafe: passes.length === 1 && !passes.some((pass) => pass.persistent),
    sourceHash: sourceHash(text),
  });
}

function normalizeInputs(value, path) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw isfError("VJ1_ISF_INPUTS_INVALID", path, "INPUTS must be an array");
  const names = new Set();
  return value.map((input, index) => {
    const name = String(input?.NAME || "");
    const type = String(input?.TYPE || "");
    if (!GLSL_IDENTIFIER.test(name)) throw isfError("VJ1_ISF_INPUT_NAME_INVALID", path, `INPUTS[${index}] has an invalid NAME`);
    if (names.has(name)) throw isfError("VJ1_ISF_INPUT_DUPLICATE", path, `Duplicate ISF input ${name}`);
    if (!INPUT_TYPES.has(type)) throw isfError("VJ1_ISF_INPUT_TYPE_UNSUPPORTED", path, `Unsupported ISF input type ${type || "missing"}`);
    names.add(name);
    return Object.freeze({
      name,
      label: String(input.LABEL || name),
      type,
      defaultValue: input.DEFAULT,
      min: input.MIN,
      max: input.MAX,
      identity: input.IDENTITY,
      values: Array.isArray(input.VALUES) ? [...input.VALUES] : null,
      labels: Array.isArray(input.LABELS) ? input.LABELS.map(String) : null,
    });
  });
}

function normalizePasses(value, path) {
  if (value === undefined) return Object.freeze([{ index: 0, target: "", persistent: false, float: false, width: "$WIDTH", height: "$HEIGHT" }]);
  if (!Array.isArray(value) || !value.length) throw isfError("VJ1_ISF_PASSES_INVALID", path, "PASSES must be a non-empty array");
  const targets = new Set();
  return value.map((pass, index) => {
    const target = String(pass?.TARGET || "");
    if (target && !GLSL_IDENTIFIER.test(target)) throw isfError("VJ1_ISF_PASS_TARGET_INVALID", path, `PASSES[${index}] has an invalid TARGET`);
    if (target && targets.has(target)) throw isfError("VJ1_ISF_PASS_TARGET_DUPLICATE", path, `Duplicate ISF pass target ${target}`);
    if (target) targets.add(target);
    if (!target && index < value.length - 1) {
      throw isfError("VJ1_ISF_PASS_ORDER_INVALID", path, `PASSES[${index}] omits TARGET before the final pass`);
    }
    return Object.freeze({
      index,
      target,
      persistent: pass?.PERSISTENT === true || Number(pass?.PERSISTENT) > 0,
      float: pass?.FLOAT === true || Number(pass?.FLOAT) > 0,
      width: normalizeDimensionExpression(pass?.WIDTH, "$WIDTH", path, index, "WIDTH"),
      height: normalizeDimensionExpression(pass?.HEIGHT, "$HEIGHT", path, index, "HEIGHT"),
    });
  });
}

function normalizeDimensionExpression(value, fallback, path, index, key) {
  if (value === undefined || value === null || value === "") return fallback;
  const expression = String(value).trim();
  if (!/^[\d\s+\-*/().,_$A-Za-z]+$/.test(expression)) {
    throw isfError("VJ1_ISF_PASS_SIZE_INVALID", path, `PASSES[${index}].${key} contains unsupported characters`);
  }
  return expression;
}

function isfError(code, path, message) {
  const error = new Error(`${code}:${path || "inline"}:${message}`);
  error.code = code;
  error.path = path;
  return error;
}

function fileStem(path) {
  return String(path || "").split("/").pop()?.replace(/\.[^.]+$/, "") || "";
}

export function sourceHash(value = "") {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
