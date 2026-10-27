export function reportText(value, fallback = "") {
  if (value === undefined || value === null || value === "") return fallback;
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

export function revisionChat(revision = {}) {
  const chat = revision.chat ?? revision.chatTranscript ?? [];
  return Array.isArray(chat) ? chat : [{ role: "message", content: reportText(chat) }];
}

export function messageText(message) {
  return reportText(message?.content ?? message?.text ?? message?.message ?? message);
}

export function messageTime(message) {
  return message?.at ?? message?.createdAt ?? message?.timestamp;
}

// Reconstruct transcript context, not a revision family tree. Revision numbers,
// names and array positions provide no evidence of ancestry.
export function recoverReportChat(report, selectedIndex) {
  let messages = revisionChat(report.revisions[selectedIndex] || {}).slice();
  const sources = [];
  const visited = new Set([selectedIndex]);
  const key = (message) => {
    const time = messageTime(message);
    if (time === undefined || time === null || time === "") return null;
    return JSON.stringify([message?.role || message?.type, time, messageText(message)]);
  };
  while (messages.length) {
    const anchor = key(messages[0]);
    if (!anchor) break;
    const matches = [];
    report.revisions.forEach((revision, index) => {
      if (visited.has(index)) return;
      const candidate = revisionChat(revision);
      for (let start = 1; start < candidate.length; start++) {
        if (key(candidate[start]) !== anchor) continue;
        const overlap = Math.min(candidate.length - start, messages.length);
        if (!Array.from({ length: overlap }, (_, offset) => offset)
          .every((offset) => key(messages[offset]) && key(messages[offset]) === key(candidate[start + offset]))) continue;
        const prefix = candidate.slice(0, start);
        // Do not prepend a copied message already present later in the transcript.
        const existing = new Set(messages.map(key).filter(Boolean));
        if (prefix.some((message) => key(message) && existing.has(key(message)))) continue;
        matches.push({ index, prefix });
      }
    });
    if (!matches.length) break;
    matches.sort((a, b) => b.prefix.length - a.prefix.length);
    const best = matches[0];
    // Shorter proposals must be suffixes of the longest. Conflicting branches
    // must never be silently joined.
    const compatible = matches.every(({ prefix }) => prefix.every((message, index) =>
      key(message) && key(message) === key(best.prefix[best.prefix.length - prefix.length + index])));
    if (!compatible) return { messages, sources, ambiguous: true };
    messages = [...best.prefix, ...messages];
    sources.unshift(best.index);
    visited.add(best.index);
  }
  return { messages, sources, ambiguous: false };
}

export function normalizeBugReport(raw, filename = "Report") {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Not a XOBIT report or project");
  const project = raw.project ?? (raw.type === "xobit-project" ? raw : null);
  if (raw.kind !== "xobit-bug-report" && raw.type !== "xobit-project"
    && !project?.revision && !Array.isArray(project?.revisions) && !raw.revision) {
    throw new Error("Not a XOBIT report or project");
  }
  const candidates = Array.isArray(project?.revisions) && project.revisions.length
    ? project.revisions : [project?.revision ?? raw.revision].filter(Boolean);
  const revisions = candidates
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((value, index) => ({ ...value, sourceIndex: index + 1 }))
    .sort((a, b) => {
      const x = Date.parse(a.createdAt);
      const y = Date.parse(b.createdAt);
      return (Number.isFinite(x) ? x : Infinity) - (Number.isFinite(y) ? y : Infinity) || 0;
    });
  const active = project?.activeRevisionId
    ? revisions.findIndex((revision) => revision.id === project.activeRevisionId) : -1;
  return {
    raw, filename, project: project || {},
    name: reportText(project?.name || project?.id || filename),
    createdAt: raw.type === "xobit-project" ? raw.updatedAt || raw.createdAt : raw.createdAt,
    revisions,
    activeIndex: active,
    selectedIndex: active >= 0 ? active : revisions.length ? 0 : -1,
  };
}

// Directory readers may return several batches, including more than 100 entries.
async function readEntry(entry, files, errors, parent = "") {
  const path = parent + entry.name;
  try {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      files.push({ file, path });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      while (true) {
        const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const child of batch) await readEntry(child, files, errors, `${path}/`);
      }
    }
  } catch (error) {
    errors.push(`${path}: ${error.message || error}`);
  }
}

export async function filesFromDrop(dataTransfer) {
  // Capture handles synchronously while the drop event still grants access.
  const items = Array.from(dataTransfer?.items || []).filter((item) => item.kind === "file");
  const handles = items.map((item) => ({ entry: item.webkitGetAsEntry?.(), file: item.getAsFile?.() }));
  const fallback = Array.from(dataTransfer?.files || []);
  const files = [];
  const errors = [];
  if (handles.length) {
    for (const { entry, file } of handles) {
      if (entry) await readEntry(entry, files, errors);
      else if (file) files.push({ file, path: file.name });
    }
  } else fallback.forEach((file) => files.push({ file, path: file.name }));
  return { files, errors };
}

function heading(value) {
  return reportText(value).replace(/[\r\n]+/g, " ").replace(/([\\`*_[\]<>#])/g, "\\$1");
}

export function markdownFence(value, language = "") {
  const text = reportText(value);
  const longest = Math.max(2, ...(text.match(/`+/g) || []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  return `${fence}${language}\n${text}\n${fence}`;
}

export function reportsToMarkdown(reports) {
  const out = ["# XOBIT reports", "", "Full revision snapshots and saved conversations. Chat history may repeat between revisions; messages are preserved without deduplication.", ""];
  reports.forEach((report, index) => {
    out.push(`## Report ${index + 1} — ${heading(report.name)}`, "",
      `Source file: ${heading(report.filename)}`, "",
      `Captured or updated: ${heading(report.createdAt || "Not recorded")}`, "",
      `Project ID: ${heading(report.project.id || "Not recorded")}`, "",
      `Revisions: ${report.revisions.length}`, "",
      "### Description", "", reportText(report.raw.description, "No description provided."), "",
      "### Project details", "", markdownFence(Object.fromEntries(Object.entries(report.project)
        .filter(([key]) => !["revision", "revisions"].includes(key))), "json"), "");
    report.revisions.forEach((revision, ri) => {
      out.push(`### Revision ${ri + 1} — ${heading(revision.name || "Untitled revision")}${ri === report.activeIndex ? " — Active at capture" : ""}`, "",
        `Revision ID: ${heading(revision.id || "Not recorded")}`, "",
        `Created: ${heading(revision.createdAt || "Not recorded")}`, "",
        "#### Specification", "", reportText(revision.specification ?? revision.spec, "No specification saved."), "",
        "#### Conversation", "");
      const chat = revisionChat(revision);
      if (!chat.length) out.push("No chat saved for this revision.", "");
      chat.forEach((message, mi) => {
        out.push(`##### Message ${mi + 1} — ${heading(message?.role || message?.type || "message")}`, "",
          messageText(message) || "(No message text)", "");
        if (message?.structured && typeof message.structured === "object") {
          const { code, ...details } = message.structured;
          if (code) out.push("Generated code", "", markdownFence(code, "c"), "");
          if (Object.keys(details).length) out.push("Response details", "", markdownFence(details, "json"), "");
        } else if (message?.structured) {
          out.push("Structured response", "", reportText(message.structured), "");
        }
        if (message && typeof message === "object") {
          const metadata = Object.fromEntries(Object.entries(message)
            .filter(([key]) => !["role", "type", "content", "text", "message", "structured"].includes(key)));
          if (Object.keys(metadata).length) out.push("Message details", "", markdownFence(metadata, "json"), "");
        }
      });
      out.push("#### Code", "", markdownFence(revision.code, "c"), "",
        "#### Circuit", "", markdownFence(revision.circuit ?? {}, "json"), "",
        "#### Revision details", "", markdownFence(Object.fromEntries(Object.entries(revision)
          .filter(([key]) => !["code", "chat", "chatTranscript", "specification", "spec", "circuit", "sourceIndex"].includes(key))), "json"), "");
    });
    out.push("### Diagnostics", "", "#### Console log", "",
      markdownFence(Array.isArray(report.raw.logs) ? report.raw.logs.map((line) => reportText(line)).join("\n") : report.raw.logs || "No logs saved.", "text"), "",
      "#### Captured state", "", markdownFence(Object.fromEntries(Object.entries(report.raw)
        .filter(([key]) => !["project", "revision", "logs", "revisions", "chat"].includes(key))), "json"), "");
  });
  return out.join("\n");
}
