export function createProjectStore({
  dbName,
  dbVersion,
  sketchStoreName,
  projectStoreName,
  projectFallbackKey,
  projectLimit,
  normalizeProjectRecord,
  logLine = () => {},
} = {}) {
  function openDb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("IndexedDB is not available"));
        return;
      }

      const request = indexedDB.open(dbName, dbVersion);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(sketchStoreName)) {
          const store = db.createObjectStore(sketchStoreName, { keyPath: "id", autoIncrement: true });
          store.createIndex("at", "at");
        }
        if (!db.objectStoreNames.contains(projectStoreName)) {
          const store = db.createObjectStore(projectStoreName, { keyPath: "id" });
          store.createIndex("updatedAt", "updatedAt");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open sketch history database"));
    });
  }

  function requestDone(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
    });
  }

  function compactProjectFallbackRecord(project = {}) {
    const normalized = normalizeProjectRecord(project);
    return {
      ...normalized,
      revisions: normalized.revisions.map((revision) => ({
        id: revision.id,
        name: revision.name,
        code: "",
        specification: "",
        specificationMode: revision.specificationMode,
        circuit: null,
        chat: [],
        source: "new-revision",
        createdAt: revision.createdAt,
        bytes: revision.bytes,
        codeHash: revision.codeHash,
      })),
    };
  }

  function readProjectsFallback() {
    try {
      const value = JSON.parse(localStorage.getItem(projectFallbackKey) || "[]");
      return Array.isArray(value)
        ? value.map((item) => normalizeProjectRecord(item)).filter((item) => item.revisions.length).slice(0, projectLimit)
        : [];
    } catch {
      return [];
    }
  }

  function tryWriteProjectsFallback(projects = []) {
    try {
      localStorage.setItem(projectFallbackKey, JSON.stringify(projects));
      return true;
    } catch {
      return false;
    }
  }

  function writeProjectsFallbackBestEffort(projects = []) {
    const candidates = [projectLimit, 40, 20, 10, 5, 1];
    for (const count of candidates) {
      if (tryWriteProjectsFallback(projects.slice(0, count))) return;
    }
    if (tryWriteProjectsFallback(projects.slice(0, projectLimit).map(compactProjectFallbackRecord))) {
      logLine("warn", "project fallback stored as metadata because localStorage quota was tight");
      return;
    }
    logLine("warn", "project fallback not updated because localStorage quota was exceeded");
  }

  async function readProjectsFromIndexedDb() {
    try {
      const db = await openDb();
      try {
        const tx = db.transaction(projectStoreName, "readonly");
        const store = tx.objectStore(projectStoreName);
        const items = await requestDone(store.getAll());
        return items
          .map((item) => normalizeProjectRecord(item))
          .filter((item) => item.revisions.length)
          .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
          .slice(0, projectLimit);
      } finally {
        db.close();
      }
    } catch (error) {
      logLine("warn", `project store read failed: ${error?.message || error}`);
      return [];
    }
  }

  async function readRawProjectRecords() {
    try {
      const db = await openDb();
      try {
        const tx = db.transaction(projectStoreName, "readonly");
        return await requestDone(tx.objectStore(projectStoreName).getAll());
      } finally {
        db.close();
      }
    } catch {
      return [];
    }
  }

  async function writeRawProjectRecords(projects = []) {
    if (!projects.length) return false;
    try {
      const db = await openDb();
      try {
        const tx = db.transaction(projectStoreName, "readwrite");
        const store = tx.objectStore(projectStoreName);
        projects.forEach((project) => store.put(project));
        await transactionDone(tx);
        return true;
      } finally {
        db.close();
      }
    } catch {
      return false;
    }
  }

  async function putProjectRecord(project) {
    if (!project?.id) return false;
    try {
      const db = await openDb();
      try {
        const tx = db.transaction(projectStoreName, "readwrite");
        tx.objectStore(projectStoreName).put(project);
        await transactionDone(tx);
        return true;
      } finally {
        db.close();
      }
    } catch {
      return false;
    }
  }

  async function replaceProjectAndDeleteDuplicates(project, duplicateIds = []) {
    if (!project?.id) return false;
    try {
      const db = await openDb();
      try {
        const tx = db.transaction(projectStoreName, "readwrite");
        const store = tx.objectStore(projectStoreName);
        store.put(project);
        duplicateIds.forEach((id) => store.delete(id));
        await transactionDone(tx);
        return true;
      } finally {
        db.close();
      }
    } catch {
      return false;
    }
  }

  async function readLegacySketchRecords() {
    try {
      const db = await openDb();
      try {
        const tx = db.transaction(sketchStoreName, "readonly");
        return await requestDone(tx.objectStore(sketchStoreName).getAll());
      } finally {
        db.close();
      }
    } catch {
      return [];
    }
  }

  async function writeLegacySketchRecords(records = []) {
    if (!records.length) return false;
    try {
      const db = await openDb();
      try {
        const tx = db.transaction(sketchStoreName, "readwrite");
        const store = tx.objectStore(sketchStoreName);
        records.forEach((record) => store.put(record));
        await transactionDone(tx);
        return true;
      } finally {
        db.close();
      }
    } catch {
      return false;
    }
  }

  async function storeCount(storeName) {
    try {
      const db = await openDb();
      try {
        if (!db.objectStoreNames.contains(storeName)) return "missing";
        const tx = db.transaction(storeName, "readonly");
        return String(await requestDone(tx.objectStore(storeName).count()));
      } finally {
        db.close();
      }
    } catch (error) {
      return `unreadable:${error?.name || "error"}`;
    }
  }

  return {
    compactProjectFallbackRecord,
    openDb,
    putProjectRecord,
    readProjectsFallback,
    readProjectsFromIndexedDb,
    readLegacySketchRecords,
    readRawProjectRecords,
    replaceProjectAndDeleteDuplicates,
    requestDone,
    transactionDone,
    storeCount,
    tryWriteProjectsFallback,
    writeRawProjectRecords,
    writeLegacySketchRecords,
    writeProjectsFallbackBestEffort,
  };
}
