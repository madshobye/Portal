function drawHopTimelineChart(x, y, w, h, points, title, series, labels = [], state = {}) {
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

  const legend = drawTimelineLegend(x + 18, y + 42, w - 36, series, labels, hiddenSeries, hiddenLabels, toggleHits);
  const plotX = x + 18;
  const plotY = max(y + 72, legend.bottom + 14);
  const plotW = w - 36;
  const plotH = max(80, h - (plotY - y) - 40);
  const maxByScale = {};
  for (const item of series) {
    if (hiddenSeries.has(item.key)) continue;
    const scaleKey = item.scale || item.key;
    maxByScale[scaleKey] = max(maxByScale[scaleKey] || 1, ...points.map((point) => abs(point[item.key] || 0)));
  }

  stroke(210);
  strokeWeight(1);
  line(plotX, plotY + plotH, plotX + plotW, plotY + plotH);

  for (const item of series) {
    if (hiddenSeries.has(item.key)) continue;
    noFill();
    const alpha = legend.hoveredSeriesKey && legend.hoveredSeriesKey !== item.key ? 35 : 255;
    stroke(item.color[0], item.color[1], item.color[2], alpha);
    strokeWeight(legend.hoveredSeriesKey === item.key ? 3.5 : 2.5);
    beginShape();
    points.forEach((point, index) => {
      const px = plotX + (points.length <= 1 ? 0 : (index / (points.length - 1)) * plotW);
      const py = plotY + plotH - ((point[item.key] || 0) / (maxByScale[item.scale || item.key] || 1)) * plotH;
      vertex(px, py);
    });
    endShape();
  }

  const labelHovered = drawTimelineLabels(plotX, plotY, plotW, plotH, points, labels, hiddenLabels, toggleHits);

  const hoverIndex = getTimelineNearestPointIndex(mouseX, plotX, plotW, points.length);
  if (!labelHovered && hoverIndex >= 0 && mouseY >= plotY - 24 && mouseY <= plotY + plotH + 24) {
    const point = points[hoverIndex];
    const px = plotX + (points.length <= 1 ? 0 : (hoverIndex / (points.length - 1)) * plotW);
    stroke(90);
    strokeWeight(1);
    line(px, plotY, px, plotY + plotH);
    const lines = [point.month];
    for (const item of series) {
      if (hiddenSeries.has(item.key)) continue;
      lines.push(`${item.label}: ${item.formatter(point[item.key] || 0)}`);
    }
    drawTooltip(mouseX, mouseY, lines);
  }

  fill(70);
  noStroke();
  textSize(12);
  textAlign(LEFT, BOTTOM);
  text(points[0]?.month || "", plotX, y + h - 14);
  textAlign(RIGHT, BOTTOM);
  text(points.at(-1)?.month || "", plotX + plotW, y + h - 14);
  drawTimelineSeasonBand(plotX, y + h - 8, plotW, points);
}

function getTimelineNearestPointIndex(mx, plotX, plotW, count) {
  if (!count || mx < plotX - 16 || mx > plotX + plotW + 16) return -1;
  if (count === 1) return 0;
  return constrain(round(((mx - plotX) / plotW) * (count - 1)), 0, count - 1);
}

function drawTimelineSeasonBand(x, y, w, points) {
  if (!points.length) return;
  const bandH = 8;
  const labelY = y + 14;
  noStroke();
  for (let index = 0; index < points.length; index += 1) {
    const date = dateFromTimelinePeriodKey(points[index].month);
    const x0 = x + (points.length <= 1 ? 0 : (index / points.length) * w);
    const x1 = x + ((index + 1) / points.length) * w;
    fill(...timelineSeasonColor(date.getMonth()));
    rect(x0, y, max(1, x1 - x0), bandH);

    if (isTimelineMonthStart(points, index, date)) {
      fill(245);
      textSize(9);
      textAlign(CENTER, TOP);
      text(timelineMonthInitial(date.getMonth()), x0, labelY);
    }
    if (date.getMonth() === 0 && isTimelineMonthStart(points, index, date)) {
      stroke(245);
      strokeWeight(1);
      line(x0, y - 4, x0, y + bandH + 12);
      noStroke();
      fill(245);
      textSize(9);
      textAlign(LEFT, TOP);
      text(String(date.getFullYear()), x0 + 3, y - 16);
    }
  }
}

function isTimelineMonthStart(points, index, date) {
  if (index === 0) return true;
  const prev = dateFromTimelinePeriodKey(points[index - 1].month);
  return prev.getMonth() !== date.getMonth() || prev.getFullYear() !== date.getFullYear();
}

function dateFromTimelinePeriodKey(key) {
  const text = String(key || "");
  const weekMatch = text.match(/^(\d{4})-W(\d{2})$/);
  if (weekMatch) return dateFromTimelineIsoWeek(Number(weekMatch[1]), Number(weekMatch[2]));
  const monthMatch = text.match(/^(\d{4})-(\d{2})$/);
  if (monthMatch) return new Date(Number(monthMatch[1]), Number(monthMatch[2]) - 1, 1);
  const quarterMatch = text.match(/^(\d{4})-Q(\d)$/);
  if (quarterMatch) return new Date(Number(quarterMatch[1]), (Number(quarterMatch[2]) - 1) * 3, 1);
  return new Date();
}

function dateFromTimelineIsoWeek(year, week) {
  const date = new Date(year, 0, 1 + (week - 1) * 7);
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

function drawTimelineLabels(plotX, plotY, plotW, plotH, points, labels, hiddenLabels, toggleHits) {
  if (!labels.length || !points.length) return false;
  const periodIndex = new Map(points.map((point, index) => [point.month, index]));
  const visibleLabels = labels.filter((label) => periodIndex.has(label.period) && label.value > 0 && !hiddenLabels.has(label.type));
  const maxValue = max(1, ...visibleLabels.map((label) => label.value));
  const laneByLabel = buildTimelineLabelLanes(visibleLabels);

  let hoveredLabel = null;
  for (const label of visibleLabels) {
    const index = periodIndex.get(label.period);
    const px = plotX + (points.length <= 1 ? 0 : (index / (points.length - 1)) * plotW);
    const lane = laneByLabel.get(label.label) ?? 0.5;
    const py = plotY + 18 + lane * max(1, plotH - 36);
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

  return { hoveredSeriesKey, bottom: cursorY + 12 };
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
  const maxOffset = max(1, ...visibleJourneys.map((journey) => journey.span || 0));
  const cumulative = options.mode === "cumulative";
  const maxValue = cumulative
    ? max(1, ...visibleJourneys.flatMap((journey) => journey.periods.map((period) => period.cumulativeValue || 0)))
    : 1;
  const hoveredJourneys = [];
  let hoveredDot = null;

  drawJourneyLegend(x + w - 360, y + 24, options.legend || []);
  stroke(215);
  strokeWeight(1);
  line(plotX, plotY + plotH, plotX + plotW, plotY + plotH);

  for (const journey of visibleJourneys) {
    const lane = normalizedJourneyLane(journey);
    const baseY = plotY + 16 + lane * max(1, plotH - 32);
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
      if (dotDistance <= max(9, radius + 5) && (!hoveredDot || dotDistance < hoveredDot.distance)) {
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
  const columns = max(1, floor((plotW + gap) / (boxW + gap)));
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
    best = min(best, dist(mx, my, points[index].x, points[index].y));
    if (index > 0) best = min(best, distanceToTimelineSegment(mx, my, points[index - 1], points[index]));
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
