export function moveById(list, fromId, toId) {
  if (!Array.isArray(list)) return false;
  const fromIndex = list.findIndex((item) => item.id === fromId);
  const toIndex = list.findIndex((item) => item.id === toId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return false;
  const [item] = list.splice(fromIndex, 1);
  list.splice(toIndex, 0, item);
  return true;
}

export function insertChainItemNearSelection(chain = [], selectedId = "", item = null) {
  if (!item) return;
  const selected = findChainItemLocation(chain, selectedId);
  if (selected?.item?.kind === "group") {
    selected.item.chain ||= [];
    selected.item.chain.push(item);
    return;
  }
  if (selected?.chain) {
    selected.chain.splice(selected.index + 1, 0, item);
    return;
  }
  chain.push(item);
}

export function findChainItemLocation(chain = [], id = "") {
  if (!Array.isArray(chain) || !id) return null;
  for (let index = 0; index < chain.length; index++) {
    const item = chain[index];
    if (item.id === id) return { chain, item, index };
    const nested = item.kind === "group" ? findChainItemLocation(item.chain, id) : null;
    if (nested) return nested;
  }
  return null;
}

export function countChainGroups(chain = []) {
  let count = 0;
  for (const item of chain || []) {
    if (item.kind === "group") count++;
    if (item.kind === "group") count += countChainGroups(item.chain);
  }
  return count;
}

export function moveChainItem(rootChain = [], fromId = "", toId = "", position = "before") {
  if (!fromId || !toId || !Array.isArray(rootChain)) return false;
  if (position === "inside" && (fromId === toId || chainItemContainsId(findChainItemLocation(rootChain, fromId)?.item, toId))) {
    return false;
  }
  const from = findChainItemLocation(rootChain, fromId);
  const target = findChainItemLocation(rootChain, toId);
  if (!from || !target) return false;
  if (position === "inside" && target.item.kind !== "group") return false;
  if ((position === "before" || position === "after") && from.chain === target.chain && from.index === target.index) return false;
  if (chainItemContainsId(from.item, toId)) return false;

  const [moved] = from.chain.splice(from.index, 1);
  if (!moved) return false;

  if (position === "inside") {
    target.item.chain ||= [];
    target.item.chain.push(moved);
    return true;
  }

  const adjustedTarget = findChainItemLocation(rootChain, toId);
  if (!adjustedTarget) {
    rootChain.push(moved);
    return true;
  }
  const insertIndex = adjustedTarget.index + (position === "after" ? 1 : 0);
  adjustedTarget.chain.splice(insertIndex, 0, moved);
  return true;
}

export function chainItemContainsId(item = null, id = "") {
  if (!item || !id || item.kind !== "group") return false;
  for (const child of item.chain || []) {
    if (child.id === id || chainItemContainsId(child, id)) return true;
  }
  return false;
}

export function clearComponentReferences(chain = [], componentId = "") {
  for (const item of chain || []) {
    if (item.kind === "source" && item.source?.type === "component" && item.source.componentId === componentId) {
      item.source.componentId = "";
    }
    if (item.kind === "group") clearComponentReferences(item.chain, componentId);
  }
}
