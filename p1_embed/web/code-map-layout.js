// Layout and control-flow edges are independent of DOM rendering.
export function layoutCodeMap(model) {
  const nodes = [], edges = [], groups = [];
  const W = 240, H = 96, GAP = 72;
  const add = (kind, label, source, x, y) => {
    const node = { id: `n${nodes.length}`, kind, label, source, x, y, width: W, height: H };
    nodes.push(node); return node;
  };
  const edge = (from, to, label = "", kind = "flow") => {
    if (from && to) edges.push({ from: from.id, to: to.id, label, kind });
  };
  const width = list => Math.max(W, ...list.map(n => n.kind === "if"
    ? width(n.children) + width(n.alternate) + GAP
    : ["while", "for"].includes(n.kind) ? width(n.children) + 180 : W));
  function sequence(list, x, y, context) {
    let first = null, tails = [], bottom = y;
    for (const ast of list) {
      const n = add(ast.kind, ast.expression ?? ast.text, ast, x - W / 2, bottom);
      if (!first) first = n;
      tails.forEach(t => edge(t.node, n, t.label));
      bottom += H + GAP;
      tails = [{ node: n }];
      if (ast.kind === "if") {
        const aWidth = width(ast.children), bWidth = width(ast.alternate);
        const a = sequence(ast.children, x - (bWidth + GAP) / 2, bottom, context);
        const b = sequence(ast.alternate, x + (aWidth + GAP) / 2, bottom, context);
        if (a.first) edge(n, a.first, "Yes");
        if (b.first) edge(n, b.first, "No");
        tails = [...(a.first ? a.tails : [{ node: n, label: "Yes" }]), ...(b.first ? b.tails : [{ node: n, label: "No" }])];
        bottom = Math.max(a.bottom, b.bottom, bottom);
      } else if (["while", "for"].includes(ast.kind)) {
        const exit = add("join", "Continue", null, x - W / 2, 0);
        const update = ast.kind === "for" ? add("update", "For update", ast, x + 90 - W / 2, 0) : n;
        const body = sequence(ast.children, x + 90, bottom, { ...context, breakTo: exit, continueTo: update });
        edge(n, body.first || update, "Yes");
        body.tails.forEach(t => edge(t.node, update, t.label || (ast.kind === "for" ? "Update" : "Repeat"), "back"));
        bottom = Math.max(bottom, body.bottom);
        if (ast.kind === "for") {
          update.y = bottom;
          bottom += H + GAP;
          edge(update, n, "Test again", "back");
        }
        exit.y = bottom;
        bottom += H + GAP;
        edge(n, exit, "No", "exit");
        tails = [{ node: exit }];
      } else if (ast.kind === "return") {
        edge(n, context.end, "Return", "exit"); tails = [];
      } else if (ast.kind === "break" || ast.kind === "continue") {
        edge(n, ast.kind === "break" ? context.breakTo : context.continueTo, ast.kind, "back"); tails = [];
      } else if (ast.kind === "source") {
        // We cannot assert where unsupported control flow goes next.
        tails = [];
      }
    }
    return { first, tails, bottom };
  }
  const globals = model.nodes.filter(n => n.kind !== "function");
  const functions = model.nodes.filter(n => n.kind === "function");
  const sections = [...(globals.length ? [{ name: "Startup", children: globals }] : []),
    ...functions.slice().sort((a, b) => {
      const rank = n => n === "setup" ? 0 : n === "loop" ? 1 : 2;
      return rank(a.name) - rank(b.name);
    })];
  let left = 40;
  const entries = new Map();
  for (const section of sections) {
    const firstNode = nodes.length;
    const size = width(section.children) + 120;
    const x = left + size / 2;
    const entry = add("entry", `${section.name}${section.kind === "function" ? `(${section.parameters})` : ""}`, section.kind ? section : null, x - W / 2, 90);
    const end = add("end", section.name === "loop" ? "Next invocation" : "End / return", null, x - W / 2, 0);
    entries.set(section.name, entry);
    const flow = sequence(section.children, x, 90 + H + GAP, { end });
    end.y = flow.bottom;
    edge(entry, flow.first || end);
    flow.tails.forEach(t => edge(t.node, end, t.label));
    if (section.name === "loop") edge(end, entry, "Repeat", "back");
    groups.push({ name: section.name, x: left, y: 40, width: size, height: end.y + H, entry: entry.id });
    nodes.slice(firstNode).forEach(n => { n.region = entry.id; });
    left += size + 100;
  }
  for (const n of nodes) {
    if (n.kind === "entry" || n.kind === "update") continue;
    for (const name of new Set(n.source?.calls || [])) {
      if (entries.has(name)) edge(n, entries.get(name), name, "call");
    }
  }
  return { nodes, edges, groups };
}
