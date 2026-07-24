import { createProjectIsfVisualLibraryLayer } from "../isf-engine/index.js?v=named-image-inputs-1";
import { projectNodePackageVisualLibraryLayers } from "../node-engine/node-package.js?v=project-group-authoring-compiler-transport-1";
import { resolveVisualLibrary } from "../visual-library/index.js";
import { BuiltInVisualLibraryLayer } from "./catalog.js?v=compiled-graph-value-authority-1";

// Built-in, installed, and project assets share one logical catalog without
// copying immutable library resources into the project folder.
export function resolveProjectVisualLibrary(state = {}, options = []) {
  const installedLayers = Array.isArray(options) ? options : options.installedLayers || [];
  const installedPackages = Array.isArray(options) ? [] : options.installedPackages || [];
  const packageLayers = projectNodePackageVisualLibraryLayers(state.nodes || {}, installedPackages);
  return resolveVisualLibrary([
    BuiltInVisualLibraryLayer,
    ...packageLayers,
    ...(installedLayers || []),
    createProjectIsfVisualLibraryLayer(state),
  ]);
}
