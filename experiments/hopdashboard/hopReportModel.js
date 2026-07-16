function buildHopReportModel(model) {
  const interactions = hopReportInteractions(model);
  const explorerItems = model.activityExplorer?.items || [];
  const findProfile = (terms) => hopReportFindProfile(explorerItems, terms);
  const intro = model.introConversion || { cohorts: [], summary: {} };
  const intensiveProfiles = [
    findProfile(["rope play immersion", "beginners weekend"]),
    findProfile(["unleash", "introduction to conscious kink"]),
  ].filter(Boolean);
  const ropeKeys = new Set(interactions.items.filter((item) => /rope|ropes|shibari|bondage/i.test(item.label)).map((item) => item.key));
  const playPartyKeys = new Set(interactions.items.filter((item) => /play[\s!_-]*part|play[\s!_-]*night/i.test(item.label)).map((item) => item.key));
  const coreEventDefinitions = [
    ["Rope Jam", ["rope jam"]],
    ["Ignite", ["ignite"]],
    ["Cuddle Space", ["cuddle space", "cuddle"]],
    ["Power Play", ["power play"]],
    ["Play Night", ["play night"]],
    ["Navigating Intimacy", ["navigating intimacy"]],
  ];
  const coreEvents = coreEventDefinitions.map(([label, terms]) => {
    const profile = findProfile(terms);
    return profile ? { ...profile, requestedLabel: label } : { requestedLabel: label, missing: true };
  });

  const recurrence = hopReportRecurrenceGroups(interactions.items);
  const regular = hopReportAnalyzeGroup(interactions, new Set(recurrence.regular.map((item) => item.key)), model);
  const special = hopReportAnalyzeGroup(interactions, new Set(recurrence.special.map((item) => item.key)), model);
  const ropeCourses = hopReportAnalyzeGroup(interactions, ropeKeys, model);
  const playParties = hopReportAnalyzeGroup(interactions, playPartyKeys, model);
  const membership = hopReportMembershipStory(model, interactions);
  const core = hopReportCoreStory(model, interactions);
  const crew = hopReportCrewStory(model, interactions);
  const recommendations = hopReportRecommendations(intro, coreEvents, intensiveProfiles, core);

  return {
    coverage: hopReportCoverage(model),
    intro,
    intensiveProfiles,
    ropeCourses,
    playParties,
    coreEvents,
    recurrence: {
      regularItems: recurrence.regular,
      specialItems: recurrence.special,
      regular,
      special,
    },
    membership,
    core,
    crew,
    recommendations,
    definitions: {
      regular: "Aktivitet med bookinger på mindst 4 forskellige datoer fordelt over mindst 3 måneder.",
      special: "Aktivitet med færre registrerede datoer/måneder end grænsen for regular events.",
      core: "Person med mindst 4 registrerede interaktioner på mindst 3 måneder og mindst 2 aktivitetstyper, eller mindst 8 interaktioner i alt.",
    },
  };
}

function hopReportInteractions(model) {
  const eventsByPerson = new Map();
  const itemsByKey = new Map();
  const add = (event) => {
    if (!eventsByPerson.has(event.customerKey)) eventsByPerson.set(event.customerKey, []);
    eventsByPerson.get(event.customerKey).push(event);
    if (!itemsByKey.has(event.key)) {
      itemsByKey.set(event.key, { key: event.key, label: event.label, events: [], bookingDates: new Set(), bookingMonths: new Set() });
    }
    const item = itemsByKey.get(event.key);
    item.events.push(event);
    if (event.source === "booking") {
      item.bookingDates.add(formatReportDateKey(event.date));
      item.bookingMonths.add(`${event.date.getFullYear()}-${String(event.date.getMonth() + 1).padStart(2, "0")}`);
    }
  };
  for (const row of (model.rows || []).filter((row) => row.totalPrice > 0.0001 && isActivityOrEventRow(row))) {
    const label = activityExplorerDisplayLabel(row.text);
    add({
      customerKey: row.customerKey,
      key: activityNodeKey(label),
      label,
      date: row.date,
      timestamp: row.date.getTime(),
      source: "paid",
      revenue: row.totalPrice,
      units: Math.max(1, Number(row.quantity) || 1),
    });
  }
  for (const booking of model.bookings || []) {
    const label = activityExplorerDisplayLabel(booking.className);
    add({
      customerKey: booking.customerKey,
      key: activityNodeKey(label),
      label,
      date: booking.date,
      timestamp: booking.startAt?.getTime?.() || booking.date.getTime(),
      source: "booking",
      revenue: 0,
      units: 1,
    });
  }
  for (const events of eventsByPerson.values()) events.sort((a, b) => a.timestamp - b.timestamp);
  const items = Array.from(itemsByKey.values()).map((item) => ({
    ...item,
    people: new Set(item.events.map((event) => event.customerKey)),
    use: item.events.reduce((total, event) => total + event.units, 0),
    revenue: item.events.reduce((total, event) => total + event.revenue, 0),
    bookingDateCount: item.bookingDates.size,
    bookingMonthCount: item.bookingMonths.size,
  }));
  return { eventsByPerson, items, itemsByKey };
}

function hopReportFindProfile(items, terms) {
  const normalizedTerms = terms.map((term) => String(term).toLowerCase());
  return [...items]
    .filter((item) => normalizedTerms.some((term) => item.label.toLowerCase().includes(term)))
    .sort((a, b) => b.totalRecordedUse - a.totalRecordedUse)[0] || null;
}

function hopReportAnalyzeGroup(interactions, keys, model) {
  const membershipKeys = new Set((model.rows || []).filter(isPaidMembershipRow).map((row) => row.customerKey));
  const people = new Set();
  const related = new Map();
  const next = new Map();
  let use = 0;
  let revenue = 0;
  let repeatPeople = 0;
  for (const [customerKey, events] of interactions.eventsByPerson.entries()) {
    const groupEvents = events.filter((event) => keys.has(event.key));
    if (!groupEvents.length) continue;
    people.add(customerKey);
    use += groupEvents.reduce((total, event) => total + event.units, 0);
    revenue += groupEvents.reduce((total, event) => total + event.revenue, 0);
    if (groupEvents.length > 1) repeatPeople += 1;
    const first = groupEvents[0];
    const nextEvent = events.find((event) => event.timestamp > first.timestamp && !keys.has(event.key));
    if (nextEvent) hopReportIncrementRelation(next, nextEvent);
    const otherKeys = new Set(events.filter((event) => !keys.has(event.key)).map((event) => event.key));
    for (const otherKey of otherKeys) {
      const other = events.find((event) => event.key === otherKey);
      if (other) hopReportIncrementRelation(related, other);
    }
  }
  const memberCount = Array.from(people).filter((key) => membershipKeys.has(key)).length;
  return {
    itemCount: keys.size,
    people: people.size,
    use,
    revenue,
    memberCount,
    memberRate: people.size ? memberCount / people.size : 0,
    repeatPeople,
    repeatRate: people.size ? repeatPeople / people.size : 0,
    related: hopReportRelationList(related, people.size),
    next: hopReportRelationList(next, people.size),
  };
}

function hopReportRecurrenceGroups(items) {
  const regular = items.filter((item) => item.bookingDateCount >= 4 && item.bookingMonthCount >= 3);
  const regularKeys = new Set(regular.map((item) => item.key));
  const special = items.filter((item) => !regularKeys.has(item.key));
  return {
    regular: regular.sort((a, b) => b.use - a.use),
    special: special.sort((a, b) => b.use - a.use),
  };
}

function hopReportMembershipStory(model, interactions) {
  const membershipRows = (model.rows || []).filter(isPaidMembershipRow).sort((a, b) => a.date - b.date);
  const firstByPerson = new Map();
  for (const row of membershipRows) if (!firstByPerson.has(row.customerKey)) firstByPerson.set(row.customerKey, row.date.getTime());
  let activityBefore = 0;
  let activityAfter = 0;
  let bookingAfter = 0;
  const before = new Map();
  const after = new Map();
  for (const [customerKey, membershipMs] of firstByPerson.entries()) {
    const events = interactions.eventsByPerson.get(customerKey) || [];
    const prior = events.filter((event) => event.timestamp < membershipMs);
    const later = events.filter((event) => event.timestamp > membershipMs);
    if (prior.length) activityBefore += 1;
    if (later.length) activityAfter += 1;
    if (later.some((event) => event.source === "booking")) bookingAfter += 1;
    for (const key of new Set(prior.map((event) => event.key))) hopReportIncrementRelation(before, prior.find((event) => event.key === key));
    for (const key of new Set(later.map((event) => event.key))) hopReportIncrementRelation(after, later.find((event) => event.key === key));
  }
  const count = firstByPerson.size;
  return {
    count,
    activityBefore,
    activityBeforeRate: count ? activityBefore / count : 0,
    activityAfter,
    activityAfterRate: count ? activityAfter / count : 0,
    bookingAfter,
    bookingAfterRate: count ? bookingAfter / count : 0,
    avgMonths: model.membershipLength?.avgMonths || 0,
    medianMonths: model.membershipLength?.medianMonths || 0,
    activeCount: model.membershipLength?.activeCount || 0,
    endedCount: model.membershipLength?.endedCount || 0,
    noBookingCount: model.membershipLength?.noBookingCount || 0,
    before: hopReportRelationList(before, count),
    after: hopReportRelationList(after, count),
  };
}

function hopReportCoreStory(model, interactions) {
  const membershipKeys = new Set((model.rows || []).filter(isPaidMembershipRow).map((row) => row.customerKey));
  const crewKeys = new Set((model.rows || []).filter(isCrewMembershipRow).map((row) => row.customerKey));
  const allPeople = Array.from(interactions.eventsByPerson.keys());
  const coreKeys = new Set();
  const activityCounts = new Map();
  let totalInteractions = 0;
  let totalTypes = 0;
  for (const [customerKey, events] of interactions.eventsByPerson.entries()) {
    const months = new Set(events.map((event) => `${event.date.getFullYear()}-${event.date.getMonth()}`));
    const types = new Set(events.map((event) => event.key));
    const use = events.reduce((total, event) => total + event.units, 0);
    if (!((use >= 4 && months.size >= 3 && types.size >= 2) || use >= 8 || crewKeys.has(customerKey))) continue;
    coreKeys.add(customerKey);
    totalInteractions += use;
    totalTypes += types.size;
    for (const key of types) {
      const event = events.find((candidate) => candidate.key === key);
      if (event) hopReportIncrementRelation(activityCounts, event);
    }
  }
  const memberCount = Array.from(coreKeys).filter((key) => membershipKeys.has(key)).length;
  const crewCount = Array.from(coreKeys).filter((key) => crewKeys.has(key)).length;
  return {
    count: coreKeys.size,
    share: allPeople.length ? coreKeys.size / allPeople.length : 0,
    memberCount,
    memberRate: coreKeys.size ? memberCount / coreKeys.size : 0,
    crewCount,
    avgInteractions: coreKeys.size ? totalInteractions / coreKeys.size : 0,
    avgTypes: coreKeys.size ? totalTypes / coreKeys.size : 0,
    topActivities: hopReportRelationList(activityCounts, coreKeys.size),
  };
}

function hopReportCrewStory(model, interactions) {
  const crewKeys = new Set((model.rows || []).filter(isCrewMembershipRow).map((row) => row.customerKey));
  const activities = new Map();
  let activeCrew = 0;
  for (const customerKey of crewKeys) {
    const events = interactions.eventsByPerson.get(customerKey) || [];
    if (events.length) activeCrew += 1;
    for (const key of new Set(events.map((event) => event.key))) {
      const event = events.find((candidate) => candidate.key === key);
      if (event) hopReportIncrementRelation(activities, event);
    }
  }
  return {
    count: crewKeys.size,
    activeCrew,
    topActivities: hopReportRelationList(activities, crewKeys.size),
    facilitatorRankingAvailable: false,
  };
}

function hopReportRecommendations(intro, coreEvents, intensiveProfiles, core) {
  const introDestinations = new Map();
  for (const cohort of intro.cohorts || []) {
    for (const destination of cohort.topDestinations || []) {
      if (destination.type === "subscription") continue;
      introDestinations.set(destination.label, (introDestinations.get(destination.label) || 0) + destination.count);
    }
  }
  const introBridge = Array.from(introDestinations.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "en tilgængelig kerneaktivitet";
  const strongestCore = coreEvents.filter((event) => !event.missing).sort((a, b) => b.repeatRate - a.repeatRate || b.totalPeople - a.totalPeople)[0];
  const intensiveNeighbor = intensiveProfiles.flatMap((profile) => profile.related || []).sort((a, b) => b.people - a.people)[0]?.label;
  return [
    {
      title: `Intro-to-core community night med bro til ${introBridge}`,
      format: "Et billigt eller gratis tilbagevendende format 1–3 uger efter introduktionen, med værter der aktivt forbinder nye deltagere til regulars.",
      evidence: "Bygger direkte på de observerede næste destinationer efter introduktionsaktiviteterne.",
    },
    {
      title: `${strongestCore?.label || "Core-event"} progression lab${intensiveNeighbor ? ` + ${intensiveNeighbor}` : ""}`,
      format: "Et mindre premium-format mellem regular event og weekend/intensive: social forankring, tydelig progression og en billetpris der kan bære høj faciliteringskvalitet.",
      evidence: `Bruger gentagelsesstyrken i ${strongestCore?.label || "kerneaktiviteterne"} og betalingsvilligheden omkring intensives. Forslaget er en hypotese, ikke en kausal effektmåling.`,
    },
  ];
}

function hopReportCoverage(model) {
  const salesDates = (model.rows || []).map((row) => row.date).filter(Boolean).sort((a, b) => a - b);
  const bookingDates = (model.bookings || []).map((row) => row.date).filter(Boolean).sort((a, b) => a - b);
  return {
    salesStart: salesDates[0] || null,
    salesEnd: salesDates.at(-1) || null,
    bookingStart: bookingDates[0] || null,
    bookingEnd: bookingDates.at(-1) || null,
    salesRows: model.rows?.length || 0,
    bookingRows: model.bookings?.length || 0,
    people: new Set([...(model.rows || []).map((row) => row.customerKey), ...(model.bookings || []).map((row) => row.customerKey)]).size,
  };
}

function hopReportIncrementRelation(map, event) {
  if (!event) return;
  if (!map.has(event.key)) map.set(event.key, { key: event.key, label: event.label, count: 0 });
  map.get(event.key).count += 1;
}

function hopReportRelationList(map, denominator) {
  return Array.from(map.values()).map((entry) => ({
    ...entry,
    share: denominator ? entry.count / denominator : 0,
  })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, 10);
}

function formatReportDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
