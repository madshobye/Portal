const HOP_STORAGE_KEY = "hopdashboard:lastCsv";
const HOP_BOOKING_STORAGE_KEY = "hopdashboard:bookingCsvs";
const HOP_INDEXED_DB_NAME = "hopdashboard";
const HOP_INDEXED_DB_STORE = "datasets";
const HOP_INDEXED_DB_VERSION = 1;
const HOP_VIEW_STORAGE_KEY = "hopdashboard:currentView";
const HOP_VISIBILITY_STORAGE_KEY = "hopdashboard:timelineVisibility";
const HOP_SLIDER_STORAGE_KEY = "hopdashboard:sliders";

function saveHopCsv(text, fileName = "CSV") {
  const payload = {
    text: String(text || ""),
    fileName: String(fileName || "CSV"),
    savedAt: new Date().toISOString(),
  };
  localStorage.setItem(HOP_STORAGE_KEY, JSON.stringify(payload));
}

function loadHopCsv() {
  const stored = localStorage.getItem(HOP_STORAGE_KEY);
  if (!stored) return null;
  try {
    const payload = JSON.parse(stored);
    return payload?.text ? payload : null;
  } catch (_error) {
    return { text: stored, fileName: "CSV" };
  }
}

function clearHopCsv() {
  localStorage.removeItem(HOP_STORAGE_KEY);
}

async function saveHopBookingCsvs(sources) {
  const payload = (sources || []).map((source) => ({
    text: String(source.text || ""),
    fileName: String(source.fileName || "Booking CSV"),
    savedAt: new Date().toISOString(),
  })).filter((source) => source.text);
  await writeHopIndexedDbValue(HOP_BOOKING_STORAGE_KEY, payload);
  localStorage.removeItem(HOP_BOOKING_STORAGE_KEY);
}

async function loadHopBookingCsvs() {
  try {
    const indexedPayload = await readHopIndexedDbValue(HOP_BOOKING_STORAGE_KEY);
    if (Array.isArray(indexedPayload)) return indexedPayload.filter((source) => source?.text);
  } catch (error) {
    console.warn("[hopdashboard] IndexedDB booking restore failed", error);
  }

  const stored = localStorage.getItem(HOP_BOOKING_STORAGE_KEY);
  if (!stored) return [];
  try {
    const payload = JSON.parse(stored);
    const sources = Array.isArray(payload) ? payload.filter((source) => source?.text) : [];
    if (sources.length) {
      try {
        await saveHopBookingCsvs(sources);
      } catch (error) {
        console.warn("[hopdashboard] legacy booking storage migration failed", error);
      }
    }
    return sources;
  } catch (_error) {
    return [];
  }
}

async function clearHopBookingCsvs() {
  localStorage.removeItem(HOP_BOOKING_STORAGE_KEY);
  try {
    await deleteHopIndexedDbValue(HOP_BOOKING_STORAGE_KEY);
  } catch (error) {
    console.warn("[hopdashboard] IndexedDB booking clear failed", error);
  }
}

function openHopIndexedDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this browser"));
      return;
    }
    const request = indexedDB.open(HOP_INDEXED_DB_NAME, HOP_INDEXED_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(HOP_INDEXED_DB_STORE)) db.createObjectStore(HOP_INDEXED_DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open dashboard storage"));
    request.onblocked = () => reject(new Error("Dashboard storage upgrade is blocked by another tab"));
  });
}

async function readHopIndexedDbValue(key) {
  const db = await openHopIndexedDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(HOP_INDEXED_DB_STORE, "readonly");
      const request = transaction.objectStore(HOP_INDEXED_DB_STORE).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || transaction.error || new Error("Could not read dashboard storage"));
      transaction.onabort = () => reject(transaction.error || new Error("Dashboard storage read was aborted"));
    });
  } finally {
    db.close();
  }
}

async function writeHopIndexedDbValue(key, value) {
  const db = await openHopIndexedDb();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(HOP_INDEXED_DB_STORE, "readwrite");
      transaction.objectStore(HOP_INDEXED_DB_STORE).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Could not save dashboard data"));
      transaction.onabort = () => reject(transaction.error || new Error("Dashboard storage save was aborted"));
    });
  } finally {
    db.close();
  }
}

async function deleteHopIndexedDbValue(key) {
  const db = await openHopIndexedDb();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(HOP_INDEXED_DB_STORE, "readwrite");
      transaction.objectStore(HOP_INDEXED_DB_STORE).delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Could not clear dashboard data"));
      transaction.onabort = () => reject(transaction.error || new Error("Dashboard storage clear was aborted"));
    });
  } finally {
    db.close();
  }
}

function saveHopView(viewId) {
  localStorage.setItem(HOP_VIEW_STORAGE_KEY, String(viewId || "overview"));
}

function loadHopView() {
  return localStorage.getItem(HOP_VIEW_STORAGE_KEY) || "";
}

function saveHopTimelineVisibility(seriesKeys, labelTypes) {
  localStorage.setItem(HOP_VISIBILITY_STORAGE_KEY, JSON.stringify({
    series: Array.from(seriesKeys || []),
    labels: Array.from(labelTypes || []),
  }));
}

function loadHopTimelineVisibility() {
  const stored = localStorage.getItem(HOP_VISIBILITY_STORAGE_KEY);
  if (!stored) return { series: [], labels: [] };
  try {
    const payload = JSON.parse(stored);
    return {
      series: Array.isArray(payload?.series) ? payload.series : [],
      labels: Array.isArray(payload?.labels) ? payload.labels : [],
    };
  } catch (_error) {
    return { series: [], labels: [] };
  }
}

function saveHopSliders(sliders) {
  localStorage.setItem(HOP_SLIDER_STORAGE_KEY, JSON.stringify(sliders || {}));
}

function loadHopSliders() {
  const stored = localStorage.getItem(HOP_SLIDER_STORAGE_KEY);
  if (!stored) return {};
  try {
    const payload = JSON.parse(stored);
    return payload && typeof payload === "object" ? payload : {};
  } catch (_error) {
    return {};
  }
}
