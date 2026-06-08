export function createProjectSchemaMigrationService({
  storage,
  storageArea,
  projectStoreName,
  projectLimit,
  migrationVersion,
  projectStore,
  readProjectsFallback,
  writeProjectsFallbackBestEffort,
  migrateProjectRecordSchema,
  setProjectCache,
} = {}) {
  async function migrateProjectStorageSchema() {
    if (storageArea.getItem(storage.projectSchemaMigration) === migrationVersion) return;
    let migrated = [];
    try {
      const db = await projectStore.openDb();
      try {
        const tx = db.transaction(projectStoreName, "readwrite");
        const store = tx.objectStore(projectStoreName);
        const items = await projectStore.requestDone(store.getAll());
        migrated = items
          .map((item) => migrateProjectRecordSchema(item))
          .filter((item) => item.revisions.length)
          .slice(0, projectLimit);
        for (const project of migrated) {
          store.put(project);
        }
        await projectStore.transactionDone(tx);
      } finally {
        db.close();
      }
    } catch {
      migrated = readProjectsFallback().map((item) => migrateProjectRecordSchema(item)).filter((item) => item.revisions.length);
    }

    if (migrated.length) {
      setProjectCache(migrated);
      writeProjectsFallbackBestEffort(migrated);
    }
    storageArea.removeItem(storage.chatHistory);
    storageArea.removeItem(storage.specificationDraft);
    storageArea.removeItem(storage.specificationMode);
    storageArea.removeItem(storage.revisionDraft);
    storageArea.setItem(storage.projectSchemaMigration, migrationVersion);
  }

  return { migrateProjectStorageSchema };
}
