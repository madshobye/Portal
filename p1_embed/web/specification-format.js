export function specificationNodesToMarkdown(nodes = []) {
  const lines = [];
  nodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.trim();
      if (text) lines.push(text);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName.toLowerCase();
    if (/^h[1-4]$/.test(tag)) {
      lines.push(`${"#".repeat(Number(tag.slice(1)))} ${inlineMarkdown(node).trim()}`);
    } else if (tag === "ul" || tag === "ol") {
      [...node.children].forEach((child, index) => {
        if (child.tagName?.toLowerCase() !== "li") return;
        const marker = tag === "ol" ? `${index + 1}.` : "-";
        lines.push(`${marker} ${inlineMarkdown(child).trim()}`);
      });
    } else if (tag === "br") {
      lines.push("");
    } else {
      const text = inlineMarkdown(node).trim();
      if (text) lines.push(text);
    }
  });
  return lines.join("\n\n");
}

export function specificationHtmlToMarkdown(html = "") {
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  return specificationNodesToMarkdown([...doc.body.childNodes]).trim();
}

function inlineMarkdown(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent.replace(/\s+/g, " ");
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const tag = node.tagName.toLowerCase();
  if (tag === "br") return "\n";
  const text = [...node.childNodes].map(inlineMarkdown).join("");
  if (!text) return "";
  const weight = String(node.style?.fontWeight || "").toLowerCase();
  const isBold = tag === "strong" || tag === "b" || weight === "bold" || Number(weight) >= 600;
  const style = String(node.style?.fontStyle || "").toLowerCase();
  const isItalic = tag === "em" || tag === "i" || style === "italic";
  if (isBold) return `**${text}**`;
  if (isItalic) return `*${text}*`;
  if (tag === "u" || node.style?.textDecorationLine?.includes("underline") || node.style?.textDecoration?.includes("underline")) return `<u>${text}</u>`;
  return text;
}

export function markdownToSpecificationHtml(markdown = "") {
  const lines = String(markdown || "").split(/\r?\n/);
  const html = [];
  let listType = "";
  const closeList = () => {
    if (!listType) return;
    html.push(`</${listType}>`);
    listType = "";
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
      return;
    }
    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdownToHtml(heading[2])}</h${level}>`);
      return;
    }
    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      if (listType !== "ul") {
        closeList();
        html.push("<ul>");
        listType = "ul";
      }
      html.push(`<li>${inlineMarkdownToHtml(bullet[1])}</li>`);
      return;
    }
    const numbered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (numbered) {
      if (listType !== "ol") {
        closeList();
        html.push("<ol>");
        listType = "ol";
      }
      html.push(`<li>${inlineMarkdownToHtml(numbered[1])}</li>`);
      return;
    }
    closeList();
    html.push(`<p>${inlineMarkdownToHtml(trimmed)}</p>`);
  });
  closeList();
  return html.join("");
}

function inlineMarkdownToHtml(text = "") {
  return escapeHtml(String(text || ""))
    .replace(/&lt;u&gt;([\s\S]+?)&lt;\/u&gt;/g, "<u>$1</u>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

export function escapeHtml(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function normalizeSpecificationMode(mode = "middle") {
  return ["overview", "middle", "structured"].includes(mode) ? mode : "middle";
}

export function specificationModeLabel(mode = "middle") {
  if (mode === "overview") return "Overarching Description";
  if (mode === "structured") return "Programming-Like Plain Text";
  return "Middle-Level Description";
}

export function specificationModePrompt(mode = "middle") {
  if (mode === "overview") {
    return "Describe the program at a high level in plain language. Focus on what the program does, what hardware it uses, and how it behaves over time. Do not describe every variable or every line of logic. Write it as a short human-readable explanation.";
  }
  if (mode === "structured") {
    return "Describe the program as structured plain text that follows the same shape as the code. Use sections like Program, Global values, Setup, and Main loop. Describe conditions, state updates, and actions step by step, but do not write actual code syntax unless naming functions, pins, or values is necessary.";
  }
  return "Describe the program in plain language, but include the important implementation details needed to recreate it. Mention key pins, hardware setup, state variables, timing, conditions, and behavior changes. Do not write pseudocode or step-by-step code instructions. The result should sit between a summary and a code plan.";
}
