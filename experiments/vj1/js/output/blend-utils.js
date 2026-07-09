export function applyBlend(pg, blend) {
  if (blend === "add") pg.blendMode(ADD);
  else if (blend === "screen") pg.blendMode(SCREEN);
  else if (blend === "multiply") pg.blendMode(MULTIPLY);
  else if (blend === "darkest") applyP5BlendMode(pg, "DARKEST");
  else if (blend === "lightest") applyP5BlendMode(pg, "LIGHTEST");
  else if (blend === "difference") applyP5BlendMode(pg, "DIFFERENCE");
  else if (blend === "exclusion") applyP5BlendMode(pg, "EXCLUSION");
  else if (blend === "overlay") applyP5BlendMode(pg, "OVERLAY");
  else if (blend === "remove") applyP5BlendMode(pg, "REMOVE");
  else pg.blendMode(BLEND);
}

function applyP5BlendMode(pg, modeName) {
  const mode = globalThis[modeName];
  pg.blendMode(typeof mode !== "undefined" ? mode : BLEND);
}
