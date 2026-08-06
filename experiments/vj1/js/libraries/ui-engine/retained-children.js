// Preserve mounted child subtrees when semantic identity and order are stable.
// Re-appending an existing DOM child is still a move and can reset focus,
// selection, scroll anchoring, and nested scroll viewports.
export function reconcileRetainedChildren(container, orderedChildren = []) {
  const retained = new Set(orderedChildren);
  for (const child of [...container.children]) {
    if (!retained.has(child)) child.remove();
  }
  orderedChildren.forEach((child, index) => {
    const current = container.children[index];
    if (current !== child) container.insertBefore(child, current || null);
  });
}
