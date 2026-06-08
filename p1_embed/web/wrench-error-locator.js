export function parseWrenchErrorLocation(message = "", editorText = "") {
  const text = String(message);
  const lineMatch = text.match(/\bline:\s*(\d+)/i) || text.match(/^\s*(\d+)\s+/m);
  if (!lineMatch) return null;

  let line = Number(lineMatch[1]);
  if (!Number.isFinite(line) || line <= 0) return null;

  let codeColumnOffset = 0;
  const numberedSourceLine = text.split("\n").find((part) => /^\s*\d+\s+\S/.test(part));
  if (numberedSourceLine) {
    const sourceMatch = numberedSourceLine.match(/^\s*\d+\s+(.*)$/);
    const sourceText = sourceMatch?.[1]?.trimEnd() || "";
    const editorLine = findEditorLine(sourceText, editorText);
    if (editorLine > 0) {
      line = editorLine;
      codeColumnOffset = numberedSourceLine.indexOf(sourceMatch[1]);
    }
  }

  const caretLine = text.split("\n").find((part) => part.includes("^")) || "";
  const column = Math.max(0, caretLine.indexOf("^") - codeColumnOffset);
  const errLine = text.split("\n").find((part) => /^err:/i.test(part.trim()));

  return {
    line,
    column,
    text: errLine ? errLine.trim() : text.split("\n")[0] || "Wrench error",
  };
}

export function findEditorLine(sourceText, editorText = "") {
  const needle = String(sourceText || "").trim();
  if (!needle) return 0;
  const lines = String(editorText || "").split(/\r?\n/);
  const index = lines.findIndex((line) => line.trim() === needle);
  return index >= 0 ? index + 1 : 0;
}
