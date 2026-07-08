const DB_NAME = "vj1-directory-handles";
const STORE_NAME = "handles";
const PROJECT_KEY = "project-directory";

export async function saveProjectDirectoryHandle(handle) {
  const store = await getStore("readwrite");
  await request(store.put(handle, PROJECT_KEY));
}

export async function loadProjectDirectoryHandle() {
  const store = await getStore("readonly");
  return await request(store.get(PROJECT_KEY));
}

export function canPersistDirectoryHandles() {
  return "indexedDB" in window && "showDirectoryPicker" in window;
}

function getStore(mode) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE_NAME);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(STORE_NAME, mode);
      tx.onerror = () => reject(tx.error);
      resolve(tx.objectStore(STORE_NAME));
    };
  });
}

function request(idbRequest) {
  return new Promise((resolve, reject) => {
    idbRequest.onerror = () => reject(idbRequest.error);
    idbRequest.onsuccess = () => resolve(idbRequest.result);
  });
}
