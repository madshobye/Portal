// Sketch Patch turns a ChatGPT diff into a complete, updated p5.js sketch.
// Paste a sketch first, then paste changes; the full result is copied automatically.

const PATCH_INSTRUCTIONS = `When changing my p5.js sketch, return a valid unified diff for sketch.js.
Use the standard headers --- a/sketch.js and +++ b/sketch.js.
Include enough unchanged context for every change to be matched reliably.
Never use placeholders such as "existing code", "same as before", or "rest unchanged".
Do not omit lines inside a changed section.
Return the complete patch in one \`\`\`diff code block.
Do not return the complete sketch unless I explicitly ask for it.`;

const COLORS = {
  background: "#f3f0e8",
  ink: "#161616",
  muted: "#6f6a60",
  line: "#c9c3b7",
  green: "#2f6d4e",
  red: "#a33d32",
  button: "#161616",
  buttonText: "#fffdf8",
  secondary: "#e7e2d7",
};

let currentSketch = "";
let previousSketch = "";
let sketchInfo = null;
let mode = "empty";
let message = "Paste your current sketch";
let detail = "Press Cmd+V / Ctrl+V anywhere, or use Paste";
let clipboardNote = "";
let lastDebugReport = "";
let lastDebugFilename = "";
let buttons = [];

function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(Math.min(2, window.devicePixelRatio || 1));
  textFont("Arial, Helvetica, sans-serif");
  document.addEventListener("paste", handlePasteEvent);
}

function draw() {
  background(COLORS.background);
  buttons = [];

  const margin = constrain(width * 0.065, 24, 88);
  const contentWidth = Math.min(920, width - margin * 2);
  const left = (width - contentWidth) / 2;

  drawHeader(left, margin, contentWidth);
  drawStatus(left, Math.max(150, height * 0.27), contentWidth);
  drawControls(left, height - margin - 58, contentWidth);
}

function drawHeader(left, top, contentWidth) {
  noStroke();
  fill(COLORS.ink);
  textStyle(BOLD);
  textSize(constrain(width * 0.028, 24, 42));
  text("SKETCH PATCH", left, top + 34);

  stroke(COLORS.line);
  strokeWeight(1);
  line(left, top + 58, left + contentWidth, top + 58);
}

function drawStatus(left, top, contentWidth) {
  noStroke();
  fill(mode === "error" ? COLORS.red : mode === "applied" ? COLORS.green : COLORS.ink);
  textStyle(BOLD);
  textSize(constrain(width * 0.045, 32, 64));
  textLeading(70);
  text(message.toUpperCase(), left, top, contentWidth, 150);

  // Leave room for the large status to wrap to two lines on a laptop screen.
  let infoY = top + 164;
  fill(COLORS.muted);
  textStyle(NORMAL);
  textSize(constrain(width * 0.018, 16, 23));
  textLeading(31);
  text(detail, left, infoY, contentWidth, 100);

  if (sketchInfo && currentSketch) {
    const summaryY = infoY + 74;
    fill(COLORS.ink);
    textStyle(BOLD);
    textSize(18);
    text(sketchInfo.title, left, summaryY);

    fill(COLORS.muted);
    textStyle(NORMAL);
    textSize(15);
    textLeading(23);
    text(sketchInfo.details, left, summaryY + 31, contentWidth, 70);
  }

  if (clipboardNote) {
    fill(COLORS.muted);
    textStyle(NORMAL);
    textSize(13);
    const noteY = sketchInfo ? top + 320 : top + 218;
    text(clipboardNote, left, Math.min(height - 132, noteY));
  }
}

function drawControls(left, top, contentWidth) {
  const gap = 10;
  const compact = width < 650;
  const labels = currentSketch
    ? mode === "error" && lastDebugReport
      ? ["PASTE", "DEBUG FILE", "COPY INSTRUCTIONS", "UNDO"]
      : ["PASTE", "COPY SKETCH", "COPY INSTRUCTIONS", "UNDO"]
    : ["PASTE", "COPY INSTRUCTIONS"];
  const weights = compact ? labels.map(() => 1) : labels.map((label) => label === "COPY INSTRUCTIONS" ? 1.6 : 1);
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const availableWidth = contentWidth - gap * (labels.length - 1);
  let x = left;

  labels.forEach((label, index) => {
    const buttonWidth = availableWidth * (weights[index] / totalWeight);
    const primary = label === "PASTE";
    fill(primary ? COLORS.button : COLORS.secondary);
    noStroke();
    rect(x, top, buttonWidth, 58, 5);

    fill(primary ? COLORS.buttonText : COLORS.ink);
    textAlign(CENTER, CENTER);
    textStyle(BOLD);
    textSize(compact ? 11 : 13);
    text(label, x + buttonWidth / 2, top + 30);
    textAlign(LEFT, BASELINE);

    buttons.push({ label, x, y: top, width: buttonWidth, height: 58 });
    x += buttonWidth + gap;
  });
}

function mousePressed() {
  const button = buttons.find(
    (item) => mouseX >= item.x && mouseX <= item.x + item.width && mouseY >= item.y && mouseY <= item.y + item.height,
  );
  if (!button) return;

  if (button.label === "PASTE") pasteFromClipboard();
  if (button.label === "COPY SKETCH") copyCurrentSketch();
  if (button.label === "DEBUG FILE") downloadLastDebugReport();
  if (button.label === "COPY INSTRUCTIONS") copyInstructions();
  if (button.label === "UNDO") undoLastChange();
}

async function pasteFromClipboard() {
  try {
    const pastedText = await navigator.clipboard.readText();
    processPastedText(pastedText);
  } catch (error) {
    setError("Paste permission was blocked", "Use Cmd+V or Ctrl+V anywhere on this page");
  }
}

function handlePasteEvent(event) {
  const pastedText = event.clipboardData?.getData("text/plain") || "";
  if (pastedText) {
    event.preventDefault();
    processPastedText(pastedText);
  }
}

async function processPastedText(rawText) {
  const textValue = rawText.replace(/\r\n/g, "\n").trim();
  if (!textValue) {
    setError("Nothing to paste", "Copy a sketch or a ChatGPT diff, then try again");
    return;
  }

  if (looksLikeDiff(textValue)) {
    if (!currentSketch) {
      setError("Paste the original sketch first", "A diff needs the sketch it was written for");
      return;
    }

    const diff = extractDiff(textValue);
    try {
      const result = applyUnifiedDiff(currentSketch, diff);
      previousSketch = currentSketch;
      currentSketch = result.text;
      sketchInfo = analyzeSketch(currentSketch);
      mode = "applied";
      message = "Change applied";
      detail = `+${result.added} added · −${result.removed} removed · full sketch copied`;
      clearDebugReport();
      const copied = await copyText(currentSketch);
      clipboardNote = copied ? "Clipboard ready" : "Automatic copy was blocked — use Copy sketch";
    } catch (error) {
      setError("Change did not match", error.message || "Ask ChatGPT for a diff based on the latest sketch");
      const filename = createAndDownloadDebugReport(error, textValue, diff);
      clipboardNote = `${filename} downloaded · nothing was changed`;
    }
    return;
  }

  const sketch = extractCompleteSketch(textValue);
  if (!looksLikeJavaScriptSketch(sketch)) {
    setError("This does not look like a sketch", "Paste a complete p5.js sketch or a unified diff");
    if (currentSketch) {
      const error = new Error("The pasted text was neither a recognized unified diff nor a complete p5.js sketch");
      const filename = createAndDownloadDebugReport(error, textValue, extractDiff(textValue));
      clipboardNote = `${filename} downloaded · nothing was changed`;
    }
    return;
  }

  previousSketch = currentSketch;
  currentSketch = sketch.trim() + "\n";
  sketchInfo = analyzeSketch(currentSketch);
  mode = "loaded";
  message = "Sketch loaded";
  detail = `${sketchInfo.lineCount} lines · now paste ChatGPT’s change`;
  clearDebugReport();
  clipboardNote = "";
}

async function copyInstructions() {
  const copied = await copyText(PATCH_INSTRUCTIONS);
  if (copied) {
    clipboardNote = "ChatGPT instructions copied";
  } else {
    setError("Clipboard was blocked", "Allow clipboard access and try again");
  }
}

async function copyCurrentSketch() {
  if (!currentSketch) return;
  const copied = await copyText(currentSketch);
  if (copied) {
    clipboardNote = "Full sketch copied";
  } else {
    setError("Clipboard was blocked", "Allow clipboard access and try again");
  }
}

function undoLastChange() {
  if (!previousSketch) return;
  const swap = currentSketch;
  currentSketch = previousSketch;
  previousSketch = swap;
  sketchInfo = analyzeSketch(currentSketch);
  mode = "loaded";
  message = "Last change undone";
  detail = `${sketchInfo.lineCount} lines · paste another change when ready`;
  clearDebugReport();
  clipboardNote = "";
}

function setError(title, explanation) {
  mode = "error";
  message = title;
  detail = explanation;
  clipboardNote = "Nothing was changed";
}

function createAndDownloadDebugReport(error, rawPaste, normalizedDiff) {
  const number = Date.now();
  lastDebugFilename = `debug-${number}.txt`;
  lastDebugReport = buildDebugReport(error, rawPaste, normalizedDiff, number);
  downloadTextFile(lastDebugFilename, lastDebugReport);
  return lastDebugFilename;
}

function buildDebugReport(error, rawPaste, normalizedDiff, number) {
  const info = currentSketch ? analyzeSketch(currentSketch) : null;
  const sections = [
    "SKETCH PATCH DEBUG REPORT",
    "=========================",
    `Debug number: ${number}`,
    `Created: ${new Date(number).toISOString()}`,
    `Error: ${error?.message || String(error || "Unknown error")}`,
    `Current sketch characters: ${currentSketch.length}`,
    `Current sketch lines: ${info?.lineCount || 0}`,
    `Pasted characters: ${rawPaste.length}`,
    `Normalized diff characters: ${normalizedDiff.length}`,
    "",
    "CURRENT SKETCH",
    "==============",
    currentSketch || "[No sketch was loaded]",
    "",
    "NORMALIZED DIFF",
    "===============",
    normalizedDiff || "[No diff was recognized]",
    "",
    "ORIGINAL PASTED TEXT",
    "====================",
    rawPaste || "[Nothing was pasted]",
    "",
  ];
  return sections.join("\n");
}

function downloadLastDebugReport() {
  if (!lastDebugReport || !lastDebugFilename) return;
  downloadTextFile(lastDebugFilename, lastDebugReport);
  clipboardNote = `${lastDebugFilename} downloaded again`;
}

function downloadTextFile(filename, contents) {
  const blob = new Blob([contents], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function clearDebugReport() {
  lastDebugReport = "";
  lastDebugFilename = "";
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch (error) {
    return false;
  }
}

function looksLikeDiff(value) {
  const candidate = extractDiff(value);
  return /^---\s+.+$/m.test(candidate) && /^\+\+\+\s+.+$/m.test(candidate) && /^@@\s+-\d+/m.test(candidate);
}

function extractDiff(value) {
  const fenced = [...value.matchAll(/```(?:diff|patch)\s*\n([\s\S]*?)```/gi)];
  if (fenced.length) return normalizeRenderedDiff(fenced.map((match) => match[1]).join("\n").trim());

  const start = value.search(/^---\s+.+$/m);
  const extracted = start >= 0 ? value.slice(start).replace(/```\s*$/, "").trim() : value.trim();
  return normalizeRenderedDiff(extracted);
}

// Some chat surfaces copy rendered Markdown instead of the original diff text.
// In that format indentation becomes &#x20; and Markdown punctuation is escaped.
function normalizeRenderedDiff(value) {
  const hasRenderedEscapes = /(?:&#x20;|&#32;|&nbsp;|^\\[+-])/im.test(value);
  if (!hasRenderedEscapes) return value;

  return value
    .split("\n")
    .map((line) => {
      let normalized = line
        .replace(/^(?:&#x20;|&#32;|&nbsp;)/i, " ")
        .replace(/^\\([+-])/, "$1");

      if (/^[ +\-]/.test(normalized)) {
        const prefix = normalized[0];
        const code = normalized
          .slice(1)
          .replace(/\\_/g, "_")
          .replace(/\\\*/g, "*");
        normalized = prefix + code;
      }

      return normalized;
    })
    .join("\n");
}

function extractCompleteSketch(value) {
  const fenced = [...value.matchAll(/```(?:javascript|js|p5)?\s*\n([\s\S]*?)```/gi)]
    .map((match) => match[1].trim())
    .filter(looksLikeJavaScriptSketch);
  if (!fenced.length) return value;
  return fenced.sort((a, b) => b.length - a.length)[0];
}

function looksLikeJavaScriptSketch(value) {
  return /\bfunction\s+(?:setup|draw)\s*\(/.test(value) || /\b(?:setup|draw)\s*=\s*(?:async\s*)?\(/.test(value);
}

function applyUnifiedDiff(original, diffText) {
  const originalEndsWithNewline = original.endsWith("\n");
  let lines = original.replace(/\r\n/g, "\n").split("\n");
  if (originalEndsWithNewline) lines.pop();

  const diffLines = diffText.replace(/\r\n/g, "\n").split("\n");
  const hunks = [];
  let currentHunk = null;

  for (const line of diffLines) {
    const header = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
    if (header) {
      currentHunk = {
        oldStart: Number(header[1]),
        lines: [],
      };
      hunks.push(currentHunk);
      continue;
    }
    if (currentHunk && /^(?:diff --git |--- (?:a\/|\/dev\/null)|\+\+\+ (?:b\/|\/dev\/null))/.test(line)) {
      currentHunk = null;
      continue;
    }
    if (currentHunk && /^[ +\-]/.test(line)) {
      currentHunk.lines.push(line);
    }
  }

  if (!hunks.length) throw new Error("No valid change sections were found in the diff");
  if (hunks.some((hunk) => !hunk.lines.length)) throw new Error("A change section contains no code");

  let offset = 0;
  let added = 0;
  let removed = 0;

  for (const hunk of hunks) {
    const oldBlock = hunk.lines.filter((line) => !line.startsWith("+")).map((line) => line.slice(1));
    const newBlock = hunk.lines.filter((line) => !line.startsWith("-")).map((line) => line.slice(1));
    const expectedIndex = Math.max(0, hunk.oldStart - 1 + offset);
    const matchIndex = findHunkPosition(lines, oldBlock, expectedIndex);

    const hunkAdded = hunk.lines.filter((line) => line.startsWith("+")).length;
    const hunkRemoved = hunk.lines.filter((line) => line.startsWith("-")).length;

    if (matchIndex >= 0) {
      lines.splice(matchIndex, oldBlock.length, ...newBlock);
    } else {
      const fuzzyMatch = findFuzzyHunkMatch(lines, hunk.lines, expectedIndex);
      if (fuzzyMatch) {
        lines = applyFuzzyHunk(lines, hunk.lines, fuzzyMatch);
      } else {
      const clue = oldBlock.find((line) => line.trim())?.trim().slice(0, 60) || `line ${hunk.oldStart}`;
      throw new Error(`Could not find the expected code near “${clue}”`);
      }
    }

    added += hunkAdded;
    removed += hunkRemoved;
    offset += hunkAdded - hunkRemoved;
  }

  return { text: lines.join("\n") + (originalEndsWithNewline ? "\n" : ""), added, removed };
}

function findHunkPosition(lines, block, expectedIndex) {
  if (blocksMatch(lines, block, expectedIndex)) return expectedIndex;

  const matches = [];
  for (let index = 0; index <= lines.length - block.length; index += 1) {
    if (blocksMatch(lines, block, index)) matches.push(index);
  }
  return matches.length === 1 ? matches[0] : -1;
}

function blocksMatch(lines, block, index) {
  if (index < 0 || index + block.length > lines.length) return false;
  return block.every((line, offset) => lines[index + offset] === line);
}

// AI-generated diffs sometimes lose indentation and collapse blank lines while
// travelling through chat apps. Match only when the remaining code sequence is
// unique, then preserve the source's existing context instead of rewriting it.
function findFuzzyHunkMatch(lines, hunkLines, expectedIndex) {
  const significant = hunkLines
    .map((line, hunkIndex) => ({ line, hunkIndex, code: line.slice(1).trim() }))
    .filter((entry) => !entry.line.startsWith("+") && entry.code);

  if (significant.length < 2) return null;

  const candidates = [];
  for (let start = 0; start < lines.length; start += 1) {
    if (lines[start].trim() !== significant[0].code) continue;

    const mapping = new Map([[significant[0].hunkIndex, start]]);
    let sourceIndex = start;
    let matched = true;

    for (let index = 1; index < significant.length; index += 1) {
      sourceIndex += 1;
      while (sourceIndex < lines.length && !lines[sourceIndex].trim()) sourceIndex += 1;
      if (sourceIndex >= lines.length || lines[sourceIndex].trim() !== significant[index].code) {
        matched = false;
        break;
      }
      mapping.set(significant[index].hunkIndex, sourceIndex);
    }

    if (matched) candidates.push({ mapping, start, distance: Math.abs(start - expectedIndex) });
  }

  if (candidates.length === 1) return candidates[0];
  return null;
}

function applyFuzzyHunk(lines, hunkLines, match) {
  const removals = new Set();
  const insertions = new Map();
  const mappedEntries = [...match.mapping.entries()];
  const flattened = mappedEntries.some(([hunkIndex, sourceIndex]) => {
    const patchCode = hunkLines[hunkIndex].slice(1);
    return patchCode === patchCode.trimStart() && /^\s+/.test(lines[sourceIndex]);
  });

  for (const [hunkIndex, sourceIndex] of mappedEntries) {
    if (hunkLines[hunkIndex].startsWith("-")) removals.add(sourceIndex);
  }

  for (let index = 0; index < hunkLines.length; index += 1) {
    if (!hunkLines[index].startsWith("+")) continue;

    const group = [];
    while (index < hunkLines.length && hunkLines[index].startsWith("+")) {
      group.push(hunkLines[index].slice(1));
      index += 1;
    }

    const nextMapped = mappedEntries.find(([hunkIndex]) => hunkIndex >= index);
    const previousMapped = [...mappedEntries].reverse().find(([hunkIndex]) => hunkIndex < index);
    const boundary = nextMapped ? nextMapped[1] : previousMapped ? previousMapped[1] + 1 : lines.length;
    const indentSource = previousMapped || nextMapped;
    const baseIndent = indentSource ? lines[indentSource[1]].match(/^\s*/)[0] : "";
    const prepared = group.map((code) => {
      if (!code || !flattened || /^\s/.test(code)) return code;
      return baseIndent + code;
    });
    insertions.set(boundary, [...(insertions.get(boundary) || []), ...prepared]);
    index -= 1;
  }

  const result = [];
  for (let index = 0; index <= lines.length; index += 1) {
    if (insertions.has(index)) result.push(...insertions.get(index));
    if (index < lines.length && !removals.has(index)) result.push(lines[index]);
  }
  return result;
}

function analyzeSketch(source) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const openingComment = extractOpeningComment(source);
  const visibleStrings = extractVisibleStrings(source);
  const features = detectFeatures(source);
  const setupCalls = extractSetupCalls(source);
  const functions = [...source.matchAll(/\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)]
    .map((match) => match[1])
    .filter((name, index, values) => values.indexOf(name) === index);

  let title = openingComment || visibleStrings[0] || "p5.js sketch";
  title = cleanDescription(title);
  if (title.length > 88) title = title.slice(0, 85).trimEnd() + "…";

  const details = [];
  if (features.length) details.push(`Uses ${joinNatural(features.slice(0, 4))}`);
  else if (setupCalls.length) details.push(`Starts ${joinNatural(setupCalls.slice(0, 3))}`);
  if (visibleStrings[0] && cleanDescription(visibleStrings[0]) !== title) {
    details.push(`Says “${cleanDescription(visibleStrings[0]).slice(0, 80)}”`);
  }
  const coreFunctions = functions.filter((name) => ["setup", "draw", "mousePressed", "keyPressed", "touchStarted"].includes(name));
  if (coreFunctions.length) details.push(coreFunctions.join(" · "));

  return {
    title,
    details: details.join("  —  ") || "A p5.js sketch",
    lineCount: lines.length,
  };
}

function extractOpeningComment(source) {
  const trimmed = source.replace(/^\s+/, "");
  const block = trimmed.match(/^\/\*([\s\S]*?)\*\//);
  if (block) return firstUsefulCommentLine(block[1].split("\n"));

  const commentLines = [];
  for (const line of trimmed.split("\n")) {
    const match = line.match(/^\s*\/\/\s?(.*)$/);
    if (!match) break;
    commentLines.push(match[1]);
  }
  return firstUsefulCommentLine(commentLines);
}

function firstUsefulCommentLine(lines) {
  return lines
    .map((line) => line.replace(/^\s*\*\s?/, "").replace(/^(?:sketch|about|description)\s*:\s*/i, "").trim())
    .find((line) => line.length >= 8 && !/^https?:\/\//i.test(line)) || "";
}

function extractVisibleStrings(source) {
  const found = [];
  const patterns = [
    /\b(?:text|createButton|uiButton|uiText|createP|createElement)\s*\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g,
    /\b(?:message|status|label|title|prompt|instruction)\s*=\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/gi,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const value = match[2]
        .replace(/\\n/g, " ")
        .replace(/\\(["'`])/g, "$1")
        .replace(/\$\{[^}]+\}/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (isUsefulString(value) && !found.includes(value)) found.push(value);
    }
  }
  return found;
}

function isUsefulString(value) {
  if (value.length < 5 || value.length > 140) return false;
  if (!/[A-Za-z]{3}/.test(value)) return false;
  if (/^(?:https?:|\.\/|\.\.\/|[\w/-]+\.(?:js|json|png|jpg|mp3|css))/i.test(value)) return false;
  if (/^(?:loading|error|debug|true|false|null|undefined)$/i.test(value)) return false;
  return true;
}

function detectFeatures(source) {
  const featurePatterns = [
    ["pose tracking", /pose(?:Net|Tracker|Detection|Landmarker)|setupPose/i],
    ["hand tracking", /hand(?:Pose|Tracker|Landmarker)|setupHand/i],
    ["webcam input", /createCapture|setupWebcamera|\bVIDEO\b/],
    ["screen sharing", /getDisplayMedia|ScreenSharing/i],
    ["speech", /speechSynthesis|PortalSpeech|SpeechRecognition/i],
    ["peer-to-peer networking", /\bPeer\s*\(|PeerJS|RTCPeerConnection/],
    ["serial input", /WebSerial|navigator\.serial|setupSerial/i],
    ["sound", /loadSound|SoundFile|AudioContext/i],
    ["JSON data", /loadJSON|\.json["'`]/i],
    ["keyboard input", /keyPressed|keyReleased|keyIsDown/],
  ];
  return featurePatterns.filter(([, pattern]) => pattern.test(source)).map(([name]) => name);
}

function extractSetupCalls(source) {
  const setupStart = source.search(/\b(?:async\s+)?function\s+setup\s*\([^)]*\)\s*\{/);
  if (setupStart < 0) return [];
  const body = source.slice(setupStart, findClosingBrace(source, source.indexOf("{", setupStart)) + 1);
  const ignored = new Set(["setup", "createCanvas", "background", "frameRate", "pixelDensity", "textFont", "loadScript"]);
  return [...body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)]
    .map((match) => match[1])
    .filter((name, index, values) => !ignored.has(name) && values.indexOf(name) === index);
}

function findClosingBrace(source, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return index;
  }
  return source.length - 1;
}

function cleanDescription(value) {
  return value.replace(/\s+/g, " ").replace(/[.;:]$/, "").trim();
}

function joinNatural(values) {
  if (values.length < 2) return values[0] || "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
