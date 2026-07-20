export function resolutionScaledStrokeWidth(strokeWidth, request = {}, backingSize = null) {
  const width = Math.max(0, Number(strokeWidth) || 0);
  if (width <= 0) return 0;
  const logicalWidth = Math.max(1, Number(request.logicalWidth) || Number(request.width) || 1);
  const logicalHeight = Math.max(1, Number(request.logicalHeight) || Number(request.height) || 1);
  const rasterWidth = Math.max(1, Number(backingSize?.width) || Number(request.width) || logicalWidth);
  const rasterHeight = Math.max(1, Number(backingSize?.height) || Number(request.height) || logicalHeight);
  const rasterScale = Math.max(0.01, Math.min(rasterWidth / logicalWidth, rasterHeight / logicalHeight));
  return Math.max(0.125, width * rasterScale);
}
