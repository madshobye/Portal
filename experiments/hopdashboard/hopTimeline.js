let timelineLegendHoverKey = "";
let timelineLegendHoverStartedAt = 0;
const TIMELINE_LEGEND_INFO_DELAY_MS = 1500;

function drawHopTimelineChart(x, y, w, h, points, title, series, labels = [], state = {}) {
  const timelinePoints = addSyntheticPreviousTimelinePoint(points, state);
  points = filterTimelinePointsForState(timelinePoints, state);
  const hiddenSeries = state.hiddenSeriesKeys || new Set();
  const hiddenLabels = state.hiddenLabelTypes || new Set();
  const toggleHits = state.toggleHits || [];

  fill(238);
  noStroke();
  rect(x, y, w, h, 4);
  fill(30);
  textSize(18);
  textAlign(LEFT, TOP);
  text(title, x + 18, y + 16);
  if (state.infoKey && typeof drawViewInfoIcon === "function") {
    drawViewInfoIcon(x + 18 + textWidth(title) + 14, y + 26, state.infoKey);
  }

  const legend = drawTimelineLegend(x + 18, y + 42, w - 36, series, labels, hiddenSeries, hiddenLabels, toggleHits);
  const visibleSeries = series.filter((item) => !hiddenSeries.has(item.key));
  const visibleScaleKeys = [...new Set(visibleSeries.map((item) => item.scale || item.key))];
  const hasDualAxis = visibleScaleKeys.includes("money") && visibleScaleKeys.includes("count");
  const leftScaleKey = visibleScaleKeys.includes("money") ? "money" : visibleScaleKeys[0];
  const rightScaleKey = hasDualAxis ? "count" : "";
  const leftAxisW = visibleScaleKeys.length ? 58 : 0;
  const rightAxisW = rightScaleKey ? 44 : 0;
  const plotX = x + 18 + leftAxisW;
  const plotY = max(y + 72, legend.bottom + 14);
  const plotW = w - 36 - leftAxisW - rightAxisW;
  const plotH = max(80, h - (plotY - y) - 70);
  const maxByScale = {};
  for (const item of visibleSeries) {
    const scaleKey = item.scale || item.key;
    maxByScale[scaleKey] = Math.max(maxByScale[scaleKey] || 1, ...points.map((point) => abs(point[item.key] || 0)));
  }
  for (const scaleKey of Object.keys(maxByScale)) {
    maxByScale[scaleKey] *= 1.08;
  }

  drawTimelineYAxis(plotX, plotY, plotW, plotH, leftScaleKey, maxByScale[leftScaleKey] || 1, false);
  if (rightScaleKey) drawTimelineYAxis(plotX, plotY, plotW, plotH, rightScaleKey, maxByScale[rightScaleKey] || 1, true);

  stroke(210);
  strokeWeight(1);
  line(plotX, plotY + plotH, plotX + plotW, plotY + plotH);

  drawingContext.save();
  drawingContext.beginPath();
  drawingContext.rect(plotX, plotY, plotW, plotH);
  drawingContext.clip();
  for (const item of visibleSeries) {
    const linePoints = lineTimelinePointsForState(timelinePoints, state);
    noFill();
    const alpha = legend.hoveredSeriesKey && legend.hoveredSeriesKey !== item.key ? 35 : 255;
    stroke(item.color[0], item.color[1], item.color[2], alpha);
    strokeWeight(legend.hoveredSeriesKey === item.key ? 3.5 : 2.5);
    drawTimelineSeriesLine(linePoints, item, plotX, plotW, plotY, plotH, maxByScale[item.scale || item.key] || 1, state);
  }
  drawingContext.restore();

  const labelHovered = drawTimelineLabels(plotX, plotY, plotW, plotH, points, labels, hiddenLabels, toggleHits, state);

  const hoverIndex = getTimelineNearestTimelineIndex(mouseX, plotX, plotW, points, state);
  if (!labelHovered && hoverIndex >= 0 && mouseY >= plotY - 24 && mouseY <= plotY + plotH + 24) {
    const point = points[hoverIndex];
    const px = timelinePointXForState(plotX, plotW, points, hoverIndex, state);
    stroke(90);
    strokeWeight(1);
    line(px, plotY, px, plotY + plotH);
    const lines = [point.month];
    for (const item of visibleSeries) {
      lines.push(`${item.label}: ${item.formatter(point[item.key] || 0)}`);
    }
    drawTooltip(mouseX, mouseY, lines);
  }

  fill(35);
  noStroke();
  textSize(12);
  const axisPeriods = timelineBandPeriods(points, state);
  textAlign(LEFT, BOTTOM);
  text(axisPeriods[0]?.month || points[0]?.month || "", plotX, y + h - 40);
  textAlign(RIGHT, BOTTOM);
  text(axisPeriods.at(-1)?.month || points.at(-1)?.month || "", plotX + plotW, y + h - 40);
  drawTimelineSeasonBand(plotX, y + h - 30, plotW, points, state);
  drawDelayedTimelineLegendInfo(legend.hoveredEntry);
}

function drawTimelineYAxis(plotX, plotY, plotW, plotH, scaleKey, maxValue, rightSide) {
  if (!scaleKey) return;
  const ticks = 4;
  const axisX = rightSide ? plotX + plotW : plotX;
  stroke(150);
  strokeWeight(1);
  line(axisX, plotY, axisX, plotY + plotH);
  textSize(10);
  textAlign(rightSide ? LEFT : RIGHT, CENTER);
  fill(65);

  for (let index = 0; index <= ticks; index += 1) {
    const value = (maxValue / ticks) * index;
    const y = plotY + plotH - (index / ticks) * plotH;
    stroke(index === 0 ? 190 : 220, index === 0 ? 180 : 110);
    strokeWeight(1);
    if (!rightSide) line(plotX, y, plotX + plotW, y);
    stroke(150);
    line(axisX + (rightSide ? 0 : -4), y, axisX + (rightSide ? 4 : 0), y);
    noStroke();
    text(formatTimelineAxisValue(value, scaleKey), axisX + (rightSide ? 8 : -8), y);
  }
}

function formatTimelineAxisValue(value, scaleKey) {
  if (scaleKey === "money") return formatCompactMoney(value);
  if (scaleKey === "count") return formatCompactCount(value);
  return formatCompactCount(value);
}

function formatCompactMoney(value) {
  const amount = Math.round(value);
  if (Math.abs(amount) >= 1000000) return `${(amount / 1000000).toFixed(1)}m`;
  if (Math.abs(amount) >= 1000) return `${Math.round(amount / 1000)}k`;
  return String(amount);
}

function formatCompactCount(value) {
  const amount = Math.round(value);
  if (Math.abs(amount) >= 1000) return `${(amount / 1000).toFixed(1)}k`;
  return String(amount);
}

function getTimelineNearestPointIndex(mx, plotX, plotW, count) {
  if (!count || mx < plotX - 16 || mx > plotX + plotW + 16) return -1;
  if (count === 1) return 0;
  return constrain(round(((mx - plotX) / plotW) * (count - 1)), 0, count - 1);
}

function getTimelineNearestPeriodEndIndex(mx, plotX, plotW, count) {
  if (!count || mx < plotX - 16 || mx > plotX + plotW + 16) return -1;
  if (count === 1) return 0;
  return constrain(round(((mx - plotX) / plotW) * count - 1), 0, count - 1);
}

function getTimelineNearestTimelineIndex(mx, plotX, plotW, points, state) {
  if (!points.length || mx < plotX - 16 || mx > plotX + plotW + 16) return -1;
  let bestIndex = 0;
  let bestDistance = Infinity;
  points.forEach((point, index) => {
    const px = timelinePointXForState(plotX, plotW, points, index, state);
    const distance = abs(mx - px);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function filterTimelinePointsForState(points, state) {
  if (!state?.rangeStartMs || !state?.rangeEndMs || state.rangeEndMs <= state.rangeStartMs) return points;
  return points.filter((point) => {
    const startMs = timelinePeriodStartMs(point.month);
    const endMs = timelinePeriodEndMs(point.month);
    return endMs >= state.rangeStartMs && startMs <= state.rangeEndMs;
  });
}

function addSyntheticPreviousTimelinePoint(points, state) {
  if (!points.length) return points;
  const bucket = state?.timeBucket || "week";
  const firstStart = dateFromTimelinePeriodKey(points[0].month);
  const previousStart = timelinePreviousBucketStart(firstStart, bucket);
  const previousKey = timelineBucketKey(previousStart, bucket);
  if (previousKey === points[0].month) return points;
  return [{ month: previousKey, synthetic: true }, ...points];
}

function lineTimelinePointsForState(points, state) {
  if (!state?.rangeStartMs || !state?.rangeEndMs || state.rangeEndMs <= state.rangeStartMs) return points;
  const visible = [];
  let before = null;
  let after = null;
  for (const point of points) {
    const startMs = timelinePeriodStartMs(point.month);
    const endMs = timelinePeriodEndMs(point.month);
    if (endMs < state.rangeStartMs) before = point;
    else if (startMs > state.rangeEndMs) {
      after = point;
      break;
    } else {
      visible.push(point);
    }
  }
  return [
    ...(before ? [before] : []),
    ...visible,
    ...(after ? [after] : []),
  ];
}

function drawTimelineSeriesLine(points, item, plotX, plotW, plotY, plotH, maxValue, state) {
  if (state.smoothTimelineCurves) {
    drawTimelineSeriesCurve(points, item, plotX, plotW, plotY, plotH, maxValue, state);
    return;
  }
  const linePoints = timelineSeriesCurvePoints(points, item, plotX, plotW, plotY, plotH, maxValue, state);
  beginShape();
  for (const point of linePoints) {
    vertex(point.x, point.y);
  }
  endShape();
}

function drawTimelineSeriesCurve(points, item, plotX, plotW, plotY, plotH, maxValue, state) {
  const curvePoints = timelineSeriesCurvePoints(points, item, plotX, plotW, plotY, plotH, maxValue, state);
  if (!curvePoints.length) return;
  if (curvePoints.length === 1) {
    point(curvePoints[0].x, curvePoints[0].y);
    return;
  }
  drawingContext.beginPath();
  drawingContext.moveTo(curvePoints[0].x, curvePoints[0].y);
  for (let index = 0; index < curvePoints.length - 1; index += 1) {
    const p0 = curvePoints[Math.max(0, index - 1)];
    const p1 = curvePoints[index];
    const p2 = curvePoints[index + 1];
    const p3 = curvePoints[Math.min(curvePoints.length - 1, index + 2)];
    drawingContext.bezierCurveTo(
      p1.x + (p2.x - p0.x) / 6,
      p1.y + (p2.y - p0.y) / 6,
      p2.x - (p3.x - p1.x) / 6,
      p2.y - (p3.y - p1.y) / 6,
      p2.x,
      p2.y
    );
  }
  drawingContext.stroke();
}

function timelineSeriesCurvePoints(points, item, plotX, plotW, plotY, plotH, maxValue, state) {
  const result = [];
  let previousYear = "";
  points.forEach((point, index) => {
    const year = String(point.month || "").slice(0, 4);
    if (item.key === "yearTotalRevenue" && index > 0 && year && previousYear && year !== previousYear) {
      const resetX = timelineMsToX(plotX, plotW, timelinePeriodStartMs(point.month), state, false);
      result.push({ x: resetX, y: plotY + plotH });
    }
    const px = timelinePointXForPoint(plotX, plotW, point, state, false);
    const py = plotY + plotH - ((point[item.key] || 0) / maxValue) * plotH;
    result.push({ x: px, y: py });
    if (year) previousYear = year;
  });
  return result;
}

function timelinePeriodSlot(plotX, plotW, count, index) {
  if (count <= 1) return { x0: plotX, x1: plotX + plotW };
  const slotW = plotW / count;
  return {
    x0: plotX + index * slotW,
    x1: plotX + (index + 1) * slotW,
  };
}

function timelinePeriodCenterX(plotX, plotW, count, index) {
  const slot = timelinePeriodSlot(plotX, plotW, count, index);
  return (slot.x0 + slot.x1) * 0.5;
}

function timelinePeriodEndX(plotX, plotW, count, index) {
  return timelinePeriodSlot(plotX, plotW, count, index).x1;
}

function timelinePointX(plotX, plotW, count, index) {
  if (count <= 1) return plotX;
  return plotX + (index / (count - 1)) * plotW;
}

function timelinePointXForState(plotX, plotW, points, index, state) {
  return timelinePointXForPoint(plotX, plotW, points[index], state, true);
}

function timelinePointXForPoint(plotX, plotW, point, state, clampToRange = true) {
  const endMs = timelinePeriodEndMs(point?.month);
  return timelineMsToX(plotX, plotW, endMs, state, clampToRange);
}

function drawTimelineSeasonBand(x, y, w, points, state = {}) {
  if (!points.length && !state?.rangeStartMs) return;
  const bandPeriods = timelineBandPeriods(points, state);
  const bandH = 8;
  const labelY = y + 14;
  noStroke();
  for (let index = 0; index < bandPeriods.length; index += 1) {
    const period = bandPeriods[index];
    const date = dateFromTimelinePeriodKey(period.month);
    const x0 = timelineMsToX(x, w, timelinePeriodStartMs(period.month), state, true);
    const x1 = timelineMsToX(x, w, timelinePeriodEndMs(period.month), state, true);
    const cx = (x0 + x1) * 0.5;
    drawTimelinePeriodSeasonSegments(x0, x1, y, bandH, date, period.month);

    if (isTimelineMonthStart(bandPeriods, index, date)) {
      fill(20);
      textSize(9);
      textAlign(CENTER, TOP);
      text(timelineMonthInitial(date.getMonth()), cx, labelY);
    }
    if (isTimelineYearStart(bandPeriods, index, date, state)) {
      stroke(20, 170);
      strokeWeight(1);
      line(x0, y - 4, x0, y + bandH + 12);
      noStroke();
      fill(20);
      textSize(9);
      textAlign(LEFT, TOP);
      text(timelineYearLabel(period.month, date, state), x0 + 3, y - 16);
    }
  }
}

function timelineBandPeriods(points, state) {
  if (!state?.rangeStartMs || !state?.rangeEndMs || state.rangeEndMs <= state.rangeStartMs || !points.length) return points;
  const bucket = state.timeBucket || "week";
  const periods = [];
  let cursor = timelineBucketStartDate(new Date(state.rangeStartMs), bucket);
  const endMs = state.rangeEndMs;
  while (cursor.getTime() <= endMs) {
    periods.push({ month: timelineBucketKey(cursor, bucket) });
    cursor = timelineNextBucketStart(cursor, bucket);
  }
  return periods;
}

function timelineMsToX(plotX, plotW, ms, state, clampToRange = true) {
  if (!state?.rangeStartMs || !state?.rangeEndMs || state.rangeEndMs <= state.rangeStartMs) return plotX;
  const xMs = clampToRange ? constrain(ms, state.rangeStartMs, state.rangeEndMs) : ms;
  return plotX + ((xMs - state.rangeStartMs) / (state.rangeEndMs - state.rangeStartMs)) * plotW;
}

function timelineBucketStartDate(date, bucket) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (bucket === "week") return startOfTimelineWeek(result);
  if (bucket === "month") return new Date(result.getFullYear(), result.getMonth(), 1);
  if (bucket === "quarter") return new Date(result.getFullYear(), floor(result.getMonth() / 3) * 3, 1);
  if (bucket === "halfyear") return new Date(result.getFullYear(), result.getMonth() < 6 ? 0 : 6, 1);
  if (bucket === "year") return new Date(result.getFullYear(), 0, 1);
  return result;
}

function timelineNextBucketStart(date, bucket) {
  const result = new Date(date);
  if (bucket === "week") result.setDate(result.getDate() + 7);
  else if (bucket === "month") result.setMonth(result.getMonth() + 1);
  else if (bucket === "quarter") result.setMonth(result.getMonth() + 3);
  else if (bucket === "halfyear") result.setMonth(result.getMonth() + 6);
  else if (bucket === "year") result.setFullYear(result.getFullYear() + 1);
  else result.setDate(result.getDate() + 1);
  return result;
}

function timelinePreviousBucketStart(date, bucket) {
  const result = new Date(date);
  if (bucket === "week") result.setDate(result.getDate() - 7);
  else if (bucket === "month") result.setMonth(result.getMonth() - 1);
  else if (bucket === "quarter") result.setMonth(result.getMonth() - 3);
  else if (bucket === "halfyear") result.setMonth(result.getMonth() - 6);
  else if (bucket === "year") result.setFullYear(result.getFullYear() - 1);
  else result.setDate(result.getDate() - 1);
  return result;
}

function timelineBucketKey(date, bucket) {
  const year = date.getFullYear();
  if (bucket === "week") {
    const iso = timelineIsoWeekInfo(date);
    return `${iso.year}-W${String(iso.week).padStart(2, "0")}`;
  }
  if (bucket === "month") return `${year}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  if (bucket === "quarter") return `${year}-Q${floor(date.getMonth() / 3) + 1}`;
  if (bucket === "halfyear") return `${year}-H${date.getMonth() < 6 ? 1 : 2}`;
  if (bucket === "year") return String(year);
  return `${year}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function startOfTimelineWeek(date) {
  const result = new Date(date);
  const day = result.getDay() || 7;
  result.setDate(result.getDate() - day + 1);
  return result;
}

function timelineIsoWeekNumber(date) {
  return timelineIsoWeekInfo(date).week;
}

function timelineIsoWeekInfo(date) {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return {
    year: target.getUTCFullYear(),
    week: ceil((((target - yearStart) / 86400000) + 1) / 7),
  };
}

function drawTimelinePeriodSeasonSegments(x0, x1, y, h, date, key) {
  const months = timelinePeriodMonthCount(key);
  for (let offset = 0; offset < months; offset += 1) {
    const monthIndex = (date.getMonth() + offset) % 12;
    const sx0 = lerp(x0, x1, offset / months);
    const sx1 = lerp(x0, x1, (offset + 1) / months);
    fill(...timelineSeasonColor(monthIndex));
    noStroke();
    rect(sx0, y, Math.max(1, sx1 - sx0), h);
  }
}

function timelinePeriodMonthCount(key) {
  const text = String(key || "");
  if (/^\d{4}$/.test(text)) return 12;
  if (/^\d{4}-H[12]$/.test(text)) return 6;
  if (/^\d{4}-Q\d$/.test(text)) return 3;
  return 1;
}

function isTimelineMonthStart(points, index, date) {
  if (index === 0) return true;
  const prev = dateFromTimelinePeriodKey(points[index - 1].month);
  return prev.getMonth() !== date.getMonth() || prev.getFullYear() !== date.getFullYear();
}

function isTimelineYearStart(points, index, date, state = {}) {
  if (index === 0) return false;
  if (state.timeBucket === "week") {
    return timelineWeekYear(points[index - 1].month) !== timelineWeekYear(points[index].month);
  }
  return date.getMonth() === 0 && isTimelineMonthStart(points, index, date);
}

function timelineWeekYear(key) {
  const match = String(key || "").match(/^(\d{4})-W\d{2}$/);
  return match ? match[1] : "";
}

function timelineYearLabel(key, date, state = {}) {
  if (state.timeBucket === "week") return timelineWeekYear(key) || String(date.getFullYear());
  return String(date.getFullYear());
}

function dateFromTimelinePeriodKey(key) {
  const text = String(key || "");
  const weekMatch = text.match(/^(\d{4})-W(\d{2})$/);
  if (weekMatch) return dateFromTimelineIsoWeek(Number(weekMatch[1]), Number(weekMatch[2]));
  const monthMatch = text.match(/^(\d{4})-(\d{2})$/);
  if (monthMatch) return new Date(Number(monthMatch[1]), Number(monthMatch[2]) - 1, 1);
  const quarterMatch = text.match(/^(\d{4})-Q(\d)$/);
  if (quarterMatch) return new Date(Number(quarterMatch[1]), (Number(quarterMatch[2]) - 1) * 3, 1);
  const halfyearMatch = text.match(/^(\d{4})-H([12])$/);
  if (halfyearMatch) return new Date(Number(halfyearMatch[1]), (Number(halfyearMatch[2]) - 1) * 6, 1);
  const yearMatch = text.match(/^(\d{4})$/);
  if (yearMatch) return new Date(Number(yearMatch[1]), 0, 1);
  return new Date();
}

function timelinePeriodEndMs(key) {
  const start = dateFromTimelinePeriodKey(key);
  const text = String(key || "");
  const end = new Date(start);
  if (/^\d{4}-W\d{2}$/.test(text)) end.setDate(end.getDate() + 6);
  else end.setMonth(end.getMonth() + timelinePeriodMonthCount(text), 0);
  return end.getTime();
}

function timelinePeriodStartMs(key) {
  return dateFromTimelinePeriodKey(key).getTime();
}

function dateFromTimelineIsoWeek(year, week) {
  const date = new Date(year, 0, 4 + (week - 1) * 7);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return date;
}

function timelineSeasonColor(monthIndex) {
  if (monthIndex >= 2 && monthIndex <= 4) return [123, 201, 111];
  if (monthIndex >= 5 && monthIndex <= 7) return [242, 201, 76];
  if (monthIndex >= 8 && monthIndex <= 10) return [217, 130, 43];
  return [93, 173, 236];
}

function timelineMonthInitial(monthIndex) {
  return "JFMAMJJASOND"[monthIndex] || "";
}

function drawTimelineLabels(plotX, plotY, plotW, plotH, points, labels, hiddenLabels, toggleHits, state = {}) {
  if (!labels.length || !points.length) return false;
  const periodIndex = new Map(points.map((point, index) => [point.month, index]));
  const visibleLabels = labels.filter((label) => periodIndex.has(label.period) && label.value > 0 && !hiddenLabels.has(label.type));
  const maxValue = Math.max(1, ...visibleLabels.map((label) => label.value));
  const laneByLabel = buildTimelineLabelLanes(visibleLabels);

  let hoveredLabel = null;
  for (const label of visibleLabels) {
    const index = periodIndex.get(label.period);
    const px = timelinePointXForState(plotX, plotW, points, index, state);
    const lane = laneByLabel.get(label.label) ?? 0.5;
    const py = plotY + 18 + lane * Math.max(1, plotH - 36);
    const radius = map(sqrt(label.value), 0, sqrt(maxValue), 8, 34);
    const color = label.color || (label.type === "Event" ? [135, 85, 170] : [60, 140, 85]);
    const focusedType = getHoveredTimelineLabelType(toggleHits, hiddenLabels);
    const dimmedByLegend = focusedType && focusedType !== label.type;
    const distance = dist(mouseX, mouseY, px, py);
    const hovered = distance <= radius * 0.65;

    fill(color[0], color[1], color[2], dimmedByLegend ? 12 : hovered || focusedType === label.type ? 90 : 42);
    noStroke();
    circle(px, py, radius);

    if (hovered && (!hoveredLabel || distance < hoveredLabel.distance)) {
      hoveredLabel = { label, px, py, radius, color, distance };
    }
  }

  if (hoveredLabel) {
    fill(hoveredLabel.color[0], hoveredLabel.color[1], hoveredLabel.color[2], 120);
    noStroke();
    circle(hoveredLabel.px, hoveredLabel.py, hoveredLabel.radius);
    drawTooltip(mouseX, mouseY, [
      ...wrapTimelineText(`${hoveredLabel.label.type}: ${hoveredLabel.label.label}`, 28),
      `${hoveredLabel.label.periodLabel || "Period"}: ${hoveredLabel.label.period}`,
      `${hoveredLabel.label.valueLabel || "Value"}: ${timelineFormatValue(hoveredLabel.label.value, hoveredLabel.label.valueFormatter)}`,
      `${hoveredLabel.label.countLabel || "Count"}: ${timelineFormatValue(hoveredLabel.label.count || 0, hoveredLabel.label.countFormatter)}`,
    ], 200);
    return true;
  }
  return false;
}

function timelineFormatValue(value, formatter) {
  return typeof formatter === "function" ? formatter(value) : String(value);
}

function drawTimelineLegend(x, y, w, series, labels, hiddenSeries, hiddenLabels, toggleHits) {
  const labelTypes = [...new Map(labels.map((label) => [label.type, label])).values()];
  const entries = [
    ...series.map((item) => ({ kind: "series", key: item.key, text: item.label, color: item.color })),
    ...labelTypes.map((label) => ({
      kind: "labelType",
      key: label.type,
      text: label.legendLabel || `${label.type}s`,
      color: label.color || (label.type === "Event" ? [135, 85, 170] : [60, 140, 85]),
    })),
  ];
  let cursorX = x;
  let cursorY = y;
  let hoveredSeriesKey = "";
  let hoveredLabelType = "";
  let hoveredEntry = null;
  const rowH = 24;

  textSize(12);
  textAlign(LEFT, CENTER);
  for (const entry of entries) {
    const labelW = textWidth(entry.text);
    const itemW = labelW + 54;
    if (cursorX > x && cursorX + itemW > x + w) {
      cursorX = x;
      cursorY += rowH;
    }

    const hit = { kind: entry.kind, key: entry.key, x: cursorX - 2, y: cursorY - 12, w: itemW - 12, h: 24 };
    const hovered = mouseX >= hit.x && mouseX <= hit.x + hit.w && mouseY >= hit.y && mouseY <= hit.y + hit.h;
    toggleHits.push(hit);
    if (hovered) hoveredEntry = { ...entry, hit };

    if (entry.kind === "series") {
      const hidden = hiddenSeries.has(entry.key);
      if (hovered) hoveredSeriesKey = entry.key;
      fill(entry.color[0], entry.color[1], entry.color[2], hidden ? 55 : 255);
      noStroke();
      rect(cursorX, cursorY, 16, 3, 1);
      fill(hidden ? 150 : hovered ? 15 : 55);
      text(entry.text, cursorX + 22, cursorY + 1);
    } else {
      const hidden = hiddenLabels.has(entry.key);
      if (hovered && !hidden) hoveredLabelType = entry.key;
      fill(entry.color[0], entry.color[1], entry.color[2], hidden || (hoveredLabelType && hoveredLabelType !== entry.key) ? 20 : hovered ? 120 : 70);
      noStroke();
      circle(cursorX + 6, cursorY + 1, 12);
      fill(hidden ? 150 : hovered ? 15 : 55);
      text(entry.text, cursorX + 18, cursorY + 1);
    }

    cursorX += itemW;
  }

  return { hoveredSeriesKey, hoveredEntry, bottom: cursorY + 12 };
}

function drawDelayedTimelineLegendInfo(entry) {
  if (!entry) {
    timelineLegendHoverKey = "";
    timelineLegendHoverStartedAt = 0;
    return;
  }
  const key = `${entry.kind}:${entry.key}`;
  if (timelineLegendHoverKey !== key) {
    timelineLegendHoverKey = key;
    timelineLegendHoverStartedAt = millis();
    return;
  }
  if (millis() - timelineLegendHoverStartedAt < TIMELINE_LEGEND_INFO_DELAY_MS) return;
  const description = timelineLegendDescription(entry);
  if (!description) return;
  drawTooltip(mouseX, mouseY, [
    entry.text,
    ...wrapTimelineText(description, 42),
  ], 300);
}

function timelineLegendDescription(entry) {
  const byKey = {
    totalRevenue: "All net revenue in the selected period, after VAT has been removed and discounts have been netted by transaction.",
    yearTotalRevenue: "Running accumulated net revenue within each calendar year. It resets when the visible year changes.",
    revenue: "Revenue from paid memberships only, spread across the active membership period.",
    firstTouchpoints: "People whose true first paid touchpoint happens in this period, measured from the full loaded CSV. Single ticket buyers and fully discounted crew memberships are excluded.",
    lastTouchpoints: "People whose true last paid touchpoint happens in this period, measured from the full loaded CSV. Single ticket buyers and fully discounted crew memberships are excluded.",
    singleTicketBuyers: "People who have exactly one paid activity/event ticket and no paid membership anywhere in the full loaded CSV, shown in the period where that ticket happened.",
    newMemberships: "People whose first paid membership starts in this period.",
    endedMemberships: "Estimated membership endings when no renewal appears within the expected renewal window.",
    memberCount: "Estimated active paid members in this period. Crew/free memberships are excluded.",
    crewCount: "Estimated active crew members from fully discounted membership transactions.",
    activeTicketUsersWithMembership: "People who bought activity or event tickets in this period and were also active members.",
    activeTicketUsersWithoutMembership: "People who bought activity or event tickets in this period without being active members.",
    classRevenue: "Net revenue from activity/class ticket sales in this period.",
    eventRevenue: "Net revenue from event ticket sales in this period.",
    classTickets: "Number of activity/class tickets sold in this period.",
    eventTickets: "Number of event tickets sold in this period.",
  };
  if (byKey[entry.key]) return byKey[entry.key];
  if (String(entry.key).startsWith("membershipType:")) return "Estimated active member count for this specific membership subscription type.";
  if (entry.kind === "labelType" && entry.key === "Activity") return "Revenue blobs for recurring activity ticket products. Size indicates revenue; position is based on the last ticket sale period.";
  if (entry.kind === "labelType" && entry.key === "Event") return "Revenue blobs for event ticket products. Size indicates revenue; position is based on the last ticket sale period.";
  return "";
}

function buildTimelineLabelLanes(labels) {
  const names = [...new Set(labels.map((label) => label.label))]
    .sort((a, b) => hashTimelineText(a) - hashTimelineText(b));
  const lanes = new Map();
  names.forEach((label, index) => {
    const lane = names.length <= 1 ? 0.5 : index / (names.length - 1);
    lanes.set(label, lane);
  });
  return lanes;
}

function getHoveredTimelineLabelType(toggleHits, hiddenLabels) {
  for (const hit of toggleHits) {
    if (hit.kind !== "labelType") continue;
    if (hiddenLabels.has(hit.key)) continue;
    if (mouseX >= hit.x && mouseX <= hit.x + hit.w && mouseY >= hit.y && mouseY <= hit.y + hit.h) return hit.key;
  }
  return "";
}

function hashTimelineText(value) {
  const text = String(value || "");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function wrapTimelineText(value, maxChars) {
  const words = String(value || "").split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const nextLine = line ? `${line} ${word}` : word;
    if (nextLine.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = nextLine;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawNormalizedJourneyTimeline(x, y, w, h, journeys, options = {}) {
  const title = options.title || "Journey patterns";
  const unitLabel = options.unitLabel || "period";
  const visibleLimit = options.visibleLimit || journeys.length;

  fill(238);
  noStroke();
  rect(x, y, w, h, 4);
  fill(30);
  textSize(18);
  textAlign(LEFT, TOP);
  text(title, x + 18, y + 16);

  if (!journeys.length) {
    fill(80);
    textSize(14);
    text(options.emptyText || "No journeys in this range.", x + 18, y + 54);
    return;
  }

  const plotX = x + 28;
  const plotY = y + 62;
  const plotW = w - 56;
  const plotH = h - 98;
  const visibleJourneys = journeys.slice(0, visibleLimit);
  const maxOffset = Math.max(1, ...visibleJourneys.map((journey) => journey.span || 0));
  const cumulative = options.mode === "cumulative";
  const maxValue = cumulative
    ? Math.max(1, ...visibleJourneys.flatMap((journey) => journey.periods.map((period) => period.cumulativeValue || 0)))
    : 1;
  const hoveredJourneys = [];
  let hoveredDot = null;

  drawJourneyLegend(x + w - 360, y + 24, options.legend || []);
  stroke(215);
  strokeWeight(1);
  line(plotX, plotY + plotH, plotX + plotW, plotY + plotH);

  for (const journey of visibleJourneys) {
    const lane = normalizedJourneyLane(journey);
    const baseY = plotY + 16 + lane * Math.max(1, plotH - 32);
    const lineColor = journey.color || [26, 105, 180];
    const points = journey.periods.map((period) => ({
      period,
      x: plotX + ((period.offset || 0) / maxOffset) * plotW,
      y: cumulative
        ? plotY + plotH - ((period.cumulativeValue || 0) / maxValue) * plotH
        : baseY + (period.yOffset || 0),
    }));
    const distance = distanceToNormalizedJourney(mouseX, mouseY, points);
    const isHover = distance < 10;
    if (isHover) hoveredJourneys.push({ journey, points, distance, color: lineColor });

    drawJourneyRoleSegments(points, lineColor, isHover);

    noStroke();
    for (const point of points) {
      const color = point.period.color || lineColor;
      const markerColor = journeyRoleMarkerColor(point.period);
      const radius = markerColor ? (isHover ? 6 : 4) : (isHover ? 3.5 : 2);
      const dotDistance = dist(mouseX, mouseY, point.x, point.y);
      fill(color[0], color[1], color[2], isHover ? 230 : 110);
      circle(point.x, point.y, radius * 2);
      if (dotDistance <= Math.max(9, radius + 5) && (!hoveredDot || dotDistance < hoveredDot.distance)) {
        hoveredDot = { journey, point, color, distance: dotDistance };
      }
      if (markerColor) {
        noFill();
        stroke(markerColor[0], markerColor[1], markerColor[2], isHover ? 255 : 170);
        strokeWeight(isHover ? 2.4 : 1.6);
        circle(point.x, point.y, isHover ? 18 : 13);
        noStroke();
      }
    }
  }

  fill(80);
  textSize(11);
  textAlign(LEFT, TOP);
  text(`0 ${unitLabel}s`, plotX, y + h - 24);
  textAlign(RIGHT, TOP);
  text(`${maxOffset} ${unitLabel}s`, plotX + plotW, y + h - 24);
  if (cumulative) {
    fill(80);
    textAlign(RIGHT, TOP);
    text(timelineFormatValue(maxValue, options.valueFormatter), plotX + plotW, plotY);
  }

  if (journeys.length > visibleJourneys.length) {
    fill(90);
    textAlign(RIGHT, TOP);
    text(`showing ${visibleJourneys.length} of ${journeys.length}`, x + w - 18, y + 18);
  }

  if (hoveredDot) drawJourneyDotTooltip(hoveredDot, options);
  else drawHoveredJourneyLabels(plotX, plotY, plotW, hoveredJourneys, options);
}

function drawJourneyDotTooltip(hoveredDot, options) {
  const period = hoveredDot.point.period;
  const itemLines = (period.items || []).slice(0, 5).map((item) => (
    item.count > 1 ? `${item.label} x${item.count}` : item.label
  ));
  const lines = [
    hoveredDot.journey.label || "Journey",
    `Offset: ${period.offset}`,
    ...itemLines,
    `Revenue: ${timelineFormatValue(period.revenue || 0, options.valueFormatter)}`,
  ];
  drawTooltip(mouseX, mouseY, lines, 260);
}

function journeyRoleMarkerColor(period) {
  if (period.isMembershipStart) return [255, 245, 120];
  if (period.isCrewStart) return [215, 160, 255];
  return null;
}

function drawJourneyRoleSegments(points, fallbackColor, isHover) {
  if (points.length <= 1) {
    const color = points[0]?.period?.color || fallbackColor;
    stroke(color[0], color[1], color[2], isHover ? 230 : 65);
    strokeWeight(isHover ? 3 : 1.3);
    point(points[0]?.x || 0, points[0]?.y || 0);
    return;
  }

  noFill();
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const color = to.period.color || from.period.color || fallbackColor;
    stroke(color[0], color[1], color[2], isHover ? 235 : 78);
    strokeWeight(isHover ? 3.4 : 1.45);
    line(from.x, from.y, to.x, to.y);
  }
}

function drawHoveredJourneyLabels(plotX, plotY, plotW, hoveredJourneys, options) {
  const items = hoveredJourneys
    .sort((a, b) => a.distance - b.distance)
    .slice(0, options.maxHoverLabels || hoveredJourneys.length);
  if (!items.length) return;

  const gap = 8;
  const boxW = options.hoverBoxWidth || 170;
  const boxH = 96;
  const columns = Math.max(1, floor((plotW + gap) / (boxW + gap)));
  const rows = ceil(items.length / columns);
  const labelY = plotY + 8;
  textSize(11);
  textLeading(12);
  textAlign(LEFT, TOP);

  items.forEach((item, index) => {
    const column = index % columns;
    const row = floor(index / columns);
    const boxX = plotX + column * (boxW + gap);
    const boxY = labelY + row * (boxH + gap);
    const endPoint = item.points.at(-1);
    stroke(item.color[0], item.color[1], item.color[2], 210);
    strokeWeight(2.4);
    line(boxX + boxW * 0.5, boxY + boxH, endPoint.x, endPoint.y);
    fill(item.color[0], item.color[1], item.color[2], 240);
    noStroke();
    circle(endPoint.x, endPoint.y, 7);
    fill(20, 220);
    rect(boxX, boxY, boxW, boxH, 3);
    fill(item.color[0], item.color[1], item.color[2], 240);
    rect(boxX, boxY, boxW, 4, 2);
    fill(245);
    drawCompactWrappedText(item.journey.label || "Journey", boxX + 8, boxY + 10, boxW - 16, 2, 12);
    const lines = typeof options.tooltipLines === "function" ? options.tooltipLines(item.journey) : [];
    fill(190);
    drawCompactWrappedText(lines[1] || "", boxX + 8, boxY + 38, boxW - 16, 2, 12);
    text(trimTimelineText(lines[3] || "", 24), boxX + 8, boxY + 66);
    text(trimTimelineText(lines[4] || "", 24), boxX + 8, boxY + 80);
  });
}

function drawCompactWrappedText(value, x, y, maxWidth, maxLines, lineHeight) {
  const words = String(value || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && textWidth(candidate) > maxWidth) {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines) break;
    } else {
      line = candidate;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  for (let index = 0; index < lines.length; index += 1) {
    const suffix = index === maxLines - 1 && words.join(" ").length > lines.join(" ").length ? "…" : "";
    text(`${lines[index]}${suffix}`, x, y + index * lineHeight);
  }
}

function trimTimelineText(value, maxLength) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function drawJourneyLegend(x, y, items) {
  let lx = x;
  textSize(12);
  textAlign(LEFT, CENTER);
  for (const item of items) {
    fill(item.color[0], item.color[1], item.color[2], 170);
    noStroke();
    rect(lx, y - 5, 12, 10, 2);
    fill(70);
    text(item.label, lx + 18, y);
    lx += textWidth(item.label) + 48;
  }
}

function normalizedJourneyLane(journey) {
  const hash = hashTimelineText(journey.id || journey.label);
  return (hash % 1000) / 1000;
}

function distanceToNormalizedJourney(mx, my, points) {
  if (!points.length) return Infinity;
  let best = Infinity;
  for (let index = 0; index < points.length; index += 1) {
    best = Math.min(best, dist(mx, my, points[index].x, points[index].y));
    if (index > 0) best = Math.min(best, distanceToTimelineSegment(mx, my, points[index - 1], points[index]));
  }
  return best;
}

function distanceToTimelineSegment(mx, my, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (!lengthSq) return dist(mx, my, a.x, a.y);
  const t = constrain(((mx - a.x) * dx + (my - a.y) * dy) / lengthSq, 0, 1);
  return dist(mx, my, a.x + t * dx, a.y + t * dy);
}
