import { migrateProjectData } from "../domain/project-migrations.js";
import {
  canPersistDirectoryHandles,
  loadProjectDirectoryHandle,
} from "./directory-handle-store.js";

export function applicationProgramFromProjectData(projectData, nodePackage) {
  if (!nodePackage?.prepareProjectState || !nodePackage?.applicationProgramForState) {
    throw new Error("APPLICATION_PROGRAM_PACKAGE_MISSING");
  }
  const migrated = migrateProjectData(projectData || {});
  const prepared = nodePackage.prepareProjectState(migrated);
  const group = nodePackage.applicationProgramForState(prepared);
  nodePackage.compileApplicationProgram?.(group);
  return group;
}

// The application graph configures the control process itself, so it must be
// read before that process constructs its services. This preflight reads only
// project.json from the already-authorized stored folder; it never requests a
// permission prompt, scans media, or creates render resources.
export async function loadStoredApplicationProgram(nodePackage, {
  canLoad = defaultCanLoad,
  loadHandle = loadProjectDirectoryHandle,
} = {}) {
  const fallback = nodePackage?.applicationProgram;
  if (!fallback) throw new Error("APPLICATION_PROGRAM_DEFAULT_MISSING");
  if (!canLoad()) return bootstrapResult(fallback, "default", "");
  try {
    const handle = await loadHandle();
    if (!handle) return bootstrapResult(fallback, "default", "");
    const permission = typeof handle.queryPermission === "function"
      ? await handle.queryPermission({ mode: "read" })
      : "granted";
    if (permission !== "granted") return bootstrapResult(fallback, "permission-required", "");
    const projectHandle = await handle.getFileHandle("project.json");
    const text = await (await projectHandle.getFile()).text();
    const group = applicationProgramFromProjectData(JSON.parse(text), nodePackage);
    return bootstrapResult(group, "stored-project", "");
  } catch (error) {
    if (error?.name === "NotFoundError") return bootstrapResult(fallback, "default", "");
    const message = error?.message || String(error);
    console.error("[VJ1_APPLICATION_PROGRAM_REJECTED]", {
      fallback: "built-in application program",
      message,
    });
    return bootstrapResult(fallback, "rejected", message);
  }
}

function bootstrapResult(group, source, warning) {
  return Object.freeze({ group, source, warning });
}

function defaultCanLoad() {
  return typeof window !== "undefined" && canPersistDirectoryHandles();
}
