let hopModel = null;
let sourceRows = [];
let droppedFileName = "";
let statusMessage = "Drop HOP sales CSV onto the canvas";
let currentView = "overview";
let fullStartMs = 0;
let fullEndMs = 0;
let selectedStartMs = 0;
let selectedEndMs = 0;
let timeBucket = "week";
let buyerPatternWindowIndex = 0;
let revenueGroupCount = 8;
let anonymizeNames = true;
let storedSliderState = {};
let draggedNetworkNode = null;
let chartToggleHits = [];
let pendingChartToggle = null;
let pendingChartToggleStartedAt = 0;
const hiddenSeriesKeys = new Set();
const hiddenTimelineLabelTypes = new Set();
const DAY_MS = 24 * 60 * 60 * 1000;
const LABEL_HOLD_MS = 450;
const NODE_PIN_HOLD_MS = 650;

const NAV_ITEMS = [
  { id: "overview", label: "Overview" },
  { id: "ticketsales", label: "Ticket Sales" },
  { id: "ticketbuyers", label: "Ticket Buyers" },
  { id: "revenuegroups", label: "Revenue Groups" },
  { id: "buyerpattern", label: "Buyer Pattern" },
  { id: "activitynetwork", label: "Activity Network" },
  { id: "usernetwork", label: "User Network" },
  { id: "activity", label: "Activity" },
];

function setup() {
  const canvas = createCanvas(windowWidth, windowHeight);
  pixelDensity(1);
  frameRate(60);
  canvas.drop(handleCsvDrop);
  restoreStoredView();
  restoreStoredTimelineVisibility();
  restoreStoredSliders();
  restoreStoredCsv();
}

function draw() {
  if (hopModel) {
    chartToggleHits = [];
    drawHopOverview(hopModel, droppedFileName, currentView, NAV_ITEMS, { anonymizeNames });
    drawTimeBucketToggle(timeBucket);
    drawAnonymizeToggle(anonymizeNames);
    drawPortalRangeControls();
  } else {
    drawCenteredMessage(statusMessage);
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function handleCsvDrop(file) {
  if (!file?.data) {
    statusMessage = "Could not read file";
    return;
  }
  try {
    loadCsvText(file.data, file.name || "CSV");
    saveHopCsv(file.data, droppedFileName);
  } catch (error) {
    console.error(error);
    statusMessage = `CSV parse failed: ${error?.message || error}`;
  }
}

function restoreStoredCsv() {
  const stored = loadHopCsv();
  if (!stored?.text) return;
  try {
    loadCsvText(stored.text, stored.fileName || "Stored CSV");
  } catch (error) {
    console.error(error);
    clearHopCsv();
    statusMessage = "Stored CSV could not be restored. Drop it again.";
  }
}

function loadCsvText(text, fileName) {
  const parsed = parseCsvText(text);
  sourceRows = parsed.rows;
  const fullModel = buildHopModel(sourceRows, timeBucket);
  fullStartMs = startOfDayMs(fullModel.invoices[0]?.date);
  fullEndMs = startOfDayMs(fullModel.invoices.at(-1)?.date);
  selectedStartMs = constrain(Number(storedSliderState.selectedStartMs) || fullStartMs, fullStartMs, fullEndMs);
  selectedEndMs = constrain(Number(storedSliderState.selectedEndMs) || fullEndMs, fullStartMs, fullEndMs);
  if (selectedStartMs > selectedEndMs) selectedStartMs = selectedEndMs;
  syncPortalControlState();
  applyDateRange();
  droppedFileName = fileName;
  statusMessage = "";
}

function drawPortalRangeControls() {
  if (typeof uiSlider !== "function") return;
  const controlY = 66;
  const sliderW = min(220, max(150, (width - 96) / 4));
  const style = {
    height: 24,
    fontSize: 11,
    rounding: 2,
    trackColor: "#242424",
    fillColor: "#5778ff",
    bgColor: "#111",
    textColor: "#f5f5f5",
    persist: false,
    hideValue: true,
  };

  const startSlider = uiSlider("hop_date_start", `From ${formatDate(new Date(selectedStartMs))}`, {
    min: fullStartMs,
    max: fullEndMs,
    init: selectedStartMs,
  }, { ...style, x: 32, y: controlY, width: sliderW });
  const endSlider = uiSlider("hop_date_end", `To ${formatDate(new Date(selectedEndMs))}`, {
    min: fullStartMs,
    max: fullEndMs,
    init: selectedEndMs,
  }, { ...style, x: 32 + sliderW + 14, y: controlY, width: sliderW });

  let nextStart = snapDay(startSlider.value);
  let nextEnd = snapDay(endSlider.value);
  if (nextStart > nextEnd) nextEnd = nextStart;
  if (nextStart !== selectedStartMs || nextEnd !== selectedEndMs) {
    selectedStartMs = nextStart;
    selectedEndMs = nextEnd;
    syncPortalDateSliders();
    saveSliderState();
    applyDateRange();
  }

  if (currentView === "buyerpattern") {
    const journeyCount = hopModel.buyerPatterns?.journeys?.length || 0;
    const maxWindow = max(0, ceil(journeyCount / 200) - 1);
    buyerPatternWindowIndex = constrain(buyerPatternWindowIndex, 0, maxWindow);
    const windowSlider = uiSlider("hop_buyer_pattern_window", `Window ${buyerPatternWindowIndex + 1}/${maxWindow + 1}`, {
      min: 0,
      max: maxWindow,
      init: buyerPatternWindowIndex,
    }, { ...style, x: 32 + (sliderW + 14) * 2, y: controlY, width: sliderW });
    const nextWindow = constrain(round(windowSlider.value), 0, maxWindow);
    if (nextWindow !== buyerPatternWindowIndex) {
      buyerPatternWindowIndex = nextWindow;
      syncPortalBuyerWindowSlider();
      saveSliderState();
    }
  }

  if (currentView === "revenuegroups") {
    const groupSlider = uiSlider("hop_revenue_group_count", `${revenueGroupCount} groups`, {
      min: 3,
      max: 100,
      init: revenueGroupCount,
    }, { ...style, x: 32 + (sliderW + 14) * 2, y: controlY, width: sliderW });
    const nextGroupCount = constrain(round(groupSlider.value), 3, 100);
    if (nextGroupCount !== revenueGroupCount) {
      revenueGroupCount = nextGroupCount;
      saveSliderState();
    }
  }
}

function applyDateRange() {
  const filteredRows = sourceRows.filter((row) => {
    const date = parseHopDate(row["Invoice date/time"]);
    const time = startOfDayMs(date);
    return time >= selectedStartMs && time <= selectedEndMs;
  });
  hopModel = buildHopModel(filteredRows, timeBucket);
  hopModel.setAnonymizeNames(anonymizeNames);
}

function syncPortalControlState() {
  syncPortalDateSliders();
  syncPortalBuyerWindowSlider();
  syncPortalRevenueGroupSlider();
}

function syncPortalDateSliders() {
  if (typeof uiSetState !== "function") return;
  uiSetState("hop_date_start", selectedStartMs, { persist: false });
  uiSetState("hop_date_end", selectedEndMs, { persist: false });
}

function syncPortalBuyerWindowSlider() {
  if (typeof uiSetState !== "function") return;
  uiSetState("hop_buyer_pattern_window", buyerPatternWindowIndex, { persist: false });
}

function syncPortalRevenueGroupSlider() {
  if (typeof uiSetState !== "function") return;
  uiSetState("hop_revenue_group_count", revenueGroupCount, { persist: false });
}

function saveSliderState() {
  storedSliderState = {
    selectedStartMs,
    selectedEndMs,
    buyerPatternWindowIndex,
    revenueGroupCount,
  };
  saveHopSliders(storedSliderState);
}

function restoreStoredSliders() {
  storedSliderState = loadHopSliders();
  buyerPatternWindowIndex = constrain(Number(storedSliderState.buyerPatternWindowIndex) || 0, 0, 999999);
  revenueGroupCount = constrain(Number(storedSliderState.revenueGroupCount) || revenueGroupCount, 3, 100);
}

function snapDay(value) {
  return constrain(Math.round(Number(value) / DAY_MS) * DAY_MS, fullStartMs, fullEndMs);
}

function startOfDayMs(date) {
  if (!(date instanceof Date)) return 0;
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
}

function mousePressed() {
  const networkHit = getNetworkNodeHitForCurrentView();
  if (networkHit) {
    draggedNetworkNode = {
      kind: currentView,
      key: networkHit.node.key,
      offsetX: networkHit.state.x - mouseX,
      offsetY: networkHit.state.y - mouseY,
      startedAt: millis(),
      wasPinned: !!networkHit.state.pinned,
    };
    networkHit.state.pinned = true;
    networkHit.state.vx = 0;
    networkHit.state.vy = 0;
    return false;
  }

  if (hopModel && isClearDataHit(mouseX, mouseY)) {
    clearHopCsv();
    hopModel = null;
    sourceRows = [];
    droppedFileName = "";
    statusMessage = "Drop HOP sales CSV onto the canvas";
    return false;
  }

  const bucketHit = getTimeBucketHit(mouseX, mouseY);
  if (bucketHit) {
    timeBucket = nextTimeBucket(timeBucket);
    buyerPatternWindowIndex = 0;
    applyDateRange();
    return false;
  }

  const anonymizeHit = getAnonymizeHit(mouseX, mouseY);
  if (anonymizeHit) {
    anonymizeNames = !anonymizeNames;
    hopModel?.setAnonymizeNames?.(anonymizeNames);
    saveSliderState();
    return false;
  }

  const chartToggle = getChartToggleHit(mouseX, mouseY);
  if (chartToggle) {
    pendingChartToggle = chartToggle;
    pendingChartToggleStartedAt = millis();
    return false;
  }

  const hit = getNavHit(mouseX, mouseY);
  if (hit) {
    currentView = hit;
    saveHopView(currentView);
    return false;
  }
  return true;
}

function mouseReleased() {
  if (draggedNetworkNode) {
    const state = getNetworkNodeState(draggedNetworkNode);
    if (state) {
      const heldLongEnough = millis() - draggedNetworkNode.startedAt >= NODE_PIN_HOLD_MS;
      state.pinned = draggedNetworkNode.wasPinned || heldLongEnough;
    }
    draggedNetworkNode = null;
    return false;
  }

  if (!pendingChartToggle) return true;
  const releaseHit = getChartToggleHit(mouseX, mouseY);
  const isSameHit = releaseHit?.kind === pendingChartToggle.kind && releaseHit?.key === pendingChartToggle.key;
  if (isSameHit) {
    const heldLongEnough = millis() - pendingChartToggleStartedAt >= LABEL_HOLD_MS;
    if (heldLongEnough) isolateChartVisibility(pendingChartToggle);
    else toggleChartVisibility(pendingChartToggle);
    saveTimelineVisibility();
  }
  pendingChartToggle = null;
  pendingChartToggleStartedAt = 0;
  return false;
}

function mouseDragged() {
  if (!draggedNetworkNode) return true;
  const state = getNetworkNodeState(draggedNetworkNode);
  const bounds = getNetworkBounds(draggedNetworkNode.kind);
  if (state && bounds) {
    state.x = constrain(mouseX + draggedNetworkNode.offsetX, bounds.x + 10, bounds.x + bounds.w - 10);
    state.y = constrain(mouseY + draggedNetworkNode.offsetY, bounds.y + 10, bounds.y + bounds.h - 10);
    state.vx = 0;
    state.vy = 0;
  }
  return false;
}

function getNetworkNodeHitForCurrentView() {
  if (currentView === "activitynetwork") return getActivityNetworkNodeHit?.(mouseX, mouseY);
  if (currentView === "usernetwork") return getUserNetworkNodeHit?.(mouseX, mouseY);
  return null;
}

function getNetworkNodeState(draggedNode) {
  if (draggedNode.kind === "activitynetwork") return getActivityNetworkNodeState?.(draggedNode.key);
  if (draggedNode.kind === "usernetwork") return getUserNetworkNodeState?.(draggedNode.key);
  return null;
}

function getNetworkBounds(kind) {
  if (kind === "activitynetwork") return getActivityNetworkBounds?.();
  if (kind === "usernetwork") return getUserNetworkBounds?.();
  return null;
}

function getChartToggleHit(x, y) {
  return chartToggleHits.find((hit) => x >= hit.x && x <= hit.x + hit.w && y >= hit.y && y <= hit.y + hit.h);
}

function toggleChartVisibility(hit) {
  const set = hit.kind === "labelType" ? hiddenTimelineLabelTypes : hiddenSeriesKeys;
  if (set.has(hit.key)) set.delete(hit.key);
  else set.add(hit.key);
}

function isolateChartVisibility(hit) {
  const uniqueHits = [...new Map(chartToggleHits.map((candidate) => [`${candidate.kind}:${candidate.key}`, candidate])).values()];
  const alreadyIsolated = uniqueHits.every((candidate) => {
    const set = candidate.kind === "labelType" ? hiddenTimelineLabelTypes : hiddenSeriesKeys;
    const isSelected = candidate.kind === hit.kind && candidate.key === hit.key;
    return isSelected ? !set.has(candidate.key) : set.has(candidate.key);
  });
  if (alreadyIsolated) {
    for (const candidate of uniqueHits) {
      const set = candidate.kind === "labelType" ? hiddenTimelineLabelTypes : hiddenSeriesKeys;
      set.delete(candidate.key);
    }
    return;
  }
  for (const candidate of uniqueHits) {
    const set = candidate.kind === "labelType" ? hiddenTimelineLabelTypes : hiddenSeriesKeys;
    if (candidate.kind === hit.kind && candidate.key === hit.key) set.delete(candidate.key);
    else set.add(candidate.key);
  }
}

function saveTimelineVisibility() {
  saveHopTimelineVisibility(hiddenSeriesKeys, hiddenTimelineLabelTypes);
}

function restoreStoredTimelineVisibility() {
  const stored = loadHopTimelineVisibility();
  hiddenSeriesKeys.clear();
  hiddenTimelineLabelTypes.clear();
  for (const key of stored.series || []) hiddenSeriesKeys.add(key);
  for (const key of stored.labels || []) hiddenTimelineLabelTypes.add(key);
}

function getTimeBucketHit(x, y) {
  const item = getTimeBucketButton();
  return x >= item.x && x <= item.x + item.w && y >= item.y && y <= item.y + item.h;
}

function getAnonymizeHit(x, y) {
  const item = getAnonymizeButton();
  return x >= item.x && x <= item.x + item.w && y >= item.y && y <= item.y + item.h;
}

function nextTimeBucket(bucket) {
  if (bucket === "week") return "month";
  if (bucket === "month") return "quarter";
  return "week";
}

function isClearDataHit(x, y) {
  const box = getClearDataButtonBounds();
  return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
}

function restoreStoredView() {
  const savedView = loadHopView();
  const storedView = savedView === "memberships" ? "activity" : savedView === "testview" ? "overview" : savedView;
  if (NAV_ITEMS.some((item) => item.id === storedView)) {
    currentView = storedView;
  }
}

function getNavHit(x, y) {
  const navY = 24;
  let navX = 32;
  textSize(14);
  for (const item of NAV_ITEMS) {
    const w = textWidth(item.label) + 28;
    if (x >= navX && x <= navX + w && y >= navY && y <= navY + 34) return item.id;
    navX += w + 10;
  }
  return null;
}
