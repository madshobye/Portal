export function normalizeChatMessages(messages) {
  return Array.isArray(messages)
    ? messages
      .filter((item) => ["user", "assistant", "error"].includes(item?.role) && typeof item?.content === "string")
      .slice(-60)
    : [];
}

export function findGeneratedRevisionMatch(project, revision, preferred = null, { revisionEquivalent } = {}) {
  if (preferred && revisionEquivalent?.(preferred, revision)) return preferred;
  const revisions = Array.isArray(project?.revisions) ? project.revisions : [];
  const code = String(revision?.code || "");
  if (!code.trim()) return null;
  return revisions.find((item) => String(item.code || "") === code) || null;
}

export function mergeGeneratedRevision(existing, incoming, {
  codeHashFor,
  normalizeCircuitLayout,
  normalizeSketchName,
} = {}) {
  return {
    ...existing,
    name: normalizeSketchName(incoming.name) || existing.name,
    code: incoming.code,
    specification: incoming.specification,
    specificationMode: incoming.specificationMode,
    circuit: normalizeCircuitLayout(incoming.circuit) || normalizeCircuitLayout(existing.circuit),
    chat: normalizeChatMessages(incoming.chat?.length ? incoming.chat : existing.chat),
    source: existing.source || incoming.source,
    bytes: incoming.bytes,
    codeHash: codeHashFor(incoming.code),
  };
}
