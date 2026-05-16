const HOP_STORAGE_KEY = "hopdashboard:lastCsv";
const HOP_VIEW_STORAGE_KEY = "hopdashboard:currentView";
const HOP_VISIBILITY_STORAGE_KEY = "hopdashboard:timelineVisibility";

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
