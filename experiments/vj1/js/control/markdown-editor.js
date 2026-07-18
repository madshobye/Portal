// Compact Markdown editor adapted from p1_embed/web's specification editor.
// Markdown describes block structure. Visual emphasis belongs to the text
// generator's persistent style parameters, not transient editor selections.
export function markdownToEditorHtml(markdown = "") {
  const lines = String(markdown || "").split(/\r?\n/);
  return lines.map((line) => {
    const heading = line.trim().match(/^(#{1,4})\s+(.+)$/);
    if (heading) return `<h${heading[1].length}>${inlineMarkdownToHtml(heading[2])}</h${heading[1].length}>`;
    return `<div>${inlineMarkdownToHtml(line) || "<br>"}</div>`;
  }).join("");
}

export function editorHtmlToMarkdown(html = "", documentRef = document) {
  const root = documentRef.createElement("div");
  root.innerHTML = String(html || "");
  return [...root.childNodes].map(blockNodeToMarkdown).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function blockNodeToMarkdown(node) {
  if (node.nodeType === 3) return node.textContent || "";
  if (node.nodeType !== 1) return "";
  const tag = node.tagName.toLowerCase();
  if (/^h[1-4]$/.test(tag)) return `${"#".repeat(Number(tag.slice(1)))} ${inlineNodeToMarkdown(node).trim()}`;
  if (tag === "br") return "";
  return inlineNodeToMarkdown(node).replace(/\n+$/g, "");
}

function inlineNodeToMarkdown(node) {
  if (node.nodeType === 3) return node.textContent || "";
  if (node.nodeType !== 1) return "";
  const tag = node.tagName.toLowerCase();
  if (tag === "br") return "\n";
  const text = [...node.childNodes].map(inlineNodeToMarkdown).join("");
  if (!text) return "";
  return text;
}

function inlineMarkdownToHtml(text = "") {
  return escapeHtml(String(text || ""))
    .replace(/&lt;u&gt;([\s\S]+?)&lt;\/u&gt;/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1");
}

function escapeHtml(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function bindMarkdownEditors(scope) {
  scope.querySelectorAll("[data-markdown-editor]").forEach((editor) => {
    const input = editor.closest("[data-markdown-control]")?.querySelector("[data-markdown-value]");
    if (!input) return;
    const syncValue = (emit = false) => {
      input.value = editorHtmlToMarkdown(editor.innerHTML, editor.ownerDocument);
      if (emit) input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    editor.addEventListener("input", () => syncValue(true));
    editor.addEventListener("blur", () => {
      syncValue();
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    editor.addEventListener("paste", (event) => {
      event.preventDefault();
      const text = event.clipboardData?.getData("text/plain") || "";
      editor.ownerDocument.execCommand("insertText", false, text);
      syncValue();
    });
  });
  scope.querySelectorAll("[data-markdown-command]").forEach((button) => {
    button.addEventListener("pointerdown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      const control = button.closest("[data-markdown-control]");
      const editor = control?.querySelector("[data-markdown-editor]");
      const input = control?.querySelector("[data-markdown-value]");
      if (!editor || !input) return;
      editor.focus();
      const command = button.dataset.markdownCommand;
      if (/^h[1-4]$/.test(command)) editor.ownerDocument.execCommand("formatBlock", false, command.toUpperCase());
      else editor.ownerDocument.execCommand(command, false, null);
      input.value = editorHtmlToMarkdown(editor.innerHTML, editor.ownerDocument);
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });
}
