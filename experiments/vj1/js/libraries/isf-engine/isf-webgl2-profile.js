export const VJ1_ISF_WEBGL2_PROFILE = "vj1-isf-webgl2@1";
export const VJ1_ISF_WEBGL2_VERTEX_MARKER =
  `/* VJ1_ISF_VERTEX_PROFILE: ${VJ1_ISF_WEBGL2_PROFILE} */`;

const ISF_HEADER = /\/\*\s*(\{[\s\S]*?\})\s*\*\//;
const RESERVED_USER_FUNCTIONS = Object.freeze(["round", "sign"]);
const LEGACY_TOKENS = Object.freeze([
  [/\bgl_FragColor\b/, "gl_FragColor"],
  [/\btexture2D\b/, "texture2D"],
  [/\bvarying\b/, "varying"],
  [/\bvv_FragNormCoord\b/, "vv_FragNormCoord"],
  [/^\s*#version\b/m, "#version"],
]);

export function canonicalizeIsfWebgl2Source(source = "", { path = "" } = {}) {
  const text = String(source || "");
  const match = text.match(ISF_HEADER);
  if (!match) {
    throw profileError("VJ1_ISF_HEADER_MISSING", path);
  }
  let metadata;
  try {
    metadata = JSON.parse(match[1]);
  } catch (error) {
    throw profileError(
      "VJ1_ISF_HEADER_INVALID",
      path,
      error?.message || "invalid JSON",
    );
  }
  metadata = migrateLegacyMetadata(metadata, path);
  metadata.VJ1 = {
    ...(metadata.VJ1 && typeof metadata.VJ1 === "object"
      ? metadata.VJ1
      : {}),
    PROFILE: VJ1_ISF_WEBGL2_PROFILE,
  };
  let fragment = canonicalizeShaderBody(
    `${text.slice(0, match.index)}${text.slice((match.index || 0) + match[0].length)}`,
    { stage: "fragment" },
  );

  return `/*${JSON.stringify(metadata, null, 2)}*/\n\n${fragment}\n`;
}

function migrateLegacyMetadata(metadata, path) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw profileError("VJ1_ISF_HEADER_INVALID", path, "metadata must be an object");
  }
  const migrated = { ...metadata };
  // A handful of older ISF-library exports serialized an unused IMPORTED
  // dictionary as an empty array. It has the same meaning as an empty object,
  // but non-empty arrays are ambiguous and remain a validation error.
  if (Array.isArray(migrated.IMPORTED) && migrated.IMPORTED.length === 0) {
    migrated.IMPORTED = {};
  }
  return migrated;
}

export function canonicalizeIsfWebgl2VertexSource(
  source = "",
  { path = "" } = {},
) {
  const body = canonicalizeShaderBody(source, { stage: "vertex" });
  if (!/\bisf_vertShaderInit\s*\(\s*\)/.test(body)) {
    throw profileError("VJ1_ISF_VERTEX_INIT_MISSING", path);
  }
  return `${VJ1_ISF_WEBGL2_VERTEX_MARKER}\n\n${body}\n`;
}

function canonicalizeShaderBody(source, { stage }) {
  let body = String(source || "")
    .replace(/\/\*\s*VJ1_ISF_VERTEX_PROFILE:[^*]*\*\//g, "")
    .trim()
    .replace(/^\s*#version[^\n]*\n?/m, "")
    .replace(
      /#if\s+__VERSION__\s*<=\s*120([\s\S]*?)#else([\s\S]*?)#endif/g,
      "$2",
    )
    .replace(/\bgl_FragColor\b/g, "isf_FragColor")
    .replace(/\btexture2D\b/g, "texture")
    .replace(/\bvv_FragNormCoord\b/g, "isf_FragNormCoord")
    .replace(
      /\bvarying\b/g,
      stage === "vertex" ? "out" : "in",
    )
    .replace(
      /\bin\s+vec2\s+vTexCoord\s*;/g,
      stage === "fragment" ? "" : "in vec2 vTexCoord;",
    );

  for (const name of RESERVED_USER_FUNCTIONS) {
    const declaration = new RegExp(
      `\\b(?:void|bool|int|uint|float|vec[234]|ivec[234]|uvec[234]|mat[234])\\s+${name}\\s*\\(`,
    );
    if (!declaration.test(body)) continue;
    body = body.replace(
      new RegExp(`\\b${name}\\b`, "g"),
      `vj1_${name}`,
    );
  }
  return body.trim();
}

export function assertIsfWebgl2Profile(document = {}) {
  const path = document.path || document.name || "inline";
  const profile = String(document.metadata?.VJ1?.PROFILE || "");
  if (profile !== VJ1_ISF_WEBGL2_PROFILE) {
    throw profileError(
      "VJ1_ISF_PROFILE_REQUIRED",
      path,
      VJ1_ISF_WEBGL2_PROFILE,
    );
  }
  const fragment = String(document.fragmentSource || "");
  for (const [pattern, token] of LEGACY_TOKENS) {
    if (pattern.test(fragment)) {
      throw profileError(
        "VJ1_ISF_PROFILE_LEGACY_TOKEN",
        path,
        token,
      );
    }
  }
  for (const name of RESERVED_USER_FUNCTIONS) {
    const declaration = new RegExp(
      `\\b(?:void|bool|int|uint|float|vec[234]|ivec[234]|uvec[234]|mat[234])\\s+${name}\\s*\\(`,
    );
    if (declaration.test(fragment)) {
      throw profileError(
        "VJ1_ISF_PROFILE_RESERVED_FUNCTION",
        path,
        name,
      );
    }
  }
  return document;
}

export function assertIsfWebgl2VertexProfile(
  source = "",
  { path = "" } = {},
) {
  const text = String(source || "");
  if (!text.includes(VJ1_ISF_WEBGL2_VERTEX_MARKER)) {
    throw profileError(
      "VJ1_ISF_VERTEX_PROFILE_REQUIRED",
      path,
      VJ1_ISF_WEBGL2_PROFILE,
    );
  }
  const body = text.replace(VJ1_ISF_WEBGL2_VERTEX_MARKER, "");
  for (const [pattern, token] of LEGACY_TOKENS) {
    if (pattern.test(body)) {
      throw profileError(
        "VJ1_ISF_VERTEX_PROFILE_LEGACY_TOKEN",
        path,
        token,
      );
    }
  }
  if (!/\bisf_vertShaderInit\s*\(\s*\)/.test(body)) {
    throw profileError("VJ1_ISF_VERTEX_INIT_MISSING", path);
  }
  return text;
}

function profileError(code, path, detail = "") {
  const error = new Error(
    `${code}:${path || "inline"}${detail ? `:${detail}` : ""}`,
  );
  error.code = code;
  error.path = path;
  return error;
}
