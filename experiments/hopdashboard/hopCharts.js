function drawCenteredMessage(message) {
  background(128);
  fill(30);
  noStroke();
  textAlign(CENTER, CENTER);
  textSize(24);
  text(message, width * 0.5, height * 0.5);
}

function drawHopOverview(model, fileName = "", currentView = "overview", navItems = []) {
  background(128);
  const pad = 32;
  const revenue = sum(model.invoices, "totalPrice");
  const vat = sum(model.invoices, "vatAmount");
  const typeCounts = countInvoiceTypes(model.invoices);

  drawHopNav(pad, 24, navItems, currentView);
  drawClearDataButton();

  if (currentView === "activity") {
    drawActivityView(model.activity, model.ticketSales, pad, 78);
    return;
  }

  if (currentView === "ticketsales") {
    drawTicketSalesView(model.ticketSales, pad, 78);
    return;
  }

  if (currentView !== "testview") {
    drawPlaceholderView(currentView, pad + 16, 92);
    return;
  }

  const cardY = 78;
  const cardW = (width - pad * 2 - 48) / 4;
  drawStatCard(pad, cardY, cardW, 96, "Revenue", formatDkk(revenue));
  drawStatCard(pad + (cardW + 16), cardY, cardW, 96, "VAT", formatDkk(vat));
  drawStatCard(pad + (cardW + 16) * 2, cardY, cardW, 96, "Customers", formatInteger(model.customers.length));
  drawStatCard(pad + (cardW + 16) * 3, cardY, cardW, 96, "Invoices", formatInteger(model.invoices.length));

  const chartTop = cardY + 132;
  const chartH = max(180, (height - chartTop - pad * 1.5) * 0.52);
  drawLineChart(pad, chartTop, width - pad * 2, chartH, model.months, "Weekly revenue", "revenue", formatDkk);

  const lowerY = chartTop + chartH + 28;
  const lowerH = height - lowerY - pad;
  drawLineChart(pad, lowerY, (width - pad * 3) * 0.58, lowerH, model.months, "Active customers by week", "customerCount", formatInteger);
  drawCategoryBars(pad * 2 + (width - pad * 3) * 0.58, lowerY, (width - pad * 3) * 0.42, lowerH, typeCounts);

  fill(40);
  textAlign(LEFT, TOP);
  textSize(13);
  text(`testview: ${currentView}`, pad, height - 26);
}

function drawPlaceholderView(currentView, x, y) {
  fill(238);
  noStroke();
  rect(32, 76, width - 64, height - 108, 4);
  fill(35);
  textAlign(LEFT, TOP);
  textSize(28);
  text(currentView, x, y);
  textSize(16);
  fill(80);
  text("This view is ready for its own analysis.", x, y + 44);
}

function drawActivityView(activity, ticketSales, pad, top) {
  const months = mergeActivityTimeline(activity?.months || [], ticketSales?.weeks || []);
  drawMultiLineChart(pad, top, width - pad * 2, height - top - pad, months, "Activity", [
    { key: "totalRevenue", label: "Total revenue", color: [0, 0, 0], formatter: formatDkk },
    { key: "revenue", label: "Member revenue", color: [20, 20, 20], formatter: formatDkk },
    { key: "newMemberships", label: "New memberships", color: [26, 105, 180], formatter: formatInteger },
    { key: "endedMemberships", label: "Ended memberships", color: [210, 55, 55], formatter: formatInteger },
    { key: "memberCount", label: "Member count", color: [190, 90, 35], formatter: formatInteger },
    { key: "classRevenue", label: "Activity ticket revenue", color: [60, 140, 85], formatter: formatDkk },
    { key: "eventRevenue", label: "Event ticket revenue", color: [135, 85, 170], formatter: formatDkk },
  ], ticketSales?.items || []);
}

function mergeActivityTimeline(activityWeeks, ticketWeeks) {
  const byWeek = new Map();
  for (const week of activityWeeks) byWeek.set(week.month, { ...week });
  for (const week of ticketWeeks) {
    const merged = byWeek.get(week.month) || { month: week.month, revenue: 0, newMemberships: 0, endedMemberships: 0, memberCount: 0 };
    merged.classRevenue = week.classRevenue || 0;
    merged.eventRevenue = week.eventRevenue || 0;
    byWeek.set(week.month, merged);
  }
  return Array.from(byWeek.values()).map((week) => ({
    ...week,
    totalRevenue: (week.revenue || 0) + (week.classRevenue || 0) + (week.eventRevenue || 0),
  })).sort((a, b) => a.month.localeCompare(b.month));
}

function drawTicketSalesView(ticketSales, pad, top) {
  const weeks = ticketSales?.weeks || [];
  const items = ticketSales?.items || [];
  const chartH = max(220, (height - top - pad * 2) * 0.62);
  drawMultiLineChart(pad, top, width - pad * 2, chartH, weeks, "Ticket sales", [
    { key: "classRevenue", label: "Activity revenue", color: [20, 20, 20], formatter: formatDkk },
    { key: "eventRevenue", label: "Event revenue", color: [26, 105, 180], formatter: formatDkk },
    { key: "classTickets", label: "Activity tickets", color: [190, 90, 35], formatter: formatInteger },
    { key: "eventTickets", label: "Event tickets", color: [60, 140, 85], formatter: formatInteger },
  ]);

  drawTicketItemBars(pad, top + chartH + 28, width - pad * 2, height - top - chartH - pad - 28, items);
}

function drawTicketItemBars(x, y, w, h, items) {
  fill(238);
  noStroke();
  rect(x, y, w, h, 4);
  fill(30);
  textSize(18);
  textAlign(LEFT, TOP);
  text("Top activities and events", x + 18, y + 16);

  const entries = items.slice(0, 8);
  const maxValue = max(1, ...entries.map((entry) => entry.revenue));
  let by = y + 54;
  for (const entry of entries) {
    const barW = ((w - 36) * entry.revenue) / maxValue;
    const hovered = mouseX >= x + 18 && mouseX <= x + 18 + barW && mouseY >= by + 18 && mouseY <= by + 30;
    fill(55);
    textSize(12);
    textAlign(LEFT, TOP);
    text(`${entry.type}: ${trimText(entry.label, 58)}`, x + 18, by);
    fill(hovered ? 5 : 35);
    rect(x + 18, by + 18, barW, 12, 2);
    fill(80);
    textAlign(RIGHT, TOP);
    text(`${formatDkk(entry.revenue)} · ${formatInteger(entry.tickets)} tickets`, x + w - 18, by);
    if (hovered) {
      drawTooltip(mouseX, mouseY, [
        `${entry.type}: ${entry.label}`,
        `Revenue: ${formatDkk(entry.revenue)}`,
        `Tickets: ${formatInteger(entry.tickets)}`,
      ]);
    }
    by += 40;
  }
}

function drawHopNav(x, y, navItems, currentView) {
  let navX = x;
  textSize(14);
  textAlign(LEFT, CENTER);
  for (const item of navItems) {
    const w = textWidth(item.label) + 28;
    fill(item.id === currentView ? 30 : 110);
    noStroke();
    rect(navX, y, w, 34, 4);
    fill(item.id === currentView ? 245 : 35);
    text(item.label, navX + 14, y + 17);
    navX += w + 10;
  }
}

function drawClearDataButton() {
  const box = getClearDataButtonBounds();
  fill(110);
  noStroke();
  rect(box.x, box.y, box.w, box.h, 4);
  fill(35);
  textSize(14);
  textAlign(CENTER, CENTER);
  text("Clear Data", box.x + box.w / 2, box.y + box.h / 2);
}

function getClearDataButtonBounds() {
  return { x: width - 124, y: 24, w: 92, h: 34 };
}

function drawTimeBucketToggle(activeBucket) {
  const item = getTimeBucketButton();
  fill(30);
  noStroke();
  rect(item.x, item.y, item.w, item.h, 4);
  fill(245);
  textSize(14);
  textAlign(CENTER, CENTER);
  text(timeBucketLabel(activeBucket), item.x + item.w / 2, item.y + item.h / 2);
}

function getTimeBucketButton() {
  const y = 24;
  const w = 76;
  const h = 34;
  const gap = 8;
  const x = width - 124 - gap - w;
  return { x, y, w, h };
}

function drawBlobLegend(x, y) {
  textSize(12);
  textAlign(LEFT, CENTER);
  const activityHidden = hiddenBlobTypes.has("Activity");
  const eventHidden = hiddenBlobTypes.has("Event");
  const activityHit = { kind: "blobType", key: "Activity", x: x - 8, y: y - 12, w: 78, h: 24 };
  const eventHit = { kind: "blobType", key: "Event", x: x + 84, y: y - 12, w: 58, h: 24 };
  const activityHovered = mouseX >= activityHit.x && mouseX <= activityHit.x + activityHit.w && mouseY >= activityHit.y && mouseY <= activityHit.y + activityHit.h;
  const eventHovered = mouseX >= eventHit.x && mouseX <= eventHit.x + eventHit.w && mouseY >= eventHit.y && mouseY <= eventHit.y + eventHit.h;
  chartToggleHits.push(activityHit);
  chartToggleHits.push(eventHit);
  fill(60, 140, 85, activityHidden || eventHovered ? 20 : activityHovered ? 120 : 70);
  noStroke();
  circle(x, y, 12);
  fill(activityHidden || eventHovered ? 150 : activityHovered ? 15 : 55);
  text("Activities", x + 12, y);
  fill(135, 85, 170, eventHidden || activityHovered ? 20 : eventHovered ? 120 : 70);
  circle(x + 92, y, 12);
  fill(eventHidden || activityHovered ? 150 : eventHovered ? 15 : 55);
  text("Events", x + 104, y);
}

function timeBucketLabel(bucket) {
  if (bucket === "month") return "Month";
  if (bucket === "quarter") return "3 Mon";
  return "Week";
}

function drawStatCard(x, y, w, h, label, value) {
  fill(238);
  rect(x, y, w, h, 4);
  fill(80);
  textSize(13);
  textAlign(LEFT, TOP);
  text(label.toUpperCase(), x + 16, y + 16);
  fill(20);
  textSize(25);
  text(value, x + 16, y + 44);
}

function drawLineChart(x, y, w, h, points, title, key, formatter) {
  fill(238);
  noStroke();
  rect(x, y, w, h, 4);
  fill(30);
  textSize(18);
  textAlign(LEFT, TOP);
  text(title, x + 18, y + 16);

  const values = points.map((point) => point[key]);
  const maxValue = max(1, ...values);
  const plotX = x + 18;
  const plotY = y + 54;
  const plotW = w - 36;
  const plotH = h - 82;

  stroke(210);
  strokeWeight(1);
  line(plotX, plotY + plotH, plotX + plotW, plotY + plotH);

  noFill();
  stroke(20);
  strokeWeight(2.5);
  const hoverPoints = [];
  beginShape();
  points.forEach((point, index) => {
    const px = plotX + (points.length <= 1 ? 0 : (index / (points.length - 1)) * plotW);
    const py = plotY + plotH - (point[key] / maxValue) * plotH;
    hoverPoints.push({ x: px, y: py, point });
    vertex(px, py);
  });
  endShape();

  for (const hoverPoint of hoverPoints) {
    if (abs(mouseX - hoverPoint.x) < 16 && abs(mouseY - hoverPoint.y) < 28) {
      fill(20);
      noStroke();
      circle(hoverPoint.x, hoverPoint.y, 8);
      drawTooltip(mouseX, mouseY, [
        hoverPoint.point.month,
        `${title}: ${formatter(hoverPoint.point[key])}`,
      ]);
      break;
    }
  }

  fill(70);
  noStroke();
  textSize(12);
  textAlign(LEFT, BOTTOM);
  text(points[0]?.month || "", plotX, y + h - 14);
  textAlign(RIGHT, BOTTOM);
  text(points.at(-1)?.month || "", plotX + plotW, y + h - 14);
  textAlign(RIGHT, TOP);
  text(formatter(maxValue), plotX + plotW, plotY);
  drawSeasonBand(plotX, y + h - 8, plotW, points);
}

function drawMultiLineChart(x, y, w, h, points, title, series, blobs = []) {
  fill(238);
  noStroke();
  rect(x, y, w, h, 4);
  fill(30);
  textSize(18);
  textAlign(LEFT, TOP);
  text(title, x + 18, y + 16);

  const plotX = x + 18;
  const plotY = y + 72;
  const plotW = w - 36;
  const plotH = h - 112;
  const maxByKey = {};
  for (const item of series) {
    maxByKey[item.key] = max(1, ...points.map((point) => abs(point[item.key] || 0)));
  }

  let legendX = x + 18;
  let hoveredLegendKey = "";
  textSize(12);
  textAlign(LEFT, CENTER);
  for (const item of series) {
    const labelW = textWidth(item.label);
    const hovered = mouseX >= legendX && mouseX <= legendX + labelW + 28 && mouseY >= y + 36 && mouseY <= y + 60;
    const hidden = hiddenSeriesKeys.has(item.key);
    chartToggleHits.push({ kind: "series", key: item.key, x: legendX, y: y + 36, w: labelW + 28, h: 24 });
    if (hovered) hoveredLegendKey = item.key;
    fill(item.color[0], item.color[1], item.color[2], hidden ? 55 : 255);
    rect(legendX, y + 47, 16, 3, 1);
    fill(hidden ? 150 : hovered ? 15 : 55);
    text(item.label, legendX + 22, y + 48);
    legendX += labelW + 54;
  }
  if (blobs.length) drawBlobLegend(x + w - 190, y + 48);

  stroke(210);
  strokeWeight(1);
  line(plotX, plotY + plotH, plotX + plotW, plotY + plotH);

  for (const item of series) {
    if (hiddenSeriesKeys.has(item.key)) continue;
    noFill();
    const alpha = hoveredLegendKey && hoveredLegendKey !== item.key ? 35 : 255;
    stroke(item.color[0], item.color[1], item.color[2], alpha);
    strokeWeight(hoveredLegendKey === item.key ? 3.5 : 2.5);
    beginShape();
    points.forEach((point, index) => {
      const px = plotX + (points.length <= 1 ? 0 : (index / (points.length - 1)) * plotW);
      const py = plotY + plotH - ((point[item.key] || 0) / maxByKey[item.key]) * plotH;
      vertex(px, py);
    });
    endShape();
  }

  const blobHovered = drawTimelineBlobs(plotX, plotY, plotW, plotH, points, blobs);

  const hoverIndex = getNearestPointIndex(mouseX, plotX, plotW, points.length);
  if (!blobHovered && hoverIndex >= 0 && mouseY >= plotY - 24 && mouseY <= plotY + plotH + 24) {
    const point = points[hoverIndex];
    const px = plotX + (points.length <= 1 ? 0 : (hoverIndex / (points.length - 1)) * plotW);
    stroke(90);
    strokeWeight(1);
    line(px, plotY, px, plotY + plotH);
    const lines = [point.month];
    for (const item of series) {
      if (hiddenSeriesKeys.has(item.key)) continue;
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
  drawSeasonBand(plotX, y + h - 8, plotW, points);
}

function getNearestPointIndex(mx, plotX, plotW, count) {
  if (!count || mx < plotX - 16 || mx > plotX + plotW + 16) return -1;
  if (count === 1) return 0;
  return constrain(round(((mx - plotX) / plotW) * (count - 1)), 0, count - 1);
}

function drawSeasonBand(x, y, w, points) {
  if (!points.length) return;
  const bandH = 8;
  const labelY = y + 14;
  noStroke();
  for (let index = 0; index < points.length; index += 1) {
    const date = dateFromPeriodKey(points[index].month);
    const x0 = x + (points.length <= 1 ? 0 : (index / points.length) * w);
    const x1 = x + ((index + 1) / points.length) * w;
    fill(...seasonColor(date.getMonth()));
    rect(x0, y, max(1, x1 - x0), bandH);

    if (isMonthStart(points, index, date)) {
      fill(55);
      textSize(9);
      textAlign(CENTER, TOP);
      text(monthInitial(date.getMonth()), x0, labelY);
    }
    if (date.getMonth() === 0 && isMonthStart(points, index, date)) {
      stroke(35);
      strokeWeight(1);
      line(x0, y - 4, x0, y + bandH + 12);
      noStroke();
      fill(35);
      textSize(9);
      textAlign(LEFT, TOP);
      text(String(date.getFullYear()), x0 + 3, y - 16);
    }
  }
}

function isMonthStart(points, index, date) {
  if (index === 0) return true;
  const prev = dateFromPeriodKey(points[index - 1].month);
  return prev.getMonth() !== date.getMonth() || prev.getFullYear() !== date.getFullYear();
}

function dateFromPeriodKey(key) {
  const text = String(key || "");
  const weekMatch = text.match(/^(\d{4})-W(\d{2})$/);
  if (weekMatch) return dateFromIsoWeek(Number(weekMatch[1]), Number(weekMatch[2]));
  const monthMatch = text.match(/^(\d{4})-(\d{2})$/);
  if (monthMatch) return new Date(Number(monthMatch[1]), Number(monthMatch[2]) - 1, 1);
  const quarterMatch = text.match(/^(\d{4})-Q(\d)$/);
  if (quarterMatch) return new Date(Number(quarterMatch[1]), (Number(quarterMatch[2]) - 1) * 3, 1);
  return new Date();
}

function dateFromIsoWeek(year, week) {
  const date = new Date(year, 0, 1 + (week - 1) * 7);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return date;
}

function seasonColor(monthIndex) {
  if (monthIndex >= 2 && monthIndex <= 4) return [123, 201, 111];
  if (monthIndex >= 5 && monthIndex <= 7) return [242, 201, 76];
  if (monthIndex >= 8 && monthIndex <= 10) return [217, 130, 43];
  return [93, 173, 236];
}

function monthInitial(monthIndex) {
  return "JFMAMJJASOND"[monthIndex] || "";
}

function drawTimelineBlobs(plotX, plotY, plotW, plotH, points, blobs) {
  if (!blobs.length || !points.length) return false;
  const weekIndex = new Map(points.map((point, index) => [point.month, index]));
  const visibleBlobs = blobs.filter((blob) => weekIndex.has(blob.lastWeek) && blob.revenue > 0 && !hiddenBlobTypes.has(blob.type));
  const maxRevenue = max(1, ...visibleBlobs.map((blob) => blob.revenue));
  const laneByLabel = buildBlobLanes(visibleBlobs);

  let hoveredBlob = null;
  for (const blob of visibleBlobs) {
    const index = weekIndex.get(blob.lastWeek);
    const px = plotX + (points.length <= 1 ? 0 : (index / (points.length - 1)) * plotW);
    const lane = laneByLabel.get(blob.label) ?? 0.5;
    const py = plotY + 18 + lane * max(1, plotH - 36);
    const radius = map(sqrt(blob.revenue), 0, sqrt(maxRevenue), 8, 34);
    const color = blob.type === "Event" ? [135, 85, 170] : [60, 140, 85];
    const legendFocusedType = getHoveredBlobLegendType();
    const dimmedByLegend = legendFocusedType && legendFocusedType !== blob.type;
    const distance = dist(mouseX, mouseY, px, py);
    const hovered = distance <= radius * 0.65;

    fill(color[0], color[1], color[2], dimmedByLegend ? 12 : hovered || legendFocusedType === blob.type ? 90 : 42);
    noStroke();
    circle(px, py, radius);

    if (hovered && (!hoveredBlob || distance < hoveredBlob.distance)) {
      hoveredBlob = { blob, px, py, radius, color, distance };
    }
  }

  if (hoveredBlob) {
    fill(hoveredBlob.color[0], hoveredBlob.color[1], hoveredBlob.color[2], 120);
    noStroke();
    circle(hoveredBlob.px, hoveredBlob.py, hoveredBlob.radius);
    drawTooltip(mouseX, mouseY, [
      ...wrapText(`${hoveredBlob.blob.type}: ${hoveredBlob.blob.label}`, 28),
      `Last sold: ${hoveredBlob.blob.lastWeek}`,
      `Revenue: ${formatDkk(hoveredBlob.blob.revenue)}`,
      `Tickets: ${formatInteger(hoveredBlob.blob.tickets)}`,
    ], 200);
    return true;
  }
  return false;
}

function buildBlobLanes(blobs) {
  const labels = [...new Set(blobs.map((blob) => blob.label))]
    .sort((a, b) => hashText(a) - hashText(b));
  const lanes = new Map();
  labels.forEach((label, index) => {
    const lane = labels.length <= 1 ? 0.5 : index / (labels.length - 1);
    lanes.set(label, lane);
  });
  return lanes;
}

function getHoveredBlobLegendType() {
  for (const hit of chartToggleHits) {
    if (hit.kind !== "blobType") continue;
    if (hiddenBlobTypes.has(hit.key)) continue;
    if (mouseX >= hit.x && mouseX <= hit.x + hit.w && mouseY >= hit.y && mouseY <= hit.y + hit.h) return hit.key;
  }
  return "";
}

function hashText(value) {
  const text = String(value || "");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function drawCategoryBars(x, y, w, h, categories) {
  fill(238);
  noStroke();
  rect(x, y, w, h, 4);
  fill(30);
  textSize(18);
  textAlign(LEFT, TOP);
  text("Activity mix", x + 18, y + 16);

  const entries = Object.entries(categories).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxValue = max(1, ...entries.map((entry) => entry[1]));
  let by = y + 58;
  for (const [label, value] of entries) {
    const barW = ((w - 36) * value) / maxValue;
    const hovered = mouseX >= x + 18 && mouseX <= x + 18 + barW && mouseY >= by + 18 && mouseY <= by + 30;
    fill(55);
    textSize(12);
    textAlign(LEFT, TOP);
    text(label, x + 18, by);
    fill(hovered ? 5 : 35);
    rect(x + 18, by + 18, barW, 12, 2);
    fill(80);
    textAlign(RIGHT, TOP);
    text(formatInteger(value), x + w - 18, by);
    if (hovered) drawTooltip(mouseX, mouseY, [label, `Count: ${formatInteger(value)}`]);
    by += 46;
  }
}

function drawTooltip(x, y, lines, maxWidth = 360) {
  textSize(12);
  const tooltipW = min(maxWidth, max(...lines.map((line) => textWidth(line))) + 24);
  const tooltipH = lines.length * 18 + 14;
  const tx = min(x + 14, width - tooltipW - 8);
  const ty = min(y + 14, height - tooltipH - 8);

  fill(20);
  noStroke();
  rect(tx, ty, tooltipW, tooltipH, 3);
  fill(245);
  textAlign(LEFT, TOP);
  lines.forEach((line, index) => text(line, tx + 12, ty + 8 + index * 18));
}

function wrapText(value, maxChars) {
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

function countInvoiceTypes(invoices) {
  const counts = {};
  for (const invoice of invoices) {
    for (const type of invoice.itemTypes) {
      counts[type || "unknown"] = (counts[type || "unknown"] || 0) + 1;
    }
  }
  return counts;
}

function sum(items, key) {
  return items.reduce((total, item) => total + (Number(item[key]) || 0), 0);
}

function formatDkk(value) {
  return `${Math.round(value).toLocaleString("da-DK")} kr`;
}

function formatInteger(value) {
  return Math.round(value).toLocaleString("da-DK");
}

function formatDate(date) {
  if (!(date instanceof Date)) return "";
  return date.toISOString().slice(0, 10);
}

function trimText(value, maxLength) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
