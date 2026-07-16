let activityNetworkState = null;
let activityNetworkBounds = null;
let userNetworkState = null;
let userNetworkBounds = null;
let userNetworkVisible = null;
let activeHopModel = null;
let activePeriodLabel = "";
let pendingViewInfoTooltip = null;
let activityExplorerSelectorHits = [];
let activityExplorerDropdownVisibleCount = 10;
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
    activity: "Timeline combining sales revenue and paid tickets with subscription booking usage. Subscription bookings are reservations, not confirmed attendance.",
    activityNetwork: "Network of activities and events. It combines paid ticket purchases and subscription bookings; nodes connect when the same person used both.",
    userNetwork: "Network of people. They connect when they bought or subscription-booked the same activities or events.",
    ticketSales: "Timeline and ranking of activity and event ticket sales, split by revenue and ticket count.",
    purchaseTiming: "Shows when people buy within the selected date range, grouped by day of month and month of year, with colors for activity, event, and membership purchases.",
    ticketBuyers: "Heatmap of ticket-buying people over time, showing single, occasional, and recurring buyers.",
    revenueGroups: "Groups paying customers by how many activities or tickets they bought in the selected period, then compares revenue and people count.",
    buyerPattern: "Normalized customer journeys from their first recorded purchase or subscription booking, showing transitions between ticket-only, subscription, booking, and crew behavior.",
    retention: "Engagement cohort heatmap: people enter on their first paid purchase and count as returning through either another purchase or a subscription booking. Tooltips separate both behaviors.",
    activityPath: "Shows what people do after a first purchase, first subscription booking, or either one. Switch the source to compare paid conversion with subscription usage paths.",
    introConversion: "Follows people after signing up for either free introduction. Outcomes use the first later booking or purchase within 90 days; sign-ups are not confirmed attendance.",
    gateway: "Ranks first activities by how well they create follow-up behavior: return rate, membership conversion, later revenue, and no-return rate.",
    pipeline: "Funnel from ticket buyers to recurring ticket buyers, members, and crew/long-term members, with first activities that feed membership.",
    productHealth: "One row per activity or event, combining paid tickets and subscription bookings so demand and repeat use are visible alongside revenue.",
    activityExplorer: "Select any paid ticket type or booking class to see its audience, source mix, related activities, previous and next destinations, journey role, and booking schedule.",
    segments: "Behavioral groups combining purchases and subscription bookings, including active, low-use, inactive, and booking-only subscription identities.",
    exitPoints: "Shows each person's latest recorded interaction, using subscription bookings when they occur after the last purchase. Booking exits carry no revenue.",
    memberLength: "Distribution of estimated paid subscription spans, with booking totals and subscribers who made no booking during their span.",
    memberDistribution: "Stacked timeline of estimated active paid subscribers by tenure, overlaid with those who did and did not make a subscription booking.",
    memberEngagement: "Joins yearly booking exports to sales identities. Shows subscription bookings, subscribers who did or did not book, class preferences, source coverage, duplicates, and match quality. Bookings are not confirmed attendance.",
    overview: "High-level summary of sales and subscription usage for the selected range: revenue, customers, invoices, bookings, people booking, and utilization.",
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
  activityExplorerSelectorHits = [];
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
    drawActivityView(model.activity, model.ticketSalesTimeline || model.ticketSales, model.memberEngagement, contentPad, contentTop);
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

  if (currentView === "purchasetiming") {
    drawPurchaseTimingView(model.rows, contentPad, contentTop, model.purchaseTimingMembershipSignupKeys);
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

  if (currentView === "introconversion") {
    drawIntroConversionView(model.introConversion, contentPad, contentTop);
    return uiState;
  }

  if (currentView === "gateway") {
    drawGatewayView(model.gatewayPath || model.activityPath, contentPad, contentTop);
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

  if (currentView === "activityexplorer") {
    drawActivityExplorerView(model.activityExplorer, contentPad, contentTop, options);
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

  if (currentView === "memberengagement") {
    drawMemberEngagementView(model.memberEngagement, contentPad, contentTop);
    return uiState;
  }

  if (currentView !== "overview") {
    drawPlaceholderView(currentView, contentPad + 16, contentTop + 14);
    return uiState;
  }

  const cardY = contentTop + 14;
  const engagement = model.memberEngagement || {};
  const latestEngagement = engagement.periods?.at(-1) || {};
  const cardGap = 8;
  const cardW = (width - pad * 2 - cardGap * 6) / 7;
  const overviewCards = [
    ["Revenue", formatDkk(revenue)],
    ["Customers", formatInteger(model.customers.length)],
    ["Invoices", formatInteger(model.invoices.length)],
    ["Sub. bookings", formatInteger(engagement.membershipBookingCount || 0)],
    ["People booking", formatInteger((engagement.members || []).filter((member) => member.membershipBookingCount > 0).length)],
    ["No booking", formatInteger(latestEngagement.subscribersWithoutBooking || 0)],
    ["Utilization", formatPercent(latestEngagement.utilizationRate || 0)],
  ];
  overviewCards.forEach(([label, value], index) => drawStatCard(pad + index * (cardW + cardGap), cardY, cardW, 72, label, value));

  const chartTop = cardY + 102;
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

function drawActivityView(activity, ticketSales, memberEngagement, pad, top) {
  const bookingPeriods = memberEngagement?.sources?.length ? memberEngagement.periods || [] : [];
  const months = mergeActivityTimeline(activity?.months || [], ticketSales?.weeks || [], bookingPeriods);
  const membershipSeries = membershipTypeSeries(activity?.membershipTypes || []);
  const moneyScale = "money";
  const countScale = "count";
  const series = [
    { key: "totalRevenue", label: "Revenue", color: [0, 0, 0], formatter: formatDkk, scale: moneyScale, legendOrder: 10 },
    { key: "yearTotalRevenue", label: "Year accumulated revenue", color: [90, 90, 90], formatter: formatDkk, scale: moneyScale, legendOrder: 11 },
    { key: "revenue", label: "Subscription revenue", color: [20, 20, 20], formatter: formatDkk, scale: moneyScale, legendOrder: 12 },
    { key: "classRevenue", label: "Activity revenue", color: [60, 140, 85], formatter: formatDkk, scale: moneyScale, legendOrder: 13 },
    { key: "eventRevenue", label: "Event revenue", color: [135, 85, 170], formatter: formatDkk, scale: moneyScale, legendOrder: 14 },
    { key: "classTickets", label: "Activity tickets", color: [90, 165, 90], formatter: formatInteger, scale: countScale, legendOrder: 30 },
    { key: "eventTickets", label: "Event tickets", color: [155, 105, 190], formatter: formatInteger, scale: countScale, legendOrder: 31 },
    { key: "activeTicketUsersWithMembership", label: "Ticket buyers with subscription", color: [34, 190, 125], formatter: formatInteger, scale: countScale, legendOrder: 40 },
    { key: "activeTicketUsersWithoutMembership", label: "Ticket buyers without subscription", color: [68, 145, 255], formatter: formatInteger, scale: countScale, legendOrder: 41 },
    { key: "singleTicketBuyers", label: "Single ticket", color: [255, 165, 45], formatter: formatInteger, scale: countScale, legendOrder: 42 },
    { key: "membershipBookings", label: "Subscription bookings", color: [35, 145, 95], formatter: formatInteger, scale: countScale, legendOrder: 43 },
    { key: "uniqueBookingMembers", label: "People booking by subscription", color: [40, 120, 180], formatter: formatInteger, scale: countScale, legendOrder: 44 },
    { key: "bookingsPerBookingMember", label: "Bookings per person", color: [90, 150, 185], formatter: (value) => (Number(value) || 0).toFixed(1), scale: countScale, legendOrder: 45, stack: false },
    { key: "unmatchedMemberBookings", label: "Bookings without matched subscription sale", color: [150, 95, 175], formatter: formatInteger, scale: countScale, legendOrder: 46, stack: false },
    { key: "firstTouchpoints", label: "First touchpoints", color: [30, 170, 190], formatter: formatInteger, scale: countScale, legendOrder: 50 },
    { key: "lastTouchpoints", label: "Last touchpoints", color: [220, 95, 95], formatter: formatInteger, scale: countScale, legendOrder: 51 },
    { key: "memberCount", label: "Estimated active subscribers", color: [190, 90, 35], formatter: formatInteger, scale: countScale, legendOrder: 60 },
    { key: "newMemberships", label: "New memberships", color: [26, 105, 180], formatter: formatInteger, scale: countScale, legendOrder: 61, stack: false },
    { key: "endedMemberships", label: "Ended memberships", color: [210, 55, 55], formatter: formatInteger, scale: countScale, legendOrder: 62, stack: false },
    { key: "subscribersWithBooking", label: "Active subscribers who booked", color: [35, 180, 115], formatter: formatInteger, scale: countScale, legendOrder: 63 },
    { key: "subscribersWithoutBooking", label: "Active subscribers with no booking", color: [220, 80, 80], formatter: formatInteger, scale: countScale, legendOrder: 64 },
    { key: "utilizationRate", label: "Subscription utilization", color: [20, 120, 105], formatter: formatPercent, scale: "percent", legendOrder: 65, stack: false },
    ...membershipSeries,
    { key: "crewCount", label: "Crew count", color: [190, 112, 255], formatter: formatInteger, scale: countScale, legendOrder: 80 },
  ];
  const labels = [
    ...ticketItemsToTimelineLabels(ticketSales?.items || []),
    ...bookingItemsToTimelineLabels(memberEngagement?.sources?.length ? memberEngagement.bookings || [] : []),
  ].map((label) => ({
    ...label,
    legendOrder: label.type === "Event" ? 101 : label.type === "Subscription booking" ? 102 : 100,
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
    text("No paid tickets or subscription bookings in this range.", pad + 18, top + 54);
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
  const key = `${network.nodes.length}:${network.links.length}:${network.nodes.map((node) => `${node.key}:${node.totalInteractions}`).join("|")}`;
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
    const radius = map(sqrt(node.totalInteractions), 0, sqrt(network.maxInteractions || 1), 5, 28);
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
    drawNetworkNeighborLabels(network.nodes, states, highlightKeys, hovered.node.key, (node) => map(sqrt(node.totalInteractions), 0, sqrt(network.maxInteractions || 1), 5, 28));
    drawNetworkSidePanel(plotX, plotY, plotW, [
      hovered.node.label,
      `Type: ${hovered.node.type}`,
      `Buyers: ${formatInteger(hovered.node.buyerCount)}`,
      `Tickets: ${formatInteger(hovered.node.tickets)}`,
      `Subscription bookings: ${formatInteger(hovered.node.memberBookings || 0)} from ${formatInteger(hovered.node.bookingMemberCount || 0)} people`,
      `Total recorded use: ${formatInteger(hovered.node.totalInteractions || 0)}`,
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
    const radius = map(sqrt(node.totalInteractions), 0, sqrt(hopModel.activityNetwork.maxInteractions || 1), 5, 28);
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
    maxInteractions: Math.max(1, ...nodes.map((node) => node.totalInteractions)),
    maxExperience: Math.max(1, ...nodes.map((node) => node.avgExperience)),
  };
}

function syncUserNetworkState(network, plotX, plotY, plotW, plotH) {
  const key = `${network.nodes.length}:${network.links.length}:${network.nodes.map((node) => `${node.key}:${node.totalInteractions}:${node.activityCount}:${node.eventCount}`).join("|")}`;
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
  text(`showing top ${network.nodes.length}/${totalNodeCount} people with paid tickets or subscription bookings`, plotX + plotW, plotY - 38);

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
    const radius = map(sqrt(node.totalInteractions), 0, sqrt(network.maxInteractions || 1), 3, 18);
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
    drawNetworkNeighborLabels(network.nodes, states, highlightKeys, hovered.node.key, (node) => map(sqrt(node.totalInteractions), 0, sqrt(network.maxInteractions || 1), 3, 18), displayPersonName);
    drawNetworkSidePanel(plotX, plotY, plotW, [
      displayPersonName(hovered.node),
      `Type: ${hovered.node.type}`,
      `Tickets: ${formatInteger(hovered.node.tickets)}`,
      `Subscription bookings: ${formatInteger(hovered.node.memberBookings || 0)}`,
      `Total recorded interactions: ${formatInteger(hovered.node.totalInteractions || 0)}`,
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

function mergeActivityTimeline(activityWeeks, ticketWeeks, bookingPeriods = []) {
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
  for (const period of bookingPeriods) {
    const merged = byWeek.get(period.month) || { month: period.month, revenue: 0, newMemberships: 0, endedMemberships: 0, memberCount: 0 };
    merged.membershipBookings = period.membershipBookings || 0;
    merged.uniqueBookingMembers = period.uniqueBookingMembers || 0;
    merged.bookingsPerBookingMember = period.bookingsPerBookingMember || 0;
    merged.unmatchedMemberBookings = period.unmatchedMemberBookings || 0;
    merged.subscribersWithBooking = period.subscribersWithBooking || 0;
    merged.subscribersWithoutBooking = period.subscribersWithoutBooking || 0;
    merged.utilizationRate = period.utilizationRate || 0;
    byWeek.set(period.month, merged);
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

function drawPurchaseTimingView(rows, pad, top, membershipSignupKeys = new Set()) {
  const chartPad = max(pad, 32);
  const panelX = chartPad;
  const panelY = top + 14;
  const panelW = width - chartPad * 2;
  const panelH = height - top - chartPad - 14;
  drawSoftPanel(panelX, panelY, panelW, panelH, 4);
  drawViewHeader("Purchase Timing", panelX + 18, panelY + 16, "purchaseTiming");

  const purchaseRows = purchaseTimingRows(rows || [], !!purchaseTimingExcludeMembership, membershipSignupKeys);
  fill(80);
  noStroke();
  textSize(12);
  textAlign(LEFT, TOP);
  const membershipNote = purchaseTimingExcludeMembership ? "membership signups hidden" : "memberships are signups only";
  text(`${formatInteger(purchaseRows.reduce((total, row) => total + row.units, 0))} purchase units in selected range · tickets use quantity, ${membershipNote}`, panelX + 18, panelY + 44);
  drawPurchaseTimingLegend(panelX + panelW - 340, panelY + 20, !!purchaseTimingExcludeMembership);

  if (!purchaseRows.length) {
    fill(80);
    textSize(14);
    textAlign(LEFT, TOP);
    text("No activity, event, or membership purchases in this range.", panelX + 18, panelY + 76);
    return;
  }

  const dayBins = purchaseTimingDayBins(purchaseRows);
  const weekBins = purchaseTimingMonthCycleWeekBins(purchaseRows);
  const monthBins = purchaseTimingMonthBins(purchaseRows);
  const gap = 18;
  const chartY = panelY + 86;
  const chartH = max(112, (panelH - 126 - gap * 2) / 3);
  drawPurchaseTimingStackedBars(panelX + 18, chartY, panelW - 36, chartH, "Day of month", dayBins, (bin) => bin.label);
  drawPurchaseTimingStackedBars(panelX + 18, chartY + chartH + gap, panelW - 36, chartH, "Week of month", weekBins, (bin) => bin.label);
  drawPurchaseTimingStackedBars(panelX + 18, chartY + (chartH + gap) * 2, panelW - 36, chartH, "Month of year", monthBins, (bin) => bin.label);
}

function purchaseTimingRows(rows, excludeMembership = false, membershipSignupKeys = new Set()) {
  return rows
    .map((row) => {
      const type = purchaseTimingType(row);
      if (excludeMembership && type === "membership") return null;
      if (type === "membership" && !membershipSignupKeys.has(purchaseTimingRowKey(row))) return null;
      if (!type || !(row.date instanceof Date) || row.totalPrice <= 0.0001) return null;
      return {
        type,
        date: row.date,
        units: type === "membership" ? 1 : max(1, row.quantity || 1),
        revenue: row.totalPrice,
      };
    })
    .filter(Boolean);
}

function purchaseTimingType(row) {
  if (row.itemType === "class_pass_type") return "activity";
  if (row.itemType === "event") return "event";
  if (typeof isPaidMembershipRow === "function" && isPaidMembershipRow(row)) return "membership";
  return "";
}

function purchaseTimingRowKey(row) {
  return [
    row.invoiceId || "",
    row.customerKey || "",
    row.date?.getTime?.() || "",
    row.itemType || "",
    row.itemId || "",
    row.text || "",
  ].join("|");
}

function purchaseTimingDayBins(rows) {
  const bins = Array.from({ length: 31 }, (_value, index) => purchaseTimingEmptyBin(String(index + 1)));
  for (const row of rows) addPurchaseTimingRow(bins[row.date.getDate() - 1], row);
  return bins;
}

function purchaseTimingMonthBins(rows) {
  const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const bins = labels.map((label) => purchaseTimingEmptyBin(label));
  for (const row of rows) addPurchaseTimingRow(bins[row.date.getMonth()], row);
  return bins;
}

function purchaseTimingMonthCycleWeekBins(rows) {
  const bins = Array.from({ length: 5 }, (_value, index) => purchaseTimingEmptyBin(`Week ${index + 1}`));
  for (const row of rows) {
    const week = Math.ceil(row.date.getDate() / 7);
    addPurchaseTimingRow(bins[constrain(week, 1, 5) - 1], row);
  }
  return bins;
}

function purchaseTimingEmptyBin(label) {
  return {
    label,
    activity: 0,
    event: 0,
    membership: 0,
    activityRevenue: 0,
    eventRevenue: 0,
    membershipRevenue: 0,
    total: 0,
    revenue: 0,
  };
}

function addPurchaseTimingRow(bin, row) {
  bin[row.type] += row.units;
  bin[`${row.type}Revenue`] += row.revenue;
  bin.total += row.units;
  bin.revenue += row.revenue;
}

function drawPurchaseTimingLegend(x, y, excludeMembership = false) {
  let lx = x;
  for (const entry of purchaseTimingSeries(excludeMembership)) {
    fill(...entry.color);
    noStroke();
    rect(lx, y + 2, 10, 10, 2);
    fill(60);
    textSize(11);
    textAlign(LEFT, TOP);
    text(entry.label, lx + 14, y);
    lx += textWidth(entry.label) + 34;
  }
}

function drawPurchaseTimingStackedBars(x, y, w, h, title, bins, labelForBin) {
  drawSoftPanel(x, y, w, h, 4);
  fill(30);
  noStroke();
  textSize(16);
  textAlign(LEFT, TOP);
  text(title, x + 16, y + 14);

  const maxTotal = Math.max(1, ...bins.map((bin) => bin.total));
  const plotX = x + 36;
  const plotY = y + 50;
  const plotW = w - 58;
  const plotH = h - 88;
  const barGap = bins.length > 20 ? 3 : 8;
  const barW = max(4, (plotW - barGap * (bins.length - 1)) / bins.length);
  const series = purchaseTimingSeries(!!purchaseTimingExcludeMembership);
  let hovered = null;

  stroke(218);
  strokeWeight(1);
  line(plotX, plotY + plotH, plotX + plotW, plotY + plotH);
  noStroke();

  for (let index = 0; index < bins.length; index += 1) {
    const bin = bins[index];
    const bx = plotX + index * (barW + barGap);
    let by = plotY + plotH;
    for (const entry of series) {
      const value = bin[entry.key] || 0;
      const bh = (value / maxTotal) * plotH;
      const isHover = value > 0 && mouseX >= bx && mouseX <= bx + barW && mouseY >= by - bh && mouseY <= by;
      fill(...entry.color);
      rect(bx, by - bh, barW, bh, 1);
      if (isHover) hovered = { bin, entry, value };
      by -= bh;
    }

    const shouldLabel = bins.length <= 12 || index % 5 === 0 || index === bins.length - 1;
    if (shouldLabel) {
      fill(75);
      textSize(10);
      textAlign(CENTER, TOP);
      text(labelForBin(bin), bx + barW / 2, plotY + plotH + 8);
    }
  }

  fill(85);
  textSize(11);
  textAlign(RIGHT, TOP);
  text(formatInteger(maxTotal), plotX + plotW, plotY);

  if (hovered) {
    const revenueKey = `${hovered.entry.key}Revenue`;
    drawTooltip(mouseX, mouseY, [
      `${title}: ${hovered.bin.label}`,
      `${hovered.entry.label}: ${formatInteger(hovered.value)}`,
      `Revenue: ${formatDkk(hovered.bin[revenueKey] || 0)}`,
      `Total: ${formatInteger(hovered.bin.total)}`,
    ]);
  }
}

function purchaseTimingSeries(excludeMembership = false) {
  const series = [
    { key: "activity", label: "Activity", color: [70, 150, 90] },
    { key: "event", label: "Event", color: [135, 85, 170] },
    { key: "membership", label: "Membership", color: [220, 125, 45] },
  ];
  return excludeMembership ? series.filter((entry) => entry.key !== "membership") : series;
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

function bookingItemsToTimelineLabels(bookings) {
  const byClass = new Map();
  for (const booking of bookings.filter((item) => item.isMembershipBooking)) {
    const key = cleanValue(booking.className).toLowerCase();
    if (!byClass.has(key)) {
      byClass.set(key, {
        label: booking.className || "Unknown class",
        count: 0,
        customerKeys: new Set(),
        lastDate: booking.date,
      });
    }
    const entry = byClass.get(key);
    entry.count += 1;
    entry.customerKeys.add(booking.customerKey);
    if (booking.date > entry.lastDate) entry.lastDate = booking.date;
  }
  return Array.from(byClass.values()).map((entry) => ({
    type: "Subscription booking",
    legendLabel: "Subscription-booked classes",
    label: entry.label,
    period: periodKey(entry.lastDate, timeBucket),
    periodLabel: "Last booked",
    value: entry.count,
    valueLabel: "Subscription bookings",
    valueFormatter: formatInteger,
    count: entry.customerKeys.size,
    countLabel: "People booking by subscription",
    countFormatter: formatInteger,
    color: [35, 145, 95],
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
  const maxValue = Math.max(1, ...entries.map((entry) => entry.revenue));
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
  const maxTickets = Math.max(1, ...buyers.flatMap((buyer) => buyer.periods.map((period) => period.tickets)));
  const maxRevenue = Math.max(1, ...buyers.flatMap((buyer) => buyer.periods.map((period) => period.revenue)));
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
    const firstIndex = rowIndexes.length ? Math.min(...rowIndexes) : 0;
    const lastIndex = rowIndexes.length ? Math.max(...rowIndexes) : 0;
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
  const maxRevenue = Math.max(1, ...groups.map((group) => group.revenue));
  const maxPeople = Math.max(1, ...groups.map((group) => group.people));
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
  drawStatCard(pad + (cardW + 16) * 2, top + 38, cardW, 82, "With sub. bookings", formatInteger(summary.membershipWithBookings || 0));
  drawStatCard(pad + (cardW + 16) * 3, top + 38, cardW, 82, "Subscription, no booking", formatInteger(summary.membershipOnly || 0));
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
    text(activityPath?.sourceMode === "subscription" ? "No subscription-booking paths in this range." : "No activity paths in this range.", pad + 18, top + 54);
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
  const maxRowSize = Math.max(1, ...visibleRows.map((row) => row.size));
  const targetByRow = new Map(visibleRows.map((row) => [
    row.key,
    new Map(row.targets.map((target) => [target.key, target])),
  ]));
  let hovered = null;

  fill(85);
  textSize(12);
  textAlign(LEFT, CENTER);
  const modeLabel = activityPath.mode === "range" ? "first in selected range" : "first ever";
  const sourceLabels = {
    purchase: { people: "buyers", first: "first paid activity", next: "next paid step" },
    subscription: { people: "people booking", first: "first subscription booking", next: "next subscription booking" },
    combined: { people: "people", first: "first purchase or subscription booking", next: "next recorded interaction" },
  };
  const sourceLabel = sourceLabels[activityPath.sourceMode] || sourceLabels.combined;
  const noBookingDetail = activityPath.sourceMode === "purchase" || !(activityPath.subscribersWithoutBookings > 0)
    ? ""
    : ` · ${formatInteger(activityPath.subscribersWithoutBookings)} paid subscribers have no booking`;
  const headerDetail = `${formatInteger(activityPath.customerCount || 0)} ${sourceLabel.people} · ${modeLabel} · columns are ${sourceLabel.next}${noBookingDetail} · showing ${visibleRows.length}/${allRows.length} starting points and ${visibleColumns.length}/${allColumns.length} next steps`;
  text(trimText(headerDetail, 140), pad + 176, top + 26);

  fill(80);
  textSize(10);
  textAlign(LEFT, BOTTOM);
  text(sourceLabel.first, labelX, plotY - 8);
  text("people", barX, plotY - 8);
  for (let colIndex = 0; colIndex < visibleColumns.length; colIndex += 1) {
    const column = visibleColumns[colIndex];
    const x = plotX + colIndex * cellW + cellW * 0.5;
    push();
    translate(x, plotY - 12);
    rotate(-PI / 4);
    textAlign(LEFT, CENTER);
    fill(activityPathTypeColor(column.type));
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
    const rowColor = activityPathTypeColor(row.type);
    fill(red(rowColor), green(rowColor), blue(rowColor), 150);
    rect(barX, y + cellH * 0.28, map(row.size, 0, maxRowSize, 0, barW), cellH * 0.44, 1);

    const targetMap = targetByRow.get(row.key);
    const maxTargetCount = Math.max(1, ...row.targets.map((target) => target.count || 0));
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
    const lines = [
      ...wrapText(`${hovered.row.label} -> ${hovered.column.label}`, 34),
      `People: ${formatInteger(count)} / ${formatInteger(hovered.row.size)} (${formatPercent(rate)})`,
      `Next type: ${hovered.column.type}`,
    ];
    if (hovered.target?.avgDaysToNext != null) lines.push(`Average time to next: ${(Number(hovered.target.avgDaysToNext) || 0).toFixed(1)} days`);
    if ((hovered.target?.revenue || 0) > 0) lines.push(`Next-step revenue: ${formatDkk(hovered.target.revenue)}`);
    drawTooltip(mouseX, mouseY, lines, 300);
  }
}

function drawIntroConversionView(introConversion, pad, top) {
  const data = introConversion || {};
  const cohorts = data.cohorts || [];
  const summary = data.summary || {};
  const panelW = width - pad * 2;
  fill(238);
  noStroke();
  rect(pad, top, panelW, height - top - pad, 4);
  drawViewHeader("Intro Conversion", pad + 18, top + 16, "introConversion");

  if (!(summary.totalSignups > 0)) {
    fill(80);
    textSize(14);
    textAlign(LEFT, TOP);
    text("No sign-ups for the two introduction classes in the selected range.", pad + 18, top + 54);
    fill(110);
    textSize(12);
    text("This view recognizes class names containing ‘Introduction to House of Play’ or ‘Introduction to Ropes for Absolute Beginners’.", pad + 18, top + 78);
    return;
  }

  const cardY = top + 48;
  const cardGap = 8;
  const cardW = (panelW - 36 - cardGap * 5) / 6;
  const cards = [
    ["Intro sign-ups", formatInteger(summary.totalSignups || 0)],
    ["Unique people", formatInteger(summary.uniquePeople || 0)],
    ["90-day eligible", formatInteger(summary.eligible90 || 0)],
    ["Continued in 90d", formatPercent(summary.continuedRate90 || 0)],
    ["Identity match", formatPercent(summary.matchRate || 0)],
    ["Revenue within 90d", formatDkk(summary.revenue90 || 0)],
  ];
  cards.forEach(([label, value], index) => {
    drawStatCard(pad + 18 + index * (cardW + cardGap), cardY, cardW, 68, label, value);
  });

  fill(85);
  noStroke();
  textSize(11);
  textAlign(LEFT, TOP);
  const coverageLabel = data.dataEndMs ? formatDate(new Date(data.dataEndMs)) : "unknown";
  text(`Outcome = first later booking or purchase within 90 days · data available through ${coverageLabel} · sign-ups do not confirm attendance`, pad + 18, top + 126);

  const cohortY = top + 154;
  const cohortGap = 10;
  const cohortH = 112;
  let hoveredOutcome = null;
  for (let index = 0; index < cohorts.length; index += 1) {
    const cohort = cohorts[index];
    const y = cohortY + index * (cohortH + cohortGap);
    drawSoftPanel(pad + 18, y, panelW - 36, cohortH, 3);
    fill(38);
    textSize(13);
    textAlign(LEFT, TOP);
    drawWrappedLabel(cohort.label, pad + 32, y + 14, 280, 2, 15);
    fill(95);
    textSize(10);
    text(`${formatInteger(cohort.signups)} sign-ups · ${formatInteger(cohort.eligible90)} eligible · ${formatInteger(cohort.pending90)} awaiting 90 days · ${formatPercent(cohort.matchRate)} matched`, pad + 32, y + 51);

    const barX = pad + 332;
    const metricsW = 215;
    const barW = max(120, panelW - 36 - 314 - metricsW);
    const barY = y + 27;
    const barH = 25;
    fill(224);
    noStroke();
    rect(barX, barY, barW, barH, 2);
    let segmentX = barX;
    for (const outcome of cohort.outcomes || []) {
      const segmentW = cohort.eligible90 ? barW * outcome.count / cohort.eligible90 : 0;
      if (segmentW <= 0) continue;
      fill(...introOutcomeColor(outcome.key));
      rect(segmentX, barY, segmentW, barH);
      if (mouseX >= segmentX && mouseX <= segmentX + segmentW && mouseY >= barY && mouseY <= barY + barH) {
        hoveredOutcome = { cohort, outcome };
      }
      segmentX += segmentW;
    }
    fill(95);
    textSize(10);
    textAlign(LEFT, TOP);
    text("90-day first destination", barX, y + 12);
    drawIntroOutcomeLegend(cohort.outcomes || [], barX, y + 62, barW);

    const metricsX = barX + barW + 18;
    fill(45);
    textSize(11);
    textAlign(LEFT, TOP);
    text(`Continued: ${formatInteger(cohort.continued90)} (${formatPercent(cohort.continuedRate90)})`, metricsX, y + 17);
    text(`Median next step: ${cohort.continued90 ? `${(Number(cohort.medianDays90) || 0).toFixed(1)} days` : "—"}`, metricsX, y + 39);
    text(`90-day revenue: ${formatDkk(cohort.revenue90 || 0)}`, metricsX, y + 61);
    text(`Revenue / eligible: ${formatDkk(cohort.avgRevenue90 || 0)}`, metricsX, y + 83);
  }

  if (hoveredOutcome) {
    drawTooltip(mouseX, mouseY, [
      ...wrapText(hoveredOutcome.cohort.label, 38),
      hoveredOutcome.outcome.label,
      `People: ${formatInteger(hoveredOutcome.outcome.count)} / ${formatInteger(hoveredOutcome.cohort.eligible90)} (${formatPercent(hoveredOutcome.outcome.rate)})`,
      "Based on the first later interaction within 90 days",
    ], 320);
  }

  const lowerY = cohortY + cohorts.length * (cohortH + cohortGap) + 4;
  const lowerH = height - lowerY - pad;
  if (lowerH > 90) {
    const splitGap = 10;
    const leftW = (panelW - 36 - splitGap) * 0.43;
    drawIntroWindowPanel(cohorts, pad + 18, lowerY, leftW, lowerH);
    drawIntroDestinationPanel(cohorts, pad + 18 + leftW + splitGap, lowerY, panelW - 36 - leftW - splitGap, lowerH);
  }
}

function drawIntroOutcomeLegend(outcomes, x, y, w) {
  let cursorX = x;
  for (const outcome of outcomes) {
    const label = `${outcome.label} ${formatInteger(outcome.count)}`;
    textSize(9);
    const itemW = textWidth(label) + 20;
    if (cursorX + itemW > x + w) break;
    fill(...introOutcomeColor(outcome.key));
    rect(cursorX, y + 2, 8, 8, 1);
    fill(75);
    textAlign(LEFT, TOP);
    text(label, cursorX + 12, y);
    cursorX += itemW + 8;
  }
}

function drawIntroWindowPanel(cohorts, x, y, w, h) {
  drawSoftPanel(x, y, w, h, 3);
  fill(45);
  textSize(12);
  textAlign(LEFT, TOP);
  text("Continued after introduction", x + 14, y + 12);
  fill(95);
  textSize(10);
  text("Only sign-ups with complete follow-up are included", x + 14, y + 31);
  const tableY = y + 58;
  const labelW = min(230, w * 0.48);
  const dayW = (w - 28 - labelW) / 4;
  fill(90);
  textAlign(CENTER, TOP);
  for (let index = 0; index < 4; index += 1) {
    const days = cohorts[0]?.windowRates?.[index]?.days || [7, 30, 60, 90][index];
    text(`${days}d`, x + 14 + labelW + dayW * (index + 0.5), tableY);
  }
  for (let rowIndex = 0; rowIndex < cohorts.length; rowIndex += 1) {
    const cohort = cohorts[rowIndex];
    const rowY = tableY + 25 + rowIndex * 42;
    fill(55);
    textSize(10);
    textAlign(LEFT, CENTER);
    text(trimText(cohort.label, 30), x + 14, rowY + 12);
    for (let index = 0; index < cohort.windowRates.length; index += 1) {
      const windowRate = cohort.windowRates[index];
      const cellX = x + 14 + labelW + dayW * index;
      fill(...interpolateRgb([245, 245, 245], [35, 155, 95], windowRate.rate));
      rect(cellX + 3, rowY, max(1, dayW - 6), 25, 2);
      fill(windowRate.rate > 0.55 ? 245 : 45);
      textAlign(CENTER, CENTER);
      text(windowRate.eligible ? formatPercent(windowRate.rate) : "—", cellX + dayW * 0.5, rowY + 12);
    }
  }
}

function drawIntroDestinationPanel(cohorts, x, y, w, h) {
  drawSoftPanel(x, y, w, h, 3);
  fill(45);
  textSize(12);
  textAlign(LEFT, TOP);
  text("Most common next destinations within 90 days", x + 14, y + 12);
  const columnGap = 18;
  const columnW = (w - 28 - columnGap) / 2;
  for (let cohortIndex = 0; cohortIndex < cohorts.length; cohortIndex += 1) {
    const cohort = cohorts[cohortIndex];
    const columnX = x + 14 + cohortIndex * (columnW + columnGap);
    fill(90);
    textSize(10);
    drawWrappedLabel(cohort.label, columnX, y + 34, columnW, 2, 12);
    const destinations = cohort.topDestinations || [];
    const maxCount = Math.max(1, ...destinations.map((destination) => destination.count));
    const rowH = min(24, max(17, (h - 76) / max(1, destinations.length)));
    for (let index = 0; index < destinations.length; index += 1) {
      const destination = destinations[index];
      const rowY = y + 68 + index * rowH;
      const valueW = 34;
      const labelW = columnW - valueW;
      const barW = map(destination.count, 0, maxCount, 0, max(10, labelW - 14));
      fill(...introOutcomeColor(destination.type), 90);
      rect(columnX, rowY + rowH * 0.25, barW, rowH * 0.5, 1);
      fill(50);
      textSize(10);
      textAlign(LEFT, CENTER);
      text(trimText(destination.label, 28), columnX + 4, rowY + rowH * 0.5);
      textAlign(RIGHT, CENTER);
      text(formatInteger(destination.count), columnX + columnW, rowY + rowH * 0.5);
    }
    if (!destinations.length) {
      fill(115);
      textSize(10);
      textAlign(LEFT, TOP);
      text("No eligible next destinations", columnX, y + 68);
    }
  }
}

function introOutcomeColor(key) {
  const colors = {
    paidClass: [60, 125, 185],
    subscription: [230, 130, 55],
    subscriptionBooking: [35, 155, 95],
    otherBooking: [85, 165, 175],
    anotherIntro: [145, 95, 185],
    noReturn: [175, 175, 175],
  };
  return colors[key] || [110, 110, 110];
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
  const maxRevenue = Math.max(1, ...rows.map((row) => row.laterRevenue));
  let hovered = null;

  fill(75);
  textSize(10);
  textAlign(LEFT, BOTTOM);
  text("gateway activity", tableX, tableY - 8);
  textAlign(RIGHT, BOTTOM);
  text("people", tableX + nameW + peopleW - 8, tableY - 8);
  text("return", tableX + nameW + peopleW + rateW - 8, tableY - 8);
  text("subscription", tableX + nameW + peopleW + rateW * 2 - 8, tableY - 8);
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
  text("Ticket buyer -> recurring ticket buyer -> paid subscriber -> crew / long-term", pad + 18, top + 44);

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
  const maxPeople = Math.max(1, ...entries.map((entry) => entry.people));
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
    text(`${formatInteger(entry.people)} subscribers`, x + w, rowY + rowH * 0.5);
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
  text("Total class demand combines paid tickets and subscription bookings; revenue remains sales-only", pad + 18, top + 44);

  const tableX = pad + 18;
  const tableY = top + 82;
  const tableW = width - pad * 2 - 36;
  const rowH = min(30, max(22, (height - tableY - pad - 22) / items.length));
  const nameW = min(300, tableW * 0.3);
  const colW = max(68, (tableW - nameW) / 7);
  const demandX = tableX + nameW;
  const revenueX = demandX + colW;
  const ticketX = revenueX + colW;
  const bookingX = ticketX + colW;
  const peopleX = bookingX + colW;
  const repeatX = peopleX + colW;
  const trendX = repeatX + colW;
  const maxDemand = max(1, productHealth.maxDemand || 1);
  let hovered = null;

  fill(75);
  textSize(10);
  textAlign(LEFT, BOTTOM);
  text("product", tableX, tableY - 8);
  textAlign(RIGHT, BOTTOM);
  text("total use", revenueX - 12, tableY - 8);
  text("revenue", ticketX - 12, tableY - 8);
  text("paid tickets", bookingX - 12, tableY - 8);
  text("sub. bookings", peopleX - 12, tableY - 8);
  text("people", repeatX - 12, tableY - 8);
  text("repeat bookers", trendX - 12, tableY - 8);
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

    const barW = map(item.totalDemand, 0, maxDemand, 0, max(20, colW - 18));
    fill(20, 65);
    rect(demandX, y + rowH * 0.3, barW, rowH * 0.4, 1);

    fill(55);
    textAlign(RIGHT, CENTER);
    text(formatInteger(item.totalDemand), revenueX - 12, y + rowH * 0.5);
    text(formatDkk(item.revenue), ticketX - 12, y + rowH * 0.5);
    text(formatInteger(item.tickets), bookingX - 12, y + rowH * 0.5);
    text(formatInteger(item.memberBookings), peopleX - 12, y + rowH * 0.5);
    text(formatInteger(item.totalPeople), repeatX - 12, y + rowH * 0.5);
    text(formatInteger(item.repeatBookingMemberCount), trendX - 12, y + rowH * 0.5);
    fill(productTrendColor(item.bookingTrend));
    text(productTrendLabel(item.bookingTrend), tableX + tableW, y + rowH * 0.5);
  }

  if (hovered) {
    drawTooltip(mouseX, mouseY, [
      ...wrapText(hovered.label, 34),
      `Type: ${hovered.type}`,
      `Revenue: ${formatDkk(hovered.revenue)}`,
      `Paid tickets: ${formatInteger(hovered.tickets)} from ${formatInteger(hovered.buyerCount)} buyers`,
      `Subscription bookings: ${formatInteger(hovered.memberBookings)} from ${formatInteger(hovered.bookingMemberCount)} people`,
      `Total recorded use: ${formatInteger(hovered.totalDemand)} from ${formatInteger(hovered.totalPeople)} people`,
      `Repeat subscription bookers: ${formatInteger(hovered.repeatBookingMemberCount)}`,
      `First-timer share: ${formatPercent(hovered.firstTimerShare)}`,
      `Member share: ${formatPercent(hovered.memberShare)}`,
      `Trend: ${productTrendLabel(hovered.trend)} (${formatPercent(hovered.trend)})`,
      `Early/Late revenue: ${formatDkk(hovered.earlyRevenue)} / ${formatDkk(hovered.lateRevenue)}`,
      `Booking trend: ${productTrendLabel(hovered.bookingTrend)} (${formatPercent(hovered.bookingTrend)})`,
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

function drawActivityExplorerView(activityExplorer, pad, top, options = {}) {
  const data = activityExplorer || {};
  const items = data.items || [];
  const panelW = width - pad * 2;
  fill(238);
  noStroke();
  rect(pad, top, panelW, height - top - pad, 4);
  drawViewHeader("Activity Explorer", pad + 18, top + 16, "activityExplorer");
  if (!items.length) {
    fill(80);
    textSize(14);
    textAlign(LEFT, TOP);
    text("No paid ticket types or booking classes in this range.", pad + 18, top + 54);
    return;
  }

  const selectedKey = items.some((item) => item.key === options.activityExplorerKey) ? options.activityExplorerKey : data.defaultKey || items[0].key;
  const selected = items.find((item) => item.key === selectedKey) || items[0];
  const selectorBounds = { x: pad + 18, y: top + 46, w: min(590, panelW - 36), h: 34 };
  drawActivityExplorerSelectorBox(selected, items.length, selectorBounds, !!options.activityExplorerDropdownOpen);

  const cardY = top + 92;
  const cardGap = 8;
  const cardW = (panelW - 36 - cardGap * 6) / 7;
  [
    ["Recorded use", formatInteger(selected.totalRecordedUse)],
    ["People", formatInteger(selected.totalPeople)],
    ["Repeat people", formatPercent(selected.repeatRate)],
    ["Revenue", formatDkk(selected.revenue)],
    ["Paid tickets", formatInteger(selected.paidTickets)],
    ["Sub. bookings", formatInteger(selected.membershipBookings)],
    ["Other bookings", formatInteger(selected.otherBookings)],
  ].forEach(([label, value], index) => drawStatCard(pad + 18 + index * (cardW + cardGap), cardY, cardW, 68, label, value));

  const bodyY = top + 176;
  const bodyH = height - bodyY - pad;
  const gap = 10;
  const columnW = (panelW - 36 - gap * 2) / 3;
  const rowH = (bodyH - gap) / 2;
  const x1 = pad + 18;
  const x2 = x1 + columnW + gap;
  const x3 = x2 + columnW + gap;
  drawActivityExplorerAudiencePanel(selected, x1, bodyY, columnW, rowH);
  drawActivityExplorerRelationPanel("Related activities", "Shared people in the selected range", selected.related, selected.totalPeople, x2, bodyY, columnW, rowH);
  drawActivityExplorerRelationPanel("Next different activity", "After the first selected interaction", selected.next, selected.totalPeople, x3, bodyY, columnW, rowH);
  drawActivityExplorerRelationPanel("Previous different activity", "Before the first selected interaction", selected.previous, selected.totalPeople, x1, bodyY + rowH + gap, columnW, rowH);
  drawActivityExplorerJourneyPanel(selected, x2, bodyY + rowH + gap, columnW, rowH);
  drawActivityExplorerSchedulePanel(selected, x3, bodyY + rowH + gap, columnW, rowH);
  if (options.activityExplorerDropdownOpen) drawActivityExplorerDropdown(items, selected.key, selectorBounds, options.activityExplorerDropdownOffset || 0);
}

function drawActivityExplorerSelectorBox(selected, itemCount, bounds, open) {
  const hovered = mouseX >= bounds.x && mouseX <= bounds.x + bounds.w && mouseY >= bounds.y && mouseY <= bounds.y + bounds.h;
  fill(hovered || open ? 250 : 244);
  stroke(open ? 70 : 205);
  strokeWeight(1);
  rect(bounds.x, bounds.y, bounds.w, bounds.h, 3);
  noStroke();
  fill(45);
  textSize(12);
  textAlign(LEFT, CENTER);
  text(trimText(selected.label, 62), bounds.x + 12, bounds.y + bounds.h * 0.5);
  fill(110);
  textSize(10);
  textAlign(RIGHT, CENTER);
  text(`${selected.sourceLabel} · ${formatInteger(itemCount)} available`, bounds.x + bounds.w - 36, bounds.y + bounds.h * 0.5);
  fill(65);
  textSize(16);
  text(open ? "▴" : "▾", bounds.x + bounds.w - 17, bounds.y + bounds.h * 0.5 - 1);
  activityExplorerSelectorHits.push({ kind: "toggle", ...bounds });
}

function drawActivityExplorerDropdown(items, selectedKey, bounds, offset) {
  const rowH = 27;
  const listY = bounds.y + bounds.h + 2;
  const availableRows = max(4, floor((height - listY - 38) / rowH));
  const visibleCount = min(12, availableRows, items.length);
  activityExplorerDropdownVisibleCount = visibleCount;
  const safeOffset = constrain(Math.round(offset), 0, max(0, items.length - visibleCount));
  const visible = items.slice(safeOffset, safeOffset + visibleCount);
  const topH = safeOffset > 0 ? 22 : 0;
  const bottomH = safeOffset + visibleCount < items.length ? 22 : 0;
  fill(252);
  stroke(95);
  strokeWeight(1);
  rect(bounds.x, listY, bounds.w, topH + visible.length * rowH + bottomH, 3);
  noStroke();
  let y = listY;
  if (topH) {
    fill(235);
    rect(bounds.x + 1, y + 1, bounds.w - 2, topH - 1, 2);
    fill(80);
    textSize(10);
    textAlign(CENTER, CENTER);
    text(`▲ ${formatInteger(safeOffset)} earlier`, bounds.x + bounds.w * 0.5, y + topH * 0.5);
    activityExplorerSelectorHits.push({ kind: "scroll", direction: -1, x: bounds.x, y, w: bounds.w, h: topH });
    y += topH;
  }
  for (const item of visible) {
    const hovered = mouseX >= bounds.x && mouseX <= bounds.x + bounds.w && mouseY >= y && mouseY <= y + rowH;
    fill(item.key === selectedKey ? color(220, 234, 245) : hovered ? color(238) : color(252));
    rect(bounds.x + 1, y, bounds.w - 2, rowH);
    fill(45);
    textSize(10);
    textAlign(LEFT, CENTER);
    text(trimText(item.label, 58), bounds.x + 12, y + rowH * 0.5);
    fill(110);
    textAlign(RIGHT, CENTER);
    text(`${item.sourceLabel} · ${formatInteger(item.totalRecordedUse)}`, bounds.x + bounds.w - 12, y + rowH * 0.5);
    activityExplorerSelectorHits.push({ kind: "option", key: item.key, x: bounds.x, y, w: bounds.w, h: rowH });
    y += rowH;
  }
  if (bottomH) {
    fill(235);
    rect(bounds.x + 1, y, bounds.w - 2, bottomH - 1, 2);
    fill(80);
    textSize(10);
    textAlign(CENTER, CENTER);
    text(`▼ ${formatInteger(items.length - safeOffset - visibleCount)} more`, bounds.x + bounds.w * 0.5, y + bottomH * 0.5);
    activityExplorerSelectorHits.push({ kind: "scroll", direction: 1, x: bounds.x, y, w: bounds.w, h: bottomH });
  }
}

function drawActivityExplorerAudiencePanel(item, x, y, w, h) {
  drawSoftPanel(x, y, w, h, 3);
  fill(45);
  textSize(12);
  textAlign(LEFT, TOP);
  text("Types of people", x + 14, y + 12);
  fill(100);
  textSize(10);
  text("Behavioral groups—not demographics", x + 14, y + 30);
  const sectionGap = max(42, (h - 50) / 3);
  drawActivityExplorerStack("How they used it", [
    { label: "Paid only", value: item.paidOnlyPeople, color: [60, 125, 185] },
    { label: "Booking only", value: item.bookingOnlyPeople, color: [35, 155, 95] },
    { label: "Both", value: item.mixedPeople, color: [135, 85, 170] },
  ], item.totalPeople, x + 14, y + 49, w - 28);
  drawActivityExplorerStack("Subscription relationship", [
    { label: "Already subscribed", value: item.subscribersAtSelection, color: [230, 130, 55] },
    { label: "Subscribed later", value: item.subscribedLater, color: [245, 185, 85] },
    { label: "No paid subscription", value: item.neverSubscribed, color: [175, 175, 175] },
  ], item.totalPeople, x + 14, y + 49 + sectionGap, w - 28);
  drawActivityExplorerStack("Breadth of activity", [
    { label: "Only this", value: item.singleElementPeople, color: [105, 145, 190] },
    { label: "2–3 types", value: item.multiElementPeople, color: [70, 165, 150] },
    { label: "4+ types", value: item.explorerPeople, color: [145, 95, 185] },
  ], item.totalPeople, x + 14, y + 49 + sectionGap * 2, w - 28);
}

function drawActivityExplorerStack(title, segments, total, x, y, w) {
  fill(75);
  textSize(9);
  textAlign(LEFT, TOP);
  text(title, x, y);
  const barY = y + 14;
  fill(225);
  rect(x, barY, w, 9, 1);
  let cursorX = x;
  for (const segment of segments) {
    const segmentW = total ? w * segment.value / total : 0;
    fill(...segment.color);
    rect(cursorX, barY, segmentW, 9);
    cursorX += segmentW;
  }
  let legendX = x;
  for (const segment of segments) {
    const label = `${segment.label} ${formatInteger(segment.value)}`;
    textSize(8);
    const labelW = textWidth(label) + 12;
    if (legendX + labelW > x + w) break;
    fill(...segment.color);
    rect(legendX, barY + 15, 6, 6, 1);
    fill(90);
    textAlign(LEFT, TOP);
    text(label, legendX + 9, barY + 12);
    legendX += labelW + 5;
  }
}

function drawActivityExplorerRelationPanel(title, subtitle, relations, totalPeople, x, y, w, h) {
  drawSoftPanel(x, y, w, h, 3);
  fill(45);
  textSize(12);
  textAlign(LEFT, TOP);
  text(title, x + 14, y + 12);
  fill(100);
  textSize(9);
  text(subtitle, x + 14, y + 30);
  const entries = (relations || []).slice(0, max(1, floor((h - 57) / 22)));
  const maxPeople = Math.max(1, ...entries.map((entry) => entry.people));
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const rowY = y + 52 + index * 22;
    const barW = map(entry.people, 0, maxPeople, 0, max(12, w - 130));
    fill(entry.type === "Event" ? color(135, 85, 170, 80) : color(60, 140, 85, 80));
    rect(x + 14, rowY + 4, barW, 13, 1);
    fill(48);
    textSize(10);
    textAlign(LEFT, CENTER);
    text(trimText(entry.label, 34), x + 18, rowY + 11);
    textAlign(RIGHT, CENTER);
    text(`${formatInteger(entry.people)} · ${formatPercent(totalPeople ? entry.people / totalPeople : 0)}`, x + w - 14, rowY + 11);
  }
  if (!entries.length) {
    fill(115);
    textSize(10);
    textAlign(LEFT, TOP);
    text("No other activity recorded", x + 14, y + 54);
  }
}

function drawActivityExplorerJourneyPanel(item, x, y, w, h) {
  drawSoftPanel(x, y, w, h, 3);
  fill(45);
  textSize(12);
  textAlign(LEFT, TOP);
  text("Role in the customer journey", x + 14, y + 12);
  const rows = [
    ["First recorded activity", item.firstElementPeople, item.firstElementRate],
    ["Last recorded activity", item.lastElementPeople, item.lastElementRate],
    ["Returned to this type", item.repeatPeople, item.repeatRate],
  ];
  for (let index = 0; index < rows.length; index += 1) {
    const [label, count, rate] = rows[index];
    const rowY = y + 44 + index * 35;
    fill(90);
    textSize(10);
    textAlign(LEFT, TOP);
    text(label, x + 14, rowY);
    fill(220);
    rect(x + 14, rowY + 16, w - 100, 7, 1);
    fill(60, 125, 185);
    rect(x + 14, rowY + 16, (w - 100) * rate, 7, 1);
    fill(50);
    textAlign(RIGHT, CENTER);
    text(`${formatInteger(count)} · ${formatPercent(rate)}`, x + w - 14, rowY + 19);
  }
  fill(65);
  textSize(10);
  textAlign(LEFT, TOP);
  text(`Median to next different activity: ${item.next?.length ? `${(Number(item.medianDaysToNext) || 0).toFixed(1)} days` : "—"}`, x + 14, min(y + h - 25, y + 155));
}

function drawActivityExplorerSchedulePanel(item, x, y, w, h) {
  drawSoftPanel(x, y, w, h, 3);
  fill(45);
  textSize(12);
  textAlign(LEFT, TOP);
  text("Booking pattern", x + 14, y + 12);
  fill(100);
  textSize(9);
  text("Schedule data comes from booking exports only", x + 14, y + 30);
  const columns = [
    { title: "Days", entries: item.weekdays || [] },
    { title: "Start times", entries: item.bookingTimes || [] },
    { title: "Rooms", entries: item.rooms || [] },
  ];
  const gap = 10;
  const columnW = (w - 28 - gap * 2) / 3;
  for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
    const column = columns[columnIndex];
    const columnX = x + 14 + columnIndex * (columnW + gap);
    fill(75);
    textSize(9);
    textAlign(LEFT, TOP);
    text(column.title, columnX, y + 52);
    for (let index = 0; index < column.entries.slice(0, 5).length; index += 1) {
      const entry = column.entries[index];
      const rowY = y + 70 + index * 19;
      fill(55);
      textSize(9);
      textAlign(LEFT, CENTER);
      text(trimText(entry.label, 14), columnX, rowY);
      textAlign(RIGHT, CENTER);
      text(formatInteger(entry.count), columnX + columnW, rowY);
    }
    if (!column.entries.length) {
      fill(125);
      textSize(9);
      textAlign(LEFT, TOP);
      text("No data", columnX, y + 70);
    }
  }
}

function getActivityExplorerSelectorHit(x, y) {
  return [...activityExplorerSelectorHits].reverse().find((hit) => x >= hit.x && x <= hit.x + hit.w && y >= hit.y && y <= hit.y + hit.h) || null;
}

function getActivityExplorerDropdownVisibleCount() {
  return activityExplorerDropdownVisibleCount;
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
    text(`avg ${formatDkk(segment.avgRevenue)} · ${segment.avgTickets.toFixed(1)} tickets · ${segment.avgBookings.toFixed(1)} bookings`, tableX + 18, y + 36);

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
      `Avg subscription bookings/person: ${hovered.avgBookings.toFixed(1)}`,
      `Favorite activities: ${hovered.favoriteActivities.map((item) => `${item.label} (${formatInteger(item.count)})`).join(", ") || "none"}`,
      `Typical journeys: ${hovered.typicalJourneys.map((item) => `${item.label} (${formatInteger(item.count)})`).join(", ") || "none"}`,
    ], 360);
  }
}

function customerSegmentColor(key) {
  const colors = {
    crew: color(135, 85, 170),
    activeSubscribers: color(35, 155, 95),
    lowUseSubscribers: color(225, 145, 55),
    inactiveSubscribers: color(210, 85, 75),
    bookingOnly: color(145, 95, 175),
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
    "Subscription booking": color(35, 155, 95),
  };
  return colors[type] || color(100);
}

function drawMemberEngagementView(engagement, pad, top) {
  const data = engagement || {};
  const panelW = width - pad * 2;
  fill(238);
  noStroke();
  rect(pad, top, panelW, height - top - pad, 4);
  drawViewHeader("Subscription Engagement", pad + 18, top + 16, "memberEngagement");

  if (!(data.sources || []).length) {
    fill(80);
    textSize(14);
    textAlign(LEFT, TOP);
    text("Drop one or more yearly booking CSVs to add subscription booking activity.", pad + 18, top + 54);
    fill(110);
    textSize(12);
    text("The sales dashboard remains available; booking files can be added in any order.", pad + 18, top + 78);
    return;
  }

  const cardY = top + 50;
  const cardGap = 10;
  const cardW = (panelW - 36 - cardGap * 3) / 4;
  drawStatCard(pad + 18, cardY, cardW, 68, "Subscription bookings", formatInteger(data.membershipBookingCount || 0));
  drawStatCard(pad + 18 + (cardW + cardGap), cardY, cardW, 68, "People booking by subscription", formatInteger((data.members || []).filter((member) => member.membershipBookingCount > 0).length));
  drawStatCard(pad + 18 + (cardW + cardGap) * 2, cardY, cardW, 68, "Active subscribers with no booking", formatInteger(data.subscribersWithoutBookings || 0));
  drawStatCard(pad + 18 + (cardW + cardGap) * 3, cardY, cardW, 68, "Sales identity match", formatPercent(data.matchStats?.rate || 0));

  fill(75);
  textSize(11);
  textAlign(LEFT, TOP);
  const coverage = bookingCoverageSummary(data.sources || []);
  text(`${coverage.label} · ${(data.sources || []).length} file${(data.sources || []).length === 1 ? "" : "s"} · ${formatInteger(data.duplicateCount || 0)} duplicate bookings removed${coverage.gapLabel}`, pad + 18, top + 128);
  textAlign(RIGHT, TOP);
  text(`${formatInteger(data.bookingOnlyMembers || 0)} people booking lack a matching subscription sale`, pad + panelW - 18, top + 128);

  const timelineY = top + 150;
  const timelineH = max(190, min(310, (height - timelineY - pad) * 0.58));
  const series = [
    { key: "membershipBookings", label: "Subscription bookings", color: [35, 145, 95], formatter: formatInteger, scale: "count", legendOrder: 10 },
    { key: "uniqueBookingMembers", label: "People booking by subscription", color: [40, 120, 180], formatter: formatInteger, scale: "count", legendOrder: 20 },
    { key: "activeSubscribers", label: "Estimated active paid subscribers", color: [230, 130, 55], formatter: formatInteger, scale: "count", legendOrder: 30, stack: false },
    { key: "subscribersWithoutBooking", label: "Active subscribers with no booking", color: [205, 75, 75], formatter: formatInteger, scale: "count", legendOrder: 40, stack: false },
  ];
  drawHopTimelineChart(pad, timelineY, panelW, timelineH, data.periods || [], "Subscription use", series, [], timelineChartState());

  const lowerY = timelineY + timelineH + 12;
  const lowerH = height - lowerY - pad;
  const halfW = (panelW - 10) / 2;
  drawMemberEngagementClassList(data.classes || [], pad, lowerY, halfW, lowerH);
  drawMemberEngagementNoBookingList(data.members || [], pad + halfW + 10, lowerY, halfW, lowerH);
}

function bookingCoverageSummary(sources) {
  const sorted = (sources || []).filter((source) => source.startMs && source.endMs).sort((a, b) => a.startMs - b.startMs);
  if (!sorted.length) return { label: "Booking range unavailable", gapLabel: "" };
  const startMs = sorted[0].startMs;
  const endMs = Math.max(...sorted.map((source) => source.endMs));
  let coveredEnd = sorted[0].endMs;
  let gapCount = 0;
  for (const source of sorted.slice(1)) {
    if (source.startMs > coveredEnd + 2 * 86400000) gapCount += 1;
    coveredEnd = Math.max(coveredEnd, source.endMs);
  }
  return {
    label: `Booking range ${formatDate(new Date(startMs))} - ${formatDate(new Date(endMs))}`,
    gapLabel: gapCount ? ` · ${gapCount} possible range gap${gapCount === 1 ? "" : "s"}` : "",
  };
}

function drawMemberEngagementClassList(classes, x, y, w, h) {
  drawSoftPanel(x, y, w, h, 4);
  fill(35);
  textSize(13);
  textAlign(LEFT, TOP);
  text("Most subscription-booked classes", x + 14, y + 12);
  const visible = classes.slice(0, max(0, floor((h - 42) / 22)));
  const maxBookings = Math.max(1, ...visible.map((item) => item.bookingCount));
  visible.forEach((item, index) => {
    const rowY = y + 38 + index * 22;
    fill(35, 45);
    noStroke();
    rect(x + 14, rowY + 5, map(item.bookingCount, 0, maxBookings, 0, max(30, w * 0.32)), 8, 1);
    fill(55);
    textSize(10);
    textAlign(LEFT, CENTER);
    text(trimText(item.label, 32), x + 14, rowY);
    textAlign(RIGHT, CENTER);
    text(`${formatInteger(item.bookingCount)} bookings · ${formatInteger(item.uniqueMembers)} people`, x + w - 14, rowY + 10);
  });
}

function drawMemberEngagementNoBookingList(members, x, y, w, h) {
  drawSoftPanel(x, y, w, h, 4);
  fill(35);
  textSize(13);
  textAlign(LEFT, TOP);
  text("Known subscribers with no subscription booking", x + 14, y + 12);
  const inactive = members.filter((member) => member.subscriptionKnown && member.membershipBookingCount === 0);
  const visible = inactive.slice(0, max(0, floor((h - 42) / 20)));
  fill(70);
  textSize(10);
  visible.forEach((member, index) => {
    textAlign(LEFT, CENTER);
    text(trimText(displayPersonName(member), 38), x + 14, y + 43 + index * 20);
  });
  if (!inactive.length) {
    fill(95);
    textSize(11);
    text("None in the selected range", x + 14, y + 44);
  } else if (inactive.length > visible.length) {
    fill(95);
    textAlign(RIGHT, BOTTOM);
    text(`+${formatInteger(inactive.length - visible.length)} more`, x + w - 14, y + h - 10);
  }
}

function drawMembershipLengthView(membershipLength, pad, top) {
  const buckets = membershipLength?.buckets || [];
  drawSoftPanel(pad, top, width - pad * 2, height - top - pad, 4);
  drawViewHeader("Subscription Duration", pad + 18, top + 16, "memberLength");

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
  fill(85);
  textSize(11);
  textAlign(LEFT, TOP);
  text(`Median ${formatMembershipMonths(membershipLength.medianMonths || 0)} · average ${formatMembershipMonths(membershipLength.avgMonths || 0)}`, cardX, top + 42);
  drawStatCard(cardX, top + 58, cardW, 72, "Subscription spans", formatInteger(membershipLength.spanCount || 0));
  drawStatCard(cardX + (cardW + cardGap), top + 58, cardW, 72, "Still active", formatInteger(membershipLength.activeCount || 0));
  drawStatCard(cardX + (cardW + cardGap) * 2, top + 58, cardW, 72, "No booking in span", formatInteger(membershipLength.noBookingCount || 0));
  drawStatCard(cardX + (cardW + cardGap) * 3, top + 58, cardW, 72, "Avg bookings/span", (membershipLength.avgBookingsPerSpan || 0).toFixed(1));

  const chartX = pad + 32;
  const chartY = top + 180;
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
      `Subscription bookings: ${formatInteger(hovered.bookings || 0)}`,
      `Spans with no booking: ${formatInteger(hovered.noBooking || 0)}`,
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
    text(`${formatInteger(type.count)} spans · ${formatInteger(type.bookings || 0)} bookings · ${formatInteger(type.noBooking || 0)} no-use`, x + w * 0.72, rowY + rowH * 0.5);
  }

  if (hovered) {
    drawTooltip(mouseX, mouseY, [
      hovered.label,
      `Spans: ${formatInteger(hovered.count)}`,
      `Still active: ${formatInteger(hovered.active)}`,
      `Average length: ${formatMembershipMonths(hovered.avgMonths)}`,
      `Subscription bookings: ${formatInteger(hovered.bookings || 0)}`,
      `Spans with no booking: ${formatInteger(hovered.noBooking || 0)}`,
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
    drawViewHeader("Subscription Tenure", pad + 18, top + 16, "memberDistribution");
    fill(80);
    textSize(14);
    textAlign(LEFT, TOP);
    text("No paid membership distribution in this range.", pad + 18, top + 54);
    return;
  }

  const colors = memberDistributionColors();
  const tenureSeries = buckets.map((bucket, index) => ({
    key: bucket.key,
    label: bucket.label,
    color: colors[index % colors.length],
    formatter: formatInteger,
    scale: "count",
  })).reverse();
  const series = [
    ...tenureSeries,
    { key: "bookedMembers", label: "Subscribers who booked", color: [35, 155, 95], formatter: formatInteger, scale: "count", stack: false },
    { key: "noBookingMembers", label: "Subscribers with no booking", color: [210, 85, 75], formatter: formatInteger, scale: "count", stack: false },
  ];
  drawHopTimelineChart(pad, top, width - pad * 2, height - top - pad, months, "Subscription Tenure", series, [], {
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
  const target = type === "Subscription booking"
    ? [35, 155, 95]
    : type === "Membership" ? [230, 130, 55]
      : type === "Event" ? [135, 85, 170] : [60, 120, 170];
  return interpolateRgb([255, 255, 255], target, amount);
}

function activityPathTypeColor(type) {
  if (type === "Subscription booking") return color(35, 145, 95);
  if (type === "Membership") return color(210, 120, 45);
  if (type === "Event") return color(135, 85, 170);
  if (type === "No return") return color(120);
  return color(60, 120, 170);
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
  const requiredOffset = min(maxOffset, 3);
  const completeCohorts = retentionCompleteCohorts(cohorts, requiredOffset);
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
  const offset1Purchase = retentionSummaryAt(completeCohorts, 1, "purchased");
  const offset1Booking = retentionSummaryAt(completeCohorts, 1, "booked");
  const completeCustomerCount = completeCohorts.reduce((total, cohort) => total + cohort.size, 0);
  fill(85);
  textSize(12);
  textAlign(LEFT, TOP);
  text(`${formatInteger(completeCustomerCount)} people · engagement return includes a later purchase or subscription booking`, pad + 18, top + 44);
  text(`+1 ${unit}: ${formatPercent(offset1)} engaged (${formatPercent(offset1Purchase)} purchased · ${formatPercent(offset1Booking)} booked) · +3: ${formatPercent(offset3)}`, pad + 18, top + 62);

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
  const maxCohortSize = Math.max(1, ...visibleCohorts.map((cohort) => cohort.size));
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
      if (cell.possible !== false && cellW > 24 && cellH > 13) {
        fill(rate > 0.55 ? 245 : 35);
        textSize(cellW > 34 && cellH > 16 ? 9 : 7);
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
      hovered.cell.possible === false ? "" : `Purchased again: ${formatInteger(hovered.cell.purchased || 0)} (${formatPercent(hovered.cell.purchaseRate || 0)})`,
      hovered.cell.possible === false ? "" : `Subscription booking: ${formatInteger(hovered.cell.booked || 0)} (${formatPercent(hovered.cell.bookingRate || 0)})`,
    ], 280);
  }
}

function retentionCompleteCohorts(cohorts, requiredOffset) {
  const rangeStart = typeof selectedStartMs === "number" ? selectedStartMs : 0;
  const rangeEnd = typeof selectedEndMs === "number" ? selectedEndMs : 0;
  return (cohorts || []).filter((cohort) => {
    const cohortStart = startOfHopDayMs(dateFromPeriodKey(cohort.period, timeBucket));
    const cohortEnd = startOfHopDayMs(periodEndDate(cohort.period, timeBucket));
    if (rangeStart && cohortStart < rangeStart) return false;
    if (rangeEnd && cohortEnd > rangeEnd) return false;
    for (let offset = 0; offset <= requiredOffset; offset += 1) {
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

function retentionSummaryAt(cohorts, offset, key = "retained") {
  let retained = 0;
  let total = 0;
  for (const cohort of cohorts) {
    const cell = cohort.cells[offset];
    if (!cell || cell.possible === false) continue;
    retained += cell[key] || 0;
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
    title: "Journey pattern from first recorded purchase or subscription booking",
    mode: "cumulative",
    unitLabel: timeBucketLabel(timeBucket).toLowerCase(),
    valueFormatter: formatDkk,
    emptyText: "No purchase or subscription-booking journeys in this range.",
    legend: [
      { label: "Ticket only", color: [68, 145, 255] },
      { label: "Membership", color: [34, 190, 125] },
      { label: "Subscription booking", color: [30, 150, 190] },
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
        `Subscription bookings: ${formatInteger(journey.totalBookings || 0)}`,
        `Revenue: ${formatDkk(journey.revenue)}`,
        lastPeriod ? `Last activity offset: ${lastPeriod.offset}` : "",
      ];
    },
  });
}

function buyerPatternColor(period) {
  if (period.hasBooking && period.hasMembership) return [35, 175, 125];
  if (period.hasBooking && period.hasTicket) return [45, 155, 205];
  if (period.hasBooking) return [30, 150, 190];
  if (period.hasCrew && period.hasMembership) return [245, 120, 255];
  if (period.hasCrew && period.hasTicket) return [195, 150, 255];
  if (period.hasCrew) return [190, 112, 255];
  if (period.hasTicket && period.hasMembership) return [255, 174, 66];
  if (period.hasMembership) return [34, 190, 125];
  return [68, 145, 255];
}

function buyerJourneyColor(journey) {
  if (journey.pattern.includes("Crew")) return [190, 112, 255];
  if (journey.pattern.includes("booking")) return [30, 150, 190];
  if (journey.pattern === "Ticket to membership") return [255, 245, 120];
  if (journey.pattern === "Membership plus tickets") return [255, 174, 66];
  if (journey.pattern === "Membership no bookings") return [34, 190, 125];
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

function drawActivityPathSourceToggle(source, visible, showSaveButton = false) {
  if (!visible) return false;
  const item = getActivityPathSourceButton(showSaveButton);
  const labels = { purchase: "Purchases", subscription: "Sub. use", combined: "Combined" };
  return drawSlimButton(labels[source] || "Combined", item, true);
}

function drawPurchaseTimingMembershipToggle(excludeMembership, visible, showSaveButton = false) {
  if (!visible) return false;
  const item = getPurchaseTimingMembershipButton(showSaveButton);
  return drawSlimButton(excludeMembership ? "No members" : "All types", item, excludeMembership);
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

function getActivityPathSourceButton(showSaveButton = false) {
  const mode = getActivityPathModeButton(showSaveButton);
  const w = 82;
  const gap = 6;
  return { x: mode.x - gap - w, y: mode.y, w, h: HOP_TOP_BUTTON_H };
}

function getPurchaseTimingMembershipButton(showSaveButton = false) {
  const stack = getTimelineStackButton(showSaveButton);
  const w = 86;
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
  const maxValue = Math.max(1, ...values);
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
  const maxValue = Math.max(1, ...entries.map((entry) => entry[1]));
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
  const tooltipW = min(maxWidth, Math.max(0, ...wrappedLines.map((line) => textWidth(line))) + 24);
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
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
