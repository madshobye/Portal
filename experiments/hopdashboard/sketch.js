let hopModel = null;
let sourceRows = [];
let sourceCsvText = "";
let droppedFileName = "";
let bookingCsvSources = [];
let sourceBookingRows = [];
let bookingDuplicateCount = 0;
let csvSavePending = false;
let csvSaveInProgress = false;
let storageMessage = "";
let storageMessageIsError = false;
let storageMessageUntil = 0;
let statusMessage = "Drop HOP sales CSV and yearly booking CSVs onto the canvas";
let currentView = "overview";
let fullStartMs = 0;
let fullEndMs = 0;
let selectedStartMs = 0;
let selectedEndMs = 0;
let timeBucket = "week";
let buyerPatternWindowIndex = 0;
let revenueGroupCount = 8;
let activityPathMode = "ever";
let activityPathSource = "combined";
let activityExplorerKey = "";
let activityExplorerDropdownOpen = false;
let activityExplorerDropdownOffset = 0;
let anonymizeNames = true;
let revenueGroupsExcludeMembership = false;
let purchaseTimingExcludeMembership = false;
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
  "purchaseNoMembership",
  "pathMode",
  "pathSource",
  "explore",
  "curves",
  "stacked",
  "hiddenSeries",
  "hiddenLabels",
];

const NAV_ITEMS = [
  { id: "overview", label: "Overview", icon: "dashboard" },
  { id: "ticketsales", label: "Ticket Sales", shortLabel: "Tickets", icon: "confirmation_number" },
  { id: "purchasetiming", label: "Purchase Timing", shortLabel: "Timing", icon: "calendar_view_month" },
  { id: "revenuegroups", label: "Revenue Groups", shortLabel: "Revenue", icon: "paid" },
  { id: "buyerpattern", label: "Buyer Pattern", shortLabel: "Pattern", icon: "polyline" },
  { id: "activitynetwork", label: "Activity Network", shortLabel: "Act Net", icon: "hub" },
  { id: "usernetwork", label: "User Network", shortLabel: "User Net", icon: "share" },
  { id: "retention", label: "Retention", icon: "calendar_month" },
  { id: "activitypath", label: "Activity Path", shortLabel: "Path", icon: "route" },
  { id: "introconversion", label: "Intro Conversion", shortLabel: "Intro", icon: "conversion_path" },
  { id: "gateway", label: "Gateway", shortLabel: "Gate", icon: "login" },
  { id: "pipeline", label: "Pipeline", shortLabel: "Pipe", icon: "filter_alt" },
  { id: "producthealth", label: "Product Health", shortLabel: "Health", icon: "monitor_heart" },
  { id: "activityexplorer", label: "Activity Explorer", shortLabel: "Explore", icon: "travel_explore" },
  { id: "segments", label: "Segments", shortLabel: "Seg", icon: "donut_large" },
  { id: "exitpoints", label: "Exit Points", shortLabel: "Exit", icon: "logout" },
  { id: "memberlength", label: "Subscription Duration", shortLabel: "Duration", icon: "linear_scale" },
  { id: "memberdistribution", label: "Subscription Tenure", shortLabel: "Tenure", icon: "workspace_premium" },
  { id: "memberengagement", label: "Subscription Engagement", shortLabel: "Engage", icon: "event_available" },
  { id: "activity", label: "Activity", icon: "timeline" },
  { id: "report", label: "July 2026 Report", shortLabel: "Report", icon: "article" },
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
  await restoreStoredCsv();
}

function draw() {
  if (hopModel) {
    chartToggleHits = [];
    const hopUi = drawHopOverview(hopModel, droppedFileName, currentView, NAV_ITEMS, {
      anonymizeNames,
      periodLabel: selectedPeriodLabel(),
      showSaveButton: csvSavePending,
      activityExplorerKey,
      activityExplorerDropdownOpen,
      activityExplorerDropdownOffset,
    });
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
    if (drawActivityPathSourceToggle(activityPathSource, currentView === "activitypath", csvSavePending)) toggleActivityPathSource();
    if (drawPurchaseTimingMembershipToggle(purchaseTimingExcludeMembership, currentView === "purchasetiming", csvSavePending)) togglePurchaseTimingMembership();
    drawPortalRangeControls();
    drawDateRangeSlider();
    drawStorageMessage();
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

async function restoreStoredCsv() {
  const stored = loadHopCsv();
  try {
    if (stored?.text) loadSalesCsvText(stored.text, stored.fileName || "Stored sales CSV", false);
    for (const source of await loadHopBookingCsvs()) {
      loadBookingCsvText(source.text, source.fileName || "Stored booking CSV", false);
    }
    rebuildHopDashboardModel();
    csvSavePending = false;
  } catch (error) {
    console.error(error);
    clearHopCsv();
    await clearHopBookingCsvs();
    statusMessage = "Stored CSV data could not be restored. Drop it again.";
  }
}

function drawStorageMessage() {
  if (!storageMessage || millis() > storageMessageUntil) return;
  fill(storageMessageIsError ? color(255, 145, 135) : color(150, 225, 175));
  noStroke();
  textSize(11);
  textAlign(LEFT, BOTTOM);
  text(storageMessage, 32, 106);
}

function showStorageMessage(message, isError = false, durationMs = 6000) {
  storageMessage = String(message || "");
  storageMessageIsError = !!isError;
  storageMessageUntil = millis() + durationMs;
}

function loadCsvText(text, fileName) {
  const parsed = parseCsvText(text);
  const csvType = detectHopCsvType(parsed.headers);
  if (csvType === "sales") {
    loadSalesCsvText(text, fileName, true, parsed);
    return;
  }
  if (csvType === "bookings") {
    loadBookingCsvText(text, fileName, true, parsed);
    return;
  }
  throw new Error("Unrecognized CSV. Expected HOP sales columns or Date, Start Time, Customer, Email, Class Type, and Booking Type.");
}

function detectHopCsvType(headers) {
  const keys = new Set((headers || []).map((header) => cleanValue(header).toLowerCase()));
  if (keys.has("invoice #") && keys.has("invoice date/time") && keys.has("total price")) return "sales";
  const bookingKeys = ["date", "start time", "customer", "email", "class type", "booking type"];
  if (bookingKeys.every((key) => keys.has(key))) return "bookings";
  return "unknown";
}

function loadSalesCsvText(text, fileName, rebuild = true, parsed = null) {
  sourceCsvText = String(text || "");
  const sales = parsed || parseCsvText(text);
  sourceRows = sales.rows;
  droppedFileName = fileName;
  fullTimelineCacheByBucket = new Map();
  if (rebuild) rebuildHopDashboardModel(true);
}

function loadBookingCsvText(text, fileName, rebuild = true, parsed = null) {
  const bookingCsv = parsed || parseCsvText(text);
  const datedRows = bookingCsv.rows.filter((row) => parseHopBookingDate(row.Date));
  if (!datedRows.length) throw new Error(`${fileName} has no valid booking dates`);
  const times = datedRows.map((row) => startOfDayMs(parseHopBookingDate(row.Date)));
  const source = {
    fileName,
    text: String(text || ""),
    rows: datedRows,
    startMs: Math.min(...times),
    endMs: Math.max(...times),
  };
  const exactSourceIndex = bookingCsvSources.findIndex((candidate) => candidate.text === source.text);
  if (exactSourceIndex >= 0) bookingCsvSources[exactSourceIndex] = source;
  else bookingCsvSources.push(source);
  mergeBookingCsvRows();
  if (rebuild) rebuildHopDashboardModel(true);
}

function mergeBookingCsvRows() {
  const byKey = new Map();
  let totalRows = 0;
  for (const source of bookingCsvSources) {
    for (const row of source.rows) {
      totalRows += 1;
      const key = rawHopBookingKey(row);
      if (!byKey.has(key)) byKey.set(key, row);
    }
  }
  sourceBookingRows = Array.from(byKey.values());
  bookingDuplicateCount = totalRows - sourceBookingRows.length;
}

function rawHopBookingKey(row) {
  return [
    normalizeIdentityEmail(row.Email) || normalizeIdentityName(row.Customer),
    startOfDayMs(parseHopBookingDate(row.Date)),
    cleanValue(row["Start Time"]),
    cleanValue(row["End Time"]),
    cleanValue(row.Room).toLowerCase(),
    cleanValue(row["Class Type"]).toLowerCase(),
  ].join("|");
}

function bookingSourceSummaries() {
  return bookingCsvSources.map((source) => ({
    fileName: source.fileName,
    startMs: source.startMs,
    endMs: source.endMs,
    rowCount: source.rows.length,
  })).sort((a, b) => a.startMs - b.startMs);
}

function rebuildHopDashboardModel(resetSelection = false) {
  if (!sourceRows.length) {
    hopModel = null;
    statusMessage = bookingCsvSources.length
      ? `${bookingCsvSources.length} booking CSV${bookingCsvSources.length === 1 ? "" : "s"} loaded. Drop the HOP sales CSV.`
      : "Drop HOP sales CSV and yearly booking CSVs onto the canvas";
    return;
  }
  fullTimelineCacheByBucket = new Map();
  const fullModel = buildHopModel(sourceRows, timeBucket, { bookingRows: sourceBookingRows });
  const allDates = [
    ...fullModel.invoices.map((invoice) => startOfDayMs(invoice.date)),
    ...sourceBookingRows.map((row) => startOfDayMs(parseHopBookingDate(row.Date))),
  ].filter(Boolean);
  fullStartMs = Math.min(...allDates);
  fullEndMs = Math.max(...allDates);
  const storedStart = resetSelection ? fullStartMs : Number(storedSliderState.selectedStartMs) || fullStartMs;
  const storedEnd = resetSelection ? fullEndMs : Number(storedSliderState.selectedEndMs) || fullEndMs;
  selectedStartMs = constrain(storedStart, fullStartMs, fullEndMs);
  selectedEndMs = constrain(storedEnd, fullStartMs, fullEndMs);
  if (selectedStartMs > selectedEndMs) selectedStartMs = selectedEndMs;
  syncPortalControlState();
  applyDateRange();
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
  const filteredBookingRows = sourceBookingRows.filter((row) => {
    const time = startOfDayMs(parseHopBookingDate(row.Date));
    return time >= selectedStartMs && time <= selectedEndMs;
  });
  hopModel = buildHopModel(filteredRows, timeBucket, {
    bookingRows: filteredBookingRows,
    historicalBookingRows: sourceBookingRows,
    bookingDuplicateCount,
    bookingSources: bookingSourceSummaries(),
    timelineActivity: fullTimeline.activity,
    ticketSalesTimeline: fullTimeline.ticketSalesTimeline,
    timelineRows: sourceRows,
    activityPathRows: sourceRows,
    retentionRows: sourceRows,
    membershipLengthRows: sourceRows,
    purchaseTimingRows: sourceRows,
    firstTouchpointRows: sourceRows,
    activityPathMode,
    activityPathSource,
    rangeStartMs: selectedStartMs,
    rangeEndMs: selectedEndMs,
  });
  hopModel.setAnonymizeNames(anonymizeNames);
  const explorerItems = hopModel.activityExplorer?.items || [];
  if (!explorerItems.some((item) => item.key === activityExplorerKey)) {
    activityExplorerKey = hopModel.activityExplorer?.defaultKey || explorerItems[0]?.key || "";
    activityExplorerDropdownOffset = 0;
  }
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
    activityPathSource,
    activityExplorerKey,
    revenueGroupsExcludeMembership,
    purchaseTimingExcludeMembership,
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
  if (["purchase", "subscription", "combined"].includes(storedSliderState.activityPathSource)) {
    activityPathSource = storedSliderState.activityPathSource;
  }
  if (typeof storedSliderState.activityExplorerKey === "string") {
    activityExplorerKey = storedSliderState.activityExplorerKey;
  }
  revenueGroupsExcludeMembership = !!storedSliderState.revenueGroupsExcludeMembership;
  purchaseTimingExcludeMembership = !!storedSliderState.purchaseTimingExcludeMembership;
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
  if (currentView === "activityexplorer") {
    const explorerHit = getActivityExplorerSelectorHit?.(mouseX, mouseY);
    if (explorerHit) {
      handleActivityExplorerSelectorHit(explorerHit);
      return false;
    }
    if (activityExplorerDropdownOpen) {
      activityExplorerDropdownOpen = false;
      return false;
    }
  }

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

function mouseWheel(event) {
  if (currentView !== "activityexplorer" || !activityExplorerDropdownOpen) return true;
  const itemCount = hopModel?.activityExplorer?.items?.length || 0;
  const visibleCount = getActivityExplorerDropdownVisibleCount?.() || 10;
  const direction = Math.sign(Number(event?.deltaY) || 0);
  activityExplorerDropdownOffset = constrain(activityExplorerDropdownOffset + direction * 3, 0, max(0, itemCount - visibleCount));
  return false;
}

function handleActivityExplorerSelectorHit(hit) {
  if (hit.kind === "toggle") {
    activityExplorerDropdownOpen = !activityExplorerDropdownOpen;
    if (activityExplorerDropdownOpen) {
      const items = hopModel?.activityExplorer?.items || [];
      const selectedIndex = items.findIndex((item) => item.key === activityExplorerKey);
      const visibleCount = getActivityExplorerDropdownVisibleCount?.() || 10;
      if (selectedIndex >= 0 && (selectedIndex < activityExplorerDropdownOffset || selectedIndex >= activityExplorerDropdownOffset + visibleCount)) {
        activityExplorerDropdownOffset = constrain(selectedIndex - floor(visibleCount / 2), 0, max(0, items.length - visibleCount));
      }
    }
    return;
  }
  if (hit.kind === "scroll") {
    const itemCount = hopModel?.activityExplorer?.items?.length || 0;
    const visibleCount = getActivityExplorerDropdownVisibleCount?.() || 10;
    activityExplorerDropdownOffset = constrain(activityExplorerDropdownOffset + hit.direction * visibleCount, 0, max(0, itemCount - visibleCount));
    return;
  }
  if (hit.kind !== "option") return;
  activityExplorerKey = hit.key;
  activityExplorerDropdownOpen = false;
  saveSliderState();
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
  void clearHopBookingCsvs();
  hopModel = null;
  sourceRows = [];
  sourceCsvText = "";
  bookingCsvSources = [];
  sourceBookingRows = [];
  bookingDuplicateCount = 0;
  activityExplorerKey = "";
  activityExplorerDropdownOpen = false;
  activityExplorerDropdownOffset = 0;
  csvSavePending = false;
  fullTimelineCacheByBucket = new Map();
  droppedFileName = "";
  statusMessage = "Drop HOP sales CSV and yearly booking CSVs onto the canvas";
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

async function saveCurrentCsvToBrowser() {
  if (csvSaveInProgress) return;
  if (!sourceCsvText) {
    statusMessage = "Drop HOP sales CSV before saving";
    return;
  }
  csvSaveInProgress = true;
  try {
    saveHopCsv(sourceCsvText, droppedFileName || "CSV");
    await saveHopBookingCsvs(bookingCsvSources);
    csvSavePending = false;
    showStorageMessage(`Saved sales and ${bookingCsvSources.length} booking CSV${bookingCsvSources.length === 1 ? "" : "s"}`);
  } catch (error) {
    console.error("[hopdashboard] Could not save dashboard CSV data", error);
    csvSavePending = true;
    showStorageMessage(`Could not save dashboard data: ${error?.message || error}`, true, 12000);
  } finally {
    csvSaveInProgress = false;
  }
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

function toggleActivityPathSource() {
  activityPathSource = activityPathSource === "purchase"
    ? "subscription"
    : activityPathSource === "subscription" ? "combined" : "purchase";
  saveSliderState();
  applyDateRange();
}

function togglePurchaseTimingMembership() {
  purchaseTimingExcludeMembership = !purchaseTimingExcludeMembership;
  saveSliderState();
}

function setCurrentView(view) {
  if (!view || view === currentView) return;
  if (view === "report") {
    window.location.href = "report.html";
    return;
  }
  activityExplorerDropdownOpen = false;
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

  const pathSource = params.get("pathSource");
  if (["purchase", "subscription", "combined"].includes(pathSource)) sliders.activityPathSource = pathSource;

  const explore = params.get("explore");
  if (explore) sliders.activityExplorerKey = explore;

  const revenueNoMembership = parseUrlBoolean(params.get("revenueNoMembership"));
  if (revenueNoMembership !== null) sliders.revenueGroupsExcludeMembership = revenueNoMembership;

  const purchaseNoMembership = parseUrlBoolean(params.get("purchaseNoMembership"));
  if (purchaseNoMembership !== null) sliders.purchaseTimingExcludeMembership = purchaseNoMembership;

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
  url.searchParams.set("purchaseNoMembership", purchaseTimingExcludeMembership ? "1" : "0");
  url.searchParams.set("pathMode", activityPathMode);
  url.searchParams.set("pathSource", activityPathSource);
  if (activityExplorerKey) url.searchParams.set("explore", activityExplorerKey);
  else url.searchParams.delete("explore");
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
