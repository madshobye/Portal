export class DirectSurfaceHierarchyError extends Error {
  constructor(message, { surfaceId = "", parentSurfaceId = "" } = {}) {
    super(message);
    this.name = "DirectSurfaceHierarchyError";
    this.code = "DIRECT_SURFACE_HIERARCHY_INVALID";
    this.surfaceId = surfaceId;
    this.parentSurfaceId = parentSurfaceId;
  }
}

export function directSurfaceHierarchy(surfaces = []) {
  const direct = (surfaces || []).filter((surface) => surface?.destination?.type === "direct");
  const byId = new Map();
  for (const surface of direct) {
    const id = String(surface?.id || "");
    if (!id) {
      throw new DirectSurfaceHierarchyError("A direct Surface route requires a stable id.");
    }
    if (byId.has(id)) {
      throw new DirectSurfaceHierarchyError(`Direct Surface route "${id}" is duplicated.`, { surfaceId: id });
    }
    byId.set(id, surface);
  }

  const parentById = new Map();
  for (const surface of direct) {
    const id = String(surface.id);
    if (!Object.prototype.hasOwnProperty.call(surface.destination || {}, "parentSurfaceId")) {
      throw new DirectSurfaceHierarchyError(
        `Direct Surface route "${id}" is missing its explicit parentSurfaceId edge.`,
        { surfaceId: id },
      );
    }
    const parentId = String(surface.destination?.parentSurfaceId || "");
    if (!parentId) continue;
    if (parentId === id) {
      throw new DirectSurfaceHierarchyError(`Direct Surface route "${id}" cannot parent itself.`, {
        surfaceId: id,
        parentSurfaceId: parentId,
      });
    }
    if (!byId.has(parentId)) {
      throw new DirectSurfaceHierarchyError(
        `Direct Surface route "${id}" references missing parent "${parentId}".`,
        { surfaceId: id, parentSurfaceId: parentId },
      );
    }
    parentById.set(id, parentId);
  }

  const depthById = new Map();
  const resolving = new Set();
  const depth = (id) => {
    if (depthById.has(id)) return depthById.get(id);
    if (resolving.has(id)) {
      throw new DirectSurfaceHierarchyError(`Direct Surface hierarchy contains a cycle at "${id}".`, {
        surfaceId: id,
        parentSurfaceId: parentById.get(id) || "",
      });
    }
    resolving.add(id);
    const parentId = parentById.get(id);
    const value = parentId ? depth(parentId) + 1 : 0;
    resolving.delete(id);
    depthById.set(id, value);
    return value;
  };
  for (const id of byId.keys()) depth(id);

  return Object.freeze({
    direct,
    byId,
    parentById,
    depthById,
    ancestorsOf(surfaceId = "") {
      const ancestors = [];
      const visited = new Set();
      let parentId = parentById.get(String(surfaceId || ""));
      while (parentId && !visited.has(parentId)) {
        visited.add(parentId);
        ancestors.push(byId.get(parentId));
        parentId = parentById.get(parentId);
      }
      return ancestors;
    },
  });
}
