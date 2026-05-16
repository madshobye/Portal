const HOP_STORAGE_KEY = "hopdashboard:lastCsv";
const HOP_VIEW_STORAGE_KEY = "hopdashboard:currentView";
const HOP_VISIBILITY_STORAGE_KEY = "hopdashboard:timelineVisibility";
const HOP_SLIDER_STORAGE_KEY = "hopdashboard:sliders";
const HOP_STORE_PREF_KEY = "hopdashboard:storeCsv";

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

function saveHopStorePreference(enabled) {
  localStorage.setItem(HOP_STORE_PREF_KEY, enabled ? "true" : "false");
}

function loadHopStorePreference() {
  return localStorage.getItem(HOP_STORE_PREF_KEY) === "true";
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
