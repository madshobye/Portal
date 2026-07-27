import { collectProjectAssetFiles, isMediaFile, isShaderFile } from "./media-library-service.js";
import { RENDITION_ROOT } from "./media-rendition-service.js";
import {
  applyThumbnailUrls,
  clearThumbnailUrls,
  createThumbnailUrlLease,
} from "./component-thumbnail-store.js";
import {
  canPersistDirectoryHandles,
  clearProjectDirectoryHandle,
  loadProjectDirectoryHandle,
  saveProjectDirectoryHandle,
} from "./directory-handle-store.js";
import { createInitialState, projectSelectedMapping } from "../domain/models.js";
import { resetSceneMappingSession } from "../domain/live-ui-state.js";
import { CURRENT_PROJECT_VERSION, migrateProjectData, ProjectVersionError } from "../domain/project-migrations.js";
import { createChangeEvent } from "../libraries/state-engine/state-command/index.js";
import { isHistoryReason } from "./project-history-policy.js";
import { buildProjectPayload } from "./project-serializer.js";
import {
  createProjectSavePreparer,
  projectPayloadSignature,
} from "./project-save-preparation.js";
import { COLD_BACKUP_ROOT, createProjectHistoryStore } from "./project-history-store.js";
import { ProjectDerivedAssetStore } from "./project-derived-asset-store.js";
import { SerializedTaskQueue } from "../libraries/storage-engine/serialized-storage/index.js";
import { mergeProjectIsfDefinitions } from "../libraries/isf-engine/index.js";
import {
  serializeNodePackage,
} from "../libraries/node-engine/node-package.js";
import {
  installNodePackageReference,
  removeNodePackageReference,
} from "../libraries/node-engine/node-project.js";
import {
  assertNodePackageUpdateSafe,
  createNodePackageLock,
  exportNodePackageDirectory,
  importNodePackageDirectory,
  loadNodePackageRepository,
  resolveReferencedNodePackages,
  writeNodePackageManifest as writeRepositoryNodePackageManifest,
  NODE_PACKAGE_LIBRARY_ROOT,
} from "./node-package-repository.js";

export { projectHistorySignature } from "./project-history-policy.js";
export { buildProjectPayload, persistedRenderSettings } from "./project-serializer.js";
export { COLD_BACKUP_INTERVAL, COLD_BACKUP_ROOT, nextColdBackupRevision } from "./project-history-store.js";

export function restoreProjectLiveUi(currentLive = {}, projectLive = {}) {
  return resetSceneMappingSession({
    ...currentLive,
    ...(projectLive || {}),
    componentOverrides: currentLive?.componentOverrides || {},
  });
}

export function createProjectFolderService({ mediaLibrary, store, bridge, classifyChange = createChangeEvent }) {
  let dirHandle = null;
  let autosaveTimer = null;
  let lastSavedSignature = "";
  let lastDirectorySignature = "";
  let refreshInFlight = false;
  let isOpening = false;
  let historyInFlight = false;
  let projectLoadBlocked = false;
  let projectMigrationSaveRequired = false;
  let pendingHistory = false;
  let pendingSaveReason = "";
  let pendingAutoSaveState = null;
  let directoryPickerUnavailableReported = false;
  const thumbnailUrlLease = createThumbnailUrlLease();
  let fileObserver = null;
  let observedChangeQueue = Promise.resolve();
  let projectGeneration = 0;
  let loadedProjectHandle = null;
  let installedNodePackages = Object.freeze([]);
  let availableNodePackages = Object.freeze([]);
  const nodePackageListeners = new Set();
  let thumbnailLoadRevision = 0;
  // Non-transactional state is a checkpoint, not a render-loop concern. Give
  // repeated UI/background changes a long quiet period and force the pending
  // checkpoint when Chrome begins hiding or leaving the page.
  const autosaveDelayMs = 5000;
  const skipAutosaveReasons = new Set([
    "init",
    "view",
    "output-metrics",
    "preview-metrics",
    "project-load",
    "project-refresh",
    "project-refresh-assets",
    "project-autosave",
    "project-autosave-status",
    "project-autosave-error",
    "project-version-error",
    "project-history",
    "project-undo",
    "project-redo",
    "live:update",
  ]);
  const historyStore = createProjectHistoryStore({
    getProjectDirectory: () => dirHandle,
    onStateChange: ({ canUndo, canRedo }) => {
      store.update((draft) => {
        draft.ui.canUndo = canUndo;
        draft.ui.canRedo = canRedo;
      }, "project-history");
    },
  });
  const saveQueue = new SerializedTaskQueue({
    worker: (job) => saveProject(job),
    // Each job is a complete authoritative project snapshot. A snapshot that
    // cannot be serialized must be reported and discarded so it cannot poison
    // every later valid edit, disable undo, and leave project.json stale.
    retainFailed: false,
    onError(error) {
      store.update((draft) => {
        draft.project.warnings = [`Autosave error: ${error.message || error}`];
      }, "project-autosave-error");
      return false;
    },
  });
  const savePreparer = createProjectSavePreparer();
  savePreparer.prewarm();
  const lifecycleDocument = globalThis.document;
  const lifecycleTarget = globalThis.window || globalThis;
  lifecycleDocument?.addEventListener?.("visibilitychange", () => {
    if (lifecycleDocument.visibilityState === "hidden") flushPendingAutoSave("browser-hidden");
  });
  lifecycleTarget?.addEventListener?.("pagehide", () => flushPendingAutoSave("browser-pagehide"));
  lifecycleTarget?.addEventListener?.("beforeunload", () => flushPendingAutoSave("browser-beforeunload"));
  const derivedAssets = new ProjectDerivedAssetStore({
    getProjectDirectory: () => dirHandle,
    isCurrentProject: (handle) => handle === dirHandle,
    mediaLibrary,
    onMediaFilesChanged: () => bridge.sendMediaFiles(mediaLibrary.getAllFiles()),
  });

  async function openFolder() {
    if (!window.showDirectoryPicker) {
      if (!directoryPickerUnavailableReported) {
        directoryPickerUnavailableReported = true;
        console.warn("[VJ1_DIRECTORY_PICKER_UNAVAILABLE]", {
          fallback: "legacy file input without a persistent project folder",
          message: "window.showDirectoryPicker is unavailable",
        });
      }
      return { fallback: true };
    }
    isOpening = true;
    let opened = false;
    let loaded = false;
    try {
      const storedHandle = dirHandle ? null : await loadStoredHandle();
      let selectedHandle = null;
      if (storedHandle && await verifyPermission(storedHandle, "readwrite", true)) {
        selectedHandle = storedHandle;
      } else {
        selectedHandle = await window.showDirectoryPicker({ mode: "readwrite" });
      }
      if (selectedHandle !== dirHandle) {
        stopFileObserver();
        historyStore.reset();
        derivedAssets.reset();
        lastSavedSignature = "";
        lastDirectorySignature = "";
        projectGeneration++;
      }
      dirHandle = selectedHandle;
      clearFileObserverAbort(selectedHandle);
      opened = true;
      await saveStoredHandle(dirHandle);
      await ensureProjectScaffold(dirHandle);
      loaded = await loadDirectory("project-open-media");
      if (loaded) startFileObserver();
      return {
        fallback: false,
        loaded,
        error: loaded ? "" : String(store.getState().project?.warnings?.[0] || "Project loading was blocked."),
      };
    } finally {
      isOpening = false;
      if (opened && loaded && !projectLoadBlocked && projectMigrationSaveRequired) {
        scheduleAutoSave("project-open", { immediate: true });
      }
    }
  }

  async function restoreStoredFolder() {
    if (!canPersistDirectoryHandles()) return false;
    isOpening = true;
    let restored = false;
    try {
      const storedHandle = await loadStoredHandle();
      if (!storedHandle) return false;
      const permission = await queryPermission(storedHandle, "readwrite");
      if (permission !== "granted") {
        store.update((draft) => {
          const recoveredFromOutput = !!draft.project.folderName;
          if (!recoveredFromOutput) {
            draft.project.folderName = "";
            draft.media = [];
          }
          draft.project.warnings = [`Click the folder button to restore access to ${storedHandle.name}.`];
        }, "project-folder-needs-permission");
        return false;
      }
      dirHandle = storedHandle;
      derivedAssets.reset();
      projectGeneration++;
      await ensureProjectScaffold(dirHandle);
      restored = await loadDirectory("project-restore-media");
      if (restored) startFileObserver();
      return restored;
    } finally {
      isOpening = false;
      if (restored && !projectLoadBlocked && projectMigrationSaveRequired) {
        scheduleAutoSave({ reason: "project-restore-migration", history: "none" }, { immediate: true });
      }
    }
  }

  async function importExternalFiles(fileList) {
    const files = Array.from(fileList || []).filter((file) => file?.name);
    if (!files.length) return { imported: 0 };
    if (!dirHandle) {
      return { needsFolder: true };
    }

    let imported = 0;
    const storedFiles = [];
    for (const file of files) {
      const path = file.relativePath || file.webkitRelativePath || file.name || "";
      const rootName = isShaderFile(path) ? "shaders" : isMediaFile(path) ? "media" : "";
      if (!rootName) continue;
      storedFiles.push(await writeFileIntoProject(dirHandle, file, rootName, path));
      imported++;
    }
    // The imported handles are already known. Publishing them directly avoids
    // turning one drop into a complete project-folder traversal.
    if (storedFiles.length) {
      const result = await mediaLibrary.importFiles(storedFiles);
      mergeObservedAssets(result);
      bridge.sendMediaFiles(mediaLibrary.getAllFiles());
    }
    return { imported };
  }

  async function closeProject() {
    if (hasPendingAutoSave()) {
      await flushAutoSave("project-close-checkpoint");
    }
    await saveQueue.wait();
    if (saveQueue.size) return false;
    stopFileObserver();
    projectGeneration++;
    thumbnailLoadRevision++;
    dirHandle = null;
    loadedProjectHandle = null;
    installedNodePackages = Object.freeze([]);
    availableNodePackages = Object.freeze([]);
    saveQueue.clear();
    lastSavedSignature = "";
    lastDirectorySignature = "";
    projectLoadBlocked = false;
    derivedAssets.reset();
    historyStore.reset();
    mediaLibrary.clear();
    bridge.sendMediaFiles([]);
    publishInstalledNodePackages([], []);
    await clearStoredHandle();
    store.replace(createInitialState(), "project-close");
    thumbnailUrlLease.activate([]);
    bridge.sendState();
    return true;
  }

  async function refreshFolder({ force = false } = {}) {
    if (!dirHandle || isOpening || refreshInFlight) return false;
    refreshInFlight = true;
    try {
      const repository = await loadNodePackageRepository(dirHandle);
      const nodeState = store.getState().nodes || {};
      const packages = resolveReferencedNodePackages(
        nodeState.packages || [],
        repository,
        nodeState.packageLock || [],
      );
      publishInstalledNodePackages(packages, repository);
      const files = await collectProjectAssetFiles(dirHandle);
      const signature = directorySignature(files);
      if (!force && signature === lastDirectorySignature) return false;
      const renditionFiles = await derivedAssets.loadIndexedRenditions();
      const imported = await mediaLibrary.replaceFiles([
        ...files,
        ...renditionFiles,
      ]);
      refreshProjectAssets(imported, signature);
      bridge.sendMediaFiles(mediaLibrary.getAllFiles());
      await refreshHistoryState();
      return true;
    } finally {
      refreshInFlight = false;
    }
  }

  async function loadDirectory(reason) {
    const recoveredFolderName = String(
      store.getState().project?.folderName || "",
    );
    const preserveRecoveredResources =
      recoveredFolderName === String(dirHandle?.name || "") &&
      mediaLibrary.getAllFiles().length > 0;
    if (!preserveRecoveredResources) {
      const hadResources = mediaLibrary.getAllFiles().length > 0;
      mediaLibrary.clear();
      if (hadResources) bridge.sendMediaFiles([]);
    }
    // Project structure and persisted thumbnails are lightweight and define
    // the first useful UI. Publish them before traversing and importing the
    // potentially large media library so startup never waits behind assets.
    const loaded = await loadProject(reason, { media: [], shaders: [] }, "", { preserveMediaCatalog: true });
    if (!loaded) return false;
    const imported = { media: [], shaders: [], files: [] };
    const files = await collectProjectAssetFiles(dirHandle, {
      onBatch: async (batch) => {
        if (!batch.length) return;
        const next = await mediaLibrary.importFiles(batch);
        imported.media.push(...next.media);
        imported.shaders.push(...next.shaders);
        imported.files.push(...next.files);
        // Every message is a complete cumulative snapshot. Output windows can
        // reconcile ownership immediately without mistaking a discovery batch
        // for an authoritative deletion set.
        bridge.sendMediaFiles(mediaLibrary.getAllFiles());
      },
    });
    const signature = directorySignature(files);
    refreshProjectAssets(imported, signature);
    // Derived caches must never gate their source assets. Publish the primary
    // media snapshot first, then attach any persisted renditions as a second,
    // additive snapshot once their index and File handles have been read.
    const renditionFiles = await derivedAssets.loadIndexedRenditions();
    await mediaLibrary.replaceFiles([...files, ...renditionFiles]);
    bridge.sendMediaFiles(mediaLibrary.getAllFiles());
    await refreshHistoryState();
    return true;
  }

  async function loadProject(
    reason = "project-load",
    imported = { media: [], shaders: [] },
    directorySig = "",
    { preserveMediaCatalog = false, preserveEditorUi = false } = {},
  ) {
    if (!dirHandle) return;
    let data;
    let embeddedThumbnails = [];
    let projectFileFound;
    try {
      const result = await readProjectFile(dirHandle);
      projectFileFound = result.found;
      data = result.data;
      embeddedThumbnails = embeddedThumbnailEntries(data.components);
    } catch (error) {
      blockProjectLoad(`Cannot open project.json safely: ${error.message || error}. The existing project was not changed.`);
      return false;
    }
    const storedProjectVersion = Number(data?.version);
    projectMigrationSaveRequired = !projectFileFound || storedProjectVersion !== CURRENT_PROJECT_VERSION;
    if (projectFileFound) {
      try {
        data = migrateProjectData(data);
      } catch (error) {
        const message = error instanceof ProjectVersionError
          ? error.message
          : `Project migration failed: ${error.message || error}`;
        blockProjectLoad(message);
        return false;
      }
    }
    projectLoadBlocked = false;
    const { ui: projectUi, metrics: _projectMetrics, ...projectData } = data;
    let projectPackages;
    try {
      const repository = await loadNodePackageRepository(dirHandle);
      const projectNodes = projectData.nodes || {};
      const references = projectNodes.packages || [];
      let packageLock = projectNodes.packageLock || [];
      if (references.length && !packageLock.length) {
        const completePackages = resolveAllReferencedNodePackages(references, repository);
        packageLock = createNodePackageLock(completePackages);
        projectData.nodes = { ...projectNodes, packageLock };
        projectMigrationSaveRequired = true;
        console.warn("[VJ1_NODE_PACKAGE_LOCK_MIGRATED]", {
          packages: packageLock.map((item) => `${item.id}@${item.version}`),
          message: "Existing package references were pinned to their current verified repository content.",
        });
      } else if (references.length) {
        resolveAllReferencedNodePackages(references, repository, packageLock);
      }
      projectPackages = resolveReferencedNodePackages(references, repository, packageLock);
      availableNodePackages = repository;
    } catch (error) {
      blockProjectLoad(`Cannot load project node packages safely: ${error.message || error}. The existing project was not changed.`);
      return false;
    }
    // A folder without project.json is a genuinely new project. Seed it from
    // the startup template instead of leaking components or mappings from the
    // project that happened to be open before the folder picker was used.
    const currentState = projectFileFound
      ? store.getState()
      : createInitialState({ startupTemplate: true });
    const currentUi = currentState.ui;
    // History revisions contain editor preferences because project.json is
    // also the reload checkpoint, but UI is intentionally absent from the
    // history signature. Undo/redo must therefore retain the editor's current
    // projection rather than resurrecting whichever selection happened to be
    // checkpointed with the historical authored state.
    const restoredProjectUi = preserveEditorUi ? {} : projectUi;
    const loadHandle = dirHandle;
    const loadGeneration = projectGeneration;
    const sameProject = loadedProjectHandle === loadHandle;
    const components = clearThumbnailUrls(Array.isArray(projectData.components) ? projectData.components : currentState.components);
    const thumbnailEntries = new Map();
    if (sameProject) {
      for (const entry of componentThumbnailEntries(currentState.components)) thumbnailEntries.set(componentThumbnailKey(entry), entry);
      applyThumbnailUrls(components, [...thumbnailEntries.values()]);
    }
    for (const entry of embeddedThumbnails) thumbnailEntries.delete(componentThumbnailKey(entry));
    applyThumbnailUrls(components, embeddedThumbnails);
    const nextState = {
      ...currentState,
      ...projectData,
      components,
      ui: {
        ...currentUi,
        selectedMappingId: restoredProjectUi?.selectedMappingId || currentUi.selectedMappingId,
        selectedSurfaceId: restoredProjectUi?.selectedSurfaceId || currentUi.selectedSurfaceId,
        selectedComponentId: restoredProjectUi?.selectedComponentId || currentUi.selectedComponentId,
        selectedChainItemId: restoredProjectUi?.selectedChainItemId || currentUi.selectedChainItemId,
        workspaceSelectionIds: restoredProjectUi?.workspaceSelectionIds || currentUi.workspaceSelectionIds,
        catalogSortModes: restoredProjectUi?.catalogSortModes || currentUi.catalogSortModes,
        previewQuality: restoredProjectUi?.previewQuality || currentUi.previewQuality,
        previewViewports: restoredProjectUi?.previewViewports || currentUi.previewViewports,
        previewDiagnostics: restoredProjectUi?.previewDiagnostics ?? currentUi.previewDiagnostics,
        mappingTestPattern: restoredProjectUi?.mappingTestPattern ?? currentUi.mappingTestPattern,
        live: restoreProjectLiveUi(currentUi.live, restoredProjectUi?.live),
      },
      project: {
        ...currentState.project,
        ...(projectData.project || {}),
        name: projectData.project?.name || dirHandle.name,
        folderName: dirHandle.name,
        warnings: projectFileFound ? [] : [`No project.json found in ${dirHandle.name}`],
      },
      media: preserveMediaCatalog && Array.isArray(projectData.media)
        ? projectData.media.map((item) => ({ ...item }))
        : mergeMediaCatalogMarkers(imported.media, projectData.media),
      nodes: mergeProjectIsfDefinitions(projectData.nodes || currentState.nodes, imported.shaders),
      shaders: firstFragmentShader(imported.shaders)
        ? {
            ...(projectData.shaders || store.getState().shaders),
            customName: firstFragmentShader(imported.shaders).name,
            customCode: firstFragmentShader(imported.shaders).code,
          }
        : (projectData.shaders || currentState.shaders),
    };
    const selectedScene = nextState.mappings?.find((scene) => scene.id === nextState.ui.selectedMappingId) || nextState.mappings?.[0];
    if (selectedScene) projectSelectedMapping(nextState, selectedScene);
    publishInstalledNodePackages(projectPackages, availableNodePackages);
    store.replace(nextState, reason);
    loadedProjectHandle = loadHandle;
    if (!sameProject) thumbnailUrlLease.activate([]);
    // Cached thumbnails are derived assets, not a prerequisite for opening a
    // project. Publish the parsed graph first, then stream thumbnail batches.
    // This prevents a busy standalone Output from starving editor recovery and
    // keeps the previous image until a replacement for that exact key exists.
    const thumbnailRevision = ++thumbnailLoadRevision;
    void derivedAssets.loadComponentThumbnails(components, {
      onBatch(entries) {
        if (loadHandle !== dirHandle || loadGeneration !== projectGeneration || thumbnailRevision !== thumbnailLoadRevision) {
          for (const entry of entries) if (String(entry.url || "").startsWith("blob:")) URL.revokeObjectURL(entry.url);
          return;
        }
        for (const entry of entries) thumbnailEntries.set(componentThumbnailKey(entry), entry);
        store.updateDerived((draft) => {
          applyThumbnailUrls(draft.components, entries);
        }, {
          reason: "project-thumbnail-cache-batch",
          projection: {
            kind: "component-thumbnails",
            entries: entries.map(({ componentId, surfaceId = "", url }) => ({
              componentId,
              surfaceId,
              url,
            })),
          },
        });
        thumbnailUrlLease.activate(componentThumbnailObjectUrls(thumbnailEntries.values()));
      },
    }).catch((error) => console.warn("[VJ1_THUMBNAIL_CACHE_LOAD_FAILED]", {
      fallback: "retain existing thumbnails and regenerate missing entries on demand",
      message: error?.message || String(error),
    }));
    if (embeddedThumbnails.length) derivedAssets.migrateEmbeddedThumbnails(embeddedThumbnails);
    lastDirectorySignature = directorySig;
    lastSavedSignature = loadedProjectPersistenceSignature(
      store.getState(),
      projectData.project?.savedAt || "",
      { requiresSave: projectMigrationSaveRequired },
    );
    return true;
  }

  function blockProjectLoad(message) {
    projectLoadBlocked = true;
    console.error("[VJ1_PROJECT_LOAD_BLOCKED]", {
      folder: dirHandle?.name || "",
      message,
      fallback: "leave the current in-memory state unchanged and refuse autosave",
    });
    store.update((draft) => {
      draft.project.folderName = dirHandle?.name || draft.project.folderName;
      draft.project.warnings = [message];
    }, "project-version-error");
  }

  function publishInstalledNodePackages(packages = [], availablePackages = availableNodePackages) {
    installedNodePackages = Object.freeze([...(packages || [])]);
    availableNodePackages = Object.freeze([...(availablePackages || [])]);
    bridge.sendNodePackages?.(installedNodePackages.map((nodePackage) => serializeNodePackage(nodePackage)));
    for (const listener of nodePackageListeners) {
      try {
        listener(installedNodePackages, availableNodePackages);
      } catch (error) {
        console.warn("[VJ1_NODE_PACKAGE_LISTENER_FAILED]", {
          message: error?.message || String(error),
        });
      }
    }
  }

  async function setNodePackageEnabled(packageId, enabled) {
    if (!dirHandle) throw new Error("NODE_PACKAGE_PROJECT_FOLDER_REQUIRED");
    const currentNodes = store.getState().nodes || {};
    const reference = (currentNodes.packages || []).find((item) => item.id === packageId);
    if (!reference) throw new Error(`NODE_PROJECT_PACKAGE_REFERENCE_MISSING:${packageId}`);
    const nextReferences = installNodePackageReference(
      currentNodes.packages,
      reference.id,
      reference.version,
      { enabled: enabled !== false },
    );
    const repository = await loadNodePackageRepository(dirHandle);
    const packages = resolveReferencedNodePackages(
      nextReferences,
      repository,
      currentNodes.packageLock || [],
    );
    // Enabling publishes the superset first; disabling publishes the reduced
    // set after state. Each renderer therefore resolves a valid package set at
    // both sides of the ordered transition.
    if (enabled !== false) publishInstalledNodePackages(packages, repository);
    store.update((draft) => {
      draft.nodes.packages = nextReferences;
    }, "update:node-package-activation");
    if (enabled === false) publishInstalledNodePackages(packages, repository);
    return installedNodePackages;
  }

  async function installNodePackage(packageId, version) {
    if (!dirHandle) throw new Error("NODE_PACKAGE_PROJECT_FOLDER_REQUIRED");
    const currentNodes = store.getState().nodes || {};
    const previous = (currentNodes.packages || []).find((item) => item.id === packageId);
    const nextReferences = installNodePackageReference(
      currentNodes.packages,
      packageId,
      version,
      { enabled: previous?.enabled !== false },
    );
    const repository = await loadNodePackageRepository(dirHandle);
    // Installing one package must never silently re-approve altered content
    // belonging to an already installed package.
    resolveAllReferencedNodePackages(
      currentNodes.packages || [],
      repository,
      currentNodes.packageLock || [],
    );
    const packageLock = createNodePackageLock(
      resolveAllReferencedNodePackages(nextReferences, repository),
    );
    const packages = resolveReferencedNodePackages(nextReferences, repository, packageLock);
    if (previous && previous.version !== version) {
      const previousPackage = repository.find((nodePackage) =>
        nodePackage.id === previous.id && nodePackage.version === previous.version);
      assertNodePackageUpdateSafe(store.getState(), previousPackage, packages);
    }
    // Validate the exact package and complete dependency closure before
    // changing project truth. Publish an enabled superset first so renderers
    // can resolve the new graph on the following ordered state message.
    if (previous?.enabled !== false) publishInstalledNodePackages(packages, repository);
    store.update((draft) => {
      draft.nodes.packages = nextReferences;
      draft.nodes.packageLock = packageLock;
    }, previous ? "update:node-package-version" : "update:node-package-install");
    if (previous?.enabled === false) publishInstalledNodePackages(packages, repository);
    return installedNodePackages;
  }

  async function removeNodePackage(packageId) {
    if (!dirHandle) throw new Error("NODE_PACKAGE_PROJECT_FOLDER_REQUIRED");
    const currentNodes = store.getState().nodes || {};
    if (!(currentNodes.packages || []).some((item) => item.id === packageId)) return false;
    const nextReferences = removeNodePackageReference(currentNodes.packages, packageId);
    const repository = await loadNodePackageRepository(dirHandle);
    const completePackages = resolveAllReferencedNodePackages(
      nextReferences,
      repository,
      currentNodes.packageLock || [],
    );
    const packageLock = createNodePackageLock(completePackages);
    const packages = resolveReferencedNodePackages(nextReferences, repository, packageLock);
    store.update((draft) => {
      draft.nodes.packages = nextReferences;
      draft.nodes.packageLock = packageLock;
    }, "update:node-package-remove");
    publishInstalledNodePackages(packages, repository);
    return true;
  }

  async function writeNodePackageManifest(encodedPackage) {
    if (!dirHandle) throw new Error("NODE_PACKAGE_PROJECT_FOLDER_REQUIRED");
    const path = await writeRepositoryNodePackageManifest(dirHandle, encodedPackage);
    const repository = await loadNodePackageRepository(dirHandle);
    const nodeState = store.getState().nodes || {};
    const packages = resolveReferencedNodePackages(
      nodeState.packages || [],
      repository,
      nodeState.packageLock || [],
    );
    publishInstalledNodePackages(packages, repository);
    return path;
  }

  async function importNodePackageFolder(sourceDirectory = null) {
    if (!dirHandle) throw new Error("NODE_PACKAGE_PROJECT_FOLDER_REQUIRED");
    const source = sourceDirectory || await globalThis.showDirectoryPicker?.({ mode: "read" });
    if (!source) throw new Error("NODE_PACKAGE_IMPORT_DIRECTORY_PICKER_UNAVAILABLE");
    const imported = await importNodePackageDirectory(dirHandle, source);
    const repository = await loadNodePackageRepository(dirHandle);
    const nodeState = store.getState().nodes || {};
    const packages = resolveReferencedNodePackages(
      nodeState.packages || [],
      repository,
      nodeState.packageLock || [],
    );
    publishInstalledNodePackages(packages, repository);
    return imported;
  }

  async function exportNodePackageFolder(packageId, version, destinationDirectory = null) {
    if (!dirHandle) throw new Error("NODE_PACKAGE_PROJECT_FOLDER_REQUIRED");
    const destination = destinationDirectory || await globalThis.showDirectoryPicker?.({ mode: "readwrite" });
    if (!destination) throw new Error("NODE_PACKAGE_EXPORT_DIRECTORY_PICKER_UNAVAILABLE");
    return exportNodePackageDirectory(dirHandle, destination, packageId, version);
  }

  function subscribeNodePackages(listener) {
    if (typeof listener !== "function") return () => {};
    nodePackageListeners.add(listener);
    return () => nodePackageListeners.delete(listener);
  }

  function refreshProjectAssets(imported = { media: [], shaders: [] }, directorySig = "") {
    store.update((draft) => {
      draft.project.folderName = dirHandle?.name || draft.project.folderName;
      draft.project.warnings = (draft.project.warnings || []).filter((warning) => !String(warning).startsWith("Folder change ("));
      draft.media = mergeMediaCatalogMarkers(imported.media, draft.media);
      draft.nodes = mergeProjectIsfDefinitions(draft.nodes, imported.shaders, { authoritative: true });
      if (firstFragmentShader(imported.shaders)) {
        draft.shaders = {
          ...draft.shaders,
          customName: firstFragmentShader(imported.shaders).name,
          customCode: firstFragmentShader(imported.shaders).code,
        };
      }
    }, {
      reason: "project-refresh-assets",
      scope: "assets",
      history: "none",
      projection: { kind: "asset-catalog" },
    });
    lastDirectorySignature = directorySig;
  }

  function scheduleAutoSave(change = "change", { immediate = false, state = null } = {}) {
    const event = classifyChange(change);
    const reason = event.reason;
    if (event.phase === "edit" || event.phase === "scrub") return;
    if (!dirHandle || isOpening || projectLoadBlocked || skipAutosaveReasons.has(reason)) return;
    if (event.history === "record") {
      pendingHistory = true;
      pendingSaveReason = reason;
    } else if (!pendingSaveReason) {
      pendingSaveReason = reason;
    }
    // Selection and other editor-only state must not serialize the complete
    // project after every click. It remains in the current state and is folded
    // into the next authored save or the browser lifecycle checkpoint.
    const previewViewportCheckpoint = event.scope === "ui" && reason.startsWith("preview-");
    if (event.scope === "ui" && !immediate && !previewViewportCheckpoint) return;
    pendingAutoSaveState = state || pendingAutoSaveState;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    const delay = immediate || reason === "live:scene" || event.history === "record" ? 0 : autosaveDelayMs;
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null;
      void flushAutoSave();
    }, delay);
  }

  async function flushAutoSave(reason = "") {
    if (!dirHandle) return false;
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
    const saveReason = reason || pendingSaveReason || "change";
    const recordHistory = pendingHistory || classifyChange(saveReason).history === "record";
    const state = pendingAutoSaveState || store.getState();
    pendingHistory = false;
    pendingSaveReason = "";
    pendingAutoSaveState = null;
    // The application dataflow already provides one detached state snapshot
    // per emission. Send that immutable transaction to the preparation worker
    // instead of cloning the complete store again. The serialized write queue
    // still owns ordering and history; it simply awaits off-thread projection,
    // JSON generation, and signatures before touching the project file.
    const prepared = savePreparer.prepareState(state, new Date().toISOString());
    return saveQueue.enqueue({ reason: saveReason, recordHistory, prepared });
  }

  function hasPendingAutoSave() {
    return Boolean(autosaveTimer || pendingHistory || pendingSaveReason);
  }

  function flushPendingAutoSave(reason) {
    if (!hasPendingAutoSave() || !dirHandle || isOpening || projectLoadBlocked) return false;
    // Begin any pending worker preparation and native file write as soon as
    // Chrome starts hiding the page instead of relying on beforeunload alone.
    void flushAutoSave(reason);
    return true;
  }

  async function saveProject({
    reason = "manual",
    recordHistory = true,
    payload: suppliedPayload = null,
    json: suppliedJson = "",
    prepared: suppliedPreparation = null,
  } = {}) {
    if (projectLoadBlocked) return false;
    let prepared = suppliedPreparation ? await suppliedPreparation : null;
    if (!prepared && suppliedPayload) prepared = await savePreparer.preparePayload({
      ...suppliedPayload,
      project: {
        ...(suppliedPayload.project || {}),
        savedAt: suppliedPayload.project?.savedAt || new Date().toISOString(),
      },
    });
    if (!prepared && suppliedJson) {
      const payload = parseProjectText(suppliedJson);
      if (!payload) throw new Error("VJ1_PROJECT_SAVE_JSON_INVALID");
      prepared = await savePreparer.preparePayload(payload);
    }
    if (!prepared) prepared = await savePreparer.prepareState(store.getState(), new Date().toISOString());
    const { savedAt, json, signature, historySignature } = prepared;
    requireValidProjectText(json, "VJ1_PROJECT_SAVE_JSON_INVALID");
    if (signature === lastSavedSignature) return false;

    if (!dirHandle) {
      return false;
    }

    let handle;
    let previousText;
    try {
      ({ handle, previousText } = await projectFileForSave(dirHandle));
    } catch (error) {
      blockProjectLoad(`Cannot verify project.json before saving: ${error.message || error}. Save was refused to protect the existing project.`);
      return false;
    }

    const recordsProjectRevision = await shouldWriteHistoryRevision(
      previousText,
      historySignature,
      json,
      reason,
      recordHistory,
      savePreparer,
    );
    if (recordsProjectRevision) {
      await historyStore.writeRevision(previousText, savedAt);
      if (!isHistoryReason(reason)) await historyStore.clearRedoRevisions();
    }

    await replaceFileText(handle, json);
    if (recordsProjectRevision) {
      try {
        await historyStore.recordColdBackup(json, savedAt);
      } catch (error) {
        console.warn("[VJ1_COLD_BACKUP_FAILED]", {
          directory: COLD_BACKUP_ROOT,
          fallback: "project saved; retry milestone backup on the next committed revision",
          message: error?.message || String(error),
        });
      }
    }
    lastSavedSignature = signature;
    projectMigrationSaveRequired = false;
    await refreshHistoryState();
    store.update((draft) => {
      draft.project.savedAt = savedAt;
      draft.project.warnings = [];
      draft.ui.mappingStatus = reason === "mapping-state" ? "Mapping autosaved" : draft.ui.mappingStatus;
    }, "project-autosave");
    return true;
  }

  async function undoProject() {
    if (!dirHandle || historyInFlight) return false;
    historyInFlight = true;
    try {
      if (autosaveTimer) {
        clearTimeout(autosaveTimer);
        autosaveTimer = null;
        await flushAutoSave("history-checkpoint");
      } else await saveQueue.wait();
      if (saveQueue.size) return false;
      const entry = await historyStore.latestRevisionEntry("undo");
      if (!entry) {
        await refreshHistoryState();
        return false;
      }
      const currentText = await readProjectText();
      const undoText = await (await entry.handle.getFile()).text();
      requireValidProjectText(undoText, "VJ1_PROJECT_UNDO_REVISION_INVALID");
      if (currentText.trim()) await historyStore.writeRedoRevision(currentText, new Date().toISOString());
      await writeProjectText(undoText);
      if (!await reloadProjectFromDisk("project-undo")) {
        throw new Error("VJ1_PROJECT_UNDO_RELOAD_FAILED");
      }
      await historyStore.removeRevisionEntry(entry);
      return true;
    } finally {
      historyInFlight = false;
    }
  }

  async function redoProject() {
    if (!dirHandle || historyInFlight) return false;
    historyInFlight = true;
    try {
      await saveQueue.wait();
      if (saveQueue.size) return false;
      const entry = await historyStore.latestRevisionEntry("redo");
      if (!entry) {
        await refreshHistoryState();
        return false;
      }
      const currentText = await readProjectText();
      const redoText = await (await entry.handle.getFile()).text();
      requireValidProjectText(redoText, "VJ1_PROJECT_REDO_REVISION_INVALID");
      if (currentText.trim()) await historyStore.writeRevision(currentText, new Date().toISOString());
      await writeProjectText(redoText);
      if (!await reloadProjectFromDisk("project-redo")) {
        throw new Error("VJ1_PROJECT_REDO_RELOAD_FAILED");
      }
      await historyStore.removeRevisionEntry(entry);
      return true;
    } finally {
      historyInFlight = false;
    }
  }

  function getHistoryState() {
    return historyStore.getState();
  }

  async function readProjectText() {
    const handle = await dirHandle.getFileHandle("project.json");
    return await (await handle.getFile()).text();
  }

  async function writeProjectText(text) {
    requireValidProjectText(text, "VJ1_PROJECT_HISTORY_REVISION_INVALID");
    const handle = await dirHandle.getFileHandle("project.json", { create: true });
    await replaceFileText(handle, text);
    const persistedText = await (await handle.getFile()).text();
    if (persistedText !== text) throw new Error("VJ1_PROJECT_HISTORY_WRITE_MISMATCH");
    requireValidProjectText(persistedText, "VJ1_PROJECT_HISTORY_WRITE_INVALID");
  }

  async function reloadProjectFromDisk(reason) {
    // Undo/redo changes project.json only. The current media-library snapshot
    // remains authoritative and must not trigger another filesystem traversal.
    const imported = { media: store.getState().media || [], shaders: [] };
    const loaded = await loadProject(reason, imported, lastDirectorySignature, {
      preserveEditorUi: true,
    });
    if (!loaded) return false;
    await refreshHistoryState();
    bridge.sendState();
    return true;
  }

  async function refreshHistoryState() {
    return historyStore.refreshState();
  }

  function startFileObserver() {
    stopFileObserver();
    const Observer = globalThis.FileSystemObserver;
    if (!Observer || !dirHandle) {
      console.info("[VJ1_FILE_OBSERVER_UNAVAILABLE]", { fallback: "use the Media refresh button for external folder changes" });
      return;
    }
    if (fileObserverAbortedForSession(dirHandle)) return;
    try {
      const observerGeneration = projectGeneration;
      const observedHandle = dirHandle;
      fileObserver = new Observer((records) => {
        observedChangeQueue = observedChangeQueue
          .then(() => observerGeneration === projectGeneration ? applyObservedChanges(records, observerGeneration) : undefined)
          .catch((error) => console.warn("[VJ1_FILE_OBSERVER_UPDATE_FAILED]", { fallback: "use the Media refresh button", message: error?.message || String(error) }));
      });
      Promise.resolve(fileObserver.observe(dirHandle, { recursive: true }))
        .then(() => clearFileObserverAbort(observedHandle))
        .catch((error) => handleFileObserverStartFailure(error, observedHandle));
    } catch (error) {
      handleFileObserverStartFailure(error, dirHandle);
    }
  }

  function handleFileObserverStartFailure(error, handle) {
    stopFileObserver();
    if (isFileObserverAbort(error)) {
      rememberFileObserverAbort(handle);
      return;
    }
    console.warn("[VJ1_FILE_OBSERVER_START_FAILED]", { fallback: "use the Media refresh button", message: error?.message || String(error) });
  }

  function stopFileObserver() {
    try { fileObserver?.disconnect?.(); } catch (error) {
      console.warn("[VJ1_FILE_OBSERVER_STOP_FAILED]", { fallback: "discard observer reference", message: error?.message || String(error) });
    }
    fileObserver = null;
  }

  async function applyObservedChanges(records = [], generation = projectGeneration) {
    for (const record of records || []) {
      if (generation !== projectGeneration) return;
      const path = observedRecordPath(record);
      if (!path || isIgnoredObservedPath(path)) continue;
      const insideAssetRoot = path === "media" || path === "shaders" || path.startsWith("media/") || path.startsWith("shaders/");
      const relevantPath = insideAssetRoot || isObservedAssetPath(path);
      if ((record.type === "unknown" || record.type === "errored") && relevantPath) {
        markManualRefreshNeeded(path, record.type);
        continue;
      }
      if (record.changedHandle?.kind === "directory" && insideAssetRoot) {
        markManualRefreshNeeded(path, record.type || "directory");
        continue;
      }
      if (record.changedHandle?.kind === "directory") continue;
      if (!isObservedAssetPath(path)) continue;
      if (record.type === "moved") {
        const previousPath = observedMovedFromPath(record);
        if (previousPath && isMediaFile(previousPath)) {
          mediaLibrary.remove(previousPath);
          store.updateDerived((draft) => {
            draft.media = (draft.media || []).filter((item) => item.id !== previousPath);
          }, {
            reason: "project-observed-asset-move",
            projection: { kind: "asset-catalog" },
          });
        } else if (previousPath && isShaderFile(previousPath)) {
          markManualRefreshNeeded(previousPath, "shader moved");
        }
      }
      if (record.type === "disappeared") {
        if (isShaderFile(path)) {
          markManualRefreshNeeded(path, "shader removed");
          continue;
        }
        mediaLibrary.remove(path);
        store.updateDerived((draft) => {
          draft.media = (draft.media || []).filter((item) => item.id !== path);
        }, {
          reason: "project-observed-asset-remove",
          projection: { kind: "asset-catalog" },
        });
        bridge.sendMediaFiles(mediaLibrary.getAllFiles());
        continue;
      }
      let handle = record.changedHandle;
      if (!handle || handle.kind !== "file") handle = await fileHandleAtPath(dirHandle, path);
      if (!handle) {
        markManualRefreshNeeded(path, "unresolved");
        continue;
      }
      try {
        const file = await handle.getFile();
        Object.defineProperty(file, "relativePath", { value: path, configurable: true });
        const imported = await mediaLibrary.importFiles([file]);
        mergeObservedAssets(imported);
        bridge.sendMediaFiles(mediaLibrary.getAllFiles());
      } catch (error) {
        console.warn("[VJ1_OBSERVED_ASSET_READ_FAILED]", { path, fallback: "use the Media refresh button", message: error?.message || String(error) });
        markManualRefreshNeeded(path, "unreadable");
      }
    }
  }

  function mergeObservedAssets(imported) {
    const hasProjectIsf = imported.shaders?.some((shader) => /\/\*\s*\{/.test(shader.code || ""));
    const merge = (draft) => {
      const byId = new Map((draft.media || []).map((item) => [item.id, item]));
      for (const item of imported.media || []) {
        const previous = byId.get(item.id);
        byId.set(item.id, {
          ...item,
          catalogMarker: previous?.catalogMarker ?? item.catalogMarker ?? 0,
          ...(Number(previous?.duration) > 0 ? { duration: Number(previous.duration) } : {}),
        });
      }
      draft.media = Array.from(byId.values());
      // Imported ISF is project-authored node code and must use the persistent
      // update path. Ordinary shader/media observation remains derived state.
      if (hasProjectIsf) draft.nodes = mergeProjectIsfDefinitions(draft.nodes, imported.shaders);
      if (firstFragmentShader(imported.shaders)) {
        const shader = firstFragmentShader(imported.shaders);
        draft.shaders = { ...draft.shaders, customName: shader.name, customCode: shader.code };
      }
    };
    if (hasProjectIsf) {
      store.update(merge, {
        reason: "project-observed-isf-update",
        scope: "assets",
        history: "none",
        projection: { kind: "asset-catalog" },
      });
    } else {
      store.updateDerived(merge, {
        reason: "project-observed-asset-update",
        projection: { kind: "asset-catalog" },
      });
    }
  }

  function markManualRefreshNeeded(path, eventType) {
    store.updateDerived((draft) => {
      draft.project.warnings = [`Folder change (${eventType}) at ${path} needs a manual Media refresh.`];
    }, "project-observer-refresh-needed");
  }

  return {
    openFolder,
    restoreStoredFolder,
    closeProject,
    saveProject,
    scheduleAutoSave,
    flushAutoSave,
    importExternalFiles,
    refreshFolder,
    undoProject,
    redoProject,
    getHistoryState,
    hasOpenFolder: () => !!dirHandle && !projectLoadBlocked,
    getInstalledNodePackages: () => installedNodePackages,
    getAvailableNodePackages: () => availableNodePackages,
    installNodePackage,
    writeNodePackageManifest,
    importNodePackageFolder,
    exportNodePackageFolder,
    setNodePackageEnabled,
    removeNodePackage,
    subscribeNodePackages,
    writeMediaRendition: (...args) => derivedAssets.writeMediaRendition(...args),
    writeComponentThumbnail: (...args) => derivedAssets.writeComponentThumbnail(...args),
  };
}

function firstFragmentShader(shaders = []) {
  return (shaders || []).find((shader) =>
    !/\.vs$/i.test(shader?.path || shader?.name || "")
  ) || null;
}

export function loadedProjectPersistenceSignature(state, savedAt = "", { requiresSave = false } = {}) {
  // `lastSavedSignature` describes the representation that is already on
  // disk—not merely the canonical representation currently held in memory.
  // A migration or package-lock upgrade has produced new project truth that
  // has never been persisted, so it must remain dirty until the write closes.
  if (requiresSave) return "";
  return projectPayloadSignature(buildProjectPayload(state, savedAt));
}

function resolveAllReferencedNodePackages(references = [], repository = [], packageLock = []) {
  return resolveReferencedNodePackages(
    (references || []).map((reference) => ({ ...reference, enabled: true })),
    repository,
    packageLock,
  );
}

function mergeMediaCatalogMarkers(imported = [], authored = []) {
  const existing = new Map((Array.isArray(authored) ? authored : []).map((item) => [item.id, item]));
  return (Array.isArray(imported) ? imported : []).map((item) => {
    const previous = existing.get(item.id);
    return {
      ...item,
      catalogMarker: previous?.catalogMarker ?? item.catalogMarker ?? 0,
      ...(Number(previous?.duration) > 0 ? { duration: Number(previous.duration) } : {}),
    };
  });
}

function componentThumbnailEntries(components = []) {
  const entries = [];
  for (const component of components || []) {
    if (component?.thumbnail) entries.push({ componentId: component.id, surfaceId: "", url: component.thumbnail });
    if (component?.type !== "scene") continue;
    for (const [surfaceId, url] of Object.entries(component.scene?.surfaceThumbnails || {})) {
      if (url) entries.push({ componentId: component.id, surfaceId, url });
    }
  }
  return entries;
}

function componentThumbnailKey(entry = {}) {
  return `${String(entry.componentId || "")}:${String(entry.surfaceId || "")}`;
}

function componentThumbnailObjectUrls(entries = []) {
  return new Set([...entries]
    .map((entry) => String(entry?.url || ""))
    .filter((url) => url.startsWith("blob:")));
}

function isFileObserverAbort(error) {
  return error?.name === "AbortError" || /user aborted/i.test(String(error?.message || ""));
}

function fileObserverAbortStorageKey(handle) {
  return `vj1:file-observer-aborted:${String(handle?.name || "project")}`;
}

function fileObserverAbortedForSession(handle) {
  try {
    return globalThis.sessionStorage?.getItem(fileObserverAbortStorageKey(handle)) === "1";
  } catch {
    return false;
  }
}

function rememberFileObserverAbort(handle) {
  try {
    globalThis.sessionStorage?.setItem(fileObserverAbortStorageKey(handle), "1");
  } catch {}
}

function clearFileObserverAbort(handle) {
  try {
    globalThis.sessionStorage?.removeItem(fileObserverAbortStorageKey(handle));
  } catch {}
}

async function ensureProjectScaffold(handle) {
  if (!handle?.getDirectoryHandle) return;
  for (const name of ["media", "shaders", NODE_PACKAGE_LIBRARY_ROOT, RENDITION_ROOT]) {
    await handle.getDirectoryHandle(name, { create: true });
  }
  for (const name of ["scenes", "mappings"]) await removeObsoleteEmptyScaffold(handle, name);
}

async function removeObsoleteEmptyScaffold(root, name) {
  try {
    const directory = await root.getDirectoryHandle(name);
    for await (const _entry of directory.values()) {
      console.info("[VJ1_OBSOLETE_SCAFFOLD_RETAINED]", { directory: name, reason: "contains user files that VJ1 will not delete" });
      return false;
    }
    await root.removeEntry(name);
    console.info("[VJ1_OBSOLETE_SCAFFOLD_REMOVED]", { directory: name });
    return true;
  } catch (error) {
    if (!isNotFoundError(error)) console.warn("[VJ1_OBSOLETE_SCAFFOLD_CLEANUP_FAILED]", { directory: name, fallback: "leave directory untouched", message: error?.message || String(error) });
    return false;
  }
}

async function shouldWriteHistoryRevision(
  previousText = "",
  nextHistorySignature = "",
  nextText = "",
  reason = "",
  recordHistory = true,
  savePreparer,
) {
  if (!recordHistory) return false;
  if (reason === "component-thumbnail") return false;
  if (!previousText.trim() || previousText === nextText) return false;
  const previous = await savePreparer.inspectText(previousText);
  if (!previous.valid) {
    console.warn("[VJ1_PROJECT_HISTORY_PARSE_FAILED]", {
      fallback: "preserve a conservative history revision",
      message: previous.message,
    });
    return true;
  }
  return previous.historySignature !== nextHistorySignature;
}

function parseProjectText(text = "") {
  try {
    return JSON.parse(text);
  } catch (error) {
    console.warn("[VJ1_PROJECT_HISTORY_PARSE_FAILED]", { fallback: "preserve a conservative history revision", message: error?.message || String(error) });
    return null;
  }
}

function requireValidProjectText(text, code = "VJ1_PROJECT_JSON_INVALID") {
  if (typeof text !== "string" || !text.trim()) throw new Error(`${code}:EMPTY`);
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new Error(`${code}:${error?.message || String(error)}`);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`${code}:PROJECT_OBJECT_REQUIRED`);
  }
  return payload;
}

async function replaceFileText(handle, text) {
  const writable = await handle.createWritable({ keepExistingData: true });
  try {
    await writable.write({ type: "write", position: 0, data: text });
    await writable.truncate(new TextEncoder().encode(text).byteLength);
    await writable.close();
  } catch (error) {
    try { await writable.abort?.(); } catch {}
    throw error;
  }
}

async function loadStoredHandle() {
  if (!canPersistDirectoryHandles()) return null;
  try {
    return await loadProjectDirectoryHandle();
  } catch (error) {
    console.warn("[VJ1_PROJECT_HANDLE_RESTORE_FAILED]", { fallback: "manual folder selection", message: error?.message || String(error) });
    return null;
  }
}

async function saveStoredHandle(handle) {
  if (!handle || !canPersistDirectoryHandles()) return;
  try {
    await saveProjectDirectoryHandle(handle);
  } catch (error) {
    console.warn("[VJ1_PROJECT_HANDLE_SAVE_FAILED]", { fallback: "current-session handle only", message: error?.message || String(error) });
    // The app can still run with the active handle; only refresh restore is lost.
  }
}

async function clearStoredHandle() {
  if (!canPersistDirectoryHandles()) return;
  try {
    await clearProjectDirectoryHandle();
  } catch (error) {
    console.warn("[VJ1_PROJECT_HANDLE_CLEAR_FAILED]", { fallback: "in-memory project close", message: error?.message || String(error) });
    // Closing the in-memory project is still valid if handle persistence cleanup fails.
  }
}

async function queryPermission(handle, mode) {
  if (!handle?.queryPermission) return "granted";
  try {
    return await handle.queryPermission({ mode });
  } catch (error) {
    console.warn("[VJ1_PROJECT_PERMISSION_QUERY_FAILED]", { fallback: "request permission interactively", message: error?.message || String(error) });
    return "prompt";
  }
}

async function verifyPermission(handle, mode, requestIfNeeded) {
  const permission = await queryPermission(handle, mode);
  if (permission === "granted") return true;
  if (!requestIfNeeded || !handle?.requestPermission) return false;
  try {
    return await handle.requestPermission({ mode }) === "granted";
  } catch (error) {
    console.warn("[VJ1_PROJECT_PERMISSION_REQUEST_FAILED]", { fallback: "leave project folder closed", message: error?.message || String(error) });
    return false;
  }
}

function directorySignature(files) {
  return JSON.stringify(Array.from(files || [])
    .map((file) => {
      const path = file.relativePath || file.webkitRelativePath || file.name || "";
      return {
        path,
        size: file.size || 0,
        modified: file.lastModified || 0,
      };
    })
    .filter((file) => isMediaFile(file.path) || isShaderFile(file.path))
    .sort((a, b) => a.path.localeCompare(b.path)));
}

function embeddedThumbnailEntries(components = []) {
  const entries = [];
  for (const component of components || []) {
    if (typeof component?.thumbnail === "string" && component.thumbnail.startsWith("data:image/")) {
      entries.push({ componentId: component.id, surfaceId: "", url: component.thumbnail });
    }
    for (const [surfaceId, url] of Object.entries(component?.scene?.surfaceThumbnails || {})) {
      if (typeof url === "string" && url.startsWith("data:image/")) entries.push({ componentId: component.id, surfaceId, url });
    }
  }
  return entries;
}

function cooperativeYield() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function observedRecordPath(record = {}) {
  const parts = record.relativePathComponents || record.relativePath || [];
  if (Array.isArray(parts)) return parts.map(String).filter(Boolean).join("/");
  return String(parts || "").replace(/^\/+/, "");
}

function observedMovedFromPath(record = {}) {
  const parts = record.relativePathMovedFrom || record.formerRelativePathComponents || [];
  if (Array.isArray(parts)) return parts.map(String).filter(Boolean).join("/");
  return String(parts || "").replace(/^\/+/, "");
}

function isIgnoredObservedPath(path = "") {
  const root = String(path).split("/")[0];
  return root === "revisions" || root === COLD_BACKUP_ROOT || root === RENDITION_ROOT;
}

function isObservedAssetPath(path = "") {
  const parts = String(path).split("/").filter(Boolean);
  if (!parts.length) return false;
  if (parts.length === 1) return isMediaFile(path) || isShaderFile(path);
  if (!["media", "shaders"].includes(parts[0])) return false;
  return isMediaFile(path) || isShaderFile(path);
}

async function fileHandleAtPath(root, path = "") {
  const parts = String(path).split("/").filter(Boolean);
  if (!parts.length) return null;
  try {
    let directory = root;
    for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
    return await directory.getFileHandle(parts.at(-1));
  } catch (error) {
    if (!isNotFoundError(error)) console.warn("[VJ1_OBSERVED_PATH_RESOLVE_FAILED]", { path, fallback: "use the Media refresh button", message: error?.message || String(error) });
    return null;
  }
}

async function writeFileIntoProject(projectDirHandle, file, rootName, sourcePath) {
  const sourceParts = String(sourcePath || "").split("/").filter(Boolean);
  if (sourceParts[0] === rootName) sourceParts.shift();
  let directory = await projectDirHandle.getDirectoryHandle(rootName, { create: true });
  const storedParts = [];
  for (const part of sourceParts.slice(0, -1)) {
    const safePart = safeFilename(part);
    directory = await directory.getDirectoryHandle(safePart, { create: true });
    storedParts.push(safePart);
  }
  const originalName = safeFilename((sourcePath || file.name).split("/").pop() || file.name || "file");
  const filename = await uniqueFilename(directory, originalName);
  const handle = await directory.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  await writable.write(file);
  await writable.close();
  const stored = await handle.getFile();
  Object.defineProperty(stored, "relativePath", { value: [rootName, ...storedParts, filename].join("/"), configurable: true });
  return stored;
}

async function uniqueFilename(directory, filename) {
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : "";
  let candidate = filename;
  let index = 1;
  while (await fileExists(directory, candidate)) {
    candidate = `${base}-${index}${ext}`;
    index++;
  }
  return candidate;
}

async function fileExists(directory, filename) {
  try {
    await directory.getFileHandle(filename);
    return true;
  } catch (error) {
    if (!isNotFoundError(error)) {
      console.error("[VJ1_FILE_EXISTENCE_CHECK_FAILED]", { filename, fallback: "abort collision check", message: error?.message || String(error) });
      throw error;
    }
    return false;
  }
}

function isNotFoundError(error) {
  return error?.name === "NotFoundError";
}

// Missing and unreadable are intentionally different states. Only a real
// NotFoundError may seed a new project; permission, I/O, parse, and transient
// handle failures must leave the current state and disk untouched.
export async function readProjectFile(directory) {
  let handle;
  try {
    handle = await directory.getFileHandle("project.json");
  } catch (error) {
    if (isNotFoundError(error)) return { found: false, data: {} };
    throw error;
  }
  const text = await (await handle.getFile()).text();
  return { found: true, data: JSON.parse(text) };
}

// Saving also fails closed. A lookup failure other than NotFoundError is not
// permission to create a replacement handle over a file we could not inspect.
export async function projectFileForSave(directory) {
  try {
    const handle = await directory.getFileHandle("project.json");
    const previousText = await (await handle.getFile()).text();
    requireValidProjectText(previousText, "VJ1_EXISTING_PROJECT_JSON_INVALID");
    return { handle, previousText, created: false };
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }
  const handle = await directory.getFileHandle("project.json", { create: true });
  return { handle, previousText: "", created: true };
}

function safeFilename(value) {
  return String(value || "file")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/^\.+$/, "file")
    .trim() || "file";
}
