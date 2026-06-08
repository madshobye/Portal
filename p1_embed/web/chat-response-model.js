export function extractResponseText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text;
  const parts = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

export function parseChatStructuredText(text, {
  currentSpecificationMode = "middle",
  normalizeSketchName = (value) => String(value || "").trim(),
  normalizeSpecificationMode = (value) => value || "middle",
} = {}) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("Empty OpenAI response");
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        parsed = null;
      }
    }
  }

  if (!parsed || typeof parsed !== "object") {
    return {
      reply: raw,
      code: "",
      code_action: "none",
      sketch_name: "",
      project_specification: "",
      specification_mode: currentSpecificationMode,
      notes: [],
      warnings: ["Response was not structured JSON."],
      circuit_layout: null,
    };
  }

  return {
    reply: String(parsed.reply || ""),
    code: String(parsed.code || ""),
    code_action: parsed.code_action === "replace" ? "replace" : "none",
    sketch_name: normalizeSketchName(parsed.sketch_name || parsed.name || parsed.title || ""),
    project_specification: String(parsed.project_specification || parsed.specification || parsed.description || ""),
    specification_mode: normalizeSpecificationMode(parsed.specification_mode || parsed.descriptionMode || currentSpecificationMode),
    notes: Array.isArray(parsed.notes) ? parsed.notes.map(String) : [],
    warnings: filterChatWarnings(parsed.warnings),
    circuit_layout: null,
  };
}

export function hasCircuitLayoutContent(layout) {
  if (!layout || typeof layout !== "object") return false;
  return Boolean(
    (Array.isArray(layout.components) && layout.components.length)
    || (Array.isArray(layout.connections) && layout.connections.length)
    || (Array.isArray(layout.assumptions) && layout.assumptions.length)
    || (Array.isArray(layout.notes) && layout.notes.length)
  );
}

export function filterChatWarnings(warnings) {
  if (!Array.isArray(warnings)) return [];
  const generic = [
    "code will be replaced",
    "replace the editor",
    "backup",
    "back up",
    "test before",
    "review before",
    "use caution",
  ];
  return warnings
    .map((warning) => String(warning).trim())
    .filter(Boolean)
    .filter((warning) => !generic.some((needle) => warning.toLowerCase().includes(needle)));
}
