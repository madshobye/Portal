let hopModel = null;
let sourceRows = [];
let sourceCsvText = "";
let droppedFileName = "";
let csvSavePending = false;
let statusMessage = "Drop HOP sales CSV onto the canvas";
let currentView = "overview";
let fullStartMs = 0;
let fullEndMs = 0;
let selectedStartMs = 0;
let selectedEndMs = 0;
let timeBucket = "week";
let buyerPatternWindowIndex = 0;
let revenueGroupCount = 8;
let activityPathMode = "ever";
let anonymizeNames = true;
let revenueGroupsExcludeMembership = false;
let timelineSmoothCurves = false;
let timelineStackedLines = false;
let fullTimelineCacheByBucket = new Map();
let storedSliderState = {};
let draggedNetworkNode = null;
let chartToggleHits = [];
let pendingChartToggle = null;
let pendingChartToggleStartedAt = 0;
let draggedDateRangeHandle = null;
let draggedDateRangeOffsetMs = 0;
let draggedDateRangeLengthMs = 0;
const hiddenSeriesKeys = new Set();
const hiddenTimelineLabelTypes = new Set();
const DAY_MS = 24 * 60 * 60 * 1000;
const LABEL_HOLD_MS = 450;
const NODE_PIN_HOLD_MS = 650;
const URL_TIME_BUCKETS = ["week", "month", "quarter", "halfyear", "year"];
const URL_DASHBOARD_PARAMS = [
  "view",
  "from",
  "to",
  "period",
  "buyerWindow",
  "revenueGroups",
  "revenueNoMembership",
  "pathMode",
  "curves",
  "stacked",
  "hiddenSeries",
  "hiddenLabels",
];

const NAV_ITEMS = [
  { id: "overview", label: "Overview", icon: "dashboard" },
  { id: "ticketsales", label: "Ticket Sales", shortLabel: "Tickets", icon: "confirmation_number" },
  { id: "revenuegroups", label: "Revenue Groups", shortLabel: "Revenue", icon: "paid" },
  { id: "buyerpattern", label: "Buyer Pattern", shortLabel: "Pattern", icon: "polyline" },
  { id: "activitynetwork", label: "Activity Network", shortLabel: "Act Net", icon: "hub" },
  { id: "usernetwork", label: "User Network", shortLabel: "User Net", icon: "share" },
  { id: "retention", label: "Retention", icon: "calendar_month" },
  { id: "activitypath", label: "Activity Path", shortLabel: "Path", icon: "route" },
  { id: "gateway", label: "Gateway", shortLabel: "Gate", icon: "login" },
  { id: "pipeline", label: "Pipeline", shortLabel: "Pipe", icon: "filter_alt" },
  { id: "producthealth", label: "Product Health", shortLabel: "Health", icon: "monitor_heart" },
  { id: "segments", label: "Segments", shortLabel: "Seg", icon: "donut_large" },
  { id: "exitpoints", label: "Exit Points", shortLabel: "Exit", icon: "logout" },
  { id: "memberlength", label: "Member Length", shortLabel: "Length", icon: "linear_scale" },
  { id: "memberdistribution", label: "Member Tenure Distribution", shortLabel: "Tenure", icon: "workspace_premium" },
  { id: "activity", label: "Activity", icon: "timeline" },
];

async function setup() {
  const canvas = createCanvas(windowWidth, windowHeight);
  pixelDensity(1);
  frameRate(60);
  if (typeof loadScript === "function") {
    await loadScript("portal/uiSlim2.js");
  }
  if (typeof loadGoogleFont === "function") {
    try {
      await loadGoogleFont("Material Symbols Rounded");
    } catch (error) {
      console.warn("[hopdashboard] icon font load failed", error);
    }
  }
  canvas.drop(handleCsvDrop);
  const dashboardUrlState = loadDashboardUrlState();
  restoreStoredView(dashboardUrlState);
  restoreStoredTimelineVisibility(dashboardUrlState);
  restoreStoredSliders(dashboardUrlState);
  restoreStoredCsv();
}

function draw() {
  if (hopModel) {
    chartToggleHits = [];
    const hopUi = drawHopOverview(hopModel, droppedFileName, currentView, NAV_ITEMS, { anonymizeNames, periodLabel: selectedPeriodLabel(), showSaveButton: csvSavePending });
    if (hopUi?.clearClicked) {
      confirmClearDashboardData();
      return;
    }
    if (hopUi?.navView) {
      setCurrentView(hopUi.navView);
      return;
    }
    drawGraphPeriodLabel(currentView);
    if (drawTimeBucketToggle(timeBucket, csvSavePending)) cycleTimeBucket();
    if (drawAnonymizeToggle(anonymizeNames)) toggleAnonymizeNames();
    if (csvSavePending && drawStorageToggle()) saveCurrentCsvToBrowser();
    if (drawTimelineCurveToggle(timelineSmoothCurves, csvSavePending)) toggleTimelineCurves();
    if (drawTimelineStackToggle(timelineStackedLines, csvSavePending)) toggleTimelineStacking();
    if (drawCaptureButton(csvSavePending)) setTimeout(saveGraphSnapshot, 0);
    if (drawActivityPathModeToggle(activityPathMode, currentView === "activitypath", csvSavePending)) toggleActivityPathMode();
    drawPortalRangeControls();
    drawDateRangeSlider();
    drawPendingViewInfoTooltip();
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
    csvSavePending = true;
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
    csvSavePending = false;
  } catch (error) {
    console.error(error);
    clearHopCsv();
    statusMessage = "Stored CSV could not be restored. Drop it again.";
  }
}

function loadCsvText(text, fileName) {
  sourceCsvText = String(text || "");
  const parsed = parseCsvText(text);
  sourceRows = parsed.rows;
  fullTimelineCacheByBucket = new Map();
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
  updateDashboardUrl();
}

function drawPortalRangeControls() {
  if (typeof uiSlider !== "function") return;
  const controlY = 65;
  const dateBounds = getDateRangeSliderBounds();
  const sliderW = min(220, max(150, (dateBounds.x - 46) / 2));
  const style = {
    height: 26,
    fontSize: 11,
    rounding: 2,
    trackColor: "#242424",
    fillColor: "#5778ff",
    bgColor: "#111",
    textColor: "#f5f5f5",
    persist: false,
    hideValue: true,
  };

  if (currentView === "buyerpattern") {
    const journeyCount = hopModel.buyerPatterns?.journeys?.length || 0;
    const maxWindow = max(0, ceil(journeyCount / 200) - 1);
    buyerPatternWindowIndex = constrain(buyerPatternWindowIndex, 0, maxWindow);
    const windowSlider = uiSlider("hop_buyer_pattern_window", `Window ${buyerPatternWindowIndex + 1}/${maxWindow + 1}`, {
      min: 0,
      max: maxWindow,
      init: buyerPatternWindowIndex,
    }, { ...style, fillColor: "#8a8a8a", x: 32, y: controlY, width: sliderW });
    const nextWindow = constrain(round(windowSlider.value), 0, maxWindow);
    if (nextWindow !== buyerPatternWindowIndex) {
      buyerPatternWindowIndex = nextWindow;
      syncPortalBuyerWindowSlider();
      saveSliderState();
    }
  }

  if (currentView === "revenuegroups") {
    const groupSliderX = 32;
    const groupSlider = uiSlider("hop_revenue_group_count", `${revenueGroupCount} groups`, {
      min: 3,
      max: 100,
      init: revenueGroupCount,
    }, { ...style, fillColor: "#8a8a8a", x: groupSliderX, y: controlY, width: sliderW });
    if (drawRevenueGroupsMembershipToggle(revenueGroupsExcludeMembership, true, getRevenueGroupsMembershipButtonPosition())) {
      revenueGroupsExcludeMembership = !revenueGroupsExcludeMembership;
      saveSliderState();
    }
    const nextGroupCount = constrain(round(groupSlider.value), 3, 100);
    if (nextGroupCount !== revenueGroupCount) {
      revenueGroupCount = nextGroupCount;
      saveSliderState();
    }
  }
}

function drawDateRangeSlider() {
  const item = getDateRangeSliderBounds();
  const trackY = item.y + 25;
  const startX = dateRangeHandleX(selectedStartMs, item);
  const endX = dateRangeHandleX(selectedEndMs, item);

  fill(245);
  noStroke();
  textSize(11);
  textAlign(RIGHT, CENTER);
  text(`${formatDate(new Date(selectedStartMs))} - ${formatDate(new Date(selectedEndMs))}`, item.x + item.w, item.y + 7);

  stroke(150);
  strokeWeight(3);
  line(item.x, trackY, item.x + item.w, trackY);
  stroke(245);
  strokeWeight(draggedDateRangeHandle === "range" ? 7 : 5);
  line(startX, trackY, endX, trackY);

  drawDateRangeHandle(startX, trackY, draggedDateRangeHandle === "start");
  drawDateRangeHandle(endX, trackY, draggedDateRangeHandle === "end");
}

function drawDateRangeHandle(x, y, active) {
  fill(active ? 35 : 245);
  stroke(active ? 245 : 35);
  strokeWeight(1.5);
  circle(x, y, 14);
}

function applyDateRange() {
  const fullTimeline = getFullTimelineCache(timeBucket);
  const filteredRows = sourceRows.filter((row) => {
    const date = parseHopDate(row["Invoice date/time"]);
    const time = startOfDayMs(date);
    return time >= selectedStartMs && time <= selectedEndMs;
  });
  hopModel = buildHopModel(filteredRows, timeBucket, {
    timelineActivity: fullTimeline.activity,
    ticketSalesTimeline: fullTimeline.ticketSalesTimeline,
    timelineRows: sourceRows,
    activityPathRows: sourceRows,
    retentionRows: sourceRows,
    membershipLengthRows: sourceRows,
    firstTouchpointRows: sourceRows,
    activityPathMode,
    rangeStartMs: selectedStartMs,
    rangeEndMs: selectedEndMs,
  });
  hopModel.setAnonymizeNames(anonymizeNames);
}

function getFullTimelineCache(bucket) {
  if (!fullTimelineCacheByBucket.has(bucket)) {
    fullTimelineCacheByBucket.set(bucket, buildHopTimelineCache(sourceRows, bucket));
  }
  return fullTimelineCacheByBucket.get(bucket);
}

function syncPortalControlState() {
  syncPortalDateSliders();
  syncPortalBuyerWindowSlider();
  syncPortalRevenueGroupSlider();
}

function syncPortalDateSliders() {
  return;
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
    timeBucket,
    activityPathMode,
    revenueGroupsExcludeMembership,
    timelineSmoothCurves,
    timelineStackedLines,
  };
  saveHopSliders(storedSliderState);
  updateDashboardUrl();
}

function restoreStoredSliders(urlState = null) {
  storedSliderState = { ...loadHopSliders(), ...(urlState?.sliders || {}) };
  buyerPatternWindowIndex = constrain(Number(storedSliderState.buyerPatternWindowIndex) || 0, 0, 999999);
  revenueGroupCount = constrain(Number(storedSliderState.revenueGroupCount) || revenueGroupCount, 3, 100);
  if (URL_TIME_BUCKETS.includes(storedSliderState.timeBucket)) {
    timeBucket = storedSliderState.timeBucket;
  }
  if (["ever", "range"].includes(storedSliderState.activityPathMode)) {
    activityPathMode = storedSliderState.activityPathMode;
  }
  revenueGroupsExcludeMembership = !!storedSliderState.revenueGroupsExcludeMembership;
  timelineSmoothCurves = !!storedSliderState.timelineSmoothCurves;
  timelineStackedLines = !!storedSliderState.timelineStackedLines;
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
  const dateHandle = getDateRangeHandleHit(mouseX, mouseY);
  if (dateHandle) {
    draggedDateRangeHandle = dateHandle;
    if (dateHandle === "range") {
      draggedDateRangeOffsetMs = dateRangeValueFromX(mouseX) - selectedStartMs;
      draggedDateRangeLengthMs = selectedEndMs - selectedStartMs;
    } else {
      setDateRangeHandle(draggedDateRangeHandle, mouseX);
    }
    return false;
  }

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

  const chartToggle = getChartToggleHit(mouseX, mouseY);
  if (chartToggle) {
    pendingChartToggle = chartToggle;
    pendingChartToggleStartedAt = millis();
    return false;
  }

  return true;
}

function mouseReleased() {
  if (draggedDateRangeHandle) {
    draggedDateRangeHandle = null;
    draggedDateRangeOffsetMs = 0;
    draggedDateRangeLengthMs = 0;
    return false;
  }

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
  if (draggedDateRangeHandle) {
    if (draggedDateRangeHandle === "range") setDateRangeWindow(mouseX);
    else setDateRangeHandle(draggedDateRangeHandle, mouseX);
    return false;
  }

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

function keyPressed() {
  if ((key === "p" || key === "P") && hopModel) {
    saveGraphSnapshot();
    return false;
  }
  return true;
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
  updateDashboardUrl();
}

function restoreStoredTimelineVisibility(urlState = null) {
  const stored = loadHopTimelineVisibility();
  hiddenSeriesKeys.clear();
  hiddenTimelineLabelTypes.clear();
  const series = urlState?.visibility?.series || stored.series || [];
  const labels = urlState?.visibility?.labels || stored.labels || [];
  for (const key of series) hiddenSeriesKeys.add(key);
  for (const key of labels) hiddenTimelineLabelTypes.add(key);
}

function getDateRangeSliderBounds() {
  const right = width - 32;
  const w = min(460, max(300, width * 0.34));
  return { x: right - w, y: 62, w, h: 34 };
}

function getDateRangeHandleHit(x, y) {
  if (!hopModel) return null;
  const item = getDateRangeSliderBounds();
  const trackY = item.y + 25;
  const isInside = x >= item.x - 10 && x <= item.x + item.w + 10 && y >= item.y && y <= item.y + item.h + 8;
  if (!isInside) return null;
  const startX = dateRangeHandleX(selectedStartMs, item);
  const endX = dateRangeHandleX(selectedEndMs, item);
  const startDistance = dist(x, y, startX, trackY);
  const endDistance = dist(x, y, endX, trackY);
  if (startDistance <= 14 || endDistance <= 14) return startDistance <= endDistance ? "start" : "end";
  if (abs(y - trackY) <= 12 && x > startX && x < endX) return "range";
  if (abs(y - trackY) <= 12 && x >= item.x && x <= item.x + item.w) return abs(x - startX) <= abs(x - endX) ? "start" : "end";
  return null;
}

function dateRangeHandleX(value, item) {
  if (fullEndMs <= fullStartMs) return item.x;
  const t = (value - fullStartMs) / (fullEndMs - fullStartMs);
  return item.x + constrain(t, 0, 1) * item.w;
}

function dateRangeValueFromX(x) {
  const item = getDateRangeSliderBounds();
  const t = constrain((x - item.x) / item.w, 0, 1);
  return snapDay(fullStartMs + t * (fullEndMs - fullStartMs));
}

function setDateRangeHandle(handle, x) {
  const value = dateRangeValueFromX(x);
  if (handle === "start") selectedStartMs = min(value, selectedEndMs);
  if (handle === "end") selectedEndMs = max(value, selectedStartMs);
  saveSliderState();
  applyDateRange();
}

function setDateRangeWindow(x) {
  const length = draggedDateRangeLengthMs || selectedEndMs - selectedStartMs;
  let start = snapDay(dateRangeValueFromX(x) - draggedDateRangeOffsetMs);
  let end = start + length;
  if (start < fullStartMs) {
    start = fullStartMs;
    end = start + length;
  }
  if (end > fullEndMs) {
    end = fullEndMs;
    start = end - length;
  }
  selectedStartMs = constrain(start, fullStartMs, fullEndMs);
  selectedEndMs = constrain(end, fullStartMs, fullEndMs);
  saveSliderState();
  applyDateRange();
}

function getRevenueGroupsMembershipButtonPosition() {
  const dateBounds = getDateRangeSliderBounds();
  const sliderW = min(220, max(150, (dateBounds.x - 46) / 2));
  return { x: 32 + sliderW + 10, y: 66 };
}

function clearDashboardData() {
  clearHopCsv();
  hopModel = null;
  sourceRows = [];
  sourceCsvText = "";
  csvSavePending = false;
  fullTimelineCacheByBucket = new Map();
  droppedFileName = "";
  statusMessage = "Drop HOP sales CSV onto the canvas";
  clearDashboardUrl();
}

function confirmClearDashboardData() {
  if (!window.confirm("Delete the loaded CSV and clear saved dashboard data?")) return;
  clearDashboardData();
}

function cycleTimeBucket() {
  timeBucket = nextTimeBucket(timeBucket);
  buyerPatternWindowIndex = 0;
  saveSliderState();
  applyDateRange();
}

function toggleAnonymizeNames() {
  anonymizeNames = !anonymizeNames;
  hopModel?.setAnonymizeNames?.(anonymizeNames);
  saveSliderState();
}

function saveCurrentCsvToBrowser() {
  if (!sourceCsvText) {
    statusMessage = "Drop HOP sales CSV before saving";
    return;
  }
  saveHopCsv(sourceCsvText, droppedFileName || "CSV");
  csvSavePending = false;
}

function toggleTimelineCurves() {
  timelineSmoothCurves = !timelineSmoothCurves;
  saveSliderState();
}

function toggleTimelineStacking() {
  timelineStackedLines = !timelineStackedLines;
  saveSliderState();
}

function toggleActivityPathMode() {
  activityPathMode = activityPathMode === "ever" ? "range" : "ever";
  saveSliderState();
  applyDateRange();
}

function setCurrentView(view) {
  if (!view || view === currentView) return;
  currentView = view;
  saveHopView(currentView);
  updateDashboardUrl();
}

function saveGraphSnapshot() {
  draw();
  const bounds = getGraphSnapshotBounds();
  const image = get(bounds.x, bounds.y, bounds.w, bounds.h);
  image.save(`hop-${currentView}-${new Date().toISOString().slice(0, 10)}`, "png");
}

function selectedPeriodLabel() {
  if (!selectedStartMs || !selectedEndMs) return "";
  return `${formatDate(new Date(selectedStartMs))} - ${formatDate(new Date(selectedEndMs))}`;
}

function getGraphSnapshotBounds() {
  const top = 112;
  return {
    x: 0,
    y: top,
    w: width,
    h: height - top,
  };
}

function nextTimeBucket(bucket) {
  if (bucket === "week") return "month";
  if (bucket === "month") return "quarter";
  if (bucket === "quarter") return "halfyear";
  if (bucket === "halfyear") return "year";
  return "week";
}

function restoreStoredView(urlState = null) {
  const savedView = urlState?.view || loadHopView();
  const storedView = savedView === "memberships" ? "activity" : savedView === "testview" ? "overview" : savedView;
  if (NAV_ITEMS.some((item) => item.id === storedView)) {
    currentView = storedView;
  }
}

function loadDashboardUrlState() {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search || "");
  if (!URL_DASHBOARD_PARAMS.some((key) => params.has(key))) return null;

  const view = normalizeUrlView(params.get("view"));
  const sliders = {};
  const fromMs = parseUrlDateMs(params.get("from"));
  const toMs = parseUrlDateMs(params.get("to"));
  if (fromMs) sliders.selectedStartMs = fromMs;
  if (toMs) sliders.selectedEndMs = toMs;

  const period = params.get("period");
  if (URL_TIME_BUCKETS.includes(period)) sliders.timeBucket = period;

  const buyerWindow = parseUrlInteger(params.get("buyerWindow"));
  if (buyerWindow !== null) sliders.buyerPatternWindowIndex = buyerWindow;

  const revenueGroups = parseUrlInteger(params.get("revenueGroups"));
  if (revenueGroups !== null) sliders.revenueGroupCount = revenueGroups;

  const pathMode = params.get("pathMode");
  if (["ever", "range"].includes(pathMode)) sliders.activityPathMode = pathMode;

  const revenueNoMembership = parseUrlBoolean(params.get("revenueNoMembership"));
  if (revenueNoMembership !== null) sliders.revenueGroupsExcludeMembership = revenueNoMembership;

  const curves = parseUrlBoolean(params.get("curves"));
  if (curves !== null) sliders.timelineSmoothCurves = curves;

  const stacked = parseUrlBoolean(params.get("stacked"));
  if (stacked !== null) sliders.timelineStackedLines = stacked;

  return {
    view,
    sliders,
    visibility: {
      series: parseUrlList(params.get("hiddenSeries")),
      labels: parseUrlList(params.get("hiddenLabels")),
    },
  };
}

function normalizeUrlView(view) {
  if (!view) return "";
  if (view === "memberships") return "activity";
  if (view === "testview") return "overview";
  return NAV_ITEMS.some((item) => item.id === view) ? view : "";
}

function parseUrlInteger(value) {
  if (value === null || value === "") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseUrlBoolean(value) {
  if (value === null || value === "") return null;
  if (["1", "true", "yes", "on"].includes(String(value).toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(String(value).toLowerCase())) return false;
  return null;
}

function parseUrlList(value) {
  if (!value) return [];
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function parseUrlDateMs(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return 0;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function formatUrlDate(ms) {
  const date = new Date(ms);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function updateDashboardUrl() {
  if (typeof window === "undefined" || !window.history?.replaceState) return;
  const url = new URL(window.location.href);
  url.searchParams.set("view", currentView);
  if (selectedStartMs) url.searchParams.set("from", formatUrlDate(selectedStartMs));
  if (selectedEndMs) url.searchParams.set("to", formatUrlDate(selectedEndMs));
  url.searchParams.set("period", timeBucket);
  url.searchParams.set("buyerWindow", String(constrain(Math.round(Number(buyerPatternWindowIndex) || 0), 0, 999999)));
  url.searchParams.set("revenueGroups", String(constrain(Math.round(Number(revenueGroupCount) || 8), 3, 100)));
  url.searchParams.set("revenueNoMembership", revenueGroupsExcludeMembership ? "1" : "0");
  url.searchParams.set("pathMode", activityPathMode);
  url.searchParams.set("curves", timelineSmoothCurves ? "1" : "0");
  url.searchParams.set("stacked", timelineStackedLines ? "1" : "0");
  setOptionalUrlList(url.searchParams, "hiddenSeries", hiddenSeriesKeys);
  setOptionalUrlList(url.searchParams, "hiddenLabels", hiddenTimelineLabelTypes);
  window.history.replaceState(null, "", url.toString());
}

function setOptionalUrlList(params, key, values) {
  const list = Array.from(values || []).filter(Boolean);
  if (list.length) params.set(key, list.join(","));
  else params.delete(key);
}

function clearDashboardUrl() {
  if (typeof window === "undefined" || !window.history?.replaceState) return;
  const url = new URL(window.location.href);
  for (const key of URL_DASHBOARD_PARAMS) url.searchParams.delete(key);
  window.history.replaceState(null, "", url.toString());
}
