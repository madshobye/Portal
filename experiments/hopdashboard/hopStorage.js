const HOP_STORAGE_KEY = "hopdashboard:lastCsv";
const HOP_VIEW_STORAGE_KEY = "hopdashboard:currentView";

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

function saveHopView(viewId) {
  localStorage.setItem(HOP_VIEW_STORAGE_KEY, String(viewId || "testview"));
}

function loadHopView() {
  return localStorage.getItem(HOP_VIEW_STORAGE_KEY) || "";
}
