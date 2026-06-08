const ROUTE_GAP = 14;
const BASE_MARGIN = 54;
const CORNER_RADIUS = 20;
const TERMINAL_STUB = 30;
const BOARD_ROUTE_CLEARANCE = 32;
const DIRECT_PENALTY = 36;
const HINT_SIDE_PENALTY = 32;
const CROSSING_PENALTY = 120000;
const LENGTH_WEIGHT = 0.42;
const RIPUP_PASSES = 6;
const RIPUP_GROUP_SIZE = 4;
const SAMPLE_STEP = 14;
const VISIBILITY_RINGS = 6;
const NET_TAP_CANDIDATES = 12;
const NET_TAP_PENALTY = 22;
const EPS = 0.001;

export function drawEmbroideryConnections(p, model, renderMode = "symbols", context = {}) {
  const routes = Array.isArray(context.routes) ? context.routes : [];
  if (!routes.length) return;
  const planned = planEmbroideryRoutes(routes, model);
  planned.paths.forEach((path) => drawPath(p, path));
  planned.paths.forEach((path) => drawDots(p, path));
  if (planned.crossings > 0) drawConflictNote(p, model, planned.crossings);
}

function planEmbroideryRoutes(routes, model = {}) {
  const bounds = contentBounds(model);
  const board = boardBounds(model);
  const ordered = [...routes].sort((left, right) => (
    Number(left.drawRank || 0) - Number(right.drawRank || 0)
    || Number(left.routeIndex || 0) - Number(right.routeIndex || 0)
  ));
  const paths = ordered
    .map((route, index) => bestRoutePath(route, bounds, board, index, []))
    .filter(Boolean);

  for (let pass = 0; pass < RIPUP_PASSES; pass += 1) {
    const beforeCrossings = totalCrossings(paths);
    const beforeLength = totalPathLength(paths);
    const conflictScores = routeConflictScores(paths);
    if (!conflictScores.some((score) => score > 0)) break;
    const order = conflictScores
      .map((score, index) => ({ score, index }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || right.index - left.index);
    let changed = false;

    for (const item of order) {
      const current = paths[item.index];
      const blockers = paths.filter((_, index) => index !== item.index);
      const rerouted = bestRoutePath(current.route, bounds, board, current.routeIndex ?? item.index, blockers);
      if (!rerouted) continue;

      const nextPaths = [...paths];
      nextPaths[item.index] = rerouted;
      const nextCrossings = totalCrossings(nextPaths);
      const nextLength = totalPathLength(nextPaths);
      if (nextCrossings < beforeCrossings || (nextCrossings === beforeCrossings && nextLength < beforeLength - 1)) {
        paths[item.index] = rerouted;
        changed = true;
        break;
      }
    }

    if (!changed) {
      const group = order.slice(0, RIPUP_GROUP_SIZE).map((item) => item.index);
      const rerouted = rerouteGroup(paths, group, bounds, board);
      if (rerouted) {
        const nextCrossings = totalCrossings(rerouted);
        const nextLength = totalPathLength(rerouted);
        if (nextCrossings < beforeCrossings || (nextCrossings === beforeCrossings && nextLength < beforeLength - 1)) {
          paths.splice(0, paths.length, ...rerouted);
          changed = true;
        }
      }
    }

    if (!changed) break;
  }

  return { paths, crossings: totalCrossings(paths) };
}

function rerouteGroup(paths, groupIndexes, bounds, board) {
  const group = new Set(groupIndexes);
  const nextPaths = paths.filter((_, index) => !group.has(index));
  const replay = groupIndexes
    .map((index) => paths[index])
    .filter(Boolean)
    .sort((left, right) => Number(left.conflicts || 0) - Number(right.conflicts || 0));

  for (const current of replay) {
    const rerouted = bestRoutePath(current.route, bounds, board, current.routeIndex ?? 0, nextPaths);
    if (!rerouted) return null;
    nextPaths.push(rerouted);
  }

  return restorePathOrder(paths, nextPaths);
}

function restorePathOrder(originalPaths, routedPaths) {
  const byRouteIndex = new Map();
  routedPaths.forEach((path) => byRouteIndex.set(path.routeIndex, path));
  return originalPaths
    .map((path, index) => byRouteIndex.get(path.routeIndex ?? index))
    .filter(Boolean);
}

function bestRoutePath(route, bounds, board, index, blockers) {
  const terminalRoute = routeWithTerminalStubs(route, bounds);
  const candidates = [
    ...buildCandidates(terminalRoute, bounds, board, index),
    ...buildVisibilityCandidates(terminalRoute, bounds, board, index, blockers),
    ...buildNetTapCandidates(terminalRoute, bounds, board, index, blockers),
  ];
  let best = null;
  candidates.forEach((candidate) => {
    const points = candidate.netTap
      ? applyNetTapTerminalStub(candidate.points, terminalRoute, candidate.terminalEndpoint)
      : applyTerminalStubs(candidate.points, terminalRoute);
    const samples = samplePoints(points);
    const conflictCount = countCrossings(samples, blockers, route, candidate.allowSameNetTouch);
    const score = conflictCount * CROSSING_PENALTY
      + pathLength(points) * LENGTH_WEIGHT
      + candidate.penalty;
    if (!best || score < best.score) {
      best = { ...candidate, points, route, routeIndex: index, samples, conflicts: conflictCount, score };
    }
  });
  return best;
}

function routeWithTerminalStubs(route, bounds) {
  const start = cleanPoint(route.start);
  const end = cleanPoint(route.end);
  if (!start || !end) return route;
  const sourceSide = horizontalTerminalSide(start, end, route.sourceSide, bounds);
  const targetSide = horizontalTerminalSide(end, start, route.targetSide, bounds);
  const startStub = horizontalStub(start, sourceSide);
  const endStub = horizontalStub(end, targetSide);
  return {
    ...route,
    start: startStub,
    end: endStub,
    sourceSide,
    targetSide,
    rawStart: start,
    rawEnd: end,
    startStub,
    endStub,
  };
}

function horizontalTerminalSide(point, other, hintedSide, bounds) {
  if (hintedSide === "left" || hintedSide === "right") return hintedSide;
  const dx = Number(other.x) - Number(point.x);
  if (Math.abs(dx) > EPS) return dx >= 0 ? "right" : "left";
  return Math.abs(point.x - bounds.left) < Math.abs(point.x - bounds.right) ? "left" : "right";
}

function horizontalStub(point, side) {
  const direction = side === "left" ? -1 : 1;
  return { x: point.x + direction * TERMINAL_STUB, y: point.y };
}

function applyTerminalStubs(points, route) {
  if (!route.rawStart || !route.rawEnd || !route.startStub || !route.endStub) return dedupePoints(points);
  return dedupePoints([
    route.rawStart,
    route.startStub,
    ...dedupePoints(points),
    route.endStub,
    route.rawEnd,
  ]);
}

function applyNetTapTerminalStub(points, route, terminalEndpoint) {
  const clean = dedupePoints(points);
  if (terminalEndpoint === "start" && route.rawStart && route.startStub) {
    return dedupePoints([route.rawStart, route.startStub, ...clean]);
  }
  if (terminalEndpoint === "end" && route.rawEnd && route.endStub) {
    return dedupePoints([route.rawEnd, route.endStub, ...clean]);
  }
  return clean;
}

function buildNetTapCandidates(route, bounds, board, index, placedPaths) {
  const netKey = routeNetKey(route);
  const endpoint = railTapEndpoint(route);
  if (!netKey || !endpoint || !placedPaths.length) return [];
  const terminalEndpoint = route.end ? "end" : "start";

  const taps = compatibleRailTaps(route, endpoint, placedPaths, netKey);
  return taps.flatMap((tap, tapIndex) => {
    const pseudoRoute = {
      ...route,
      start: endpoint,
      end: tap,
      endDot: tap,
      sourceSide: directionalEndpointSide(endpoint, tap, route.sourceSide, bounds),
      targetSide: directionalEndpointSide(tap, endpoint, route.targetSide, bounds),
    };
    const visibility = buildVisibilityCandidates(pseudoRoute, bounds, board, index + tapIndex, placedPaths);
    return [
      ...buildCandidates(pseudoRoute, bounds, board, index + tapIndex),
      ...visibility,
    ].map((candidate) => ({
      ...candidate,
      points: forceEndpoint(candidate.points, endpoint, tap),
      penalty: candidate.penalty + NET_TAP_PENALTY + tapIndex * 8,
      allowSameNetTouch: true,
      netTap: true,
      terminalEndpoint,
    }));
  });
}

function buildVisibilityCandidates(route, bounds, board, index, placedPaths) {
  const start = cleanPoint(route.start);
  const end = cleanPoint(route.end);
  if (!start || !end || !placedPaths.length) return [];
  const nodes = visibilityNodes(start, end, bounds, board, index);
  const path = shortestVisiblePath(nodes, placedPaths);
  if (!path) return [];
  return [{
    points: path,
    penalty: path.length * 8,
  }];
}

function buildCandidates(route, bounds, board, index) {
  const start = cleanPoint(route.start);
  const end = cleanPoint(route.end);
  if (!start || !end) return [];
  const lane = index % 24;
  const ring = Math.floor(index / 24);
  const margin = BASE_MARGIN + lane * ROUTE_GAP + ring * ROUTE_GAP * 4;
  const rect = expandRect(bounds, margin);
  const candidates = [];
  const sidePairs = uniqueSidePairs([
    {
      startSide: directionalEndpointSide(start, end, route.sourceSide, bounds),
      endSide: directionalEndpointSide(end, start, route.targetSide, bounds),
      penalty: 0,
    },
    {
      startSide: endpointSide(start, route.sourceSide, bounds),
      endSide: endpointSide(end, route.targetSide, bounds),
      penalty: HINT_SIDE_PENALTY,
    },
  ]);

  if (board) {
    candidates.push(...boardOrbitCandidates(start, end, route, board, index));
  }

  sidePairs.forEach((pair) => {
    ["cw", "ccw"].forEach((direction) => {
      candidates.push({
        points: dedupePoints([
          start,
          sidePoint(pair.startSide, start, rect),
          ...perimeterPoints(pair.startSide, pair.endSide, rect, direction),
          sidePoint(pair.endSide, end, rect),
          end,
        ]),
        penalty: pair.penalty + 90 + (direction === "cw" ? 0 : 18),
      });
    });

    candidates.push({
      points: directDetour(start, end, pair.startSide, pair.endSide, rect),
      penalty: pair.penalty + DIRECT_PENALTY,
    });
  });

  return candidates;
}

function boardOrbitCandidates(start, end, route, board, index) {
  const lane = index % 18;
  const ring = Math.floor(index / 18);
  const margin = BOARD_ROUTE_CLEARANCE + lane * ROUTE_GAP + ring * ROUTE_GAP * 3;
  const rect = expandRect(board, margin);
  const sidePairs = uniqueSidePairs([
    {
      startSide: directionalEndpointSide(start, end, route.sourceSide, board),
      endSide: directionalEndpointSide(end, start, route.targetSide, board),
      penalty: 0,
    },
    {
      startSide: endpointSide(start, route.sourceSide, board),
      endSide: endpointSide(end, route.targetSide, board),
      penalty: 14,
    },
  ]);
  const candidates = [];

  sidePairs.forEach((pair) => {
    ["cw", "ccw"].forEach((direction) => {
      candidates.push({
        points: dedupePoints([
          start,
          sidePoint(pair.startSide, start, rect),
          ...perimeterPoints(pair.startSide, pair.endSide, rect, direction),
          sidePoint(pair.endSide, end, rect),
          end,
        ]),
        penalty: pair.penalty + (direction === "cw" ? 0 : 10),
      });
    });
  });

  return candidates;
}

function visibilityNodes(start, end, bounds, board, index) {
  const nodes = [start, end];
  const phase = index % 4;
  if (board) {
    for (let ring = 0; ring < 4; ring += 1) {
      const margin = BOARD_ROUTE_CLEARANCE + (ring * ROUTE_GAP * 2) + phase * ROUTE_GAP;
      pushRectNodes(nodes, expandRect(board, margin), start, end);
    }
  }
  for (let ring = 0; ring < VISIBILITY_RINGS; ring += 1) {
    const margin = BASE_MARGIN + (ring * ROUTE_GAP * 4) + phase * ROUTE_GAP;
    pushRectNodes(nodes, expandRect(bounds, margin), start, end);
  }
  return dedupePoints(nodes);
}

function pushRectNodes(nodes, rect, start, end) {
  nodes.push(
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
    { x: rect.left, y: start.y },
    { x: rect.right, y: start.y },
    { x: rect.left, y: end.y },
    { x: rect.right, y: end.y },
    { x: start.x, y: rect.top },
    { x: start.x, y: rect.bottom },
    { x: end.x, y: rect.top },
    { x: end.x, y: rect.bottom },
  );
}

function shortestVisiblePath(nodes, placedPaths) {
  const startIndex = 0;
  const endIndex = 1;
  const placedSegments = placedPaths.flatMap((path) => segmentsFor(path.samples || samplePoints(path.points || [])));
  const open = new Set([startIndex]);
  const cameFrom = new Map();
  const gScore = new Map([[startIndex, 0]]);
  const fScore = new Map([[startIndex, distance(nodes[startIndex], nodes[endIndex])]]);

  while (open.size) {
    const current = [...open].sort((a, b) => (fScore.get(a) ?? Infinity) - (fScore.get(b) ?? Infinity))[0];
    if (current === endIndex) return reconstructPath(cameFrom, nodes, current);
    open.delete(current);

    for (let next = 0; next < nodes.length; next += 1) {
      if (next === current) continue;
      if (!edgeVisible(nodes[current], nodes[next], placedSegments)) continue;
      const tentative = (gScore.get(current) ?? Infinity)
        + distance(nodes[current], nodes[next]) * LENGTH_WEIGHT
        + bendPenalty(cameFrom, nodes, current, next);
      if (tentative >= (gScore.get(next) ?? Infinity)) continue;
      cameFrom.set(next, current);
      gScore.set(next, tentative);
      fScore.set(next, tentative + distance(nodes[next], nodes[endIndex]) * LENGTH_WEIGHT);
      open.add(next);
    }
  }
  return null;
}

function edgeVisible(a, b, placedSegments) {
  return !placedSegments.some((segment) => segmentConflicts(a, b, segment.a, segment.b));
}

function bendPenalty(cameFrom, nodes, current, next) {
  if (!cameFrom.has(current)) return 0;
  const previous = nodes[cameFrom.get(current)];
  const here = nodes[current];
  const there = nodes[next];
  const cross = Math.abs(direction(previous, here, there));
  if (cross < EPS) return 0;
  return 5;
}

function reconstructPath(cameFrom, nodes, current) {
  const out = [nodes[current]];
  while (cameFrom.has(current)) {
    current = cameFrom.get(current);
    out.unshift(nodes[current]);
  }
  return dedupePoints(out);
}

function directDetour(start, end, startSide, endSide, rect) {
  if ((startSide === "left" || startSide === "right") && (endSide === "left" || endSide === "right")) {
    const midX = (start.x + end.x) / 2;
    return dedupePoints([start, { x: midX, y: start.y }, { x: midX, y: end.y }, end]);
  }
  if ((startSide === "top" || startSide === "bottom") && (endSide === "top" || endSide === "bottom")) {
    const midY = (start.y + end.y) / 2;
    return dedupePoints([start, { x: start.x, y: midY }, { x: end.x, y: midY }, end]);
  }
  if (startSide === endSide) {
    const anchor = sideCoordinate(startSide, rect);
    if (startSide === "left" || startSide === "right") {
      return dedupePoints([start, { x: anchor, y: start.y }, { x: anchor, y: end.y }, end]);
    }
    return dedupePoints([start, { x: start.x, y: anchor }, { x: end.x, y: anchor }, end]);
  }
  return dedupePoints([
    start,
    { x: end.x, y: start.y },
    end,
  ]);
}

function contentBounds(model = {}) {
  const items = [];
  if (model.board) {
    items.push({
      left: Number(model.board.x || 0),
      top: Number(model.board.y || 0),
      right: Number(model.board.x || 0) + Number(model.board.w || 0),
      bottom: Number(model.board.y || 0) + Number(model.board.h || 0),
    });
  }
  (model.components || []).forEach((component) => {
    const w = Number(component.w || 120);
    const h = Number(component.h || 80);
    items.push({
      left: Number(component.x || 0) - w / 2,
      top: Number(component.y || 0) - h / 2,
      right: Number(component.x || 0) + w / 2,
      bottom: Number(component.y || 0) + h / 2,
    });
  });
  if (!items.length) return { left: 0, top: 0, right: 1680, bottom: 1140 };
  return {
    left: Math.min(...items.map((item) => item.left)),
    top: Math.min(...items.map((item) => item.top)),
    right: Math.max(...items.map((item) => item.right)),
    bottom: Math.max(...items.map((item) => item.bottom)),
  };
}

function boardBounds(model = {}) {
  if (!model.board) return null;
  const left = Number(model.board.x || 0);
  const top = Number(model.board.y || 0);
  const width = Number(model.board.w || 0);
  const height = Number(model.board.h || 0);
  if (!Number.isFinite(left) || !Number.isFinite(top) || width <= 0 || height <= 0) return null;
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
  };
}

function expandRect(bounds, margin) {
  return {
    left: bounds.left - margin,
    top: bounds.top - margin,
    right: bounds.right + margin,
    bottom: bounds.bottom + margin,
  };
}

function endpointSide(point, hintedSide, bounds) {
  if (["left", "right", "top", "bottom"].includes(hintedSide)) return hintedSide;
  const distances = [
    ["left", Math.abs(point.x - bounds.left)],
    ["right", Math.abs(point.x - bounds.right)],
    ["top", Math.abs(point.y - bounds.top)],
    ["bottom", Math.abs(point.y - bounds.bottom)],
  ];
  distances.sort((a, b) => a[1] - b[1]);
  return distances[0][0];
}

function directionalEndpointSide(point, other, hintedSide, bounds) {
  const dx = Number(other.x) - Number(point.x);
  const dy = Number(other.y) - Number(point.y);
  if (Math.abs(dx) > Math.abs(dy) * 0.65) return dx >= 0 ? "right" : "left";
  if (Math.abs(dy) > EPS) return dy >= 0 ? "bottom" : "top";
  return endpointSide(point, hintedSide, bounds);
}

function uniqueSidePairs(pairs) {
  const seen = new Set();
  const out = [];
  pairs.forEach((pair) => {
    if (!pair.startSide || !pair.endSide) return;
    const key = `${pair.startSide}:${pair.endSide}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(pair);
  });
  return out;
}

function sidePoint(side, point, rect) {
  if (side === "left") return { x: rect.left, y: point.y };
  if (side === "right") return { x: rect.right, y: point.y };
  if (side === "top") return { x: point.x, y: rect.top };
  return { x: point.x, y: rect.bottom };
}

function sideCoordinate(side, rect) {
  if (side === "left") return rect.left;
  if (side === "right") return rect.right;
  if (side === "top") return rect.top;
  return rect.bottom;
}

function perimeterPoints(startSide, endSide, rect, direction) {
  if (startSide === endSide) return [];
  const out = [];
  let side = startSide;
  let guard = 0;
  while (side !== endSide && guard < 8) {
    out.push(cornerLeaving(side, direction, rect));
    side = nextSide(side, direction);
    guard += 1;
  }
  return out;
}

function nextSide(side, direction) {
  const order = direction === "cw"
    ? ["top", "right", "bottom", "left"]
    : ["top", "left", "bottom", "right"];
  const index = order.indexOf(side);
  return order[(index + 1 + order.length) % order.length];
}

function cornerLeaving(side, direction, rect) {
  const cw = direction === "cw";
  if (side === "top") return { x: cw ? rect.right : rect.left, y: rect.top };
  if (side === "right") return { x: rect.right, y: cw ? rect.bottom : rect.top };
  if (side === "bottom") return { x: cw ? rect.left : rect.right, y: rect.bottom };
  return { x: rect.left, y: cw ? rect.top : rect.bottom };
}

function drawPath(p, path) {
  const route = path.route || {};
  const stroke = Number.isFinite(Number(route.connection?.stroke)) ? Number(route.connection.stroke) : 2.4;
  p.noFill();
  p.stroke(route.color || "#111111");
  p.strokeWeight(stroke);
  p.strokeJoin(p.ROUND);
  p.strokeCap(p.ROUND);
  if (route.connection?.style === "dotted" || route.connection?.hint) p.drawingContext.setLineDash([5, 7]);
  drawRoundedPolyline(p, path.points);
  if (route.connection?.style === "dotted" || route.connection?.hint) p.drawingContext.setLineDash([]);
}

function drawRoundedPolyline(p, points) {
  const clean = dedupePoints(points);
  if (clean.length < 2) return;
  p.beginShape();
  p.vertex(clean[0].x, clean[0].y);
  for (let index = 1; index < clean.length - 1; index += 1) {
    const prev = clean[index - 1];
    const point = clean[index];
    const next = clean[index + 1];
    const radius = Math.min(CORNER_RADIUS, distance(prev, point) / 2, distance(point, next) / 2);
    const entry = along(point, prev, radius);
    const exit = along(point, next, radius);
    p.vertex(entry.x, entry.y);
    p.quadraticVertex(point.x, point.y, exit.x, exit.y);
  }
  const last = clean[clean.length - 1];
  p.vertex(last.x, last.y);
  p.endShape();
}

function drawDots(p, path) {
  const route = path.route || {};
  if (route.connection?.hint) return;
  const stroke = Number.isFinite(Number(route.connection?.stroke)) ? Number(route.connection.stroke) : 2.4;
  const points = dedupePoints(path.points || []);
  const start = path.netTap && points.length ? points[0] : route.start;
  const end = path.netTap && points.length ? points[points.length - 1] : route.endDot;
  p.noStroke();
  p.fill(route.color || "#111111");
  if (start) p.circle(start.x, start.y, Math.max(5, stroke + 2));
  if (end) p.circle(end.x, end.y, Math.max(6, stroke + 3));
}

function drawConflictNote(p, model, crossings) {
  const bounds = contentBounds(model);
  p.push();
  p.noStroke();
  p.fill("#5e35b1");
  p.textSize(12);
  p.textAlign(p.LEFT, p.TOP);
  p.text(`experimental embroidery routing: ${crossings} unresolved crossings`, bounds.left, bounds.top - 26);
  p.pop();
}

function samplePoints(points) {
  const clean = dedupePoints(points);
  const samples = [];
  for (let index = 0; index < clean.length - 1; index += 1) {
    const a = clean[index];
    const b = clean[index + 1];
    const steps = Math.max(1, Math.ceil(distance(a, b) / SAMPLE_STEP));
    for (let step = 0; step <= steps; step += 1) {
      samples.push({
        x: a.x + ((b.x - a.x) * step) / steps,
        y: a.y + ((b.y - a.y) * step) / steps,
      });
    }
  }
  return samples;
}

function countCrossings(samples, paths, route = null, allowSameNetTouch = false) {
  let count = 0;
  const segments = segmentsFor(samples);
  const netKey = allowSameNetTouch ? routeNetKey(route) : "";
  paths.forEach((path) => {
    if (netKey && routeNetKey(path.route) === netKey) return;
    const otherSegments = segmentsFor(path.samples || []);
    segments.forEach((segment) => {
      otherSegments.forEach((other) => {
        if (sharesEndpoint(segment, other)) return;
        if (segmentsIntersect(segment.a, segment.b, other.a, other.b)) count += 1;
      });
    });
  });
  return count;
}

function routeConflictScores(paths) {
  return paths.map((path, index) => {
    let count = 0;
    const segments = segmentsFor(path.samples || samplePoints(path.points || []));
    paths.forEach((other, otherIndex) => {
      if (otherIndex === index) return;
      if (sameNet(path.route, other.route)) return;
      const otherSegments = segmentsFor(other.samples || samplePoints(other.points || []));
      segments.forEach((segment) => {
        otherSegments.forEach((otherSegment) => {
          if (sharesEndpoint(segment, otherSegment)) return;
          if (segmentsIntersect(segment.a, segment.b, otherSegment.a, otherSegment.b)) count += 1;
        });
      });
    });
    return count;
  });
}

function totalCrossings(paths) {
  let count = 0;
  for (let index = 0; index < paths.length; index += 1) {
    const leftSegments = segmentsFor(paths[index].samples || samplePoints(paths[index].points || []));
    for (let otherIndex = index + 1; otherIndex < paths.length; otherIndex += 1) {
      if (sameNet(paths[index].route, paths[otherIndex].route)) continue;
      const rightSegments = segmentsFor(paths[otherIndex].samples || samplePoints(paths[otherIndex].points || []));
      leftSegments.forEach((left) => {
        rightSegments.forEach((right) => {
          if (sharesEndpoint(left, right)) return;
          if (segmentsIntersect(left.a, left.b, right.a, right.b)) count += 1;
        });
      });
    }
  }
  return count;
}

function totalPathLength(paths) {
  return paths.reduce((total, path) => total + pathLength(path.points || []), 0);
}

function sameNet(leftRoute, rightRoute) {
  const left = routeNetKey(leftRoute);
  return Boolean(left && left === routeNetKey(rightRoute));
}

function routeNetKey(route = {}) {
  const laneKey = String(route.laneKey || "").toLowerCase();
  if (laneKey === "ground") return "ground";
  if (laneKey.startsWith("power:")) return laneKey;
  const text = [
    laneKey,
    route.connection?.label,
    route.connection?.from?.pin,
    route.connection?.to?.pin,
    route.connection?.to?.boardPin,
  ].map((value) => String(value || "").toLowerCase()).join(" ");
  if (/\b(g|gnd|ground)\b/.test(text)) return "ground";
  if (/\b12v\b/.test(text)) return "power:12v";
  if (/\b5v\b/.test(text)) return "power:5v";
  if (/\b(3v|3v3|3\.3v)\b/.test(text)) return "power:3v3";
  if (/\b(vin|vcc|power|\+)\b/.test(text)) return "power:vin";
  return "";
}

function railTapEndpoint(route = {}) {
  const end = cleanPoint(route.end);
  if (end) return end;
  return cleanPoint(route.start);
}

function compatibleRailTaps(route, endpoint, placedPaths, netKey) {
  const seen = new Set();
  const taps = [];
  placedPaths.forEach((path) => {
    if (routeNetKey(path.route) !== netKey) return;
    const points = dedupePoints(path.points || []);
    const samples = path.samples || samplePoints(points);
    [...points, ...sparseSamples(samples)].forEach((point) => {
      const tap = cleanPoint(point);
      if (!tap || distance(tap, endpoint) < ROUTE_GAP * 1.5) return;
      const key = `${Math.round(tap.x / 4)}:${Math.round(tap.y / 4)}`;
      if (seen.has(key)) return;
      seen.add(key);
      taps.push({ ...tap, score: distance(tap, endpoint) });
    });
  });
  return taps
    .sort((left, right) => left.score - right.score)
    .slice(0, NET_TAP_CANDIDATES)
    .map(({ x, y }) => ({ x, y }));
}

function sparseSamples(samples) {
  if (!samples.length) return [];
  const stride = Math.max(1, Math.floor(samples.length / NET_TAP_CANDIDATES));
  const out = [];
  for (let index = 0; index < samples.length; index += stride) out.push(samples[index]);
  return out;
}

function forceEndpoint(points, start, end) {
  const clean = dedupePoints(points);
  if (!clean.length) return [start, end];
  clean[0] = start;
  clean[clean.length - 1] = end;
  return dedupePoints(clean);
}

function segmentsFor(points) {
  const segments = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    segments.push({ a: points[index], b: points[index + 1] });
  }
  return segments;
}

function segmentsIntersect(a, b, c, d) {
  const d1 = direction(c, d, a);
  const d2 = direction(c, d, b);
  const d3 = direction(a, b, c);
  const d4 = direction(a, b, d);
  return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS))
    && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS));
}

function segmentConflicts(a, b, c, d) {
  if (sharesEndpoint({ a, b }, { a: c, b: d })) return false;
  if (segmentsIntersect(a, b, c, d)) return true;
  if (Math.abs(direction(a, b, c)) > EPS || Math.abs(direction(a, b, d)) > EPS) return false;
  return rangesOverlap(a.x, b.x, c.x, d.x) && rangesOverlap(a.y, b.y, c.y, d.y);
}

function rangesOverlap(a, b, c, d) {
  const left = Math.max(Math.min(a, b), Math.min(c, d));
  const right = Math.min(Math.max(a, b), Math.max(c, d));
  return right - left > EPS;
}

function direction(a, b, c) {
  return (c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x);
}

function sharesEndpoint(left, right) {
  return near(left.a, right.a) || near(left.a, right.b) || near(left.b, right.a) || near(left.b, right.b);
}

function pathLength(points) {
  let total = 0;
  for (let index = 0; index < points.length - 1; index += 1) total += distance(points[index], points[index + 1]);
  return total;
}

function dedupePoints(points) {
  const out = [];
  points.forEach((point) => {
    const clean = cleanPoint(point);
    if (!clean) return;
    const last = out[out.length - 1];
    if (!last || !near(last, clean)) out.push(clean);
  });
  return out;
}

function cleanPoint(point) {
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function along(from, to, amount) {
  const length = distance(from, to);
  if (length <= EPS) return { ...from };
  const t = amount / length;
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
  };
}

function distance(a, b) {
  return Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y));
}

function near(a, b) {
  return distance(a, b) < 0.5;
}
