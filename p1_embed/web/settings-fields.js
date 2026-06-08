export function setSelectValueOrFallback(select, value, fallback = "UTC0") {
  if (!select) return;
  const nextValue = String(value || fallback).trim() || fallback;
  const existing = Array.from(select.options).find((option) => option.value === nextValue);
  select.value = existing ? nextValue : fallback;
}
