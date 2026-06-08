export function createCodeDropController({
  dropTarget,
  onDropText = async () => {},
} = {}) {
  function stop(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function setDragging(dragging) {
    dropTarget?.classList.toggle("is-dragover", dragging);
  }

  function bind() {
    if (!dropTarget) return;

    ["dragenter", "dragover"].forEach((name) => {
      dropTarget.addEventListener(name, (event) => {
        stop(event);
        setDragging(true);
      });
    });

    ["dragleave", "dragend"].forEach((name) => {
      dropTarget.addEventListener(name, (event) => {
        stop(event);
        setDragging(false);
      });
    });

    dropTarget.addEventListener("drop", async (event) => {
      stop(event);
      setDragging(false);
      const file = event.dataTransfer?.files?.[0] || null;
      const text = file ? await file.text() : event.dataTransfer?.getData("text/plain");
      if (!text) return;
      await onDropText({ text, file });
    });
  }

  return { bind };
}
