let activityNetworkState = null;
let activityNetworkBounds = null;
let userNetworkState = null;
let userNetworkBounds = null;
let userNetworkVisible = null;
let activeHopModel = null;

function displayPersonName(entity) {
  return activeHopModel?.getName ? activeHopModel.getName(entity) : entity?.label || "Unknown customer";
}

function drawCenteredMessage(message) {
  background(0);
  fill(245);
  noStroke();
  textAlign(CENTER, CENTER);
  textSize(24);
  text(message, width * 0.5, height * 0.5);
}

function drawHopOverview(model, fileName = "", currentView = "overview", navItems = [], options = {}) {
  activeHopModel = model;
  if (Object.prototype.hasOwnProperty.call(options, "anonymizeNames")) {
    model?.setAnonymizeNames?.(options.anonymizeNames);
  }
  background(0);
  const pad = 32;
  const revenue = sum(model.invoices, "totalPrice");
  const typeCounts = countInvoiceTypes(model.invoices);

  drawHopNav(pad, 24, navItems, currentView);
  drawClearDataButton();
  const contentTop = 112;

  if (currentView === "activity") {
    drawActivityView(model.activity, model.ticketSales, pad, contentTop);
    return;
  }

  if (currentView === "activitynetwork") {
    drawActivityNetworkView(model.activityNetwork, pad, contentTop);
    return;
  }

  if (currentView === "usernetwork") {
    drawUserNetworkView(model.userNetwork, pad, contentTop);
    return;
  }

  if (currentView === "ticketsales") {
    drawTicketSalesView(model.ticketSales, pad, contentTop);
    return;
  }

  if (currentView === "ticketbuyers") {
    drawTicketBuyersView(model.ticketBuyers, pad, contentTop);
    return;
  }

  if (currentView === "revenuegroups") {
    drawRevenueGroupsView(model.customers, pad, contentTop, revenueGroupCount || 8);
    return;
  }

  if (currentView === "buyerpattern") {
    drawBuyerPatternView(model.buyerPatterns, pad, contentTop);
    return;
  }

  if (currentView !== "overview") {
    drawPlaceholderView(currentView, pad + 16, contentTop + 14);
    return;
  }

  const cardY = contentTop;
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
  const membershipSeries = membershipTypeSeries(activity?.membershipTypes || []);
  const moneyScale = "money";
  const countScale = "count";
  drawHopTimelineChart(pad, top, width - pad * 2, height - top - pad, months, "Activity", [
    { key: "totalRevenue", label: "Revenue", color: [0, 0, 0], formatter: formatDkk, scale: moneyScale },
    { key: "yearTotalRevenue", label: "Year accumulated revenue", color: [90, 90, 90], formatter: formatDkk, scale: moneyScale },
    { key: "revenue", label: "Member revenue", color: [20, 20, 20], formatter: formatDkk, scale: moneyScale },
    { key: "newMemberships", label: "New memberships", color: [26, 105, 180], formatter: formatInteger, scale: countScale },
    { key: "endedMemberships", label: "Ended memberships", color: [210, 55, 55], formatter: formatInteger, scale: countScale },
    { key: "memberCount", label: "Member count", color: [190, 90, 35], formatter: formatInteger, scale: countScale },
    ...membershipSeries,
    { key: "crewCount", label: "Crew count", color: [190, 112, 255], formatter: formatInteger, scale: countScale },
    { key: "activeTicketUsersWithMembership", label: "Active ticket users (w.m)", color: [34, 190, 125], formatter: formatInteger, scale: countScale },
    { key: "activeTicketUsersWithoutMembership", label: "Active ticket users (wo.m)", color: [68, 145, 255], formatter: formatInteger, scale: countScale },
    { key: "classRevenue", label: "Activity ticket revenue", color: [60, 140, 85], formatter: formatDkk, scale: moneyScale },
    { key: "eventRevenue", label: "Event ticket revenue", color: [135, 85, 170], formatter: formatDkk, scale: moneyScale },
  ], ticketItemsToTimelineLabels(ticketSales?.items || []), timelineChartState());
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
  }));
}

function drawActivityNetworkView(network, pad, top) {
  fill(238);
  noStroke();
  rect(pad, top, width - pad * 2, height - top - pad, 4);
  fill(30);
  textSize(18);
  textAlign(LEFT, TOP);
  text("Activity Network", pad + 18, top + 16);

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
    fill(20);
    textSize(12);
    textAlign(CENTER, BOTTOM);
    text(trimText(hovered.node.label, 34), hovered.state.x, hovered.state.y - hovered.radius - 8);
    drawTooltip(mouseX, mouseY, [
      hovered.node.label,
      `Type: ${hovered.node.type}`,
      `Buyers: ${formatInteger(hovered.node.buyerCount)}`,
      `Tickets: ${formatInteger(hovered.node.tickets)}`,
      `Revenue: ${formatDkk(hovered.node.revenue)}`,
      `Avg prior tickets: ${hovered.node.avgExperience.toFixed(1)}`,
      `First-timer purchases: ${formatInteger(hovered.node.firstTimerPurchases)}`,
    ], 300);
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
  fill(30);
  textSize(18);
  textAlign(LEFT, TOP);
  text("User Network", pad + 18, top + 16);

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
    fill(20);
    textSize(12);
    textAlign(CENTER, BOTTOM);
    text(trimText(displayPersonName(hovered.node), 34), hovered.state.x, hovered.state.y - hovered.radius - 8);
    drawTooltip(mouseX, mouseY, [
      displayPersonName(hovered.node),
      `Type: ${hovered.node.type}`,
      `Tickets: ${formatInteger(hovered.node.tickets)}`,
      `Revenue: ${formatDkk(hovered.node.revenue)}`,
      `Activities: ${formatInteger(hovered.node.activityCount)}`,
      `Events: ${formatInteger(hovered.node.eventCount)}`,
    ], 280);
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
  ], [], timelineChartState());

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
  };
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

function drawTicketBuyersView(ticketBuyers, pad, top) {
  const summary = ticketBuyers?.summary || {};
  const buyers = ticketBuyers?.buyers || [];
  const periods = ticketBuyers?.periods || [];
  const cardW = (width - pad * 2 - 48) / 4;
  drawStatCard(pad, top, cardW, 82, "Ticket buyers", formatInteger(summary.total || 0));
  drawStatCard(pad + (cardW + 16), top, cardW, 82, "Single buyers", formatInteger(summary.single || 0));
  drawStatCard(pad + (cardW + 16) * 2, top, cardW, 82, "Recurring active", formatInteger(summary.activeRecurring || 0));
  drawStatCard(pad + (cardW + 16) * 3, top, cardW, 82, "Ticket revenue", formatDkk(summary.revenue || 0));
  drawTicketBuyerHeatmap(pad, top + 110, width - pad * 2, height - top - pad - 110, buyers, periods);
}

function drawTicketBuyerHeatmap(x, y, w, h, buyers, periods) {
  fill(238);
  noStroke();
  rect(x, y, w, h, 4);
  fill(30);
  textSize(18);
  textAlign(LEFT, TOP);
  text("Ticket buyer activity", x + 18, y + 16);

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

function drawRevenueGroupsView(customers, pad, top, groupCount) {
  const payingCustomers = (customers || [])
    .filter((customer) => customer.revenue > 0)
    .sort((a, b) => {
      const aTickets = a.classPassCount + a.eventCount;
      const bTickets = b.classPassCount + b.eventCount;
      return bTickets - aTickets || b.membershipCount - a.membershipCount || b.revenue - a.revenue;
    });

  fill(238);
  noStroke();
  rect(pad, top, width - pad * 2, height - top - pad, 4);
  fill(30);
  textSize(18);
  textAlign(LEFT, TOP);
  text("Revenue groups", pad + 18, top + 16);

  if (!payingCustomers.length) {
    fill(80);
    textSize(14);
    text("No paying customers in this range.", pad + 18, top + 54);
    return;
  }

  const groups = buildRevenueFrequencyGroups(payingCustomers, groupCount);
  const totalRevenue = sum(groups, "revenue");
  const maxRevenue = max(1, ...groups.map((group) => group.revenue));
  const maxPeople = max(1, ...groups.map((group) => group.people));
  const plotX = pad + 28;
  const plotY = top + 86;
  const plotW = width - pad * 2 - 56;
  const plotH = height - top - pad - 122;
  const barGap = 8;
  const barW = max(4, (plotW - barGap * (groups.length - 1)) / groups.length);

  fill(85);
  textSize(11);
  textAlign(LEFT, TOP);
  text("one-time buyers", plotX, plotY - 22);
  textAlign(RIGHT, TOP);
  text(`${groupCount}+ activities`, plotX + plotW, plotY - 22);

  drawRevenueGroupLegend(plotX, top + 44);

  fill(80);
  textSize(12);
  textAlign(RIGHT, TOP);
  text(`${formatInteger(payingCustomers.length)} paying people grouped by ticket/activity frequency`, plotX + plotW, top + 16);

  stroke(210);
  strokeWeight(1);
  line(plotX, plotY + plotH, plotX + plotW, plotY + plotH);

  let hovered = null;
  const peoplePoints = [];
  noStroke();
  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i];
    const x = plotX + i * (barW + barGap);
    const h = map(group.revenue, 0, maxRevenue, 0, plotH * 0.86);
    const y = plotY + plotH - h;
    const isHover = mouseX >= x && mouseX <= x + barW && mouseY >= plotY && mouseY <= plotY + plotH;

    fill(68, 145, 255, isHover ? 230 : 170);
    rect(x, y, barW, h, 1);

    const peopleY = plotY + plotH - map(group.people, 0, maxPeople, 0, plotH * 0.86);
    peoplePoints.push({ x: x + barW * 0.5, y: peopleY });
    fill(20, isHover ? 245 : 150);
    circle(x + barW * 0.5, peopleY, isHover ? 8 : 5);

    fill(70);
    textSize(10);
    textAlign(CENTER, TOP);
    text(group.label, x + barW * 0.5, plotY + plotH + 8);

    if (isHover) hovered = { group, x, y, h };
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
      `Revenue: ${formatDkk(hovered.group.revenue)} (${Math.round((hovered.group.revenue / totalRevenue) * 100)}%)`,
      `People: ${formatInteger(hovered.group.people)}`,
      `Avg revenue/person: ${formatDkk(hovered.group.avgRevenue)}`,
      `Avg activities/person: ${hovered.group.avgActivities.toFixed(1)}`,
      `One-time ticket buyers: ${formatInteger(hovered.group.singleTicketBuyers)}`,
      `Recurring/member buyers: ${formatInteger(hovered.group.recurringBuyers)}`,
    ], 320);
  }
}

function buildRevenueFrequencyGroups(customers, maxSingleBucket) {
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
    const revenue = sum(entries, "revenue");
    const activities = entries.reduce((total, customer) => total + customer.classPassCount + customer.eventCount, 0);
    const singleTicketBuyers = entries.filter((customer) => customer.classPassCount + customer.eventCount === 1 && customer.membershipCount === 0).length;
    const recurringBuyers = entries.filter((customer) => customer.classPassCount + customer.eventCount > 1 || customer.membershipCount > 0).length;
    groups.push({
      label,
      people: entries.length,
      revenue,
      avgRevenue: revenue / entries.length,
      avgActivities: activities / entries.length,
      singleTicketBuyers,
      recurringBuyers,
    });
  }
  return groups;
}

function drawRevenueGroupLegend(x, y) {
  const items = [
    { label: "Revenue", color: [68, 145, 255] },
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
  const summary = buyerPatterns?.summary || {};
  const journeys = buyerPatterns?.journeys || [];
  const windowSize = 200;
  const windowCount = max(1, ceil(journeys.length / windowSize));
  const windowIndex = constrain(buyerPatternWindowIndex || 0, 0, windowCount - 1);
  const windowStart = windowIndex * windowSize;
  const visibleJourneys = journeys.slice(windowStart, windowStart + 200);
  const cardW = (width - pad * 2 - 48) / 4;
  drawStatCard(pad, top, cardW, 82, "Journeys", formatInteger(summary.total || 0));
  drawStatCard(pad + (cardW + 16), top, cardW, 82, "Ticket only", formatInteger(summary.ticketOnly || 0));
  drawStatCard(pad + (cardW + 16) * 2, top, cardW, 82, "Ticket to member", formatInteger(summary.ticketToMembership || 0));
  drawStatCard(pad + (cardW + 16) * 3, top, cardW, 82, "Crew", formatInteger(summary.crew || 0));
  fill(210);
  noStroke();
  textSize(12);
  textAlign(LEFT, TOP);
  text(`Window ${windowIndex + 1}/${windowCount}: showing ${windowStart + 1}-${windowStart + visibleJourneys.length} sorted by cumulative revenue`, pad, top + 88);
  drawBuyerJourneyMap(pad, top + 110, width - pad * 2, height - top - pad - 110, visibleJourneys);
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

function drawAnonymizeToggle(active) {
  const item = getAnonymizeButton();
  fill(active ? 30 : 110);
  noStroke();
  rect(item.x, item.y, item.w, item.h, 4);
  fill(active ? 245 : 35);
  textSize(14);
  textAlign(CENTER, CENTER);
  text(active ? "Anon" : "Names", item.x + item.w / 2, item.y + item.h / 2);
}

function getTimeBucketButton() {
  const y = 24;
  const w = 76;
  const h = 34;
  const gap = 8;
  const x = width - 124 - gap - w;
  return { x, y, w, h };
}

function getAnonymizeButton() {
  const bucket = getTimeBucketButton();
  const w = 76;
  const h = 34;
  const gap = 8;
  return { x: bucket.x - gap - w, y: bucket.y, w, h };
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
  drawTimelineSeasonBand(plotX, y + h - 8, plotW, points);
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

  fill(20, 175);
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

function hashText(value) {
  const text = String(value || "");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash;
}
