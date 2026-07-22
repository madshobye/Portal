// A deliberately small p5-like authoring surface for procedural 2D nodes.
// Sketch code runs once while the node definition is loaded. The resulting
// plain command structure is what gets compiled; no JavaScript is interpreted
// while frames are rendered.
export function createSdf2dProgram({ id = "procedural-2d", name = "Procedural 2D", draw } = {}) {
  const commands = [];
  const api = Object.freeze({
    background: (color) => commands.push(command("background", { color })),
    rect: (x, y, width, height, color, options = {}) => commands.push(command("rect", { x, y, width, height, color, ...options })),
    circle: (x, y, radius, color, options = {}) => commands.push(command("circle", { x, y, radius, color, ...options })),
    ring: (x, y, radius, weight, color, options = {}) => commands.push(command("ring", { x, y, radius, weight, color, ...options })),
    line: (x1, y1, x2, y2, weight, color, options = {}) => commands.push(command("line", { x1, y1, x2, y2, weight, color, ...options })),
    grid: (columns, rows, weight, color, options = {}) => commands.push(command("grid", { columns, rows, weight, color, ...options })),
    edgeChecks: (count, depth, colorA, colorB) => commands.push(command("edgeChecks", { count, depth, colorA, colorB })),
    stripes: (x, y, width, height, count, colorA, colorB, options = {}) => commands.push(command("stripes", { x, y, width, height, count, colorA, colorB, ...options })),
    colorBars: (x, y, width, height, colors, options = {}) => commands.push(command("colorBars", { x, y, width, height, colors, ...options })),
    grayScale: (x, y, width, height, steps, options = {}) => commands.push(command("grayScale", { x, y, width, height, steps, ...options })),
  });
  if (typeof draw !== "function") throw new TypeError("SDF2D_DRAW_FUNCTION_REQUIRED");
  draw(api);
  return deepFreeze({ version: 1, id: String(id), name: String(name), commands });
}

// Escape hatch for time/parameter expressions. It remains explicit in the
// stored program instead of turning the sketch into a per-frame JS evaluator.
export function sdfExpr(source) {
  return Object.freeze({ expression: String(source) });
}

function command(type, values) {
  return { type, ...values };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
