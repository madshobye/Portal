export function advanceSpatialScale(previous, scale, anchor = [0, 0], output = null) {
  const nextScale = Math.max(0.02, Number(scale) || 0.62);
  const x = Number(anchor[0]) || 0;
  const y = Number(anchor[1]) || 0;
  const previousScale = previous?.scale;
  const previousPhaseX = previous?.phase?.[0] || 0;
  const previousPhaseY = previous?.phase?.[1] || 0;
  const result = output || { scale: nextScale, phase: [0, 0] };
  const delta = previous ? previousScale - nextScale : 0;
  result.scale = nextScale;
  result.phase[0] = previous ? previousPhaseX + x * delta : 0;
  result.phase[1] = previous ? previousPhaseY + y * delta : 0;
  return result;
}
