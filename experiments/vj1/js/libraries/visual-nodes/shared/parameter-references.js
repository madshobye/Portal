export function visitVisualParameterReferences(params, visitor, path = "params") {
  if (!params || typeof params !== "object" || typeof visitor !== "function") return;
  for (const [key, value] of Object.entries(params)) {
    const nextPath = `${path}.${key}`;
    if (value && typeof value === "object") {
      visitVisualParameterReferences(value, visitor, nextPath);
      continue;
    }
    const id = String(value || "");
    if (!id) continue;
    const kind = visualParameterReferenceKind(key);
    if (kind) visitor({ kind, id, key, path: nextPath });
  }
}

export function visualParameterReferenceKind(key) {
  if (/^componentId$/i.test(String(key || ""))) return "component";
  if (/(?:media|image|mesh|texture|font)[A-Za-z0-9_]*Id$/i.test(String(key || ""))) return "media";
  return "";
}
