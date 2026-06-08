export function createProjectImporter({
  normalizeProject,
  normalizeSketchName,
  forkImportedProjectIfNeeded,
  projectFromCode,
} = {}) {
  function sketchNameFromFilename(filename = "") {
    const base = String(filename || "")
      .split(/[\\/]/)
      .pop()
      .replace(/\.(p1e\.json|json|wrench|txt)$/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return normalizeSketchName(base);
  }

  function parseDroppedProject(text, file = null) {
    const fallbackName = sketchNameFromFilename(file?.name || "");
    try {
      const parsed = JSON.parse(String(text || ""));
      const project = normalizeProject(parsed, fallbackName);
      if (project) return forkImportedProjectIfNeeded(project);
    } catch {
    }
    return projectFromCode(String(text || ""), fallbackName);
  }

  return {
    parseDroppedProject,
    sketchNameFromFilename,
  };
}
