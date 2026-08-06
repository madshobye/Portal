export function setByPath(target, path, value) {
  const parts = String(path || "").split(".").filter(Boolean);
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index++) {
    const part = pathPart(parts[index]);
    cursor = cursor?.[part];
    if (!cursor) return;
  }
  if (!cursor || !parts.length) return;
  cursor[pathPart(parts.at(-1))] = value;
}

export function getByPath(target, path) {
  const parts = String(path || "").split(".").filter(Boolean);
  let cursor = target;
  for (const part of parts) cursor = cursor?.[pathPart(part)];
  return cursor;
}

export function setByPathCreate(target, path, value) {
  const parts = String(path || "").split(".").filter(Boolean);
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index++) {
    const part = pathPart(parts[index]);
    if (cursor[part] === undefined) cursor[part] = Number.isNaN(Number(parts[index + 1])) ? {} : [];
    cursor = cursor[part];
  }
  if (cursor && parts.length) cursor[pathPart(parts.at(-1))] = value;
}

function pathPart(value) {
  return Number.isNaN(Number(value)) ? value : Number(value);
}
