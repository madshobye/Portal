export const COLD_BACKUP_ROOT = "backups";
export const COLD_BACKUP_INTERVAL = 500;

const DEFAULT_MAX_REVISION_ENTRIES = 500;
const DEFAULT_MAX_REVISION_BYTES = 512 * 1024 * 1024;

export function nextColdBackupRevision(currentRevision = 0, interval = COLD_BACKUP_INTERVAL) {
  const revision = Math.max(0, Math.floor(Number(currentRevision) || 0)) + 1;
  const cadence = Math.max(1, Math.floor(Number(interval) || COLD_BACKUP_INTERVAL));
  return { revision, shouldBackup: revision % cadence === 0 };
}

// Owns the revision directories, their bounded in-memory indexes, and milestone
// backups. Project loading and save orchestration stay in the folder service;
// this store has one filesystem concern and publishes only undo/redo capability.
export function createProjectHistoryStore({
  getProjectDirectory,
  onStateChange = () => {},
  maxRevisionEntries = DEFAULT_MAX_REVISION_ENTRIES,
  maxRevisionBytes = DEFAULT_MAX_REVISION_BYTES,
} = {}) {
  let state = { canUndo: false, canRedo: false };
  let historyIndexReady = false;
  const revisionIndex = { undo: [], redo: [] };
  let coldBackupIndexReady = false;
  let coldBackupIndex = emptyColdBackupIndex();

  function projectDirectory() {
    return getProjectDirectory?.() || null;
  }

  function getState() {
    return { ...state };
  }

  function reset() {
    revisionIndex.undo.length = 0;
    revisionIndex.redo.length = 0;
    historyIndexReady = false;
    coldBackupIndexReady = false;
    coldBackupIndex = emptyColdBackupIndex();
    publishState(false, false);
  }

  async function refreshState() {
    if (!projectDirectory()) {
      publishState(false, false);
      return getState();
    }
    await ensureHistoryIndex();
    publishIndexedState();
    return getState();
  }

  async function writeRevision(text, savedAt) {
    const directory = projectDirectory();
    if (!directory) return false;
    await ensureHistoryIndex();
    if (directory !== projectDirectory()) return false;
    const revisions = await directory.getDirectoryHandle("revisions", { create: true });
    const filename = revisionFilename("project-before", savedAt);
    const handle = await writeDirectoryTextFile(revisions, filename, text);
    revisionIndex.undo.push({ parent: revisions, handle, name: filename, size: textByteLength(text) });
    revisionIndex.undo.sort(compareRevisionEntries);
    await pruneRevisionIndex("undo");
    publishIndexedState();
    return true;
  }

  async function writeRedoRevision(text, savedAt) {
    const directory = projectDirectory();
    if (!directory) return false;
    await ensureHistoryIndex();
    if (directory !== projectDirectory()) return false;
    const redos = await getRedoDirectory({ create: true });
    if (!redos) return false;
    const filename = revisionFilename("project-redo", savedAt);
    const handle = await writeDirectoryTextFile(redos, filename, text);
    revisionIndex.redo.push({ parent: redos, handle, name: filename, size: textByteLength(text) });
    revisionIndex.redo.sort(compareRevisionEntries);
    await pruneRevisionIndex("redo");
    publishIndexedState();
    return true;
  }

  async function clearRedoRevisions() {
    await ensureHistoryIndex();
    for (const entry of revisionIndex.redo.splice(0)) {
      await entry.parent.removeEntry(entry.name);
      await cooperativeYield();
    }
    publishIndexedState();
  }

  async function latestRevisionEntry(kind) {
    await ensureHistoryIndex();
    const entries = revisionIndex[kind === "redo" ? "redo" : "undo"];
    return entries[entries.length - 1] || null;
  }

  async function removeRevisionEntry(entry) {
    if (!entry) return false;
    await entry.parent.removeEntry(entry.name);
    for (const entries of [revisionIndex.undo, revisionIndex.redo]) {
      const index = entries.findIndex((candidate) => candidate.name === entry.name && candidate.parent === entry.parent);
      if (index >= 0) entries.splice(index, 1);
    }
    publishIndexedState();
    return true;
  }

  async function recordColdBackup(projectJson, savedAt) {
    const directory = projectDirectory();
    if (!directory) return false;
    await ensureColdBackupIndex(directory);
    if (directory !== projectDirectory()) return false;
    const checkpoint = nextColdBackupRevision(coldBackupIndex.revisionCount);
    let backupFilename = coldBackupIndex.lastBackupFilename || "";
    let lastBackupRevision = coldBackupIndex.lastBackupRevision || 0;
    const backupDirectory = await directory.getDirectoryHandle(COLD_BACKUP_ROOT, { create: true });
    if (checkpoint.shouldBackup) {
      backupFilename = `project-backup-${String(checkpoint.revision).padStart(9, "0")}-${safeTimestamp(savedAt)}-${randomSuffix()}.json`;
      await writeDirectoryTextFile(backupDirectory, backupFilename, projectJson);
      lastBackupRevision = checkpoint.revision;
    }
    const nextIndex = {
      version: 1,
      interval: COLD_BACKUP_INTERVAL,
      revisionCount: checkpoint.revision,
      lastBackupRevision,
      lastBackupFilename: backupFilename,
    };
    await writeDirectoryTextFile(backupDirectory, "index.json", JSON.stringify(nextIndex, null, 2));
    if (directory !== projectDirectory()) return false;
    coldBackupIndex = nextIndex;
    return checkpoint.shouldBackup;
  }

  async function ensureHistoryIndex() {
    if (historyIndexReady || !projectDirectory()) return;
    revisionIndex.undo.length = 0;
    revisionIndex.redo.length = 0;
    const revisions = await getRevisionDirectory();
    if (revisions) await indexRevisionDirectory(revisions, revisionIndex.undo, /^project-before-.+\.json$/);
    const redos = await getRedoDirectory();
    if (redos) await indexRevisionDirectory(redos, revisionIndex.redo, /^project-redo-.+\.json$/);
    historyIndexReady = true;
    await pruneRevisionIndex("undo");
    await pruneRevisionIndex("redo");
    publishIndexedState();
  }

  async function ensureColdBackupIndex(directory) {
    if (coldBackupIndexReady || !directory) return;
    let parsed = null;
    try {
      const backupDirectory = await directory.getDirectoryHandle(COLD_BACKUP_ROOT);
      const handle = await backupDirectory.getFileHandle("index.json");
      parsed = JSON.parse(await (await handle.getFile()).text());
    } catch (error) {
      if (!isNotFoundError(error)) {
        console.warn("[VJ1_COLD_BACKUP_INDEX_INVALID]", {
          directory: COLD_BACKUP_ROOT,
          fallback: "restart milestone count and preserve all existing backup files",
          message: error?.message || String(error),
        });
      }
    }
    if (directory !== projectDirectory()) return;
    coldBackupIndex = normalizeColdBackupIndex(parsed);
    coldBackupIndexReady = true;
  }

  async function indexRevisionDirectory(directory, target, pattern) {
    let count = 0;
    for await (const entry of directory.values()) {
      if (entry.kind === "file" && pattern.test(entry.name)) target.push({ parent: directory, handle: entry, name: entry.name, size: -1 });
      if (++count % 100 === 0) await cooperativeYield();
    }
    target.sort(compareRevisionEntries);
  }

  async function pruneRevisionIndex(kind) {
    const entries = revisionIndex[kind];
    while (entries.length > maxRevisionEntries) {
      const entry = entries.shift();
      await entry.parent.removeEntry(entry.name);
      if (entries.length % 100 === 0) await cooperativeYield();
    }
    let totalBytes = 0;
    for (const entry of entries) {
      if (entry.size < 0) {
        try { entry.size = (await entry.handle.getFile()).size || 0; }
        catch (error) {
          console.warn("[VJ1_HISTORY_ENTRY_UNREADABLE]", { name: entry.name, fallback: "remove unreadable revision", message: error?.message || String(error) });
          entry.size = 0;
        }
      }
      totalBytes += entry.size;
      if (totalBytes % (32 * 1024 * 1024) < entry.size) await cooperativeYield();
    }
    while (entries.length && totalBytes > maxRevisionBytes) {
      const entry = entries.shift();
      totalBytes -= entry.size;
      await entry.parent.removeEntry(entry.name);
    }
  }

  async function getRevisionDirectory({ create = false } = {}) {
    const directory = projectDirectory();
    if (!directory) return null;
    try {
      return await directory.getDirectoryHandle("revisions", { create });
    } catch (error) {
      if (!isNotFoundError(error)) console.warn("[VJ1_HISTORY_DIRECTORY_UNAVAILABLE]", { directory: "revisions", fallback: "history disabled", message: error?.message || String(error) });
      return null;
    }
  }

  async function getRedoDirectory({ create = false } = {}) {
    const revisions = await getRevisionDirectory({ create });
    if (!revisions) return null;
    try {
      return await revisions.getDirectoryHandle("redos", { create });
    } catch (error) {
      if (!isNotFoundError(error)) console.warn("[VJ1_HISTORY_DIRECTORY_UNAVAILABLE]", { directory: "redos", fallback: "redo disabled", message: error?.message || String(error) });
      return null;
    }
  }

  function publishIndexedState() {
    publishState(revisionIndex.undo.length > 0, revisionIndex.redo.length > 0);
  }

  function publishState(canUndo, canRedo) {
    const next = { canUndo: !!canUndo, canRedo: !!canRedo };
    if (next.canUndo === state.canUndo && next.canRedo === state.canRedo) return;
    state = next;
    onStateChange(getState());
  }

  return {
    clearRedoRevisions,
    getState,
    latestRevisionEntry,
    recordColdBackup,
    refreshState,
    removeRevisionEntry,
    reset,
    writeRedoRevision,
    writeRevision,
  };
}

function revisionFilename(prefix, savedAt) {
  return `${prefix}-${safeTimestamp(savedAt)}-${randomSuffix()}.json`;
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 7);
}

function safeTimestamp(value) {
  return String(value || new Date().toISOString()).replace(/[:.]/g, "-");
}

function compareRevisionEntries(a, b) {
  return a.name.localeCompare(b.name);
}

function textByteLength(text = "") {
  return new Blob([text]).size;
}

function emptyColdBackupIndex() {
  return { version: 1, interval: COLD_BACKUP_INTERVAL, revisionCount: 0, lastBackupRevision: 0, lastBackupFilename: "" };
}

function normalizeColdBackupIndex(value) {
  if (!value || typeof value !== "object") return emptyColdBackupIndex();
  return {
    version: 1,
    interval: COLD_BACKUP_INTERVAL,
    revisionCount: Math.max(0, Math.floor(Number(value.revisionCount) || 0)),
    lastBackupRevision: Math.max(0, Math.floor(Number(value.lastBackupRevision) || 0)),
    lastBackupFilename: typeof value.lastBackupFilename === "string" ? value.lastBackupFilename : "",
  };
}

async function writeDirectoryTextFile(directory, filename, text) {
  const handle = await directory.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
  return handle;
}

function cooperativeYield() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function isNotFoundError(error) {
  return error?.name === "NotFoundError";
}
