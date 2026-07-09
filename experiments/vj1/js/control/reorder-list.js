export function bindReorderList(root, {
  itemSelector = "[data-reorder-id]",
  onReorder,
} = {}) {
  if (!root || !onReorder) return;
  let draggedId = "";

  root.querySelectorAll(itemSelector).forEach((item) => {
    item.draggable = true;
    item.addEventListener("dragstart", (event) => {
      draggedId = item.dataset.reorderId || "";
      item.classList.add("is-dragging");
      event.dataTransfer?.setData("text/plain", draggedId);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });
    item.addEventListener("dragend", () => {
      item.classList.remove("is-dragging");
      draggedId = "";
    });
    item.addEventListener("dragover", (event) => {
      if (!draggedId) return;
      event.preventDefault();
      item.classList.add("is-drop-target");
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    });
    item.addEventListener("dragleave", () => {
      item.classList.remove("is-drop-target");
    });
    item.addEventListener("drop", (event) => {
      event.preventDefault();
      item.classList.remove("is-drop-target");
      const fromId = draggedId || event.dataTransfer?.getData("text/plain") || "";
      const toId = item.dataset.reorderId || "";
      if (fromId && toId && fromId !== toId) onReorder(fromId, toId);
    });
  });
}
