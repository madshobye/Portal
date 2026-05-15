let hopModel = null;
let sourceRows = [];
let droppedFileName = "";
let statusMessage = "Drop HOP sales CSV onto the canvas";
let currentView = "testview";
let dateStartSlider = null;
let dateEndSlider = null;
let fullStartMs = 0;
let fullEndMs = 0;
let selectedStartMs = 0;
let selectedEndMs = 0;
let timeBucket = "week";
let chartToggleHits = [];
const hiddenSeriesKeys = new Set();
const hiddenBlobTypes = new Set();
const DAY_MS = 24 * 60 * 60 * 1000;

const NAV_ITEMS = [
  { id: "testview", label: "Test View" },
  { id: "overview", label: "Overview" },
  { id: "ticketsales", label: "Ticket Sales" },
  { id: "activity", label: "Activity" },
];

function setup() {
  const canvas = createCanvas(windowWidth, windowHeight);
  pixelDensity(1);
  frameRate(60);
  canvas.drop(handleCsvDrop);
  restoreStoredView();
  restoreStoredCsv();
}

function draw() {
  if (hopModel) {
    chartToggleHits = [];
    drawHopOverview(hopModel, droppedFileName, currentView, NAV_ITEMS);
    drawTimeBucketToggle(timeBucket);
    drawDateRangeLabels();
    positionDateSliders();
  } else {
    hideDateSliders();
    drawCenteredMessage(statusMessage);
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  positionDateSliders();
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
  selectedStartMs = fullStartMs;
  selectedEndMs = fullEndMs;
  createDateSliders();
  applyDateRange();
  droppedFileName = fileName;
  statusMessage = "";
}

function createDateSliders() {
  if (!dateStartSlider) {
    dateStartSlider = createSlider(0, 1, 0, DAY_MS);
    dateStartSlider.input(handleStartDateSliderInput);
  }
  if (!dateEndSlider) {
    dateEndSlider = createSlider(0, 1, 1, DAY_MS);
    dateEndSlider.input(handleEndDateSliderInput);
  }
  dateStartSlider.attribute("min", fullStartMs);
  dateStartSlider.attribute("max", fullEndMs);
  dateStartSlider.attribute("step", DAY_MS);
  dateStartSlider.value(selectedStartMs);
  dateEndSlider.attribute("min", fullStartMs);
  dateEndSlider.attribute("max", fullEndMs);
  dateEndSlider.attribute("step", DAY_MS);
  dateEndSlider.value(selectedEndMs);
  positionDateSliders();
}

function positionDateSliders() {
  if (!dateStartSlider || !dateEndSlider) return;
  const sliderW = min(220, max(120, width * 0.18));
  const startX = width - 300 - sliderW * 2;
  dateStartSlider.position(startX, 26);
  dateEndSlider.position(startX + sliderW + 18, 26);
  dateStartSlider.size(sliderW);
  dateEndSlider.size(sliderW);
  dateStartSlider.show();
  dateEndSlider.show();
}

function hideDateSliders() {
  dateStartSlider?.hide();
  dateEndSlider?.hide();
}

function handleStartDateSliderInput() {
  selectedStartMs = Number(dateStartSlider.value());
  selectedEndMs = Number(dateEndSlider.value());
  if (selectedStartMs > selectedEndMs) {
    selectedEndMs = selectedStartMs;
    dateStartSlider.value(selectedStartMs);
    dateEndSlider.value(selectedEndMs);
  }
  applyDateRange();
}

function handleEndDateSliderInput() {
  selectedStartMs = Number(dateStartSlider.value());
  selectedEndMs = Number(dateEndSlider.value());
  if (selectedEndMs < selectedStartMs) {
    selectedStartMs = selectedEndMs;
    dateStartSlider.value(selectedStartMs);
    dateEndSlider.value(selectedEndMs);
  }
  applyDateRange();
}

function applyDateRange() {
  const filteredRows = sourceRows.filter((row) => {
    const date = parseHopDate(row["Invoice date/time"]);
    const time = startOfDayMs(date);
    return time >= selectedStartMs && time <= selectedEndMs;
  });
  hopModel = buildHopModel(filteredRows, timeBucket);
}

function drawDateRangeLabels() {
  fill(40);
  noStroke();
  textSize(11);
  textAlign(LEFT, CENTER);
  const sliderW = min(220, max(120, width * 0.18));
  const startX = width - 300 - sliderW * 2;
  text(formatDate(new Date(selectedStartMs)), startX, 18);
  text(formatDate(new Date(selectedEndMs)), startX + sliderW + 18, 18);
}

function startOfDayMs(date) {
  if (!(date instanceof Date)) return 0;
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
}

function mousePressed() {
  if (hopModel && isClearDataHit(mouseX, mouseY)) {
    clearHopCsv();
    hopModel = null;
    sourceRows = [];
    droppedFileName = "";
    statusMessage = "Drop HOP sales CSV onto the canvas";
    hideDateSliders();
    return false;
  }

  const bucketHit = getTimeBucketHit(mouseX, mouseY);
  if (bucketHit) {
    timeBucket = nextTimeBucket(timeBucket);
    applyDateRange();
    return false;
  }

  const chartToggle = getChartToggleHit(mouseX, mouseY);
  if (chartToggle) {
    toggleChartVisibility(chartToggle);
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

function getChartToggleHit(x, y) {
  return chartToggleHits.find((hit) => x >= hit.x && x <= hit.x + hit.w && y >= hit.y && y <= hit.y + hit.h);
}

function toggleChartVisibility(hit) {
  const set = hit.kind === "blobType" ? hiddenBlobTypes : hiddenSeriesKeys;
  if (set.has(hit.key)) set.delete(hit.key);
  else set.add(hit.key);
}

function getTimeBucketHit(x, y) {
  const item = getTimeBucketButton();
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
  const storedView = savedView === "memberships" ? "activity" : savedView;
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
