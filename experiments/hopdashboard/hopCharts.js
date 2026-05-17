let activityNetworkState = null;
let activityNetworkBounds = null;
let userNetworkState = null;
let userNetworkBounds = null;
let userNetworkVisible = null;
let activeHopModel = null;
let activePeriodLabel = "";
let pendingViewInfoTooltip = null;
const HOP_TOP_BUTTON_Y = 12;
const HOP_TOP_BUTTON_H = 26;
const HOP_DETAIL_TOP = 52;
const HOP_CONTENT_TOP = 112;
const HOP_PANEL_BG = 238;
const HOP_CARD_BG = 248;
const HOP_CARD_STROKE = 222;

function displayPersonName(entity) {
  return activeHopModel?.getName ? activeHopModel.getName(entity) : entity?.label || "Unknown customer";
}

function drawViewHeader(title, x, y, infoKey) {
  fill(30);
  textSize(18);
  textAlign(LEFT, TOP);
  text(title, x, y);
  drawViewInfoIcon(x + textWidth(title) + 14, y + 10, infoKey);
}

function drawViewInfoIcon(x, y, infoKey) {
  const description = viewInfoDescription(infoKey);
  if (!description) return;
  const radius = 7;
  const hovered = dist(mouseX, mouseY, x, y) <= radius + 4;
  fill(hovered ? 35 : 120);
  noStroke();
  circle(x, y, radius * 2);
  fill(245);
  textSize(10);
  textAlign(CENTER, CENTER);
  text("i", x, y - 0.5);
  if (hovered) {
    pendingViewInfoTooltip = {
      x: mouseX,
      y: mouseY,
      lines: [
      ...wrapText(description, 42),
      ],
      maxWidth: 300,
    };
  }
}

function drawPendingViewInfoTooltip() {
  if (!pendingViewInfoTooltip) return;
  drawTooltip(pendingViewInfoTooltip.x, pendingViewInfoTooltip.y, pendingViewInfoTooltip.lines, pendingViewInfoTooltip.maxWidth);
}

function drawGraphPeriodLabel(viewId) {
  if (!activePeriodLabel) return;
  fill(45);
  noStroke();
  textSize(11);
  textAlign(RIGHT, TOP);
  text(activePeriodLabel, width - 50, viewId === "revenuegroups" ? 146 : 128);
}

function viewInfoDescription(infoKey) {
  const descriptions = {
    activity: "Timeline of revenue, members, crew, ticket users, and activity/event sales for the selected date range.",
    activityNetwork: "Network of activities and events. Nodes connect when the same buyers bought both, with first-timer activities pulled left and experienced activities pulled right.",
    userNetwork: "Network of ticket buyers. People connect when they have bought tickets for the same activities or events.",
    ticketSales: "Timeline and ranking of activity and event ticket sales, split by revenue and ticket count.",
    ticketBuyers: "Heatmap of ticket-buying people over time, showing single, occasional, and recurring buyers.",
    revenueGroups: "Groups paying customers by how many activities or tickets they bought in the selected period, then compares revenue and people count.",
    buyerPattern: "Normalized customer journeys from first purchase onward, showing transitions between ticket-only, membership, and crew patterns.",
    retention: "Cohort heatmap showing whether first-time paid buyers came back in later periods. Bordered cells are outside the selected slider range but measured from the loaded CSV.",
    activityPath: "Shows where people go after their first paid activity or event. Rows are first activities; columns are the next paid step, membership, or no return.",
    gateway: "Ranks first activities by how well they create follow-up behavior: return rate, membership conversion, later revenue, and no-return rate.",
    pipeline: "Funnel from ticket buyers to recurring ticket buyers, members, and crew/long-term members, with first activities that feed membership.",
    productHealth: "One row per activity or event product, showing revenue, buyers, repeat buyers, first-timer share, member share, and recent trend.",
    segments: "Behavioral customer clusters: one-timers, seasonal returners, recurring ticket buyers, members, crew, and high-value supporters.",
    exitPoints: "Shows each customer's last meaningful paid touchpoint in the selected period, grouped by activity, event, membership, or crew.",
    memberLength: "Distribution of paid membership spans, estimating continuous membership from recurring payments and separating active from ended spans.",
    memberDistribution: "Stacked timeline showing active paid members by tenure: how long they have continuously been members at each period end.",
    overview: "High-level summary of revenue, customers, invoices, active customers, and invoice mix for the selected date range.",
    ticketItems: "Largest activity and event products by net revenue and ticket count in the selected date range.",
    activityMix: "Count of invoice item types in the selected date range.",
  };
  return descriptions[infoKey] || "";
}

function drawCenteredMessage(message) {
  background(52);
  fill(245);
  noStroke();
  textAlign(CENTER, CENTER);
  textSize(24);
  text(message, width * 0.5, height * 0.5);
}

function drawHopOverview(model, fileName = "", currentView = "overview", navItems = [], options = {}) {
  activeHopModel = model;
  activePeriodLabel = options.periodLabel || "";
  pendingViewInfoTooltip = null;
  if (Object.prototype.hasOwnProperty.call(options, "anonymizeNames")) {
    model?.setAnonymizeNames?.(options.anonymizeNames);
  }
  background(52);
  const pad = 32;
  const contentPad = 0;
  const revenue = sum(model.invoices, "totalPrice");
  const typeCounts = countInvoiceTypes(model.invoices);

  const uiState = {
    navView: drawHopNav(pad, HOP_TOP_BUTTON_Y, navItems, currentView),
    clearClicked: drawClearDataButton(),
  };
  const contentTop = HOP_CONTENT_TOP;
  drawTopDetailBackground();
  drawViewPanelBackground(contentTop);

  if (currentView === "activity") {
    drawActivityView(model.activity, model.ticketSalesTimeline || model.ticketSales, contentPad, contentTop);
    return uiState;
  }

  if (currentView === "activitynetwork") {
    drawActivityNetworkView(model.activityNetwork, contentPad, contentTop);
    return uiState;
  }

  if (currentView === "usernetwork") {
    drawUserNetworkView(model.userNetwork, contentPad, contentTop);
    return uiState;
  }

  if (currentView === "ticketsales") {
    drawTicketSalesView(model.ticketSales, contentPad, contentTop);
    return uiState;
  }

  if (currentView === "ticketbuyers") {
    drawTicketBuyersView(model.ticketBuyers, contentPad, contentTop);
    return uiState;
  }

  if (currentView === "revenuegroups") {
    drawRevenueGroupsView(model.customers, contentPad, contentTop, revenueGroupCount || 8, !!revenueGroupsExcludeMembership);
    return uiState;
  }

  if (currentView === "buyerpattern") {
    drawBuyerPatternView(model.buyerPatterns, contentPad, contentTop);
    return uiState;
  }

  if (currentView === "retention") {
    drawRetentionView(model.retention, contentPad, contentTop);
    return uiState;
  }

  if (currentView === "activitypath") {
    drawActivityPathView(model.activityPath, contentPad, contentTop);
    return uiState;
  }

  if (currentView === "gateway") {
    drawGatewayView(model.activityPath, contentPad, contentTop);
    return uiState;
  }

  if (currentView === "pipeline") {
    drawMembershipPipelineView(model.membershipPipeline, contentPad, contentTop);
    return uiState;
  }

  if (currentView === "producthealth") {
    drawProductHealthView(model.productHealth, contentPad, contentTop);
    return uiState;
  }

  if (currentView === "segments") {
    drawCustomerSegmentsView(model.customerSegments, contentPad, contentTop);
    return uiState;
  }

  if (currentView === "exitpoints") {
    drawExitPointsView(model.exitPoints, contentPad, contentTop);
    return uiState;
  }

  if (currentView === "memberlength") {
    drawMembershipLengthView(model.membershipLength, contentPad, contentTop);
    return uiState;
  }

  if (currentView === "memberdistribution") {
    drawMemberDistributionView(model.membershipLength?.distribution, contentPad, contentTop);
    return uiState;
  }

  if (currentView !== "overview") {
    drawPlaceholderView(currentView, contentPad + 16, contentTop + 14);
    return uiState;
  }

  const cardY = contentTop + 14;
  const cardW = (width - pad * 2 - 32) / 3;
  drawStatCard(pad, cardY, cardW, 96, "Revenue", formatDkk(revenue));
  drawStatCard(pad + (cardW + 16), cardY, cardW, 96, "Customers", formatInteger(model.customers.length));
  drawStatCard(pad + (cardW + 16) * 2, cardY, cardW, 96, "Invoices", formatInteger(model.invoices.length));

  const chartTop = cardY + 132;
  const chartH = max(180, (height - chartTop - pad * 1.5) * 0.52);
  const bucketLabel = timeBucketLabel(timeBucket).toLowerCase();
  drawLineChart(pad, chartTop, width - pad * 2, chartH, model.months, `${bucketLabel} revenue`, "revenue", formatDkk);

  const lowerY = chartTop + chartH + 28;
  const lowerH = height - lowerY - pad;
  drawLineChart(pad, lowerY, (width - pad * 3) * 0.58, lowerH, model.months, `Active customers by ${bucketLabel}`, "customerCount", formatInteger);
  drawCategoryBars(pad * 2 + (width - pad * 3) * 0.58, lowerY, (width - pad * 3) * 0.42, lowerH, typeCounts);

  fill(40);
  textAlign(LEFT, TOP);
  textSize(13);
  text(`overview: ${currentView}`, pad, height - 26);
  return uiState;
}

function drawPlaceholderView(currentView, x, y) {
  fill(35);
  textAlign(LEFT, TOP);
  textSize(28);
  text(currentView, x, y);
  textSize(16);
  fill(80);
  text("This view is ready for its own analysis.", x, y + 44);
}

function drawViewPanelBackground(top = HOP_CONTENT_TOP) {
  fill(HOP_PANEL_BG);
  noStroke();
  rect(0, top, width, height - top);
}

function drawTopDetailBackground() {
  fill(44);
  noStroke();
  rect(0, HOP_DETAIL_TOP, width, HOP_CONTENT_TOP - HOP_DETAIL_TOP);
  stroke(68);
  strokeWeight(1);
  line(0, HOP_DETAIL_TOP, width, HOP_DETAIL_TOP);
  stroke(34);
  line(0, HOP_CONTENT_TOP - 0.5, width, HOP_CONTENT_TOP - 0.5);
  noStroke();
}

function drawSoftPanel(x, y, w, h, radius = 4) {
  fill(HOP_CARD_BG);
  stroke(HOP_CARD_STROKE);
  strokeWeight(1);
  rect(x, y, w, h, radius);
  noStroke();
}

function drawActivityView(activity, ticketSales, pad, top) {
  const months = mergeActivityTimeline(activity?.months || [], ticketSales?.weeks || []);
  const membershipSeries = membershipTypeSeries(activity?.membershipTypes || []);
  const moneyScale = "money";
  const countScale = "count";
  const series = [
    { key: "totalRevenue", label: "Revenue", color: [0, 0, 0], formatter: formatDkk, scale: moneyScale, legendOrder: 10 },
    { key: "yearTotalRevenue", label: "Year accumulated revenue", color: [90, 90, 90], formatter: formatDkk, scale: moneyScale, legendOrder: 11 },
    { key: "revenue", label: "Member revenue", color: [20, 20, 20], formatter: formatDkk, scale: moneyScale, legendOrder: 12 },
    { key: "classRevenue", label: "Activity revenue", color: [60, 140, 85], formatter: formatDkk, scale: moneyScale, legendOrder: 13 },
    { key: "eventRevenue", label: "Event revenue", color: [135, 85, 170], formatter: formatDkk, scale: moneyScale, legendOrder: 14 },
    { key: "classTickets", label: "Activity tickets", color: [90, 165, 90], formatter: formatInteger, scale: countScale, legendOrder: 30 },
    { key: "eventTickets", label: "Event tickets", color: [155, 105, 190], formatter: formatInteger, scale: countScale, legendOrder: 31 },
    { key: "activeTicketUsersWithMembership", label: "Ticket users (w.m)", color: [34, 190, 125], formatter: formatInteger, scale: countScale, legendOrder: 40 },
    { key: "activeTicketUsersWithoutMembership", label: "Ticket users (wo.m)", color: [68, 145, 255], formatter: formatInteger, scale: countScale, legendOrder: 41 },
    { key: "singleTicketBuyers", label: "Single ticket", color: [255, 165, 45], formatter: formatInteger, scale: countScale, legendOrder: 42 },
    { key: "firstTouchpoints", label: "First touchpoints", color: [30, 170, 190], formatter: formatInteger, scale: countScale, legendOrder: 50 },
    { key: "lastTouchpoints", label: "Last touchpoints", color: [220, 95, 95], formatter: formatInteger, scale: countScale, legendOrder: 51 },
    { key: "memberCount", label: "Member count", color: [190, 90, 35], formatter: formatInteger, scale: countScale, legendOrder: 60 },
    { key: "newMemberships", label: "New memberships", color: [26, 105, 180], formatter: formatInteger, scale: countScale, legendOrder: 61 },
    { key: "endedMemberships", label: "Ended memberships", color: [210, 55, 55], formatter: formatInteger, scale: countScale, legendOrder: 62 },
    ...membershipSeries,
    { key: "crewCount", label: "Crew count", color: [190, 112, 255], formatter: formatInteger, scale: countScale, legendOrder: 80 },
  ];
  const labels = ticketItemsToTimelineLabels(ticketSales?.items || []).map((label) => ({
    ...label,
    legendOrder: label.type === "Event" ? 101 : 100,
  }));
  drawHopTimelineChart(pad, top, width - pad * 2, height - top - pad, months, visibleActivityTitle(series, labels), series, labels, { ...timelineChartState(), infoKey: "activity", showMissingDataEdges: true });
}

function visibleActivityTitle(series, labels) {
  const state = timelineChartState();
  const visibleSeries = series.filter((item) => !state.hiddenSeriesKeys.has(item.key)).map((item) => item.label);
  const visibleLabelTypes = [...new Map(labels
    .filter((label) => !state.hiddenLabelTypes.has(label.type))
    .map((label) => [label.type, label.legendLabel || `${label.type}s`])).values()];
  const visible = [...visibleSeries, ...visibleLabelTypes];
  if (!visible.length) return "Activity: no labels selected";
  const title = visible.slice(0, 4).join(", ");
  return `Activity: ${title}${visible.length > 4 ? ` +${visible.length - 4}` : ""}`;
}

function membershipTypeSeries(membershipTypes) {
  const colors = [
    [230, 130, 55],
    [210, 95, 60],
    [175, 120, 45],
    [235, 165, 80],
    [155, 90, 35],
  ];
  return membershipTypes.slice(0, 8).map((type, index) => ({
    key: `membershipType:${type.key}`,
    label: trimText(type.label, 22),
    color: colors[index % colors.length],
    formatter: formatInteger,
    scale: "count",
    legendOrder: 70 + index,
  }));
}

function drawActivityNetworkView(network, pad, top) {
  fill(238);
  noStroke();
  rect(pad, top, width - pad * 2, height - top - pad, 4);
  drawViewHeader("Activity Network", pad + 18, top + 16, "activityNetwork");

  if (!network?.nodes?.length) {
    fill(80);
    textSize(14);
    text("No activity or event tickets in this range.", pad + 18, top + 54);
    return;
  }

  const plotX = pad + 28;
  const plotY = top + 62;
  const plotW = width - pad * 2 - 56;
  const plotH = height - top - pad - 96;
  activityNetworkBounds = { x: plotX, y: plotY, w: plotW, h: plotH };
  syncActivityNetworkState(network, plotX, plotY, plotW, plotH);
  stepActivityNetwork(network, plotX, plotY, plotW, plotH);
  drawActivityNetwork(plotX, plotY, plotW, plotH, network);
}

function syncActivityNetworkState(network, plotX, plotY, plotW, plotH) {
  const key = `${network.nodes.length}:${network.links.length}:${network.nodes.map((node) => `${node.key}:${node.tickets}`).join("|")}`;
  if (activityNetworkState?.key === key) return;
  activityNetworkState = {
    key,
    nodes: new Map(network.nodes.map((node, index) => {
      const x = plotX + map(node.avgExperience || 0, 0, network.maxExperience || 1, 40, plotW - 40);
      const y = plotY + 40 + ((hashText(node.key) % 1000) / 1000) * max(1, plotH - 80);
      return [node.key, { x, y, vx: 0, vy: 0, index }];
    })),
  };
}

function stepActivityNetwork(network, plotX, plotY, plotW, plotH) {
  const states = activityNetworkState.nodes;
  const nodeList = network.nodes;
  for (let iteration = 0; iteration < 2; iteration += 1) {
    for (const link of network.links.slice(0, 900)) {
      const a = states.get(link.source);
      const b = states.get(link.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = max(1, sqrt(dx * dx + dy * dy));
      const desired = 70 + 140 / sqrt(max(1, link.weight));
      const force = (distance - desired) * 0.0014 * min(7, sqrt(link.weight));
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    for (let i = 0; i < nodeList.length; i += 1) {
      const a = states.get(nodeList[i].key);
      if (!a) continue;
      for (let j = i + 1; j < nodeList.length; j += 1) {
        const b = states.get(nodeList[j].key);
        if (!b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distanceSq = max(25, dx * dx + dy * dy);
        const distance = sqrt(distanceSq);
        const minDistance = 34;
        const closePush = distance < minDistance ? (minDistance - distance) * 0.035 : 0;
        const force = min(2.3, 220 / distanceSq) + closePush;
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    for (const node of nodeList) {
    const state = states.get(node.key);
    if (!state) continue;
    if (state.pinned) continue;
      const targetX = plotX + map(node.avgExperience || 0, 0, network.maxExperience || 1, 40, plotW - 40);
      const targetY = plotY + plotH * 0.5;
      state.vx += (targetX - state.x) * 0.012;
      state.vy += (targetY - state.y) * 0.002;
      state.vx *= 0.82;
      state.vy *= 0.82;
      state.x = constrain(state.x + state.vx, plotX + 10, plotX + plotW - 10);
      state.y = constrain(state.y + state.vy, plotY + 10, plotY + plotH - 10);
    }
  }
}

function drawActivityNetwork(plotX, plotY, plotW, plotH, network) {
  const states = activityNetworkState.nodes;
  fill(85);
  textSize(11);
  textAlign(LEFT, TOP);
  text("first-timer nodes", plotX, plotY - 22);
  textAlign(RIGHT, TOP);
  text("higher-experience nodes", plotX + plotW, plotY - 22);

  stroke(210);
  strokeWeight(1);
  line(plotX, plotY + plotH + 8, plotX + plotW, plotY + plotH + 8);

  const visibleLinks = network.links.slice(0, 900);
  const hoverInfo = getActivityNetworkNodeHit(mouseX, mouseY);
  const highlightKeys = hoverInfo ? connectedNodeKeys(hoverInfo.node.key, visibleLinks) : null;

  for (const link of visibleLinks) {
    const a = states.get(link.source);
    const b = states.get(link.target);
    if (!a || !b) continue;
    const strength = sqrt(min(link.weight, 40));
    const isHighlighted = highlightKeys?.has(link.source) && highlightKeys?.has(link.target);
    const alpha = hoverInfo ? isHighlighted ? map(strength, 1, sqrt(40), 90, 220) : 8 : map(strength, 1, sqrt(40), 18, 165);
    stroke(20, 20, 20, alpha);
    strokeWeight(map(strength, 1, sqrt(40), isHighlighted ? 1.5 : 0.5, isHighlighted ? 10 : 8));
    line(a.x, a.y, b.x, b.y);
  }

  let hovered = hoverInfo;
  noStroke();
  for (const node of network.nodes) {
    const state = states.get(node.key);
    if (!state) continue;
    const radius = map(sqrt(node.revenue), 0, sqrt(network.maxRevenue || 1), 5, 28);
    const color = node.type === "Event" ? [135, 85, 170] : [60, 140, 85];
    const isHover = hovered?.node.key === node.key;
    const isHighlighted = !highlightKeys || highlightKeys.has(node.key);
    fill(color[0], color[1], color[2], isHover ? 245 : isHighlighted ? 190 : 28);
    circle(state.x, state.y, radius * 2);
    if (state.pinned) {
      noFill();
      stroke(20, 190);
      strokeWeight(2);
      circle(state.x, state.y, radius * 2 + 8);
      noStroke();
    }
    fill(255, isHover ? 220 : isHighlighted ? 120 : 25);
    circle(state.x, state.y, max(3, radius * (node.firstTimerPurchases / max(1, node.purchaseCount))));
  }

  if (hovered) {
    drawNetworkNeighborLabels(network.nodes, states, highlightKeys, hovered.node.key, (node) => map(sqrt(node.revenue), 0, sqrt(network.maxRevenue || 1), 5, 28));
    drawNetworkSidePanel(plotX, plotY, plotW, [
      hovered.node.label,
      `Type: ${hovered.node.type}`,
      `Buyers: ${formatInteger(hovered.node.buyerCount)}`,
      `Tickets: ${formatInteger(hovered.node.tickets)}`,
      `Revenue: ${formatDkk(hovered.node.revenue)}`,
      `Avg prior tickets: ${hovered.node.avgExperience.toFixed(1)}`,
      `First-timer purchases: ${formatInteger(hovered.node.firstTimerPurchases)}`,
    ]);
  }
}

function getActivityNetworkNodeHit(x, y) {
  if (!activityNetworkState?.nodes || !hopModel?.activityNetwork?.nodes) return null;
  let best = null;
  for (const node of hopModel.activityNetwork.nodes) {
    const state = activityNetworkState.nodes.get(node.key);
    if (!state) continue;
    const radius = map(sqrt(node.revenue), 0, sqrt(hopModel.activityNetwork.maxRevenue || 1), 5, 28);
    const distance = dist(x, y, state.x, state.y);
    if (distance <= radius + 6 && (!best || distance < best.distance)) {
      best = { node, state, radius, distance };
    }
  }
  return best;
}

function getActivityNetworkNodeState(key) {
  return activityNetworkState?.nodes?.get(key) || null;
}

function getActivityNetworkBounds() {
  return activityNetworkBounds;
}

function drawUserNetworkView(network, pad, top) {
  fill(238);
  noStroke();
  rect(pad, top, width - pad * 2, height - top - pad, 4);
  drawViewHeader("User Network", pad + 18, top + 16, "userNetwork");

  if (!network?.nodes?.length) {
    fill(80);
    textSize(14);
    text("No ticket buyers in this range.", pad + 18, top + 54);
    return;
  }

  const visibleNetwork = limitUserNetwork(network, 450);
  userNetworkVisible = visibleNetwork;
  const plotX = pad + 28;
  const plotY = top + 62;
  const plotW = width - pad * 2 - 56;
  const plotH = height - top - pad - 96;
  userNetworkBounds = { x: plotX, y: plotY, w: plotW, h: plotH };
  syncUserNetworkState(visibleNetwork, plotX, plotY, plotW, plotH);
  stepUserNetwork(visibleNetwork, plotX, plotY, plotW, plotH);
  drawUserNetwork(plotX, plotY, plotW, plotH, visibleNetwork, network.nodes.length);
}

function limitUserNetwork(network, maxNodes) {
  const nodes = network.nodes.slice(0, maxNodes);
  const nodeKeys = new Set(nodes.map((node) => node.key));
  const links = network.links.filter((link) => nodeKeys.has(link.source) && nodeKeys.has(link.target));
  return {
    ...network,
    nodes,
    links,
    maxRevenue: Math.max(1, ...nodes.map((node) => node.revenue)),
    maxTickets: Math.max(1, ...nodes.map((node) => node.tickets)),
    maxExperience: Math.max(1, ...nodes.map((node) => node.avgExperience)),
  };
}

function syncUserNetworkState(network, plotX, plotY, plotW, plotH) {
  const key = `${network.nodes.length}:${network.links.length}:${network.nodes.map((node) => `${node.key}:${node.tickets}:${node.activityCount}:${node.eventCount}`).join("|")}`;
  if (userNetworkState?.key === key) return;
  userNetworkState = {
    key,
    nodes: new Map(network.nodes.map((node, index) => {
      const x = plotX + map(node.avgExperience || 0, 0, network.maxExperience || 1, 40, plotW - 40);
      const y = plotY + 40 + ((hashText(node.key) % 1000) / 1000) * max(1, plotH - 80);
      return [node.key, { x, y, vx: 0, vy: 0, index }];
    })),
  };
}

function stepUserNetwork(network, plotX, plotY, plotW, plotH) {
  const states = userNetworkState.nodes;
  const nodeList = network.nodes;
  for (let iteration = 0; iteration < 2; iteration += 1) {
    for (const link of network.links.slice(0, 1200)) {
      const a = states.get(link.source);
      const b = states.get(link.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = max(1, sqrt(dx * dx + dy * dy));
      const desired = 65 + 120 / sqrt(max(1, link.weight));
      const force = (distance - desired) * 0.0012 * min(6, sqrt(link.weight));
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    for (let i = 0; i < nodeList.length; i += 1) {
      const a = states.get(nodeList[i].key);
      if (!a) continue;
      for (let j = i + 1; j < nodeList.length; j += 1) {
        const b = states.get(nodeList[j].key);
        if (!b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distanceSq = max(36, dx * dx + dy * dy);
        const distance = sqrt(distanceSq);
        const minDistance = 18;
        const closePush = distance < minDistance ? (minDistance - distance) * 0.02 : 0;
        const force = min(1.7, 150 / distanceSq) + closePush;
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    for (const node of nodeList) {
      const state = states.get(node.key);
      if (!state) continue;
      if (state.pinned) continue;
      const targetX = plotX + map(node.avgExperience || 0, 0, network.maxExperience || 1, 40, plotW - 40);
      const targetY = plotY + plotH * 0.5;
      state.vx += (targetX - state.x) * 0.01;
      state.vy += (targetY - state.y) * 0.0018;
      state.vx *= 0.84;
      state.vy *= 0.84;
      state.x = constrain(state.x + state.vx, plotX + 8, plotX + plotW - 8);
      state.y = constrain(state.y + state.vy, plotY + 8, plotY + plotH - 8);
    }
  }
}

function drawUserNetwork(plotX, plotY, plotW, plotH, network, totalNodeCount) {
  const states = userNetworkState.nodes;
  fill(85);
  textSize(11);
  textAlign(LEFT, TOP);
  text("few shared activities", plotX, plotY - 22);
  textAlign(RIGHT, TOP);
  text("broader activity history", plotX + plotW, plotY - 22);
  fill(90);
  textAlign(RIGHT, TOP);
  text(`showing top ${network.nodes.length}/${totalNodeCount} buyers`, plotX + plotW, plotY - 38);

  stroke(210);
  strokeWeight(1);
  line(plotX, plotY + plotH + 8, plotX + plotW, plotY + plotH + 8);

  const visibleLinks = network.links.slice(0, 1200);
  const hoverInfo = getUserNetworkNodeHit(mouseX, mouseY);
  const highlightKeys = hoverInfo ? connectedNodeKeys(hoverInfo.node.key, visibleLinks) : null;

  for (const link of visibleLinks) {
    const a = states.get(link.source);
    const b = states.get(link.target);
    if (!a || !b) continue;
    const strength = sqrt(min(link.weight, 50));
    const isHighlighted = highlightKeys?.has(link.source) && highlightKeys?.has(link.target);
    stroke(20, 20, 20, hoverInfo ? isHighlighted ? map(strength, 1, sqrt(50), 85, 210) : 6 : map(strength, 1, sqrt(50), 10, 130));
    strokeWeight(map(strength, 1, sqrt(50), isHighlighted ? 1.4 : 0.4, isHighlighted ? 7 : 5));
    line(a.x, a.y, b.x, b.y);
  }

  let hovered = hoverInfo;
  noStroke();
  for (const node of network.nodes) {
    const state = states.get(node.key);
    if (!state) continue;
    const radius = map(sqrt(node.tickets), 0, sqrt(network.maxTickets || 1), 3, 18);
    const color = node.type === "Recurring" ? [68, 145, 255] : [120, 120, 120];
    const isHover = hovered?.node.key === node.key;
    const isHighlighted = !highlightKeys || highlightKeys.has(node.key);
    fill(color[0], color[1], color[2], isHover ? 245 : isHighlighted ? 190 : 26);
    circle(state.x, state.y, radius * 2);
    if (state.pinned) {
      noFill();
      stroke(20, 190);
      strokeWeight(2);
      circle(state.x, state.y, radius * 2 + 7);
      noStroke();
    }
    fill(255, isHover ? 220 : isHighlighted ? 115 : 24);
    circle(state.x, state.y, max(3, radius * (node.eventCount / max(1, node.activityCount + node.eventCount))));
  }

  if (hovered) {
    drawNetworkNeighborLabels(network.nodes, states, highlightKeys, hovered.node.key, (node) => map(sqrt(node.tickets), 0, sqrt(network.maxTickets || 1), 3, 18), displayPersonName);
    drawNetworkSidePanel(plotX, plotY, plotW, [
      displayPersonName(hovered.node),
      `Type: ${hovered.node.type}`,
      `Tickets: ${formatInteger(hovered.node.tickets)}`,
      `Revenue: ${formatDkk(hovered.node.revenue)}`,
      `Activities: ${formatInteger(hovered.node.activityCount)}`,
      `Events: ${formatInteger(hovered.node.eventCount)}`,
    ]);
  }
}

function connectedNodeKeys(nodeKey, links) {
  const keys = new Set([nodeKey]);
  for (const link of links) {
    if (link.source === nodeKey) keys.add(link.target);
    if (link.target === nodeKey) keys.add(link.source);
  }
  return keys;
}

function drawNetworkNeighborLabels(nodes, states, highlightKeys, hoveredKey, radiusForNode, nameForNode = (node) => node.label) {
  if (!highlightKeys) return;
  fill(20);
  noStroke();
  textSize(10);
  textAlign(CENTER, BOTTOM);
  for (const node of nodes) {
    if (node.key === hoveredKey || !highlightKeys.has(node.key)) continue;
    const state = states.get(node.key);
    if (!state) continue;
    const radius = radiusForNode(node);
    text(trimText(nameForNode(node), 24), state.x, state.y - radius - 6);
  }
}

function drawNetworkSidePanel(plotX, plotY, plotW, lines) {
  const panelW = 260;
  const panelX = plotX + plotW - panelW - 12;
  const panelY = plotY + 10;
  const wrapped = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const width = index === 0 ? 28 : 34;
    wrapped.push(...wrapText(line, width));
  }
  const panelH = min(230, 28 + wrapped.length * 16);

  fill(238, 232);
  stroke(20, 45);
  strokeWeight(1);
  rect(panelX, panelY, panelW, panelH, 4);
  noStroke();
  fill(20);
  textAlign(LEFT, TOP);
  for (let index = 0; index < wrapped.length; index += 1) {
    textSize(index === 0 ? 13 : 11);
    text(wrapped[index], panelX + 12, panelY + 10 + index * 16);
  }
}

function getUserNetworkNodeHit(x, y) {
  if (!userNetworkState?.nodes || !userNetworkVisible?.nodes) return null;
  let best = null;
  for (const node of userNetworkVisible.nodes) {
    const state = userNetworkState.nodes.get(node.key);
    if (!state) continue;
    const radius = map(sqrt(node.tickets), 0, sqrt(userNetworkVisible.maxTickets || 1), 3, 18);
    const distance = dist(x, y, state.x, state.y);
    if (distance <= radius + 7 && (!best || distance < best.distance)) {
      best = { node, state, radius, distance };
    }
  }
  return best;
}

function getUserNetworkNodeState(key) {
  return userNetworkState?.nodes?.get(key) || null;
}

function getUserNetworkBounds() {
  return userNetworkBounds;
}

function mergeActivityTimeline(activityWeeks, ticketWeeks) {
  const byWeek = new Map();
  for (const week of activityWeeks) {
    const mergedWeek = { ...week };
    for (const [typeKey, count] of Object.entries(week.membershipTypeCounts || {})) {
      mergedWeek[`membershipType:${typeKey}`] = count;
    }
    byWeek.set(week.month, mergedWeek);
  }
  for (const week of ticketWeeks) {
    const merged = byWeek.get(week.month) || { month: week.month, revenue: 0, newMemberships: 0, endedMemberships: 0, memberCount: 0 };
    merged.classRevenue = week.classRevenue || 0;
    merged.eventRevenue = week.eventRevenue || 0;
    merged.classTickets = week.classTickets || 0;
    merged.eventTickets = week.eventTickets || 0;
    merged.activeTicketUsers = week.activeTicketUsers || 0;
    merged.activeTicketUsersWithMembership = countSetIntersection(week.customerKeys || new Set(), merged.customerKeys || new Set());
    merged.activeTicketUsersWithoutMembership = (week.customerKeys?.size || 0) - merged.activeTicketUsersWithMembership;
    byWeek.set(week.month, merged);
  }
  let activeYear = "";
  let yearTotalRevenue = 0;
  return Array.from(byWeek.values()).map((week) => ({
    ...week,
    totalRevenue: (week.revenue || 0) + (week.classRevenue || 0) + (week.eventRevenue || 0),
  })).sort((a, b) => a.month.localeCompare(b.month)).map((week) => {
    const year = String(week.month).slice(0, 4);
    if (year !== activeYear) {
      activeYear = year;
      yearTotalRevenue = 0;
    }
    yearTotalRevenue += week.totalRevenue || 0;
    return { ...week, yearTotalRevenue };
  });
}

function countSetIntersection(a, b) {
  let count = 0;
  for (const value of a) {
    if (b.has(value)) count += 1;
  }
  return count;
}

function drawTicketSalesView(ticketSales, pad, top) {
  const weeks = ticketSales?.weeks || [];
  const items = ticketSales?.items || [];
  const chartH = max(220, (height - top - pad * 2) * 0.62);
  drawHopTimelineChart(pad, top, width - pad * 2, chartH, weeks, "Ticket sales", [
    { key: "classRevenue", label: "Activity revenue", color: [20, 20, 20], formatter: formatDkk },
    { key: "eventRevenue", label: "Event revenue", color: [26, 105, 180], formatter: formatDkk },
    { key: "classTickets", label: "Activity tickets", color: [190, 90, 35], formatter: formatInteger },
    { key: "eventTickets", label: "Event tickets", color: [60, 140, 85], formatter: formatInteger },
  ], [], { ...timelineChartState(), infoKey: "ticketSales" });

  drawTicketItemBars(pad, top + chartH + 28, width - pad * 2, height - top - chartH - pad - 28, items);
}

function ticketItemsToTimelineLabels(items) {
  return items.map((item) => ({
    type: item.type,
    legendLabel: item.type === "Event" ? "Events" : "Activities",
    label: item.label,
    period: item.lastWeek,
    periodLabel: "Last sold",
    value: item.revenue,
    valueLabel: "Revenue",
    valueFormatter: formatDkk,
    count: item.tickets,
    countLabel: "Tickets",
    countFormatter: formatInteger,
    color: item.type === "Event" ? [135, 85, 170] : [60, 140, 85],
  }));
}

function timelineChartState() {
  return {
    toggleHits: chartToggleHits,
    hiddenSeriesKeys,
    hiddenLabelTypes: hiddenTimelineLabelTypes,
    timeBucket,
    rangeStartMs: typeof selectedStartMs === "number" ? selectedStartMs : 0,
    rangeEndMs: typeof selectedEndMs === "number" ? selectedEndMs : 0,
    dataStartMs: typeof fullStartMs === "number" ? fullStartMs : 0,
    dataEndMs: typeof fullEndMs === "number" ? fullEndMs : 0,
    smoothTimelineCurves: !!timelineSmoothCurves,
    stackedTimelineLines: !!timelineStackedLines,
  };
}

function drawTicketItemBars(x, y, w, h, items) {
  fill(238);
  noStroke();
  rect(x, y, w, h, 4);
  drawViewHeader("Top activities and events", x + 18, y + 16, "ticketItems");

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

function drawTicketBuyersView(ticketBuyers, pad, top) {
  const summary = ticketBuyers?.summary || {};
  const buyers = ticketBuyers?.buyers || [];
  const periods = ticketBuyers?.periods || [];
  const cardW = (width - pad * 2 - 48) / 4;
  fill(238);
  noStroke();
  rect(pad, top, width - pad * 2, 36, 4);
  drawViewHeader("Ticket Buyers", pad + 18, top + 16, "ticketBuyers");
  drawStatCard(pad, top + 38, cardW, 82, "Ticket buyers", formatInteger(summary.total || 0));
  drawStatCard(pad + (cardW + 16), top + 38, cardW, 82, "Single buyers", formatInteger(summary.single || 0));
  drawStatCard(pad + (cardW + 16) * 2, top + 38, cardW, 82, "Recurring active", formatInteger(summary.activeRecurring || 0));
  drawStatCard(pad + (cardW + 16) * 3, top + 38, cardW, 82, "Ticket revenue", formatDkk(summary.revenue || 0));
  drawTicketBuyerHeatmap(pad, top + 148, width - pad * 2, height - top - pad - 148, buyers, periods);
}

function drawTicketBuyerHeatmap(x, y, w, h, buyers, periods) {
  fill(238);
  noStroke();
  rect(x, y, w, h, 4);
  drawViewHeader("Ticket buyer activity", x + 18, y + 16, "ticketBuyers");

  if (!buyers.length || !periods.length) {
    fill(80);
    textSize(14);
    text("No ticket buyer data in this range.", x + 18, y + 54);
    return;
  }

  const plotX = x + 18;
  const plotY = y + 58;
  const plotW = w - 36;
  const plotH = h - 92;
  const rowH = plotH / max(1, buyers.length);
  const maxTickets = max(1, ...buyers.flatMap((buyer) => buyer.periods.map((period) => period.tickets)));
  const maxRevenue = max(1, ...buyers.flatMap((buyer) => buyer.periods.map((period) => period.revenue)));
  const periodIndex = new Map(periods.map((period, index) => [period, index]));

  stroke(215, 80);
  strokeWeight(1);
  line(plotX, plotY + plotH + 8, plotX + plotW, plotY + plotH + 8);

  let hovered = null;
  noStroke();
  for (let rowIndex = 0; rowIndex < buyers.length; rowIndex += 1) {
    const buyer = buyers[rowIndex];
    const py = plotY + rowH * (rowIndex + 0.5);
    const rowColor = buyer.segment === "Recurring" ? [26, 105, 180] : buyer.segment === "Single" ? [95, 95, 95] : [190, 90, 35];
    const rowIndexes = buyer.periods
      .map((period) => periodIndex.get(period.period))
      .filter((index) => index !== undefined);
    const firstIndex = rowIndexes.length ? min(...rowIndexes) : 0;
    const lastIndex = rowIndexes.length ? max(...rowIndexes) : 0;
    const startX = plotX + (periods.length <= 1 ? 0 : (firstIndex / (periods.length - 1)) * plotW);
    const endX = plotX + (periods.length <= 1 ? 0 : (lastIndex / (periods.length - 1)) * plotW);
    for (const period of buyer.periods) {
      const index = periodIndex.get(period.period);
      if (index === undefined) continue;
      const px = plotX + (periods.length <= 1 ? 0 : (index / (periods.length - 1)) * plotW);
      const ticketRadius = map(sqrt(period.tickets), 0, sqrt(maxTickets), 1.2, min(8, max(1.4, rowH * 0.72)));
      const revenueBoost = map(sqrt(max(0, period.revenue)), 0, sqrt(maxRevenue), 0, min(3, rowH * 0.25));
      const radius = ticketRadius + revenueBoost;
      const color = rowColor;
      const isHover = dist(mouseX, mouseY, px, py) <= max(8, radius + 4);
      fill(color[0], color[1], color[2], isHover ? 235 : buyer.segment === "Single" ? 70 : 120);
      circle(px, py, radius * 2);
      if (isHover) hovered = { buyer, period, rowIndex, py, color, startX, endX };
    }
  }

  if (hovered) {
    stroke(hovered.color[0], hovered.color[1], hovered.color[2], 210);
    strokeWeight(2.2);
    line(hovered.startX, hovered.py, hovered.endX, hovered.py);
    noStroke();
  }

  drawTicketBuyerSegmentLabels(plotX, plotY, plotH, buyers);

  fill(80);
  textSize(11);
  textAlign(LEFT, TOP);
  text(periods[0] || "", plotX, y + h - 24);
  textAlign(RIGHT, TOP);
  text(periods.at(-1) || "", plotX + plotW, y + h - 24);

  fill(90);
  textAlign(RIGHT, TOP);
  text(`showing all ${buyers.length} buyers`, x + w - 18, y + 18);

  if (hovered) {
    drawTooltip(mouseX, mouseY, [
      displayPersonName(hovered.buyer),
      `Buyer #${hovered.rowIndex + 1}`,
      `Segment: ${hovered.buyer.segment}`,
      `Period: ${hovered.period.period}`,
      `Tickets: ${formatInteger(hovered.period.tickets)}`,
      `Revenue: ${formatDkk(hovered.period.revenue)}`,
      `Total tickets: ${formatInteger(hovered.buyer.totalTickets)}`,
    ]);
  }
}

function drawTicketBuyerSegmentLabels(plotX, plotY, plotH, buyers) {
  const firstBySegment = new Map();
  buyers.forEach((buyer, index) => {
    if (!firstBySegment.has(buyer.segment)) firstBySegment.set(buyer.segment, index);
  });
  const rowH = plotH / max(1, buyers.length);
  textSize(10);
  textAlign(LEFT, CENTER);
  noStroke();
  for (const [segment, index] of firstBySegment.entries()) {
    const y = plotY + rowH * (index + 0.5);
    const color = segment === "Recurring" ? [26, 105, 180] : segment === "Single" ? [95, 95, 95] : [190, 90, 35];
    fill(color[0], color[1], color[2], 180);
    text(segment, plotX, y);
  }
}

function drawRevenueGroupsView(customers, pad, top, groupCount, excludeMembershipRevenue = false) {
  const revenueLabel = excludeMembershipRevenue ? "Activity + event revenue" : "Stacked revenue";
  const payingCustomers = (customers || [])
    .filter((customer) => customer.ticketRevenue + (excludeMembershipRevenue ? 0 : customer.membershipRevenue) > 0)
    .sort((a, b) => {
      const aTickets = a.classPassCount + a.eventCount;
      const bTickets = b.classPassCount + b.eventCount;
      const aRevenue = a.ticketRevenue + (excludeMembershipRevenue ? 0 : a.membershipRevenue);
      const bRevenue = b.ticketRevenue + (excludeMembershipRevenue ? 0 : b.membershipRevenue);
      return bTickets - aTickets || b.membershipCount - a.membershipCount || bRevenue - aRevenue;
    });

  fill(238);
  noStroke();
  rect(pad, top, width - pad * 2, height - top - pad, 4);
  drawViewHeader("Revenue groups", pad + 18, top + 16, "revenueGroups");

  if (!payingCustomers.length) {
    fill(80);
    textSize(14);
    text("No paying customers in this range.", pad + 18, top + 54);
    return;
  }

  const groups = buildRevenueFrequencyGroups(payingCustomers, groupCount, excludeMembershipRevenue);
  const totalRevenue = sum(groups, "revenue");
  const maxRevenue = max(1, ...groups.map((group) => group.revenue));
  const maxPeople = max(1, ...groups.map((group) => group.people));
  const plotX = pad + 28;
  const plotY = top + 86;
  const plotW = width - pad * 2 - 56;
  const plotH = height - top - pad - 122;
  const innerPadX = 54;
  const barPlotX = plotX + innerPadX;
  const barPlotW = max(1, plotW - innerPadX * 2);
  const barGap = 8;
  const barW = max(4, (barPlotW - barGap * (groups.length - 1)) / groups.length);

  fill(85);
  textSize(11);
  textAlign(LEFT, TOP);
  text("one-time buyers", plotX, plotY - 22);
  textAlign(RIGHT, TOP);
  text(`${groupCount}+ activities`, plotX + plotW, plotY - 22);

  drawRevenueGroupLegend(plotX, top + 44, revenueLabel);

  fill(80);
  textSize(12);
  textAlign(RIGHT, TOP);
  text(`${formatInteger(payingCustomers.length)} paying people grouped by ticket/activity frequency`, plotX + plotW, top + 16);

  stroke(210);
  strokeWeight(1);
  line(plotX, plotY + plotH, plotX + plotW, plotY + plotH);
  drawRevenueGroupYAxis(plotX, plotY, plotW, plotH, maxRevenue, maxPeople);
  drawRevenueGroupXAxis(plotX, plotY + plotH, plotW);

  let hovered = null;
  const peoplePoints = [];
  noStroke();
  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i];
    const x = barPlotX + i * (barW + barGap);
    const h = map(group.revenue, 0, maxRevenue, 0, plotH * 0.86);
    const isHover = mouseX >= x && mouseX <= x + barW && mouseY >= plotY && mouseY <= plotY + plotH;

    drawRevenueGroupStackedBar(x, plotY + plotH, barW, h, group, isHover, excludeMembershipRevenue);

    const peopleY = plotY + plotH - map(group.people, 0, maxPeople, 0, plotH * 0.86);
    peoplePoints.push({ x: x + barW * 0.5, y: peopleY });
    fill(20, isHover ? 245 : 150);
    circle(x + barW * 0.5, peopleY, isHover ? 8 : 5);

    fill(70);
    textSize(10);
    textAlign(CENTER, TOP);
    text(group.label, x + barW * 0.5, plotY + plotH + 8);

    if (isHover) hovered = { group, x, h };
  }

  noFill();
  stroke(20, 160);
  strokeWeight(1.5);
  beginShape();
  for (const point of peoplePoints) vertex(point.x, point.y);
  endShape();
  noStroke();
  fill(20, 180);
  for (const point of peoplePoints) circle(point.x, point.y, 5);

  if (hovered) {
    drawTooltip(mouseX, mouseY, [
      `${hovered.group.label} activities/tickets`,
      `${revenueLabel}: ${formatDkk(hovered.group.revenue)} (${Math.round((hovered.group.revenue / totalRevenue) * 100)}%)`,
      `Activities: ${formatDkk(hovered.group.activityRevenue)}`,
      `Events: ${formatDkk(hovered.group.eventRevenue)}`,
      ...(excludeMembershipRevenue ? [] : [`Memberships: ${formatDkk(hovered.group.membershipRevenue)}`]),
      `People: ${formatInteger(hovered.group.people)}`,
      `Avg revenue/person: ${formatDkk(hovered.group.avgRevenue)}`,
      `Avg activities/person: ${hovered.group.avgActivities.toFixed(1)}`,
      `One-time ticket buyers: ${formatInteger(hovered.group.singleTicketBuyers)}`,
      `Recurring/member buyers: ${formatInteger(hovered.group.recurringBuyers)}`,
    ], 320);
  }
}

function drawRevenueGroupYAxis(plotX, plotY, plotW, plotH, maxRevenue, maxPeople) {
  const ticks = 4;
  const leftLabelX = plotX + 6;
  const rightLabelX = plotX + plotW - 6;
  const leftTickX = plotX + 42;
  const rightTickX = plotX + plotW - 42;
  textSize(10);
  for (let index = 0; index <= ticks; index += 1) {
    const y = plotY + plotH - (index / ticks) * plotH * 0.86;
    const revenue = (maxRevenue / ticks) * index;
    const people = (maxPeople / ticks) * index;

    stroke(index === 0 ? 160 : 220, index === 0 ? 180 : 100);
    strokeWeight(1);
    line(plotX, y, plotX + plotW, y);
    stroke(145);
    line(leftTickX - 6, y, leftTickX, y);
    line(rightTickX, y, rightTickX + 6, y);

    noStroke();
    fill(70);
    textAlign(LEFT, CENTER);
    text(formatCompactDkk(revenue), leftLabelX, y);
    textAlign(RIGHT, CENTER);
    text(formatInteger(round(people)), rightLabelX, y);
  }

  fill(70);
  textSize(10);
  textAlign(LEFT, TOP);
  text("revenue", leftLabelX, plotY + 6);
  textAlign(RIGHT, TOP);
  text("people", rightLabelX, plotY + 6);
}

function formatCompactDkk(value) {
  const amount = Math.round(value);
  if (Math.abs(amount) >= 1000000) return `${(amount / 1000000).toFixed(1)}m`;
  if (Math.abs(amount) >= 1000) return `${Math.round(amount / 1000)}k`;
  return String(amount);
}

function drawRevenueGroupXAxis(x, y, w) {
  stroke(145);
  strokeWeight(1);
  line(x, y, x + w, y);
  line(x, y, x, y + 5);
  line(x + w, y, x + w, y + 5);
  noStroke();
  fill(70);
  textSize(10);
  textAlign(CENTER, TOP);
  text("activity/event purchases per person", x + w * 0.5, y + 20);
}

function drawRevenueGroupStackedBar(x, baseY, w, totalH, group, isHover, excludeMembershipRevenue) {
  const parts = [
    { key: "activityRevenue", color: [60, 140, 85] },
    { key: "eventRevenue", color: [135, 85, 170] },
    ...(excludeMembershipRevenue ? [] : [{ key: "membershipRevenue", color: [230, 130, 55] }]),
  ];
  let cursorY = baseY;
  for (const part of parts) {
    const value = group[part.key] || 0;
    const h = group.revenue ? totalH * (value / group.revenue) : 0;
    cursorY -= h;
    fill(part.color[0], part.color[1], part.color[2], isHover ? 235 : 180);
    noStroke();
    rect(x, cursorY, w, h, 1);
  }
}

function buildRevenueFrequencyGroups(customers, maxSingleBucket, excludeMembershipRevenue = false) {
  const byActivityCount = new Map();
  for (const customer of customers) {
    const activityCount = customer.classPassCount + customer.eventCount;
    const bucket = activityCount >= maxSingleBucket ? `${maxSingleBucket}+` : String(activityCount);
    if (!byActivityCount.has(bucket)) byActivityCount.set(bucket, []);
    byActivityCount.get(bucket).push(customer);
  }

  const groups = [];
  for (let count = 1; count <= maxSingleBucket; count += 1) {
    const label = count === maxSingleBucket ? `${maxSingleBucket}+` : String(count);
    const entries = byActivityCount.get(label) || [];
    if (!entries.length) continue;
    const activityRevenue = sum(entries, "activityRevenue");
    const eventRevenue = sum(entries, "eventRevenue");
    const membershipRevenue = excludeMembershipRevenue ? 0 : sum(entries, "membershipRevenue");
    const revenue = activityRevenue + eventRevenue + membershipRevenue;
    const activities = entries.reduce((total, customer) => total + customer.classPassCount + customer.eventCount, 0);
    const singleTicketBuyers = entries.filter((customer) => customer.classPassCount + customer.eventCount === 1 && customer.membershipCount === 0).length;
    const recurringBuyers = entries.filter((customer) => customer.classPassCount + customer.eventCount > 1 || customer.membershipCount > 0).length;
    groups.push({
      label,
      people: entries.length,
      revenue,
      activityRevenue,
      eventRevenue,
      membershipRevenue,
      avgRevenue: revenue / entries.length,
      avgActivities: activities / entries.length,
      singleTicketBuyers,
      recurringBuyers,
    });
  }
  return groups;
}

function drawRevenueGroupLegend(x, y, revenueLabel = "Revenue") {
  const items = [
    { label: "Activities", color: [60, 140, 85] },
    { label: "Events", color: [135, 85, 170] },
    ...(revenueLabel === "Stacked revenue" ? [{ label: "Memberships", color: [230, 130, 55] }] : []),
    { label: "People", color: [20, 20, 20] },
  ];
  let lx = x + 180;
  textSize(11);
  textAlign(LEFT, CENTER);
  for (const item of items) {
    fill(item.color[0], item.color[1], item.color[2], 190);
    noStroke();
    circle(lx, y + 7, 8);
    fill(65);
    text(item.label, lx + 8, y + 7);
    lx += textWidth(item.label) + 34;
  }
}

function drawBuyerPatternView(buyerPatterns, pad, top) {
  pad = max(pad, 32);
  const summary = buyerPatterns?.summary || {};
  const journeys = buyerPatterns?.journeys || [];
  const windowSize = 200;
  const windowCount = max(1, ceil(journeys.length / windowSize));
  const windowIndex = constrain(buyerPatternWindowIndex || 0, 0, windowCount - 1);
  const windowStart = windowIndex * windowSize;
  const visibleJourneys = journeys.slice(windowStart, windowStart + 200);
  const cardW = (width - pad * 2 - 48) / 4;
  drawSoftPanel(pad, top, width - pad * 2, 36, 4);
  drawViewHeader("Buyer Pattern", pad + 18, top + 16, "buyerPattern");
  drawStatCard(pad, top + 38, cardW, 82, "Journeys", formatInteger(summary.total || 0));
  drawStatCard(pad + (cardW + 16), top + 38, cardW, 82, "Ticket only", formatInteger(summary.ticketOnly || 0));
  drawStatCard(pad + (cardW + 16) * 2, top + 38, cardW, 82, "Ticket to member", formatInteger(summary.ticketToMembership || 0));
  drawStatCard(pad + (cardW + 16) * 3, top + 38, cardW, 82, "Crew", formatInteger(summary.crew || 0));
  fill(210);
  noStroke();
  textSize(12);
  textAlign(LEFT, TOP);
  text(`Window ${windowIndex + 1}/${windowCount}: showing ${windowStart + 1}-${windowStart + visibleJourneys.length} sorted by cumulative revenue`, pad, top + 126);
  drawBuyerJourneyMap(pad, top + 148, width - pad * 2, height - top - pad - 148, visibleJourneys);
}

function drawActivityPathView(activityPath, pad, top) {
  pad = max(pad, 32);
  const allRows = activityPath?.rows || [];
  const allColumns = activityPath?.columns || [];
  fill(238);
  noStroke();
  rect(pad, top, width - pad * 2, height - top - pad, 4);
  drawViewHeader("Activity Path", pad + 18, top + 16, "activityPath");

  if (!allRows.length || !allColumns.length) {
    fill(80);
    textSize(14);
    textAlign(LEFT, TOP);
    text("No activity paths in this range.", pad + 18, top + 54);
    return;
  }

  const visibleRows = allRows.slice(0, 24);
  const visibleColumns = activityPathVisibleColumns(allColumns, 24);
  const labelX = pad + 24;
  const rowLabelW = min(230, max(150, width * 0.2));
  const barX = labelX + rowLabelW + 10;
  const barW = 44;
  const plotX = barX + barW + 18;
  const plotY = top + 126;
  const plotW = width - plotX - pad - 18;
  const plotH = height - plotY - pad - 34;
  const cellW = max(16, plotW / max(1, visibleColumns.length));
  const cellH = max(16, min(28, plotH / max(1, visibleRows.length)));
  const maxRowSize = max(1, ...visibleRows.map((row) => row.size));
  const targetByRow = new Map(visibleRows.map((row) => [
    row.key,
    new Map(row.targets.map((target) => [target.key, target])),
  ]));
  let hovered = null;

  fill(85);
  textSize(12);
  textAlign(LEFT, CENTER);
  const modeLabel = activityPath.mode === "range" ? "first in selected range" : "first ever";
  const headerDetail = `${formatInteger(activityPath.customerCount || 0)} buyers · ${modeLabel} · columns are next paid step · showing ${visibleRows.length}/${allRows.length} activities and ${visibleColumns.length}/${allColumns.length} next steps`;
  text(trimText(headerDetail, 140), pad + 176, top + 26);

  fill(80);
  textSize(10);
  textAlign(LEFT, BOTTOM);
  text("first activity", labelX, plotY - 8);
  text("buyers", barX, plotY - 8);
  for (let colIndex = 0; colIndex < visibleColumns.length; colIndex += 1) {
    const column = visibleColumns[colIndex];
    const x = plotX + colIndex * cellW + cellW * 0.5;
    push();
    translate(x, plotY - 12);
    rotate(-PI / 4);
    textAlign(LEFT, CENTER);
    fill(column.type === "Membership" ? color(40, 120, 90) : column.type === "No return" ? color(120) : color(70));
    text(trimText(column.label, 18), 0, 0);
    pop();
  }

  for (let rowIndex = 0; rowIndex < visibleRows.length; rowIndex += 1) {
    const row = visibleRows[rowIndex];
    const y = plotY + rowIndex * cellH;
    fill(55);
    textSize(10);
    textAlign(LEFT, CENTER);
    text(trimText(row.label, 32), labelX, y + cellH * 0.5);
    fill(row.type === "Event" ? color(210, 95, 70, 150) : color(60, 120, 170, 150));
    rect(barX, y + cellH * 0.28, map(row.size, 0, maxRowSize, 0, barW), cellH * 0.44, 1);

    const targetMap = targetByRow.get(row.key);
    const maxTargetCount = max(1, ...row.targets.map((target) => target.count || 0));
    for (let colIndex = 0; colIndex < visibleColumns.length; colIndex += 1) {
      const column = visibleColumns[colIndex];
      const target = targetMap.get(column.key);
      const x = plotX + colIndex * cellW;
      const rate = target?.rate || 0;
      const amount = target ? (target.count || 0) / maxTargetCount : 0;
      fill(target ? activityPathCellColor(amount, column.type) : 248);
      rect(x + 1, y + 1, max(1, cellW - 2), max(1, cellH - 2), 1);
      if (target && cellW > 34 && cellH > 18) {
        fill(amount > 0.65 && column.type !== "No return" ? 245 : 45);
        textSize(9);
        textAlign(CENTER, CENTER);
        text(formatInteger(target.count), x + cellW * 0.5, y + cellH * 0.5);
      }
      if (mouseX >= x && mouseX <= x + cellW && mouseY >= y && mouseY <= y + cellH) {
        hovered = { row, column, target };
      }
    }
  }

  if (hovered) {
    const count = hovered.target?.count || 0;
    const rate = hovered.row.size ? count / hovered.row.size : 0;
    drawTooltip(mouseX, mouseY, [
      ...wrapText(`${hovered.row.label} -> ${hovered.column.label}`, 34),
      `People: ${formatInteger(count)} / ${formatInteger(hovered.row.size)} (${formatPercent(rate)})`,
      `Next type: ${hovered.column.type}`,
      `Later revenue: ${formatDkk(hovered.target?.revenue || 0)}`,
    ], 300);
  }
}

function drawGatewayView(activityPath, pad, top) {
  const rows = gatewayRows(activityPath).slice(0, 18);
  fill(238);
  noStroke();
  rect(pad, top, width - pad * 2, height - top - pad, 4);
  drawViewHeader("Gateway", pad + 18, top + 16, "gateway");

  if (!rows.length) {
    fill(80);
    textSize(14);
    textAlign(LEFT, TOP);
    text("No gateway activities in this range.", pad + 18, top + 54);
    return;
  }

  const modeLabel = activityPath?.mode === "range" ? "first in selected range" : "first ever";
  fill(85);
  textSize(12);
  textAlign(LEFT, TOP);
  text(`Ranked by later revenue · based on ${modeLabel} paid activity/event`, pad + 18, top + 44);

  const tableX = pad + 18;
  const tableY = top + 82;
  const tableW = width - pad * 2 - 36;
  const rowH = min(34, max(24, (height - tableY - pad - 24) / rows.length));
  const nameW = min(300, tableW * 0.32);
  const peopleW = 64;
  const rateW = 90;
  const revenueX = tableX + nameW + peopleW + rateW * 3 + 22;
  const revenueW = tableX + tableW - revenueX;
  const maxRevenue = max(1, ...rows.map((row) => row.laterRevenue));
  let hovered = null;

  fill(75);
  textSize(10);
  textAlign(LEFT, BOTTOM);
  text("gateway activity", tableX, tableY - 8);
  textAlign(RIGHT, BOTTOM);
  text("people", tableX + nameW + peopleW - 8, tableY - 8);
  text("return", tableX + nameW + peopleW + rateW - 8, tableY - 8);
  text("member", tableX + nameW + peopleW + rateW * 2 - 8, tableY - 8);
  text("no return", tableX + nameW + peopleW + rateW * 3 - 8, tableY - 8);
  text("later revenue", tableX + tableW, tableY - 8);

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const y = tableY + index * rowH;
    const isHover = mouseX >= tableX && mouseX <= tableX + tableW && mouseY >= y && mouseY <= y + rowH;
    if (isHover) hovered = row;

    fill(isHover ? 225 : index % 2 ? 244 : 238);
    noStroke();
    rect(tableX - 6, y, tableW + 12, rowH, 2);

    fill(row.type === "Event" ? color(135, 85, 170) : color(60, 140, 85));
    rect(tableX, y + rowH * 0.34, 8, rowH * 0.32, 1);
    fill(40);
    textSize(11);
    textAlign(LEFT, CENTER);
    text(trimText(row.label, 38), tableX + 14, y + rowH * 0.5);

    textAlign(RIGHT, CENTER);
    fill(55);
    text(formatInteger(row.people), tableX + nameW + peopleW - 8, y + rowH * 0.5);
    text(formatPercent(row.returnRate), tableX + nameW + peopleW + rateW - 8, y + rowH * 0.5);
    text(formatPercent(row.membershipRate), tableX + nameW + peopleW + rateW * 2 - 8, y + rowH * 0.5);
    text(formatPercent(row.noReturnRate), tableX + nameW + peopleW + rateW * 3 - 8, y + rowH * 0.5);

    const barW = map(row.laterRevenue, 0, maxRevenue, 0, revenueW - 90);
    fill(20, 75);
    rect(revenueX, y + rowH * 0.28, barW, rowH * 0.44, 1);
    fill(35);
    text(formatDkk(row.laterRevenue), tableX + tableW, y + rowH * 0.5);
  }

  if (hovered) {
    drawTooltip(mouseX, mouseY, [
      ...wrapText(hovered.label, 34),
      `People: ${formatInteger(hovered.people)}`,
      `Returned: ${formatInteger(hovered.returned)} (${formatPercent(hovered.returnRate)})`,
      `Converted to membership: ${formatInteger(hovered.membership)} (${formatPercent(hovered.membershipRate)})`,
      `No return: ${formatInteger(hovered.noReturn)} (${formatPercent(hovered.noReturnRate)})`,
      `Later revenue: ${formatDkk(hovered.laterRevenue)}`,
    ], 300);
  }
}

function gatewayRows(activityPath) {
  return (activityPath?.rows || []).map((row) => {
    const membership = row.targets.find((target) => target.key === "__membership")?.count || 0;
    const noReturn = row.targets.find((target) => target.key === "__no_return")?.count || 0;
    const laterRevenue = sum(row.targets, "revenue");
    const returned = max(0, row.size - noReturn);
    return {
      label: row.label,
      type: row.type,
      people: row.size,
      returned,
      membership,
      noReturn,
      returnRate: row.size ? returned / row.size : 0,
      membershipRate: row.size ? membership / row.size : 0,
      noReturnRate: row.size ? noReturn / row.size : 0,
      laterRevenue,
    };
  }).sort((a, b) => b.laterRevenue - a.laterRevenue || b.returnRate - a.returnRate || b.people - a.people);
}

function drawMembershipPipelineView(pipeline, pad, top) {
  const stages = pipeline?.stages || [];
  const feeders = pipeline?.feeders || [];
  drawSoftPanel(pad, top, width - pad * 2, height - top - pad, 4);
  drawViewHeader("Membership Pipeline", pad + 18, top + 16, "pipeline");

  if (!stages.length) {
    fill(80);
    textSize(14);
    textAlign(LEFT, TOP);
    text("No pipeline data in this range.", pad + 18, top + 54);
    return;
  }

  fill(85);
  textSize(12);
  textAlign(LEFT, TOP);
  text("Ticket buyer -> recurring ticket buyer -> member -> crew / long-term", pad + 18, top + 44);

  const funnelX = pad + 18;
  const funnelY = top + 86;
  const funnelW = width - pad * 2 - 36;
  const funnelH = min(220, max(150, (height - top - pad) * 0.38));
  const gap = 16;
  const stageW = (funnelW - gap * (stages.length - 1)) / stages.length;
  const maxCount = max(1, stages[0]?.count || 1);
  let hoveredStage = null;

  for (let index = 0; index < stages.length; index += 1) {
    const stage = stages[index];
    const x = funnelX + index * (stageW + gap);
    const h = map(stage.count, 0, maxCount, 18, funnelH - 56);
    const y = funnelY + funnelH - h;
    const rate = index === 0 ? 1 : stage.count / max(1, stages[index - 1].count);
    const totalRate = stage.count / maxCount;
    const hovered = mouseX >= x && mouseX <= x + stageW && mouseY >= y && mouseY <= funnelY + funnelH;
    if (hovered) hoveredStage = { stage, rate, totalRate };

    fill(index === 0 ? color(65, 120, 180) : index === 1 ? color(60, 140, 85) : index === 2 ? color(230, 130, 55) : color(135, 85, 170));
    rect(x, y, stageW, h, 2);
    fill(35);
    textSize(13);
    textAlign(CENTER, BOTTOM);
    text(formatInteger(stage.count), x + stageW * 0.5, y - 8);
    fill(65);
    textSize(11);
    textAlign(CENTER, TOP);
    text(trimText(stage.label, 18), x + stageW * 0.5, funnelY + funnelH + 8);
    if (index > 0) {
      fill(90);
      textSize(10);
      text(`${formatPercent(rate)} from previous`, x + stageW * 0.5, funnelY + funnelH + 24);
    }
  }

  if (hoveredStage) {
    drawTooltip(mouseX, mouseY, [
      hoveredStage.stage.label,
      `People: ${formatInteger(hoveredStage.stage.count)}`,
      `From previous: ${formatPercent(hoveredStage.rate)}`,
      `From ticket buyers: ${formatPercent(hoveredStage.totalRate)}`,
    ], 260);
  }

  drawPipelineFeeders(feeders, pad + 18, funnelY + funnelH + 58, width - pad * 2 - 36, height - (funnelY + funnelH + 58) - pad - 18);
}

function drawPipelineFeeders(feeders, x, y, w, h) {
  fill(80);
  textSize(13);
  textAlign(LEFT, TOP);
  text("First activities that feed membership", x, y);
  if (!feeders.length) {
    fill(110);
    textSize(12);
    text("No ticket-to-membership feeders in this range.", x, y + 28);
    return;
  }

  const entries = feeders.slice(0, 8);
  const maxPeople = max(1, ...entries.map((entry) => entry.people));
  const rowH = min(28, max(20, (h - 34) / entries.length));
  let hovered = null;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const rowY = y + 34 + index * rowH;
    const barW = map(entry.people, 0, maxPeople, 0, w - 260);
    const isHover = mouseX >= x && mouseX <= x + w && mouseY >= rowY && mouseY <= rowY + rowH;
    if (isHover) hovered = entry;
    fill(isHover ? 225 : 238);
    noStroke();
    rect(x - 6, rowY, w + 12, rowH, 2);
    fill(entry.type === "Event" ? color(135, 85, 170, 150) : color(60, 140, 85, 150));
    rect(x + 240, rowY + rowH * 0.28, barW, rowH * 0.44, 1);
    fill(45);
    textSize(11);
    textAlign(LEFT, CENTER);
    text(trimText(entry.label, 32), x, rowY + rowH * 0.5);
    textAlign(RIGHT, CENTER);
    text(`${formatInteger(entry.people)} members`, x + w, rowY + rowH * 0.5);
  }

  if (hovered) {
    drawTooltip(mouseX, mouseY, [
      ...wrapText(hovered.label, 34),
      `Converted members: ${formatInteger(hovered.people)}`,
      `Total later revenue: ${formatDkk(hovered.revenue)}`,
    ], 280);
  }
}

function drawProductHealthView(productHealth, pad, top) {
  const items = (productHealth?.items || []).slice(0, 22);
  fill(238);
  noStroke();
  rect(pad, top, width - pad * 2, height - top - pad, 4);
  drawViewHeader("Product Health", pad + 18, top + 16, "productHealth");

  if (!items.length) {
    fill(80);
    textSize(14);
    textAlign(LEFT, TOP);
    text("No activity or event products in this range.", pad + 18, top + 54);
    return;
  }

  fill(85);
  textSize(12);
  textAlign(LEFT, TOP);
  text("Revenue, buyers, repeat behavior, first-timer share, member share, and late-vs-early trend", pad + 18, top + 44);

  const tableX = pad + 18;
  const tableY = top + 82;
  const tableW = width - pad * 2 - 36;
  const rowH = min(30, max(22, (height - tableY - pad - 22) / items.length));
  const nameW = min(300, tableW * 0.3);
  const colW = 78;
  const revenueX = tableX + nameW;
  const buyerX = revenueX + 150;
  const repeatX = buyerX + colW;
  const firstX = repeatX + colW;
  const memberX = firstX + colW;
  const trendX = memberX + colW;
  const maxRevenue = max(1, productHealth.maxRevenue || 1);
  let hovered = null;

  fill(75);
  textSize(10);
  textAlign(LEFT, BOTTOM);
  text("product", tableX, tableY - 8);
  textAlign(RIGHT, BOTTOM);
  text("revenue", buyerX - 12, tableY - 8);
  text("buyers", repeatX - 12, tableY - 8);
  text("repeat", firstX - 12, tableY - 8);
  text("first", memberX - 12, tableY - 8);
  text("member", trendX - 12, tableY - 8);
  text("trend", tableX + tableW, tableY - 8);

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const y = tableY + index * rowH;
    const isHover = mouseX >= tableX && mouseX <= tableX + tableW && mouseY >= y && mouseY <= y + rowH;
    if (isHover) hovered = item;
    fill(isHover ? 225 : index % 2 ? 244 : 238);
    noStroke();
    rect(tableX - 6, y, tableW + 12, rowH, 2);

    fill(item.type === "Event" ? color(135, 85, 170) : color(60, 140, 85));
    rect(tableX, y + rowH * 0.34, 8, rowH * 0.32, 1);
    fill(40);
    textSize(11);
    textAlign(LEFT, CENTER);
    text(trimText(item.label, 36), tableX + 14, y + rowH * 0.5);

    const barW = map(item.revenue, 0, maxRevenue, 0, 70);
    fill(20, 65);
    rect(revenueX, y + rowH * 0.3, barW, rowH * 0.4, 1);

    fill(55);
    textAlign(RIGHT, CENTER);
    text(formatDkk(item.revenue), buyerX - 12, y + rowH * 0.5);
    text(formatInteger(item.buyerCount), repeatX - 12, y + rowH * 0.5);
    text(formatInteger(item.repeatBuyerCount), firstX - 12, y + rowH * 0.5);
    text(formatPercent(item.firstTimerShare), memberX - 12, y + rowH * 0.5);
    text(formatPercent(item.memberShare), trendX - 12, y + rowH * 0.5);
    fill(productTrendColor(item.trend));
    text(productTrendLabel(item.trend), tableX + tableW, y + rowH * 0.5);
  }

  if (hovered) {
    drawTooltip(mouseX, mouseY, [
      ...wrapText(hovered.label, 34),
      `Type: ${hovered.type}`,
      `Revenue: ${formatDkk(hovered.revenue)}`,
      `Unique buyers: ${formatInteger(hovered.buyerCount)}`,
      `Repeat buyers: ${formatInteger(hovered.repeatBuyerCount)}`,
      `First-timer share: ${formatPercent(hovered.firstTimerShare)}`,
      `Member share: ${formatPercent(hovered.memberShare)}`,
      `Trend: ${productTrendLabel(hovered.trend)} (${formatPercent(hovered.trend)})`,
      `Early/Late revenue: ${formatDkk(hovered.earlyRevenue)} / ${formatDkk(hovered.lateRevenue)}`,
    ], 320);
  }
}

function productTrendLabel(trend) {
  if (trend > 0.2) return "up";
  if (trend < -0.2) return "down";
  return "flat";
}

function productTrendColor(trend) {
  if (trend > 0.2) return color(48, 168, 112);
  if (trend < -0.2) return color(210, 95, 70);
  return color(80);
}

function drawCustomerSegmentsView(customerSegments, pad, top) {
  const segments = customerSegments?.segments || [];
  fill(238);
  noStroke();
  rect(pad, top, width - pad * 2, height - top - pad, 4);
  drawViewHeader("Customer Segments", pad + 18, top + 16, "segments");

  if (!segments.length) {
    fill(80);
    textSize(14);
    textAlign(LEFT, TOP);
    text("No customer segments in this range.", pad + 18, top + 54);
    return;
  }

  fill(85);
  textSize(12);
  textAlign(LEFT, TOP);
  text(`${formatInteger(customerSegments.customerCount || 0)} people · high-value threshold ${formatDkk(customerSegments.highValueThreshold || 0)}`, pad + 18, top + 44);

  const tableX = pad + 18;
  const tableY = top + 86;
  const tableW = width - pad * 2 - 36;
  const rowH = min(68, max(52, (height - tableY - pad - 22) / max(1, segments.length)));
  const nameW = min(230, tableW * 0.24);
  const countX = tableX + nameW;
  const revenueX = countX + 150;
  const infoX = revenueX + 170;
  const maxCount = max(1, customerSegments.maxCount || 1);
  const maxRevenue = max(1, customerSegments.maxRevenue || 1);
  let hovered = null;

  fill(75);
  textSize(10);
  textAlign(LEFT, BOTTOM);
  text("segment", tableX, tableY - 8);
  text("people", countX, tableY - 8);
  text("revenue", revenueX, tableY - 8);
  text("favorite activities + typical journey", infoX, tableY - 8);

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const y = tableY + index * rowH;
    const isHover = mouseX >= tableX && mouseX <= tableX + tableW && mouseY >= y && mouseY <= y + rowH;
    if (isHover) hovered = segment;

    fill(isHover ? 225 : index % 2 ? 244 : 238);
    noStroke();
    rect(tableX - 6, y, tableW + 12, rowH - 4, 2);

    fill(customerSegmentColor(segment.key));
    rect(tableX, y + 10, 10, rowH - 24, 1);
    fill(35);
    textSize(13);
    textAlign(LEFT, TOP);
    drawWrappedLabel(segment.label, tableX + 18, y + 8, nameW - 26, 2, 12);
    fill(85);
    textSize(10);
    text(`avg ${formatDkk(segment.avgRevenue)} · ${segment.avgTickets.toFixed(1)} tickets`, tableX + 18, y + 36);

    fill(20, 70);
    rect(countX, y + 16, map(segment.count, 0, maxCount, 0, 105), 8, 1);
    fill(45);
    textSize(11);
    textAlign(LEFT, TOP);
    text(formatInteger(segment.count), countX, y + 30);

    fill(20, 70);
    rect(revenueX, y + 16, map(segment.revenue, 0, maxRevenue, 0, 125), 8, 1);
    fill(45);
    text(formatDkk(segment.revenue), revenueX, y + 30);

    const favorite = segment.favoriteActivities.map((item) => item.label).join(", ") || "No favorite activity";
    const journey = segment.typicalJourneys[0]?.label || "No typical journey";
    fill(55);
    textSize(11);
    textAlign(LEFT, TOP);
    drawWrappedLabel(favorite, infoX, y + 8, max(120, tableX + tableW - infoX - 10), 2, 12);
    fill(90);
    drawWrappedLabel(journey, infoX, y + 34, max(120, tableX + tableW - infoX - 10), 1, 12);
  }

  if (hovered) {
    drawTooltip(mouseX, mouseY, [
      hovered.label,
      `People: ${formatInteger(hovered.count)}`,
      `Revenue: ${formatDkk(hovered.revenue)}`,
      `Avg revenue/person: ${formatDkk(hovered.avgRevenue)}`,
      `Avg tickets/person: ${hovered.avgTickets.toFixed(1)}`,
      `Favorite activities: ${hovered.favoriteActivities.map((item) => `${item.label} (${formatInteger(item.count)})`).join(", ") || "none"}`,
      `Typical journeys: ${hovered.typicalJourneys.map((item) => `${item.label} (${formatInteger(item.count)})`).join(", ") || "none"}`,
    ], 360);
  }
}

function customerSegmentColor(key) {
  const colors = {
    crew: color(135, 85, 170),
    members: color(230, 130, 55),
    highValue: color(40, 120, 180),
    recurringTickets: color(60, 140, 85),
    seasonalReturners: color(217, 130, 43),
    oneTimers: color(120),
  };
  return colors[key] || color(90);
}

function drawExitPointsView(exitPoints, pad, top) {
  const points = exitPoints?.points || [];
  fill(238);
  noStroke();
  rect(pad, top, width - pad * 2, height - top - pad, 4);
  drawViewHeader("Exit Points", pad + 18, top + 16, "exitPoints");

  if (!points.length) {
    fill(80);
    textSize(14);
    textAlign(LEFT, TOP);
    text("No exit points in this range.", pad + 18, top + 54);
    return;
  }

  fill(85);
  textSize(12);
  textAlign(LEFT, TOP);
  text(`${formatInteger(exitPoints.customerCount || 0)} people grouped by their last meaningful paid touchpoint`, pad + 18, top + 44);

  drawExitTypeSummary(exitPoints.types || [], pad + 18, top + 68, width - pad * 2 - 36);

  const tableY = top + 118;
  const rowH = 34;
  const maxRows = max(1, floor((height - tableY - pad - 18) / rowH));
  const rows = points.slice(0, min(22, maxRows));
  const tableX = pad + 18;
  const tableW = width - pad * 2 - 36;
  const typeX = tableX;
  const nameX = tableX + 86;
  const countX = tableX + min(460, tableW * 0.48);
  const revenueX = countX + min(210, tableW * 0.22);
  let hovered = null;

  fill(75);
  textSize(10);
  textAlign(LEFT, BOTTOM);
  text("type", typeX, tableY - 8);
  text("last touchpoint", nameX, tableY - 8);
  text("people ending here", countX, tableY - 8);
  text("exit revenue", revenueX, tableY - 8);

  for (let index = 0; index < rows.length; index += 1) {
    const point = rows[index];
    const y = tableY + index * rowH;
    const isHover = mouseX >= tableX && mouseX <= tableX + tableW && mouseY >= y && mouseY <= y + rowH;
    if (isHover) hovered = point;

    fill(isHover ? 225 : index % 2 ? 244 : 238);
    noStroke();
    rect(tableX - 6, y, tableW + 12, rowH - 3, 2);

    fill(exitTypeColor(point.type));
    rect(typeX, y + 9, 10, rowH - 18, 1);
    fill(50);
    textSize(11);
    textAlign(LEFT, CENTER);
    text(point.type, typeX + 16, y + rowH * 0.5);

    fill(35);
    textSize(11);
    textAlign(LEFT, TOP);
    drawWrappedLabel(point.label, nameX, y + 5, max(120, countX - nameX - 12), 2, 12);

    fill(20, 70);
    rect(countX, y + rowH * 0.5 - 5, map(point.count, 0, exitPoints.maxCount || 1, 0, 150), 10, 1);
    fill(45);
    text(formatInteger(point.count), countX + 158, y + rowH * 0.5);

    fill(20, 70);
    rect(revenueX, y + rowH * 0.5 - 5, map(point.revenue, 0, exitPoints.maxRevenue || 1, 0, 130), 10, 1);
    fill(45);
    text(formatDkk(point.revenue), revenueX + 138, y + rowH * 0.5);
  }

  if (hovered) {
    drawTooltip(mouseX, mouseY, [
      hovered.label,
      `Type: ${hovered.type}`,
      `People ending here: ${formatInteger(hovered.count)}`,
      `Revenue on final touchpoint: ${formatDkk(hovered.revenue)}`,
      `Avg full journey revenue: ${formatDkk(hovered.avgJourneyRevenue)}`,
      `Example customers: ${hovered.sampleCustomers.map(displayPersonName).join(", ") || "none"}`,
    ], 340);
  }
}

function drawExitTypeSummary(types, x, y, w) {
  const total = max(1, types.reduce((acc, item) => acc + item.count, 0));
  const gap = 8;
  const compactW = min(w, 520);
  const segmentW = max(46, (compactW - gap * max(0, types.length - 1)) / max(1, types.length));
  let cursor = x;
  for (const type of types) {
    const fillW = map(type.count, 0, total, 0, segmentW);
    fill(exitTypeColor(type.type));
    noStroke();
    rect(cursor, y, fillW, 14, 2);
    stroke(210);
    strokeWeight(1);
    noFill();
    rect(cursor, y, segmentW, 14, 2);
    noStroke();
    fill(35);
    textSize(10);
    textAlign(LEFT, TOP);
    text(`${type.type} ${formatInteger(type.count)}`, cursor, y + 18);
    cursor += segmentW + gap;
  }
}

function exitTypeColor(type) {
  const colors = {
    Activity: color(60, 140, 85),
    Event: color(135, 85, 170),
    Membership: color(230, 130, 55),
    Crew: color(120, 95, 180),
  };
  return colors[type] || color(100);
}

function drawMembershipLengthView(membershipLength, pad, top) {
  const buckets = membershipLength?.buckets || [];
  drawSoftPanel(pad, top, width - pad * 2, height - top - pad, 4);
  drawViewHeader("Membership Length", pad + 18, top + 16, "memberLength");

  if (!buckets.length) {
    fill(80);
    textSize(14);
    textAlign(LEFT, TOP);
    text("No paid membership spans in this range.", pad + 18, top + 54);
    return;
  }

  const cardGap = 12;
  const cardX = pad + 18;
  const cardW = (width - pad * 2 - 36 - cardGap * 3) / 4;
  drawStatCard(cardX, top + 48, cardW, 72, "Spans", formatInteger(membershipLength.spanCount || 0));
  drawStatCard(cardX + (cardW + cardGap), top + 48, cardW, 72, "Still active", formatInteger(membershipLength.activeCount || 0));
  drawStatCard(cardX + (cardW + cardGap) * 2, top + 48, cardW, 72, "Median length", formatMembershipMonths(membershipLength.medianMonths || 0));
  drawStatCard(cardX + (cardW + cardGap) * 3, top + 48, cardW, 72, "Avg length", formatMembershipMonths(membershipLength.avgMonths || 0));

  const chartX = pad + 32;
  const chartY = top + 170;
  const chartW = width - pad * 2 - 64;
  const chartH = min(260, max(170, (height - chartY - pad) * 0.52));
  drawMembershipLengthDistribution(chartX, chartY, chartW, chartH, buckets, membershipLength.maxBucketCount || 1);
  drawMembershipLengthTypes(chartX, chartY + chartH + 46, chartW, height - chartY - chartH - pad - 58, membershipLength.types || [], membershipLength.maxTypeCount || 1);
}

function drawMembershipLengthDistribution(x, y, w, h, buckets, maxCount) {
  fill(248);
  noStroke();
  rect(x - 14, y - 28, w + 28, h + 66, 3);
  fill(35);
  textSize(15);
  textAlign(LEFT, TOP);
  text("Distribution of membership spans", x, y - 20);

  const gap = 12;
  const barW = (w - gap * (buckets.length - 1)) / buckets.length;
  let hovered = null;
  stroke(210);
  strokeWeight(1);
  line(x, y + h, x + w, y + h);

  for (let index = 0; index < buckets.length; index += 1) {
    const bucket = buckets[index];
    const barX = x + index * (barW + gap);
    const totalH = map(bucket.total, 0, maxCount, 0, h * 0.82);
    const activeH = bucket.total ? totalH * (bucket.active / bucket.total) : 0;
    const endedH = max(0, totalH - activeH);
    const isHover = mouseX >= barX && mouseX <= barX + barW && mouseY >= y && mouseY <= y + h;
    if (isHover) hovered = bucket;

    fill(80, 130, 210, isHover ? 245 : 210);
    noStroke();
    rect(barX, y + h - endedH, barW, endedH, 2);
    fill(45, 185, 125, isHover ? 245 : 210);
    rect(barX, y + h - totalH, barW, activeH, 2);

    fill(55);
    textSize(11);
    textAlign(CENTER, TOP);
    text(bucket.label, barX + barW / 2, y + h + 10);
    text(formatInteger(bucket.total), barX + barW / 2, y + h - totalH - 18);
  }

  drawMembershipLengthLegend(x + w - 180, y - 20);

  if (hovered) {
    drawTooltip(mouseX, mouseY, [
      hovered.label,
      `Total spans: ${formatInteger(hovered.total)}`,
      `Still active: ${formatInteger(hovered.active)}`,
      `Ended: ${formatInteger(hovered.ended)}`,
    ], 220);
  }
}

function drawMembershipLengthLegend(x, y) {
  const items = [
    { label: "ended", color: color(80, 130, 210) },
    { label: "still active", color: color(45, 185, 125) },
  ];
  let cursor = x;
  for (const item of items) {
    fill(item.color);
    noStroke();
    rect(cursor, y + 3, 10, 10, 1);
    fill(80);
    textSize(10);
    textAlign(LEFT, TOP);
    text(item.label, cursor + 14, y);
    cursor += textWidth(item.label) + 48;
  }
}

function drawMembershipLengthTypes(x, y, w, h, types, maxCount) {
  if (!types.length || h < 60) return;
  fill(35);
  textSize(15);
  textAlign(LEFT, TOP);
  text("Membership types", x, y);

  const rows = types.slice(0, 8);
  const rowH = min(28, max(20, (h - 32) / rows.length));
  let hovered = null;
  for (let index = 0; index < rows.length; index += 1) {
    const type = rows[index];
    const rowY = y + 32 + index * rowH;
    const isHover = mouseX >= x && mouseX <= x + w && mouseY >= rowY && mouseY <= rowY + rowH;
    if (isHover) hovered = type;
    fill(isHover ? 225 : 238);
    noStroke();
    rect(x - 6, rowY, w + 12, rowH - 3, 2);
    fill(35);
    textSize(11);
    textAlign(LEFT, CENTER);
    text(trimText(type.label, 56), x, rowY + rowH * 0.5);
    fill(45, 185, 125, 180);
    rect(x + w * 0.48, rowY + rowH * 0.5 - 5, map(type.count, 0, maxCount, 0, w * 0.28), 10, 1);
    fill(70);
    textAlign(LEFT, CENTER);
    text(`${formatInteger(type.count)} spans · avg ${formatMembershipMonths(type.avgMonths)} · ${formatInteger(type.active)} active`, x + w * 0.8, rowY + rowH * 0.5);
  }

  if (hovered) {
    drawTooltip(mouseX, mouseY, [
      hovered.label,
      `Spans: ${formatInteger(hovered.count)}`,
      `Still active: ${formatInteger(hovered.active)}`,
      `Average length: ${formatMembershipMonths(hovered.avgMonths)}`,
    ], 280);
  }
}

function drawMemberDistributionView(distribution, pad, top) {
  const months = distribution?.months || [];
  const buckets = distribution?.buckets || [];
  if (!months.length || !buckets.length) {
    fill(238);
    noStroke();
    rect(pad, top, width - pad * 2, height - top - pad, 4);
    drawViewHeader("Member Tenure Distribution", pad + 18, top + 16, "memberDistribution");
    fill(80);
    textSize(14);
    textAlign(LEFT, TOP);
    text("No paid membership distribution in this range.", pad + 18, top + 54);
    return;
  }

  const colors = memberDistributionColors();
  const series = buckets.map((bucket, index) => ({
    key: bucket.key,
    label: bucket.label,
    color: colors[index % colors.length],
    formatter: formatInteger,
    scale: "count",
  })).reverse();
  drawHopTimelineChart(pad, top, width - pad * 2, height - top - pad, months, "Member Tenure Distribution", series, [], {
    ...timelineChartState(),
    infoKey: "memberDistribution",
  });
}

function memberDistributionColors() {
  return [
    [210, 210, 210],
    [185, 205, 230],
    [130, 185, 220],
    [75, 175, 190],
    [70, 180, 130],
    [225, 165, 65],
    [220, 95, 55],
    [135, 65, 170],
  ];
}

function formatMembershipMonths(months) {
  if (months >= 24) return `${(months / 12).toFixed(1)} yr`;
  if (months >= 10) return `${months.toFixed(0)} mo`;
  return `${months.toFixed(1)} mo`;
}

function activityPathVisibleColumns(columns, limit) {
  const special = columns.filter((column) => column.key.startsWith("__"));
  const regular = columns.filter((column) => !column.key.startsWith("__"));
  const regularLimit = max(0, limit - special.length);
  return [...regular.slice(0, regularLimit), ...special];
}

function activityPathCellColor(rate, type) {
  if (type === "No return") {
    const amount = constrain(rate, 0, 1);
    return [180, 180, 180, 70 + amount * 150];
  }
  const amount = constrain(rate, 0, 1);
  return interpolateRgb([255, 255, 255], [35, 155, 95], amount);
}

function drawRetentionView(retention, pad, top) {
  const cohorts = retention?.cohorts || [];
  fill(238);
  noStroke();
  rect(pad, top, width - pad * 2, height - top - pad, 4);
  drawViewHeader("Retention", pad + 18, top + 16, "retention");

  if (!cohorts.length) {
    fill(80);
    textSize(14);
    text("No paid activity in this range.", pad + 18, top + 54);
    return;
  }

  const unit = timeBucketLabel(timeBucket).toLowerCase();
  const maxOffset = min(retention.maxOffset || 0, 24);
  const completeCohorts = retentionCompleteCohorts(cohorts, maxOffset);
  if (!completeCohorts.length) {
    fill(80);
    textSize(14);
    text("No complete retention groups in this slider range.", pad + 18, top + 54);
    fill(110);
    textSize(12);
    text("Move the slider to include full periods before and after each cohort.", pad + 18, top + 78);
    return;
  }
  const offset1 = retentionSummaryAt(completeCohorts, 1);
  const offset3 = retentionSummaryAt(completeCohorts, 3);
  const completeCustomerCount = completeCohorts.reduce((total, cohort) => total + cohort.size, 0);
  fill(85);
  textSize(12);
  textAlign(LEFT, TOP);
  text(`${formatInteger(completeCustomerCount)} people · rows are complete first paid ${unit}s · columns are ${unit}s after first purchase`, pad + 18, top + 44);
  text(`+1 ${unit}: ${formatPercent(offset1)} · +3 ${unit}s: ${formatPercent(offset3)}`, pad + 18, top + 62);

  const labelX = pad + 18;
  const barX = pad + 76;
  const plotX = pad + 124;
  const plotY = top + 96;
  const plotW = width - plotX - pad - 18;
  const plotH = height - top - pad - 132;
  const cellW = plotW / max(1, maxOffset + 1);
  const cellH = min(26, plotH / max(1, completeCohorts.length));
  const visibleRows = min(completeCohorts.length, floor(plotH / max(1, cellH)));
  const visibleCohorts = completeCohorts.slice(0, visibleRows);
  const maxCohortSize = max(1, ...visibleCohorts.map((cohort) => cohort.size));
  let hovered = null;

  fill(80);
  textSize(10);
  textAlign(LEFT, BOTTOM);
  text("group", labelX, plotY - 8);
  text("size", barX, plotY - 8);
  textAlign(CENTER, BOTTOM);
  for (let offset = 0; offset <= maxOffset; offset += 1) {
    const x = plotX + offset * cellW + cellW * 0.5;
    text(offset === 0 ? "start" : `+${offset}`, x, plotY - 8);
  }

  for (let rowIndex = 0; rowIndex < visibleCohorts.length; rowIndex += 1) {
    const cohort = visibleCohorts[rowIndex];
    const y = plotY + rowIndex * cellH;
    const barW = map(cohort.size, 0, maxCohortSize, 0, 40);
    fill(85);
    textSize(10);
    textAlign(LEFT, CENTER);
    text(cohort.period, labelX, y + cellH * 0.5);
    fill(60, 90);
    rect(barX, y + cellH * 0.25, barW, cellH * 0.5, 1);

    for (let offset = 0; offset <= maxOffset; offset += 1) {
      const cell = cohort.cells[offset] || { rate: 0, retained: 0, revenue: 0 };
      const x = plotX + offset * cellW;
      const rate = offset === 0 && cohort.size ? 1 : cell.rate;
      fill(cell.possible === false ? 255 : retentionRateColor(rate));
      noStroke();
      rect(x + 1, y + 1, max(1, cellW - 2), max(1, cellH - 2), 1);
      if (cell.possible !== false && cellW > 38 && cellH > 17) {
        fill(rate > 0.55 ? 245 : 35);
        textSize(9);
        textAlign(CENTER, CENTER);
        text(`${Math.round(rate * 100)}%`, x + cellW * 0.5, y + cellH * 0.5);
      }
      if (mouseX >= x && mouseX <= x + cellW && mouseY >= y && mouseY <= y + cellH) {
        hovered = { cohort, cell, offset, rate };
      }
    }
  }

  fill(90);
  textSize(11);
  textAlign(RIGHT, TOP);
  text(`showing ${visibleCohorts.length}/${completeCohorts.length} complete groups`, plotX + plotW, top + 62);

  if (hovered) {
    drawTooltip(mouseX, mouseY, [
      `Cohort: ${hovered.cohort.period}`,
      `Cohort size: ${formatInteger(hovered.cohort.size)}`,
      `Offset: ${hovered.offset === 0 ? "start" : `+${hovered.offset} ${unit}s`}`,
      hovered.cell.possible === false ? "Not possible yet" : `Retained: ${formatInteger(hovered.cell.retained)} (${formatPercent(hovered.rate)})`,
      hovered.cell.outOfScope ? "Outside selected range, measured from full loaded data" : "",
      hovered.cell.possible === false ? "" : `Revenue in cell: ${formatDkk(hovered.cell.revenue)}`,
    ], 280);
  }
}

function retentionCompleteCohorts(cohorts, maxOffset) {
  const rangeStart = typeof selectedStartMs === "number" ? selectedStartMs : 0;
  const rangeEnd = typeof selectedEndMs === "number" ? selectedEndMs : 0;
  return (cohorts || []).filter((cohort) => {
    const cohortStart = startOfHopDayMs(dateFromPeriodKey(cohort.period, timeBucket));
    const cohortEnd = startOfHopDayMs(periodEndDate(cohort.period, timeBucket));
    if (rangeStart && cohortStart < rangeStart) return false;
    if (rangeEnd && cohortEnd > rangeEnd) return false;
    for (let offset = 0; offset <= maxOffset; offset += 1) {
      if (cohort.cells[offset]?.possible === false) return false;
    }
    return true;
  });
}

function retentionRateColor(rate) {
  const clamped = constrain(Number(rate) || 0, 0, 1);
  const curved = constrain((clamped - 0.08) / 0.22, 0, 1);
  const low = [255, 255, 255];
  const high = [35, 155, 95];
  return interpolateRgb(low, high, curved);
}

function interpolateRgb(a, b, t) {
  const amount = constrain(t, 0, 1);
  return [
    lerp(a[0], b[0], amount),
    lerp(a[1], b[1], amount),
    lerp(a[2], b[2], amount),
    230,
  ];
}

function retentionSummaryAt(cohorts, offset) {
  let retained = 0;
  let total = 0;
  for (const cohort of cohorts) {
    const cell = cohort.cells[offset];
    if (!cell || cell.possible === false) continue;
    retained += cell.retained;
    total += cohort.size;
  }
  return total ? retained / total : 0;
}

function drawBuyerJourneyMap(x, y, w, h, journeys) {
  const normalizedJourneys = journeys.map((journey) => {
    let cumulativeRevenue = 0;
    return {
      id: journey.customerKey,
      label: displayPersonName(journey),
      span: journey.span,
      color: buyerJourneyColor(journey),
      source: journey,
      periods: journey.periods.map((period) => {
        cumulativeRevenue += period.revenue || 0;
        return {
          ...period,
          color: buyerPatternColor(period),
          isMembershipStart: period.offset === journey.firstMembership,
          isCrewStart: period.offset === journey.firstCrew,
          cumulativeValue: cumulativeRevenue,
        };
      }),
    };
  });
  drawNormalizedJourneyTimeline(x, y, w, h, normalizedJourneys, {
    title: "Buyer pattern cumulative revenue from first purchase",
    mode: "cumulative",
    unitLabel: timeBucketLabel(timeBucket).toLowerCase(),
    valueFormatter: formatDkk,
    emptyText: "No ticket or membership journeys in this range.",
    legend: [
      { label: "Ticket only", color: [68, 145, 255] },
      { label: "Membership", color: [34, 190, 125] },
      { label: "Crew", color: [190, 112, 255] },
      { label: "Ticket + membership", color: [255, 174, 66] },
      { label: "First membership", color: [255, 245, 120] },
    ],
    tooltipLines: (normalizedJourney) => {
      const journey = normalizedJourney.source;
      const lastPeriod = journey.periods.at(-1);
      return [
        displayPersonName(journey),
        `Pattern: ${journey.pattern}`,
        `Span: ${formatInteger(journey.span)} ${timeBucketLabel(timeBucket).toLowerCase()}s`,
        `Total tickets: ${formatInteger(journey.totalTickets)}`,
        `Revenue: ${formatDkk(journey.revenue)}`,
        lastPeriod ? `Last activity offset: ${lastPeriod.offset}` : "",
      ];
    },
  });
}

function buyerPatternColor(period) {
  if (period.hasCrew && period.hasMembership) return [245, 120, 255];
  if (period.hasCrew && period.hasTicket) return [195, 150, 255];
  if (period.hasCrew) return [190, 112, 255];
  if (period.hasTicket && period.hasMembership) return [255, 174, 66];
  if (period.hasMembership) return [34, 190, 125];
  return [68, 145, 255];
}

function buyerJourneyColor(journey) {
  if (journey.pattern.includes("Crew")) return [190, 112, 255];
  if (journey.pattern === "Ticket to membership") return [255, 245, 120];
  if (journey.pattern === "Membership plus tickets") return [255, 174, 66];
  if (journey.pattern === "Membership only") return [34, 190, 125];
  return [68, 145, 255];
}

function drawHopNav(x, y, navItems, currentView) {
  let navX = x;
  let clickedView = null;
  for (const item of navItems) {
    const w = 30;
    if (drawNavIconButton({ x: navX, y, w, h: HOP_TOP_BUTTON_H }, item.id === currentView, item.icon || "circle")) clickedView = item.id;
    navX += w + 6;
  }
  return clickedView;
}

function drawNavIconButton(item, selected, icon) {
  if (typeof uiButton === "function") {
    const result = uiButton("", {
      x: item.x,
      y: item.y,
      width: item.w,
      height: item.h,
      fontSize: 11,
      padding: 0,
      rounding: 3,
      hAlign: "center",
      vAlign: "middle",
      bgColor: selected ? "#8a8a8a" : "#1e1e1e",
      textColor: selected ? "#232323" : "#8a8a8a",
      hover: { bgColor: selected ? "#a0a0a0" : "#343434", cursor: "pointer" },
      pressed: { bgColor: "#111111", cursor: "pointer" },
      persist: false,
    });
    push();
    textFont("Material Symbols Rounded");
    textSize(19);
    textAlign(CENTER, CENTER);
    fill(selected ? "#232323" : "#8a8a8a");
    noStroke();
    text(icon, item.x + item.w / 2, item.y + item.h / 2 + 2);
    pop();
    return result.clicked;
  }
  return drawTopIconButton(item, !selected, icon);
}

function drawClearDataButton() {
  return drawTopIconButton(getClearDataButtonBounds(), false, "delete");
}

function getClearDataButtonBounds() {
  const w = 30;
  return { x: width - 32 - w, y: HOP_TOP_BUTTON_Y, w, h: HOP_TOP_BUTTON_H };
}

function drawTimeBucketToggle(activeBucket, showSaveButton = false) {
  const item = getTimeBucketButton(showSaveButton);
  return drawSlimButton(timeBucketLabel(activeBucket).toUpperCase(), item, true);
}

function drawAnonymizeToggle(active) {
  return drawTopIconButton(getAnonymizeButton(), active, active ? "visibility_off" : "visibility");
}

function drawStorageToggle() {
  return drawTopIconButton(getStorageButton(), false, "save");
}

function drawTimelineCurveToggle(active, showSaveButton = false) {
  return drawTopIconButton(getTimelineCurveButton(showSaveButton), !active, active ? "timeline" : "show_chart");
}

function drawTimelineStackToggle(active, showSaveButton = false) {
  return drawTopIconButton(getTimelineStackButton(showSaveButton), !active, active ? "stacked_line_chart" : "area_chart");
}

function drawCaptureButton(showSaveButton = false) {
  return drawTopIconButton(getCaptureButton(showSaveButton), false, "photo_camera");
}

function drawTopIconButton(item, active, icon) {
  if (typeof uiButton === "function") {
    const result = uiButton("", {
      x: item.x,
      y: item.y,
      width: item.w,
      height: item.h,
      fontSize: 11,
      padding: 0,
      rounding: 3,
      hAlign: "center",
      vAlign: "middle",
      bgColor: active ? "#1e1e1e" : "#6e6e6e",
      textColor: active ? "#f5f5f5" : "#232323",
      hover: { bgColor: active ? "#343434" : "#909090", cursor: "pointer" },
      pressed: { bgColor: "#111111", cursor: "pointer" },
      persist: false,
    });
    push();
    textFont("Material Symbols Rounded");
    textSize(19);
    textAlign(CENTER, CENTER);
    fill(active ? "#f5f5f5" : "#232323");
    noStroke();
    text(icon, item.x + item.w / 2, item.y + item.h / 2 + 2);
    pop();
    return result.clicked;
  }
  return drawSlimButton(icon, item, active, {
    font: "Material Symbols Rounded",
    fontSize: 19,
    padding: 0,
  });
}

function drawSlimButton(label, item, active, style = {}) {
  if (typeof uiButton === "function") {
    return uiButton(label, {
      x: item.x,
      y: item.y,
      width: item.w,
      height: item.h,
      fontSize: 11,
      padding: 0,
      rounding: 3,
      hAlign: "center",
      vAlign: "middle",
      bgColor: active ? "#1e1e1e" : "#6e6e6e",
      textColor: active ? "#f5f5f5" : "#232323",
      hover: { bgColor: active ? "#343434" : "#909090", cursor: "pointer" },
      pressed: { bgColor: "#111111", cursor: "pointer" },
      persist: false,
      ...style,
    }).clicked;
  }
  fill(active ? 30 : 110);
  noStroke();
  rect(item.x, item.y, item.w, item.h, 3);
  fill(active ? 245 : 35);
  if (style.font) textFont(style.font);
  textSize(style.fontSize || 11);
  textAlign(CENTER, CENTER);
  text(label, item.x + item.w / 2, item.y + item.h / 2 + 1);
  return false;
}

function drawActivityPathModeToggle(mode, visible, showSaveButton = false) {
  if (!visible) return false;
  const item = getActivityPathModeButton(showSaveButton);
  return drawSlimButton(mode === "range" ? "First in range" : "First ever", item, true);
}

function drawRevenueGroupsMembershipToggle(excludeMembership, visible, overridePosition) {
  if (!visible) return false;
  const item = getRevenueGroupsMembershipButton(overridePosition);
  return drawSlimButton(excludeMembership ? "No members" : "All rev", item, excludeMembership);
}

function getTimeBucketButton(showSaveButton = false) {
  const capture = getCaptureButton(showSaveButton);
  const w = 58;
  const gap = 16;
  return { x: capture.x - gap - w, y: capture.y, w, h: HOP_TOP_BUTTON_H };
}

function getAnonymizeButton() {
  const clear = getClearDataButtonBounds();
  const w = 30;
  const gap = 6;
  return { x: clear.x - gap - w, y: HOP_TOP_BUTTON_Y, w, h: HOP_TOP_BUTTON_H };
}

function getStorageButton() {
  const anonymize = getAnonymizeButton();
  const w = 26;
  const gap = 6;
  return { x: anonymize.x - gap - w, y: anonymize.y, w, h: HOP_TOP_BUTTON_H };
}

function getCaptureButton(showSaveButton = false) {
  const storage = showSaveButton ? getStorageButton() : getAnonymizeButton();
  const w = 26;
  const gap = 6;
  return { x: storage.x - gap - w, y: storage.y, w, h: HOP_TOP_BUTTON_H };
}

function getTimelineCurveButton(showSaveButton = false) {
  const bucket = getTimeBucketButton(showSaveButton);
  const w = 30;
  const gap = 6;
  return { x: bucket.x - gap - w, y: bucket.y, w, h: HOP_TOP_BUTTON_H };
}

function getTimelineStackButton(showSaveButton = false) {
  const curve = getTimelineCurveButton(showSaveButton);
  const w = 30;
  const gap = 6;
  return { x: curve.x - gap - w, y: curve.y, w, h: HOP_TOP_BUTTON_H };
}

function getActivityPathModeButton(showSaveButton = false) {
  const stack = getTimelineStackButton(showSaveButton);
  const w = 92;
  const gap = 6;
  return { x: stack.x - gap - w, y: stack.y, w, h: HOP_TOP_BUTTON_H };
}

function getRevenueGroupsMembershipButton(overridePosition) {
  if (overridePosition) return { x: overridePosition.x, y: overridePosition.y, w: 86, h: HOP_TOP_BUTTON_H };
  const capture = getCaptureButton();
  const w = 86;
  const gap = 6;
  return { x: capture.x - gap - w, y: capture.y, w, h: HOP_TOP_BUTTON_H };
}

function timeBucketLabel(bucket) {
  if (bucket === "year") return "Year";
  if (bucket === "halfyear") return "1/2 Year";
  if (bucket === "month") return "Month";
  if (bucket === "quarter") return "3 Mon";
  return "Week";
}

function drawStatCard(x, y, w, h, label, value) {
  drawSoftPanel(x, y, w, h, 4);
  fill(80);
  noStroke();
  textSize(13);
  textAlign(LEFT, TOP);
  text(label.toUpperCase(), x + 16, y + 16);
  fill(20);
  textSize(25);
  text(value, x + 16, y + 44);
}

function drawLineChart(x, y, w, h, points, title, key, formatter) {
  drawSoftPanel(x, y, w, h, 4);
  fill(30);
  noStroke();
  textSize(18);
  textAlign(LEFT, TOP);
  text(title, x + 18, y + 16);

  const values = points.map((point) => point[key]);
  const maxValue = max(1, ...values);
  const plotX = x + 18;
  const plotY = y + 54;
  const plotW = w - 36;
  const plotH = h - 108;

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

  fill(35);
  noStroke();
  textSize(12);
  textAlign(LEFT, BOTTOM);
  text(points[0]?.month || "", plotX, y + h - 40);
  textAlign(RIGHT, BOTTOM);
  text(points.at(-1)?.month || "", plotX + plotW, y + h - 40);
  textAlign(RIGHT, TOP);
  text(formatter(maxValue), plotX + plotW, plotY);
  drawTimelineSeasonBand(plotX, y + h - 30, plotW, points);
}

function drawCategoryBars(x, y, w, h, categories) {
  drawSoftPanel(x, y, w, h, 4);
  drawViewHeader("Activity mix", x + 18, y + 16, "activityMix");

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
  const wrappedLines = wrapTooltipLines(lines, maxWidth - 24);
  const tooltipW = min(maxWidth, max(...wrappedLines.map((line) => textWidth(line))) + 24);
  const tooltipH = wrappedLines.length * 18 + 14;
  const tx = min(x + 14, width - tooltipW - 8);
  const ty = min(y + 14, height - tooltipH - 8);

  fill(20, 175);
  noStroke();
  rect(tx, ty, tooltipW, tooltipH, 3);
  fill(245);
  textAlign(LEFT, TOP);
  wrappedLines.forEach((line, index) => text(line, tx + 12, ty + 8 + index * 18));
}

function wrapTooltipLines(lines, maxWidth) {
  return (lines || []).flatMap((line) => wrapTextByWidth(line, maxWidth));
}

function drawWrappedLabel(value, x, y, maxWidth, maxLines = 2, lineHeight = 12) {
  const lines = wrapTextByWidth(value, maxWidth).slice(0, maxLines);
  for (let index = 0; index < lines.length; index += 1) {
    const suffix = index === maxLines - 1 && wrapTextByWidth(value, maxWidth).length > maxLines ? "..." : "";
    text(`${lines[index]}${suffix}`, x, y + index * lineHeight);
  }
}

function wrapTextByWidth(value, maxWidth) {
  const words = String(value || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && textWidth(candidate) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
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

function formatPercent(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function formatDate(date) {
  if (!(date instanceof Date)) return "";
  return date.toISOString().slice(0, 10);
}

function trimText(value, maxLength) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function hashText(value) {
  const text = String(value || "");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash;
}
