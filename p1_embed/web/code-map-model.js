// Structural reader for the Wrench syntax used by XOBIT. Never executes code.
// Unknown constructs remain source blocks; this is not a compiler or runtime trace.
export function parseCodeMap(source = "") {
  source = String(source);
  const tokens = [];
  let line = 1;
  const add = (value, start, end, at) => tokens.push({ value, start, end, line: at });
  try {
    if (source.length > 150000) throw new Error("Code Map supports scripts up to 150,000 characters.");
    for (let i = 0; i < source.length;) {
      const start = i, at = line, c = source[i];
      if (/\s/.test(c)) { if (c === "\n") line++; i++; continue; }
      if (source.startsWith("//", i)) { while (i < source.length && source[i] !== "\n") i++; continue; }
      if (source.startsWith("/*", i)) {
        i += 2;
        while (i < source.length && !source.startsWith("*/", i)) { if (source[i++] === "\n") line++; }
        if (i >= source.length) throw new Error(`Unclosed comment at line ${at}.`);
        i += 2; continue;
      }
      if (c === '"' || c === "'") {
        i++;
        while (i < source.length && source[i] !== c) {
          if (source[i] === "\\") { i += 2; continue; }
          if (source[i++] === "\n") line++;
        }
        if (i >= source.length) throw new Error(`Unclosed string at line ${at}.`);
        i++; add(source.slice(start, i), start, i, at); continue;
      }
      const word = source.slice(i).match(/^[A-Za-z_$][\w$]*|^(?:0x[\da-fA-F]+|\d+(?:\.\d+)?)/);
      i += word ? word[0].length : 1;
      add(source.slice(start, i), start, i, at);
    }
    const pairs = new Map(), stack = [];
    tokens.forEach((t, i) => {
      if (["(", "[", "{"].includes(t.value)) stack.push(i);
      if ([")", "]", "}"].includes(t.value)) {
        const open = stack.pop();
        if (open === undefined || '([{'.indexOf(tokens[open].value) !== ')]}'.indexOf(t.value)) throw new Error(`Unmatched ${t.value} at line ${t.line}.`);
        pairs.set(open, i);
      }
    });
    if (stack.length) throw new Error(`Unclosed ${tokens[stack[0]].value} at line ${tokens[stack[0]].line}.`);
    let cursor = 0, count = 0;
    const value = () => tokens[cursor]?.value;
    const node = (kind, start, end, extra = {}) => {
      if (++count > 2000) throw new Error("Code Map supports up to 2,000 blocks.");
      return { kind, start: tokens[start].start, end: tokens[end].end,
        line: tokens[start].line, endLine: tokens[end].line,
        text: source.slice(tokens[start].start, tokens[end].end), ...extra };
    };
    const body = (depth) => {
      if (depth > 40) throw new Error("Code nesting is too deep to display.");
      if (value() !== "{") return [statement(depth + 1)];
      cursor++;
      const children = [];
      while (cursor < tokens.length && value() !== "}") children.push(statement(depth + 1));
      if (value() !== "}") throw new Error("Expected a closing brace.");
      cursor++;
      return children;
    };
    const condition = () => {
      if (value() !== "(") throw new Error(`Expected a condition near line ${tokens[cursor]?.line || line}.`);
      const start = cursor, end = pairs.get(cursor);
      cursor = end + 1;
      return source.slice(tokens[start].end, tokens[end].start).trim();
    };
    const statement = (depth = 0) => {
      if (depth > 40) throw new Error("Code nesting is too deep to display.");
      const start = cursor, keyword = value();
      if (keyword === "function") {
        cursor++;
        const name = value(); cursor++;
        const parameters = condition();
        if (value() !== "{") throw new Error(`Expected function body at line ${tokens[start].line}.`);
        const children = body(depth);
        return node("function", start, cursor - 1, { name, parameters, children });
      }
      if (["if", "while", "for"].includes(keyword)) {
        cursor++;
        const headerStart = cursor;
        const expression = condition();
        const header = tokens.slice(headerStart + 1, cursor - 1);
        const calls = header.filter((t, i) => header[i + 1]?.value === "(" && /^[A-Za-z_$]/.test(t.value)).map(t => t.value);
        const children = body(depth);
        let alternate = [];
        if (keyword === "if" && value() === "else") { cursor++; alternate = body(depth); }
        return node(keyword, start, cursor - 1, { expression, calls, children, alternate });
      }
      if (keyword === "do") {
        cursor++;
        body(depth);
        if (value() === "while") { cursor++; condition(); }
        if (value() === ";") cursor++;
        return node("source", start, cursor - 1, { calls: [] });
      }
      // Skip balanced expressions and unknown blocks intact, including switch.
      while (cursor < tokens.length && value() !== ";" && value() !== "}") {
        if (pairs.has(cursor)) {
          const block = value() === "{";
          cursor = pairs.get(cursor) + 1;
          if (block) break;
        } else cursor++;
      }
      if (value() === ";") cursor++;
      if (cursor === start) throw new Error(`Unexpected syntax at line ${tokens[start].line}.`);
      const simple = tokens.slice(start, cursor);
      const calls = simple.filter((t, i) => simple[i + 1]?.value === "(" && /^[A-Za-z_$]/.test(t.value)).map(t => t.value);
      const kind = ["return", "break", "continue"].includes(keyword) ? keyword
        : simple.some(t => ["{", "}", ":"].includes(t.value)) || ["do", "switch", "goto"].includes(keyword) ? "source" : "statement";
      return node(kind, start, cursor - 1, { calls });
    };
    const nodes = [];
    while (cursor < tokens.length) nodes.push(statement());
    return { source, nodes, error: "" };
  } catch (error) {
    return { source, nodes: [], error: error.message };
  }
}

export function canContinueCodeFlow(node) {
  if (["return", "break", "continue", "source"].includes(node.kind)) return false;
  if (node.kind === "if") {
    const flows = children => !children.length || canContinueCodeFlow(children[children.length - 1]);
    return flows(node.children) || flows(node.alternate);
  }
  return true;
}

const operations = {
  pinMode: ["settings_input_component", "Configure pin"], digitalRead: ["touch_app", "Read digital input"],
  analogRead: ["sensors", "Read analog input"], touchRead: ["touch_app", "Read touch input"],
  digitalWrite: ["power", "Write digital output"], analogWrite: ["tune", "Write analog output"],
  ledConfig: ["lightbulb", "Configure LED strip"], ledSet: ["lightbulb", "Set LED colour"],
  ledClear: ["lightbulb", "Clear LEDs"], ledShow: ["lightbulb", "Show LEDs"],
  delay: ["schedule", "Wait"], println: ["terminal", "Print"], print: ["terminal", "Print"],
};

export function describeCodeNode(node) {
  if (node.kind === "source") return { icon: "code", label: "Source block · flow not inferred" };
  if (node.kind === "if") return { icon: "call_split", label: "Condition" };
  if (["while", "for"].includes(node.kind)) return { icon: "repeat", label: node.kind === "for" ? "For loop" : "While loop" };
  const operation = node.calls?.find(name => operations[name]);
  if (operation) return { icon: operations[operation][0], label: operations[operation][1] };
  if (["return", "break", "continue"].includes(node.kind)) return { icon: "subdirectory_arrow_right", label: node.kind };
  return { icon: node.calls?.length ? "functions" : "data_object", label: node.calls?.length ? "Function call" : "Values / expression" };
}
