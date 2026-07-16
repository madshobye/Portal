function buildHopModel(rows, timeBucket = "week", options = {}) {
  const normalizedRows = applyTransactionDiscountNetting(rows.map(normalizeSalesRow).filter((row) => row.date));
  const bookings = normalizeBookingRows(options.bookingRows || [], normalizedRows);
  const activityPathRows = options.activityPathRows
    ? applyTransactionDiscountNetting(options.activityPathRows.map(normalizeSalesRow).filter((row) => row.date))
    : normalizedRows;
  const retentionRows = options.retentionRows
    ? applyTransactionDiscountNetting(options.retentionRows.map(normalizeSalesRow).filter((row) => row.date))
    : normalizedRows;
  const membershipLengthRows = options.membershipLengthRows
    ? applyTransactionDiscountNetting(options.membershipLengthRows.map(normalizeSalesRow).filter((row) => row.date))
    : normalizedRows;
  const purchaseTimingRows = options.purchaseTimingRows
    ? applyTransactionDiscountNetting(options.purchaseTimingRows.map(normalizeSalesRow).filter((row) => row.date))
    : normalizedRows;
  const firstTouchpointRows = options.firstTouchpointRows && !options.timelineActivity
    ? applyTransactionDiscountNetting(options.firstTouchpointRows.map(normalizeSalesRow).filter((row) => row.date))
    : normalizedRows;
  const timelineRows = options.timelineRows && (!options.timelineActivity || !options.ticketSalesTimeline)
    ? applyTransactionDiscountNetting(options.timelineRows.map(normalizeSalesRow).filter((row) => row.date))
    : normalizedRows;
  const historicalBookings = options.historicalBookingRows
    ? normalizeBookingRows(options.historicalBookingRows, activityPathRows)
    : bookings;
  const invoices = groupInvoices(normalizedRows);
  const customers = groupCustomers(invoices);
  const months = groupMonths(invoices, timeBucket);
  const activity = options.timelineActivity || groupActivity(timelineRows, timeBucket, {
    firstTouchpointRows,
  });
  const ticketSales = groupTicketSales(normalizedRows, timeBucket);
  const ticketSalesTimeline = options.ticketSalesTimeline || groupTicketSales(timelineRows, timeBucket);
  const ticketBuyers = groupTicketBuyers(normalizedRows, timeBucket);
  const buyerPatterns = groupBuyerPatterns(normalizedRows, timeBucket, bookings);
  const activityNetwork = groupActivityNetwork(normalizedRows, bookings);
  const userNetwork = groupUserNetwork(normalizedRows, bookings);
  const retention = groupRetention(retentionRows, timeBucket, {
    bookingRows: historicalBookings,
    rangeStartMs: options.rangeStartMs,
    rangeEndMs: options.rangeEndMs,
  });
  const activityPath = groupActivityPath(activityPathRows, {
    bookingRows: historicalBookings,
    mode: options.activityPathMode || "ever",
    sourceMode: options.activityPathSource || "combined",
    rangeStartMs: options.rangeStartMs,
    rangeEndMs: options.rangeEndMs,
  });
  const gatewayPath = groupActivityPath(activityPathRows, {
    bookingRows: historicalBookings,
    mode: options.activityPathMode || "ever",
    sourceMode: "purchase",
    rangeStartMs: options.rangeStartMs,
    rangeEndMs: options.rangeEndMs,
  });
  const introConversion = groupIntroConversion(activityPathRows, historicalBookings, {
    rangeStartMs: options.rangeStartMs,
    rangeEndMs: options.rangeEndMs,
  });
  const membershipPipeline = groupMembershipPipeline(normalizedRows);
  const productHealth = groupProductHealth(normalizedRows, bookings);
  const activityExplorer = groupActivityExplorer(normalizedRows, bookings, {
    identityRows: activityPathRows,
  });
  const customerSegments = groupCustomerSegments(normalizedRows, bookings);
  const exitPoints = groupExitPoints(normalizedRows, bookings);
  const membershipLength = groupMembershipLength(membershipLengthRows, {
    bookingRows: historicalBookings,
    rangeStartMs: options.rangeStartMs,
    rangeEndMs: options.rangeEndMs,
    timeBucket,
  });
  const memberEngagement = groupMemberEngagement(bookings, customers, membershipLength.spans, timeBucket, {
    rangeStartMs: options.rangeStartMs,
    rangeEndMs: options.rangeEndMs,
    duplicateCount: options.bookingDuplicateCount,
    sources: options.bookingSources,
  });

  return {
    rows: normalizedRows,
    bookings,
    invoices,
    customers,
    months,
    activity,
    ticketSales,
    ticketSalesTimeline,
    ticketBuyers,
    buyerPatterns,
    activityNetwork,
    userNetwork,
    retention,
    activityPath,
    gatewayPath,
    introConversion,
    membershipPipeline,
    productHealth,
    activityExplorer,
    customerSegments,
    exitPoints,
    membershipLength,
    memberEngagement,
    purchaseTimingMembershipSignupKeys: firstMembershipSignupRowKeys(purchaseTimingRows),
    anonymizeNames: false,
    setAnonymizeNames(value) {
      this.anonymizeNames = !!value;
    },
    getName(entity) {
      return getModelName(entity, this.anonymizeNames);
    },
  };
}

function buildHopTimelineCache(rows, timeBucket = "week") {
  const normalizedRows = applyTransactionDiscountNetting(rows.map(normalizeSalesRow).filter((row) => row.date));
  return {
    activity: groupActivity(normalizedRows, timeBucket, {
      firstTouchpointRows: normalizedRows,
    }),
    ticketSalesTimeline: groupTicketSales(normalizedRows, timeBucket),
  };
}

function normalizeSalesRow(row) {
  const date = parseHopDate(row["Invoice date/time"]);
  const customerId = cleanValue(row["Customer ID"]);
  const customerName = cleanValue(row["Customer name"]);
  const customerEmail = cleanEmail(row["Customer email"]);
  const grossTotalPrice = parseHopNumber(row["Total price"]);
  const vatAmount = parseHopNumber(row["VAT amount"]);
  const customerKey = customerId || customerEmail || customerName || "unknown";

  const realLabel = customerName || customerEmail || customerId || "Unknown customer";
  return {
    date,
    invoiceId: cleanValue(row["Invoice #"]),
    pspId: cleanValue(row["PSP ID"]),
    customerId,
    customerName,
    customerEmail,
    customerKey,
    label: realLabel,
    realLabel,
    anonymousLabel: anonymousCustomerName(customerKey),
    text: cleanValue(row.Text),
    itemType: cleanValue(row["Item type"]),
    itemId: cleanValue(row["Item ID"]),
    quantity: parseHopNumber(row.Quantity),
    itemPrice: parseHopNumber(row["Item price"]),
    grossTotalPrice,
    totalPrice: grossTotalPrice - vatAmount,
    vatAmount,
    vatPercent: parseHopNumber(row["VAT %"]),
    paymentMethod: cleanValue(row["Payment method"]),
  };
}

function getModelName(entity, anonymizeNames = false) {
  if (!entity) return "Unknown customer";
  if (anonymizeNames) {
    return entity.anonymousLabel || anonymousCustomerName(entity.customerKey || entity.key || entity.customerId || entity.realLabel || entity.label);
  }
  return entity.realLabel || entity.label || entity.customerName || entity.customerEmail || entity.customerId || "Unknown customer";
}

function applyTransactionDiscountNetting(rows) {
  const byTransaction = new Map();
  for (const row of rows) {
    const key = row.pspId || row.invoiceId || `${row.customerKey}:${row.date?.getTime() || ""}`;
    if (!byTransaction.has(key)) byTransaction.set(key, []);
    byTransaction.get(key).push(row);
  }

  for (const transactionRows of byTransaction.values()) {
    if (transactionRows.length < 2 || !transactionRows.some((row) => row.totalPrice < 0 || row.itemType === "discount_code")) continue;

    const positiveRows = transactionRows.filter((row) => row.totalPrice > 0 && row.itemType !== "discount_code");
    if (!positiveRows.length) continue;

    const transactionNet = transactionRows.reduce((sum, row) => sum + row.totalPrice, 0);
    const positiveTotal = positiveRows.reduce((sum, row) => sum + row.totalPrice, 0);

    for (const row of transactionRows) {
      row.discountAdjustedTotalPrice = row.totalPrice;
      if (row.itemType === "discount_code" || row.totalPrice < 0) row.totalPrice = 0;
    }

    for (const row of positiveRows) {
      row.totalPrice = positiveTotal > 0 ? transactionNet * (row.discountAdjustedTotalPrice / positiveTotal) : 0;
      row.fullyDiscounted = transactionNet <= 0.0001;
    }
  }

  return rows;
}

function groupInvoices(rows) {
  const byInvoice = new Map();
  for (const row of rows) {
    const key = row.invoiceId || `${row.customerKey}:${row.date?.getTime() || ""}:${row.text}`;
    if (!byInvoice.has(key)) {
      byInvoice.set(key, {
        invoiceId: row.invoiceId,
        date: row.date,
        customerKey: row.customerKey,
        customerId: row.customerId,
        customerName: row.customerName,
        customerEmail: row.customerEmail,
        label: row.realLabel,
        realLabel: row.realLabel,
        anonymousLabel: row.anonymousLabel,
        totalPrice: 0,
        lines: [],
        itemTypes: new Set(),
      });
    }
    const invoice = byInvoice.get(key);
    invoice.totalPrice += row.totalPrice;
    invoice.lines.push(row);
    invoice.itemTypes.add(row.itemType);
  }
  return Array.from(byInvoice.values()).sort((a, b) => a.date - b.date);
}

function groupCustomers(invoices) {
  const byCustomer = new Map();
  for (const invoice of invoices) {
    if (!byCustomer.has(invoice.customerKey)) {
      byCustomer.set(invoice.customerKey, {
        customerKey: invoice.customerKey,
        customerId: invoice.customerId,
        customerName: invoice.customerName,
        customerEmail: invoice.customerEmail,
        label: invoice.realLabel,
        realLabel: invoice.realLabel,
        anonymousLabel: invoice.anonymousLabel,
        firstDate: invoice.date,
        lastDate: invoice.date,
        firstTouchpointDate: null,
        firstTouchpointType: "unknown",
        firstTouchpointLabel: "Unknown",
        firstTouchpointText: "",
        lastTouchpointDate: null,
        lastTouchpointType: "unknown",
        lastTouchpointLabel: "Unknown",
        lastTouchpointText: "",
        revenue: 0,
        activityRevenue: 0,
        eventRevenue: 0,
        membershipRevenue: 0,
        ticketRevenue: 0,
        invoiceCount: 0,
        classPassCount: 0,
        eventCount: 0,
        membershipCount: 0,
        crewMembershipCount: 0,
      });
    }
    const customer = byCustomer.get(invoice.customerKey);
    customer.firstDate = minDate(customer.firstDate, invoice.date);
    customer.lastDate = maxDate(customer.lastDate, invoice.date);
    customer.revenue += invoice.totalPrice;
    for (const row of invoice.lines) {
      if (row.itemType === "class_pass_type") customer.activityRevenue += row.totalPrice;
      if (row.itemType === "event") customer.eventRevenue += row.totalPrice;
      if (isPaidMembershipRow(row)) customer.membershipRevenue += row.totalPrice;
    }
    customer.ticketRevenue = customer.activityRevenue + customer.eventRevenue;
    customer.invoiceCount += 1;
    const firstTouchpoint = firstPaidTouchpointForInvoice(invoice);
    if (firstTouchpoint && (!customer.firstTouchpointDate || invoice.date < customer.firstTouchpointDate)) {
      customer.firstTouchpointDate = invoice.date;
      customer.firstTouchpointType = firstTouchpoint.type;
      customer.firstTouchpointLabel = firstTouchpoint.label;
      customer.firstTouchpointText = firstTouchpoint.text;
    }
    const lastTouchpoint = paidTouchpointForInvoice(invoice);
    if (lastTouchpoint && (!customer.lastTouchpointDate || invoice.date > customer.lastTouchpointDate)) {
      customer.lastTouchpointDate = invoice.date;
      customer.lastTouchpointType = lastTouchpoint.type;
      customer.lastTouchpointLabel = lastTouchpoint.label;
      customer.lastTouchpointText = lastTouchpoint.text;
    }
    if (invoice.itemTypes.has("class_pass_type")) customer.classPassCount += 1;
    if (invoice.itemTypes.has("event")) customer.eventCount += 1;
    if (invoice.lines.some((row) => isMembershipSubscriptionRow(row) && !isCrewMembershipRow(row))) {
      customer.membershipCount += 1;
    }
    if (invoice.lines.some((row) => isCrewMembershipRow(row))) customer.crewMembershipCount += 1;
  }
  return Array.from(byCustomer.values()).sort((a, b) => b.revenue - a.revenue);
}

function firstPaidTouchpointForInvoice(invoice) {
  const rows = (invoice.lines || [])
    .filter(isPaidTouchpointRow)
    .sort((a, b) => touchpointPriority(a) - touchpointPriority(b));
  return rows.length ? paidTouchpointInfo(rows[0]) : null;
}

function paidTouchpointForInvoice(invoice) {
  const rows = (invoice.lines || [])
    .filter(isPaidTouchpointRow)
    .sort((a, b) => touchpointPriority(a) - touchpointPriority(b));
  return rows.length ? paidTouchpointInfo(rows[0]) : null;
}

function isPaidTouchpointRow(row) {
  return row.totalPrice > 0.0001 && (
    row.itemType === "class_pass_type" ||
    row.itemType === "event" ||
    (isMembershipSubscriptionRow(row) && !isCrewMembershipRow(row))
  );
}

function paidTouchpointInfo(row) {
  if (isCrewMembershipRow(row)) return { type: "crew", label: "Crew", text: row.text || "" };
  if (isPaidMembershipRow(row)) return { type: "membership", label: "Membership", text: row.text || "" };
  if (row.itemType === "event") return { type: "event", label: "Event ticket", text: row.text || "" };
  if (row.itemType === "class_pass_type") return { type: "activity", label: "Activity ticket", text: row.text || "" };
  return { type: "other", label: row.itemType || "Other", text: row.text || "" };
}

function touchpointPriority(row) {
  if (row.itemType === "class_pass_type" || row.itemType === "event") return 0;
  if (isPaidMembershipRow(row)) return 1;
  if (isCrewMembershipRow(row)) return 2;
  return 3;
}

function groupMonths(invoices, timeBucket) {
  const byMonth = new Map();
  for (const invoice of invoices) {
    const key = periodKey(invoice.date, timeBucket);
    if (!byMonth.has(key)) {
      byMonth.set(key, {
        month: key,
        revenue: 0,
        invoiceCount: 0,
        customerKeys: new Set(),
      });
    }
    const month = byMonth.get(key);
    month.revenue += invoice.totalPrice;
    month.invoiceCount += 1;
    month.customerKeys.add(invoice.customerKey);
  }
  return Array.from(byMonth.values()).map((month) => ({
    month: month.month,
    revenue: month.revenue,
    invoiceCount: month.invoiceCount,
    customerCount: month.customerKeys.size,
  }));
}

function groupActivity(rows, timeBucket, options = {}) {
  const crewMembershipRows = rows.filter(isCrewMembershipRow);
  const rawMembershipRows = rows.filter((row) => isMembershipSubscriptionRow(row) && !isCrewMembershipRow(row));
  const paidMemberKeys = new Set(
    rawMembershipRows
      .filter((row) => row.totalPrice > 0)
      .map((row) => row.customerKey)
  );
  const membershipRows = rawMembershipRows.filter((row) => paidMemberKeys.has(row.customerKey));
  const byMonth = new Map();
  const firstMembershipByCustomer = new Map();
  const membershipRowsByCustomer = new Map();
  const crewRowsByCustomer = new Map();
  const membershipTypes = new Map();

  for (const row of membershipRows) {
    const type = membershipTypeInfo(row.text);
    const typeKey = type.key;
    if (!membershipTypes.has(typeKey)) membershipTypes.set(typeKey, type.label);
    const month = periodKey(row.date, timeBucket);
    if (!byMonth.has(month)) {
        byMonth.set(month, {
          month,
          revenue: 0,
          customerKeys: new Set(),
          newCustomerKeys: new Set(),
          endedCustomerKeys: new Set(),
        });
    }
    if (!firstMembershipByCustomer.has(row.customerKey)) {
      firstMembershipByCustomer.set(row.customerKey, row.date);
      byMonth.get(month).newCustomerKeys.add(row.customerKey);
    }

    if (!membershipRowsByCustomer.has(row.customerKey)) {
      membershipRowsByCustomer.set(row.customerKey, []);
    }
    membershipRowsByCustomer.get(row.customerKey).push({ ...row, membershipTypeKey: typeKey });
  }

  for (const row of crewMembershipRows) {
    if (!crewRowsByCustomer.has(row.customerKey)) {
      crewRowsByCustomer.set(row.customerKey, []);
    }
    crewRowsByCustomer.get(row.customerKey).push(row);
  }

  addActiveMemberWeeks(byMonth, membershipRowsByCustomer, getLastRowDate(rows), timeBucket);
  addActiveCrewWeeks(byMonth, crewRowsByCustomer, getLastRowDate(rows), timeBucket);
  addFirstTouchpointPeriods(byMonth, options.firstTouchpointRows || rows, timeBucket, options.rangeStartMs, options.rangeEndMs);
  addLastTouchpointPeriods(byMonth, options.firstTouchpointRows || rows, timeBucket, options.rangeStartMs, options.rangeEndMs);
  addSingleTicketBuyerPeriods(byMonth, options.firstTouchpointRows || rows, timeBucket, options.rangeStartMs, options.rangeEndMs);

  return {
    months: Array.from(byMonth.values()).map((month) => ({
      month: month.month,
      revenue: month.revenue,
      memberCount: month.customerKeys.size,
      membershipTypeCounts: Object.fromEntries(Array.from(month.membershipTypeKeys || new Map()).map(([key, customerKeys]) => [key, customerKeys.size])),
      customerKeys: month.customerKeys,
      crewCount: month.crewKeys?.size || 0,
      newMemberships: month.newCustomerKeys.size,
      endedMemberships: month.endedCustomerKeys?.size || 0,
      firstTouchpoints: month.firstTouchpointKeys?.size || 0,
      lastTouchpoints: month.lastTouchpointKeys?.size || 0,
      singleTicketBuyers: month.singleTicketBuyerKeys?.size || 0,
    })),
    membershipTypes: Array.from(membershipTypes.entries()).map(([key, label]) => ({ key, label })),
  };
}

function addFirstTouchpointPeriods(byMonth, rows, timeBucket, rangeStartMs, rangeEndMs) {
  const byCustomer = new Map();
  const singleTicketKeys = singleTicketBuyerKeys(rows);
  const touchpointRows = rows
    .filter(isPaidTouchpointRow)
    .sort((a, b) => a.date - b.date || touchpointPriority(a) - touchpointPriority(b));

  for (const row of touchpointRows) {
    if (singleTicketKeys.has(row.customerKey)) continue;
    if (byCustomer.has(row.customerKey)) continue;
    byCustomer.set(row.customerKey, row);
  }

  for (const row of byCustomer.values()) {
    const time = startOfHopDayMs(row.date);
    if (rangeStartMs && time < rangeStartMs) continue;
    if (rangeEndMs && time > rangeEndMs) continue;
    const month = periodKey(row.date, timeBucket);
    if (!byMonth.has(month)) {
      byMonth.set(month, {
        month,
        revenue: 0,
        customerKeys: new Set(),
        newCustomerKeys: new Set(),
        endedCustomerKeys: new Set(),
      });
    }
    const entry = byMonth.get(month);
    entry.firstTouchpointKeys = entry.firstTouchpointKeys || new Set();
    entry.firstTouchpointKeys.add(row.customerKey);
  }
}

function addLastTouchpointPeriods(byMonth, rows, timeBucket, rangeStartMs, rangeEndMs) {
  const byCustomer = new Map();
  const singleTicketKeys = singleTicketBuyerKeys(rows);
  const touchpointRows = rows
    .filter(isPaidTouchpointRow)
    .sort((a, b) => b.date - a.date || touchpointPriority(a) - touchpointPriority(b));

  for (const row of touchpointRows) {
    if (singleTicketKeys.has(row.customerKey)) continue;
    if (byCustomer.has(row.customerKey)) continue;
    byCustomer.set(row.customerKey, row);
  }

  for (const row of byCustomer.values()) {
    const time = startOfHopDayMs(row.date);
    if (rangeStartMs && time < rangeStartMs) continue;
    if (rangeEndMs && time > rangeEndMs) continue;
    const month = periodKey(row.date, timeBucket);
    if (!byMonth.has(month)) {
      byMonth.set(month, {
        month,
        revenue: 0,
        customerKeys: new Set(),
        newCustomerKeys: new Set(),
        endedCustomerKeys: new Set(),
      });
    }
    const entry = byMonth.get(month);
    entry.lastTouchpointKeys = entry.lastTouchpointKeys || new Set();
    entry.lastTouchpointKeys.add(row.customerKey);
  }
}

function addSingleTicketBuyerPeriods(byMonth, rows, timeBucket, rangeStartMs, rangeEndMs) {
  const singleTicketKeys = singleTicketBuyerKeys(rows);
  const ticketRows = rows
    .filter((row) => row.totalPrice > 0.0001)
    .filter((row) => row.itemType === "class_pass_type" || row.itemType === "event")
    .sort((a, b) => a.date - b.date);
  const byCustomer = new Map();

  for (const row of ticketRows) {
    if (!singleTicketKeys.has(row.customerKey)) continue;
    if (!byCustomer.has(row.customerKey)) byCustomer.set(row.customerKey, []);
    byCustomer.get(row.customerKey).push(row);
  }

  for (const [customerKey, customerRows] of byCustomer.entries()) {
    if (customerRows.length !== 1) continue;
    const row = customerRows[0];
    const time = startOfHopDayMs(row.date);
    if (rangeStartMs && time < rangeStartMs) continue;
    if (rangeEndMs && time > rangeEndMs) continue;
    const month = periodKey(row.date, timeBucket);
    if (!byMonth.has(month)) {
      byMonth.set(month, {
        month,
        revenue: 0,
        customerKeys: new Set(),
        newCustomerKeys: new Set(),
        endedCustomerKeys: new Set(),
      });
    }
    const entry = byMonth.get(month);
    entry.singleTicketBuyerKeys = entry.singleTicketBuyerKeys || new Set();
    entry.singleTicketBuyerKeys.add(customerKey);
  }
}

function singleTicketBuyerKeys(rows) {
  const ticketCounts = new Map();
  const membershipKeys = new Set();
  for (const row of rows) {
    if (row.totalPrice <= 0.0001) continue;
    if (row.itemType === "class_pass_type" || row.itemType === "event") {
      ticketCounts.set(row.customerKey, (ticketCounts.get(row.customerKey) || 0) + 1);
    }
    if (isMembershipSubscriptionRow(row) && !isCrewMembershipRow(row)) {
      membershipKeys.add(row.customerKey);
    }
  }
  return new Set(Array.from(ticketCounts.entries())
    .filter(([customerKey, count]) => count === 1 && !membershipKeys.has(customerKey))
    .map(([customerKey]) => customerKey));
}

function groupTicketSales(rows, timeBucket) {
  const ticketRows = rows.filter((row) => row.itemType === "class_pass_type" || row.itemType === "event");
  const byWeek = new Map();
  const byItem = new Map();

  for (const row of ticketRows) {
    const week = periodKey(row.date, timeBucket);
    if (!byWeek.has(week)) {
      byWeek.set(week, {
        month: week,
        classRevenue: 0,
        eventRevenue: 0,
        classTickets: 0,
        eventTickets: 0,
        customerKeys: new Set(),
      });
    }
    const weekEntry = byWeek.get(week);
    const quantity = row.quantity || 1;
    weekEntry.customerKeys.add(row.customerKey);
    const isEvent = row.itemType === "event";
    if (isEvent) {
      weekEntry.eventRevenue += row.totalPrice;
      weekEntry.eventTickets += quantity;
    } else {
      weekEntry.classRevenue += row.totalPrice;
      weekEntry.classTickets += quantity;
    }

    const itemKey = isEvent ? `${row.itemType}:${row.text}` : `${row.itemType}:${row.text}:${week}`;
    if (!byItem.has(itemKey)) {
      byItem.set(itemKey, {
        label: row.text || row.itemType,
        type: isEvent ? "Event" : "Activity",
        revenue: 0,
        tickets: 0,
        lastWeek: week,
        lastDate: row.date,
      });
    }
    const item = byItem.get(itemKey);
    item.revenue += row.totalPrice;
    item.tickets += quantity;
    if (row.date > item.lastDate) {
      item.lastDate = row.date;
      item.lastWeek = week;
    }
  }

  return {
    weeks: Array.from(byWeek.values()).map((week) => ({
      month: week.month,
      classRevenue: week.classRevenue,
      eventRevenue: week.eventRevenue,
      classTickets: week.classTickets,
      eventTickets: week.eventTickets,
      activeTicketUsers: week.customerKeys.size,
      customerKeys: week.customerKeys,
    })),
    items: Array.from(byItem.values()).sort((a, b) => b.revenue - a.revenue),
  };
}

function groupTicketBuyers(rows, timeBucket) {
  const ticketRows = rows.filter((row) => row.itemType === "class_pass_type" || row.itemType === "event");
  const byCustomer = new Map();
  const periodSet = new Set();

  for (const row of ticketRows) {
    const period = periodKey(row.date, timeBucket);
    const quantity = row.quantity || 1;
    periodSet.add(period);
    if (!byCustomer.has(row.customerKey)) {
      byCustomer.set(row.customerKey, {
        customerKey: row.customerKey,
        label: row.realLabel,
        realLabel: row.realLabel,
        anonymousLabel: row.anonymousLabel,
        totalTickets: 0,
        revenue: 0,
        periods: new Map(),
      });
    }
    const buyer = byCustomer.get(row.customerKey);
    buyer.totalTickets += quantity;
    buyer.revenue += row.totalPrice;
    if (!buyer.periods.has(period)) {
      buyer.periods.set(period, {
        period,
        tickets: 0,
        revenue: 0,
        classTickets: 0,
        eventTickets: 0,
      });
    }
    const periodEntry = buyer.periods.get(period);
    periodEntry.tickets += quantity;
    periodEntry.revenue += row.totalPrice;
    if (row.itemType === "event") periodEntry.eventTickets += quantity;
    else periodEntry.classTickets += quantity;
  }

  const periods = Array.from(periodSet).sort();
  const lastActiveIndex = max(0, periods.length - 4);
  const buyers = Array.from(byCustomer.values()).map((buyer) => {
    const activePeriods = buyer.periods.size;
    const sortedPeriods = Array.from(buyer.periods.keys()).sort();
    const lastPeriod = sortedPeriods.at(-1) || "";
    const isRecurring = activePeriods >= 3 || buyer.totalTickets >= 5;
    const isSingle = activePeriods === 1 && buyer.totalTickets <= 1;
    const lastPeriodIndex = periods.indexOf(lastPeriod);
    return {
      ...buyer,
      periods: Array.from(buyer.periods.values()).sort((a, b) => a.period.localeCompare(b.period)),
      activePeriods,
      firstPeriod: sortedPeriods[0] || "",
      lastPeriod,
      segment: isRecurring ? "Recurring" : isSingle ? "Single" : "Occasional",
      isActive: lastPeriodIndex >= lastActiveIndex,
    };
  }).sort((a, b) => {
    if (a.segment !== b.segment) return a.segment === "Recurring" ? -1 : b.segment === "Recurring" ? 1 : 0;
    return b.totalTickets - a.totalTickets;
  });

  return {
    periods,
    buyers,
    summary: {
      total: buyers.length,
      single: buyers.filter((buyer) => buyer.segment === "Single").length,
      recurring: buyers.filter((buyer) => buyer.segment === "Recurring").length,
      activeRecurring: buyers.filter((buyer) => buyer.segment === "Recurring" && buyer.isActive).length,
      revenue: buyers.reduce((total, buyer) => total + buyer.revenue, 0),
    },
  };
}

function groupActivityNetwork(rows, bookings = []) {
  const ticketRows = rows
    .filter((row) => row.itemType === "class_pass_type" || row.itemType === "event")
    .sort((a, b) => a.date - b.date);
  const nodesByKey = new Map();
  const rowsByCustomer = new Map();

  for (const row of ticketRows) {
    const key = activityNodeKey(row.text);
    if (!key) continue;
    if (!nodesByKey.has(key)) {
      nodesByKey.set(key, {
        key,
        label: row.text || row.itemType,
        type: row.itemType === "event" ? "Event" : "Activity",
        revenue: 0,
        tickets: 0,
        buyers: new Set(),
        firstTimerPurchases: 0,
        experiencedPurchases: 0,
        experienceSum: 0,
        purchaseCount: 0,
        memberBookings: 0,
        bookingMembers: new Set(),
      });
    }
    const node = nodesByKey.get(key);
    const quantity = row.quantity || 1;
    node.revenue += row.totalPrice;
    node.tickets += quantity;
    node.buyers.add(row.customerKey);
    if (row.itemType === "event") node.type = "Event";

    if (!rowsByCustomer.has(row.customerKey)) rowsByCustomer.set(row.customerKey, []);
    rowsByCustomer.get(row.customerKey).push(row);
  }

  for (const booking of bookings.filter((item) => item.isMembershipBooking)) {
    const key = activityNodeKey(booking.className);
    if (!key) continue;
    if (!nodesByKey.has(key)) {
      nodesByKey.set(key, {
        key,
        label: booking.className || "Unknown class",
        type: "Activity",
        revenue: 0,
        tickets: 0,
        buyers: new Set(),
        firstTimerPurchases: 0,
        experiencedPurchases: 0,
        experienceSum: 0,
        purchaseCount: 0,
        memberBookings: 0,
        bookingMembers: new Set(),
      });
    }
    const node = nodesByKey.get(key);
    node.memberBookings += 1;
    node.bookingMembers.add(booking.customerKey);
    node.buyers.add(booking.customerKey);
    if (!rowsByCustomer.has(booking.customerKey)) rowsByCustomer.set(booking.customerKey, []);
    rowsByCustomer.get(booking.customerKey).push({
      date: booking.date,
      text: booking.className,
      quantity: 1,
      interactionSource: "booking",
    });
  }

  for (const customerRows of rowsByCustomer.values()) {
    let priorTicketCount = 0;
    for (const row of customerRows.sort((a, b) => a.date - b.date)) {
      const key = activityNodeKey(row.text);
      const node = nodesByKey.get(key);
      if (!node) continue;
      node.experienceSum += priorTicketCount;
      node.purchaseCount += 1;
      if (priorTicketCount === 0) node.firstTimerPurchases += 1;
      else node.experiencedPurchases += 1;
      priorTicketCount += row.quantity || 1;
    }
  }

  const linksByKey = new Map();
  for (const customerRows of rowsByCustomer.values()) {
    const keys = [...new Set(customerRows.map((row) => activityNodeKey(row.text)).filter(Boolean))].sort();
    for (let a = 0; a < keys.length; a += 1) {
      for (let b = a + 1; b < keys.length; b += 1) {
        const linkKey = `${keys[a]}::${keys[b]}`;
        if (!linksByKey.has(linkKey)) linksByKey.set(linkKey, { source: keys[a], target: keys[b], weight: 0 });
        linksByKey.get(linkKey).weight += 1;
      }
    }
  }

  const nodes = Array.from(nodesByKey.values()).map((node) => ({
    ...node,
    buyerCount: node.buyers.size,
    bookingMemberCount: node.bookingMembers.size,
    totalInteractions: node.tickets + node.memberBookings,
    avgExperience: node.purchaseCount ? node.experienceSum / node.purchaseCount : 0,
  })).sort((a, b) => b.totalInteractions - a.totalInteractions || b.revenue - a.revenue);

  const nodeKeys = new Set(nodes.map((node) => node.key));
  const links = Array.from(linksByKey.values())
    .filter((link) => nodeKeys.has(link.source) && nodeKeys.has(link.target))
    .sort((a, b) => b.weight - a.weight);

  return {
    nodes,
    links,
    maxRevenue: Math.max(1, ...nodes.map((node) => node.revenue)),
    maxTickets: Math.max(1, ...nodes.map((node) => node.tickets)),
    maxExperience: Math.max(1, ...nodes.map((node) => node.avgExperience)),
    maxInteractions: Math.max(1, ...nodes.map((node) => node.totalInteractions)),
  };
}

function activityNodeKey(text) {
  return cleanValue(text).toLowerCase();
}

function groupProductHealth(rows, bookings = []) {
  const ticketRows = rows
    .filter((row) => row.totalPrice > 0.0001)
    .filter(isActivityOrEventRow)
    .sort((a, b) => a.date - b.date);
  const membershipKeys = new Set(rows.filter(isPaidMembershipRow).map((row) => row.customerKey));
  const products = new Map();
  const seenTicketCustomers = new Set();
  const buyerProductCount = new Map();
  const productDates = [...ticketRows.map((row) => row.date), ...bookings.map((booking) => booking.date)].sort((a, b) => a - b);
  const firstDate = productDates[0] || null;
  const lastDate = productDates.at(-1) || null;
  const midpoint = firstDate && lastDate ? new Date((firstDate.getTime() + lastDate.getTime()) / 2) : null;

  for (const row of ticketRows) {
    const key = activityNodeKey(row.text) || row.itemType;
    if (!products.has(key)) {
      products.set(key, {
        key,
        label: cleanValue(row.text) || row.itemType,
        type: row.itemType === "event" ? "Event" : "Activity",
        revenue: 0,
        tickets: 0,
        buyers: new Set(),
        repeatBuyers: new Set(),
        firstTimerBuyers: new Set(),
        memberBuyers: new Set(),
        earlyRevenue: 0,
        lateRevenue: 0,
        memberBookings: 0,
        bookingMembers: new Set(),
        repeatBookingMembers: new Set(),
        earlyBookings: 0,
        lateBookings: 0,
      });
    }
    const product = products.get(key);
    const buyerProductKey = `${row.customerKey}::${key}`;
    const buyerProductVisits = buyerProductCount.get(buyerProductKey) || 0;
    product.revenue += row.totalPrice;
    product.tickets += row.quantity || 1;
    product.buyers.add(row.customerKey);
    if (buyerProductVisits > 0) product.repeatBuyers.add(row.customerKey);
    if (!seenTicketCustomers.has(row.customerKey)) product.firstTimerBuyers.add(row.customerKey);
    if (membershipKeys.has(row.customerKey)) product.memberBuyers.add(row.customerKey);
    if (midpoint && row.date <= midpoint) product.earlyRevenue += row.totalPrice;
    else product.lateRevenue += row.totalPrice;
    buyerProductCount.set(buyerProductKey, buyerProductVisits + 1);
    seenTicketCustomers.add(row.customerKey);
  }

  const bookingProductCount = new Map();
  for (const booking of bookings.filter((item) => item.isMembershipBooking)) {
    const key = activityNodeKey(booking.className) || "unknown booking";
    if (!products.has(key)) {
      products.set(key, {
        key,
        label: booking.className || "Unknown class",
        type: "Activity",
        revenue: 0,
        tickets: 0,
        buyers: new Set(),
        repeatBuyers: new Set(),
        firstTimerBuyers: new Set(),
        memberBuyers: new Set(),
        earlyRevenue: 0,
        lateRevenue: 0,
        memberBookings: 0,
        bookingMembers: new Set(),
        repeatBookingMembers: new Set(),
        earlyBookings: 0,
        lateBookings: 0,
      });
    }
    const product = products.get(key);
    const personProductKey = `${booking.customerKey}::${key}`;
    const previousBookings = bookingProductCount.get(personProductKey) || 0;
    product.memberBookings += 1;
    product.bookingMembers.add(booking.customerKey);
    if (previousBookings > 0) product.repeatBookingMembers.add(booking.customerKey);
    if (midpoint && booking.date <= midpoint) product.earlyBookings += 1;
    else product.lateBookings += 1;
    bookingProductCount.set(personProductKey, previousBookings + 1);
  }

  const items = Array.from(products.values()).map((product) => {
    const buyerCount = product.buyers.size;
    const trendBase = max(1, product.earlyRevenue);
    const trend = (product.lateRevenue - product.earlyRevenue) / trendBase;
    const bookingTrendBase = max(1, product.earlyBookings);
    const bookingTrend = (product.lateBookings - product.earlyBookings) / bookingTrendBase;
    const people = new Set([...product.buyers, ...product.bookingMembers]);
    return {
      key: product.key,
      label: product.label,
      type: product.type,
      revenue: product.revenue,
      tickets: product.tickets,
      buyerCount,
      repeatBuyerCount: product.repeatBuyers.size,
      firstTimerShare: buyerCount ? product.firstTimerBuyers.size / buyerCount : 0,
      memberShare: buyerCount ? product.memberBuyers.size / buyerCount : 0,
      memberBookings: product.memberBookings,
      bookingMemberCount: product.bookingMembers.size,
      repeatBookingMemberCount: product.repeatBookingMembers.size,
      totalDemand: product.tickets + product.memberBookings,
      totalPeople: people.size,
      bookingTrend,
      trend,
      earlyRevenue: product.earlyRevenue,
      lateRevenue: product.lateRevenue,
    };
  }).sort((a, b) => b.totalDemand - a.totalDemand || b.revenue - a.revenue);

  return {
    items,
    maxRevenue: Math.max(1, ...items.map((item) => item.revenue)),
    maxDemand: Math.max(1, ...items.map((item) => item.totalDemand)),
  };
}

function groupActivityExplorer(rows, bookings = [], options = {}) {
  const identityRows = Array.isArray(options.identityRows) ? options.identityRows : rows;
  const membershipRows = identityRows.filter(isPaidMembershipRow).sort((a, b) => a.date - b.date);
  const membershipKeys = new Set(membershipRows.map((row) => row.customerKey));
  const firstMembershipByCustomer = new Map();
  for (const row of membershipRows) {
    if (!firstMembershipByCustomer.has(row.customerKey)) firstMembershipByCustomer.set(row.customerKey, row.date.getTime());
  }

  const catalog = new Map();
  const eventsByCustomer = new Map();
  const ensureItem = (key, label, type) => {
    if (!catalog.has(key)) {
      catalog.set(key, {
        key,
        label: label || "Unknown activity",
        type: type || "Activity",
        labelCounts: new Map(),
        events: [],
        revenue: 0,
        paidTickets: 0,
        bookings: 0,
        membershipBookings: 0,
        otherBookings: 0,
        paidBuyers: new Set(),
        bookingPeople: new Set(),
        rooms: new Map(),
        bookingTimes: new Map(),
        weekdays: new Map(),
      });
    }
    const item = catalog.get(key);
    if (type === "Event") item.type = "Event";
    item.labelCounts.set(label, (item.labelCounts.get(label) || 0) + 1);
    return item;
  };
  const addPersonEvent = (event) => {
    if (!eventsByCustomer.has(event.customerKey)) eventsByCustomer.set(event.customerKey, []);
    eventsByCustomer.get(event.customerKey).push(event);
  };

  for (const row of rows.filter((row) => row.totalPrice > 0.0001 && isActivityOrEventRow(row))) {
    const label = activityExplorerDisplayLabel(row.text);
    const key = activityNodeKey(label);
    if (!key) continue;
    const type = row.itemType === "event" ? "Event" : "Activity";
    const units = Math.max(1, Number(row.quantity) || 1);
    const event = {
      key,
      label,
      type,
      customerKey: row.customerKey,
      timestamp: row.date.getTime(),
      date: row.date,
      source: "paid",
      units,
      revenue: row.totalPrice,
    };
    const item = ensureItem(key, label, type);
    item.events.push(event);
    item.revenue += row.totalPrice;
    item.paidTickets += units;
    item.paidBuyers.add(row.customerKey);
    addPersonEvent(event);
  }

  for (const booking of bookings) {
    const label = activityExplorerDisplayLabel(booking.className);
    const key = activityNodeKey(label);
    if (!key) continue;
    const event = {
      key,
      label,
      type: "Activity",
      customerKey: booking.customerKey,
      timestamp: booking.startAt?.getTime?.() || booking.date.getTime(),
      date: booking.date,
      source: "booking",
      units: 1,
      revenue: 0,
      isMembershipBooking: booking.isMembershipBooking,
    };
    const item = ensureItem(key, label, "Activity");
    item.events.push(event);
    item.bookings += 1;
    if (booking.isMembershipBooking) item.membershipBookings += 1;
    else item.otherBookings += 1;
    item.bookingPeople.add(booking.customerKey);
    const room = cleanValue(booking.room);
    if (room) item.rooms.set(room, (item.rooms.get(room) || 0) + 1);
    const start = booking.startAt;
    if (start instanceof Date && !Number.isNaN(start.getTime())) {
      const timeLabel = `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`;
      item.bookingTimes.set(timeLabel, (item.bookingTimes.get(timeLabel) || 0) + 1);
      const weekdayLabel = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][start.getDay()];
      item.weekdays.set(weekdayLabel, (item.weekdays.get(weekdayLabel) || 0) + 1);
    }
    addPersonEvent(event);
  }

  for (const events of eventsByCustomer.values()) events.sort((a, b) => a.timestamp - b.timestamp || a.key.localeCompare(b.key));

  const items = Array.from(catalog.values()).map((item) => {
    const label = Array.from(item.labelCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || item.label;
    const selectedByCustomer = new Map();
    for (const event of item.events) {
      if (!selectedByCustomer.has(event.customerKey)) selectedByCustomer.set(event.customerKey, []);
      selectedByCustomer.get(event.customerKey).push(event);
    }
    const people = new Set(selectedByCustomer.keys());
    const related = new Map();
    const previous = new Map();
    const next = new Map();
    const daysToNext = [];
    let repeatPeople = 0;
    let paidOnlyPeople = 0;
    let bookingOnlyPeople = 0;
    let mixedPeople = 0;
    let subscribersAtSelection = 0;
    let subscribedLater = 0;
    let neverSubscribed = 0;
    let firstElementPeople = 0;
    let lastElementPeople = 0;
    let singleElementPeople = 0;
    let multiElementPeople = 0;
    let explorerPeople = 0;

    for (const [customerKey, selectedEvents] of selectedByCustomer.entries()) {
      selectedEvents.sort((a, b) => a.timestamp - b.timestamp || a.source.localeCompare(b.source));
      const allEvents = eventsByCustomer.get(customerKey) || [];
      const firstSelected = selectedEvents[0];
      const selectedUse = selectedEvents.reduce((total, event) => total + event.units, 0);
      if (selectedUse > 1) repeatPeople += 1;
      const hasPaid = selectedEvents.some((event) => event.source === "paid");
      const hasBooking = selectedEvents.some((event) => event.source === "booking");
      if (hasPaid && hasBooking) mixedPeople += 1;
      else if (hasPaid) paidOnlyPeople += 1;
      else bookingOnlyPeople += 1;

      const firstMembershipMs = firstMembershipByCustomer.get(customerKey);
      if (firstMembershipMs != null && firstMembershipMs <= firstSelected.timestamp) subscribersAtSelection += 1;
      else if (firstMembershipMs != null) subscribedLater += 1;
      else neverSubscribed += 1;

      const uniqueKeys = new Set(allEvents.map((event) => event.key));
      if (uniqueKeys.size <= 1) singleElementPeople += 1;
      else if (uniqueKeys.size <= 3) multiElementPeople += 1;
      else explorerPeople += 1;
      if (allEvents[0]?.key === item.key) firstElementPeople += 1;
      if (allEvents.at(-1)?.key === item.key) lastElementPeople += 1;

      const priorEvent = [...allEvents].reverse().find((event) => event.timestamp < firstSelected.timestamp && event.key !== item.key);
      const nextEvent = allEvents.find((event) => event.timestamp > firstSelected.timestamp && event.key !== item.key);
      if (priorEvent) addActivityExplorerRelation(previous, priorEvent, customerKey);
      if (nextEvent) {
        addActivityExplorerRelation(next, nextEvent, customerKey);
        daysToNext.push((nextEvent.timestamp - firstSelected.timestamp) / 86400000);
      }
      for (const otherKey of uniqueKeys) {
        if (otherKey === item.key) continue;
        const otherEvent = allEvents.find((event) => event.key === otherKey);
        if (otherEvent) addActivityExplorerRelation(related, otherEvent, customerKey);
      }
    }

    const totalPeople = people.size;
    const relationList = (map) => Array.from(map.values()).map((entry) => ({
      key: entry.key,
      label: entry.label,
      type: entry.type,
      people: entry.people.size,
      share: totalPeople ? entry.people.size / totalPeople : 0,
    })).sort((a, b) => b.people - a.people || a.label.localeCompare(b.label)).slice(0, 10);
    const rankedCounts = (map, limit = 5) => Array.from(map.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, limit);
    const sourceLabel = item.paidTickets > 0 && item.bookings > 0
      ? "Paid tickets + bookings"
      : item.paidTickets > 0 ? "Paid tickets" : "Bookings";
    return {
      key: item.key,
      label,
      type: item.type,
      sourceLabel,
      revenue: item.revenue,
      paidTickets: item.paidTickets,
      paidBuyerCount: item.paidBuyers.size,
      bookings: item.bookings,
      membershipBookings: item.membershipBookings,
      otherBookings: item.otherBookings,
      bookingPeopleCount: item.bookingPeople.size,
      totalRecordedUse: item.paidTickets + item.bookings,
      totalPeople,
      repeatPeople,
      repeatRate: totalPeople ? repeatPeople / totalPeople : 0,
      paidOnlyPeople,
      bookingOnlyPeople,
      mixedPeople,
      subscribersAtSelection,
      subscribedLater,
      neverSubscribed,
      knownSubscriberCount: Array.from(people).filter((customerKey) => membershipKeys.has(customerKey)).length,
      firstElementPeople,
      firstElementRate: totalPeople ? firstElementPeople / totalPeople : 0,
      lastElementPeople,
      lastElementRate: totalPeople ? lastElementPeople / totalPeople : 0,
      singleElementPeople,
      multiElementPeople,
      explorerPeople,
      medianDaysToNext: median(daysToNext),
      related: relationList(related),
      previous: relationList(previous),
      next: relationList(next),
      bookingTimes: rankedCounts(item.bookingTimes),
      weekdays: rankedCounts(item.weekdays, 7),
      rooms: rankedCounts(item.rooms),
    };
  }).sort((a, b) => a.label.localeCompare(b.label));

  const defaultItem = [...items].sort((a, b) => b.totalRecordedUse - a.totalRecordedUse || a.label.localeCompare(b.label))[0];
  return {
    items,
    defaultKey: defaultItem?.key || "",
    itemCount: items.length,
    maxUse: items.reduce((highest, item) => Math.max(highest, item.totalRecordedUse), 1),
  };
}

function addActivityExplorerRelation(map, event, customerKey) {
  if (!map.has(event.key)) {
    map.set(event.key, {
      key: event.key,
      label: event.label,
      type: event.type,
      people: new Set(),
    });
  }
  map.get(event.key).people.add(customerKey);
}

function activityExplorerDisplayLabel(value) {
  const label = cleanValue(value) || "Unknown activity";
  return label.replace(/\s*\((?=[^)]*(?:free\s+for|non[-\s]?members?|\b\d+[.,]?\d*\s*kr\b))[^)]*\)\s*$/i, "").trim() || label;
}

function groupCustomerSegments(rows, bookings = []) {
  const journeyRows = rows
    .filter((row) => row.totalPrice > 0.0001 || isCrewMembershipRow(row))
    .filter((row) => isActivityOrEventRow(row) || isMembershipSubscriptionRow(row) || isCrewMembershipRow(row))
    .sort((a, b) => a.date - b.date);
  const byCustomer = new Map();

  for (const row of journeyRows) {
    if (!byCustomer.has(row.customerKey)) {
      byCustomer.set(row.customerKey, {
        customerKey: row.customerKey,
        revenue: 0,
        ticketCount: 0,
        ticketWeeks: new Set(),
        ticketQuarters: new Set(),
        hasMembership: false,
        hasMembershipSale: false,
        hasCrew: false,
        bookingCount: 0,
        bookingWeeks: new Set(),
        firstDate: row.date,
        lastDate: row.date,
        items: new Map(),
        events: [],
      });
    }
    const customer = byCustomer.get(row.customerKey);
    customer.revenue += row.totalPrice;
    customer.firstDate = minDate(customer.firstDate, row.date);
    customer.lastDate = maxDate(customer.lastDate, row.date);
    if (isActivityOrEventRow(row)) {
      const quantity = row.quantity || 1;
      customer.ticketCount += quantity;
      customer.ticketWeeks.add(periodKey(row.date, "week"));
      customer.ticketQuarters.add(periodKey(row.date, "quarter"));
      customer.items.set(row.text, (customer.items.get(row.text) || 0) + quantity);
      customer.events.push("ticket");
    }
    if (isPaidMembershipRow(row)) {
      customer.hasMembership = true;
      customer.hasMembershipSale = true;
      customer.events.push("membership");
    }
    if (isCrewMembershipRow(row)) {
      customer.hasCrew = true;
      customer.events.push("crew");
    }
  }

  for (const booking of bookings.filter((item) => item.isMembershipBooking)) {
    if (!byCustomer.has(booking.customerKey)) {
      byCustomer.set(booking.customerKey, {
        customerKey: booking.customerKey,
        revenue: 0,
        ticketCount: 0,
        ticketWeeks: new Set(),
        ticketQuarters: new Set(),
        hasMembership: true,
        hasMembershipSale: false,
        hasCrew: false,
        bookingCount: 0,
        bookingWeeks: new Set(),
        firstDate: booking.date,
        lastDate: booking.date,
        items: new Map(),
        events: [],
      });
    }
    const customer = byCustomer.get(booking.customerKey);
    customer.hasMembership = true;
    customer.bookingCount += 1;
    customer.bookingWeeks.add(periodKey(booking.date, "week"));
    customer.firstDate = minDate(customer.firstDate, booking.date);
    customer.lastDate = maxDate(customer.lastDate, booking.date);
    customer.items.set(booking.className, (customer.items.get(booking.className) || 0) + 1);
    customer.events.push("booking");
  }

  const customers = Array.from(byCustomer.values()).filter((customer) => customer.revenue > 0 || customer.ticketCount > 0 || customer.bookingCount > 0 || customer.hasCrew);
  const positiveRevenue = customers.map((customer) => customer.revenue).filter((value) => value > 0).sort((a, b) => a - b);
  const highValueThreshold = positiveRevenue.length ? positiveRevenue[Math.floor(positiveRevenue.length * 0.9)] : Infinity;
  const segmentOrder = [
    "crew",
    "activeSubscribers",
    "lowUseSubscribers",
    "inactiveSubscribers",
    "bookingOnly",
    "highValue",
    "recurringTickets",
    "seasonalReturners",
    "oneTimers",
  ];
  const segmentLabels = {
    crew: "Crew",
    activeSubscribers: "High-use paid subscribers",
    lowUseSubscribers: "Low-use paid subscribers",
    inactiveSubscribers: "Paid subscribers with no booking",
    bookingOnly: "Bookings without matched subscription sale",
    highValue: "High-value supporters",
    recurringTickets: "Recurring ticket buyers",
    seasonalReturners: "Seasonal returners",
    oneTimers: "One-timers",
  };
  const segmentsByKey = new Map(segmentOrder.map((key) => [key, {
    key,
    label: segmentLabels[key],
    customers: [],
    revenue: 0,
    items: new Map(),
    patterns: new Map(),
  }]));

  for (const customer of customers) {
    const key = customerSegmentKey(customer, highValueThreshold);
    const segment = segmentsByKey.get(key);
    segment.customers.push(customer);
    segment.revenue += customer.revenue;
    const pattern = customerJourneyPattern(customer);
    segment.patterns.set(pattern, (segment.patterns.get(pattern) || 0) + 1);
    for (const [item, count] of customer.items.entries()) {
      segment.items.set(item, (segment.items.get(item) || 0) + count);
    }
  }

  const segments = segmentOrder.map((key) => {
    const segment = segmentsByKey.get(key);
    const count = segment.customers.length;
    return {
      key,
      label: segment.label,
      count,
      revenue: segment.revenue,
      avgRevenue: count ? segment.revenue / count : 0,
      avgTickets: count ? segment.customers.reduce((total, customer) => total + customer.ticketCount, 0) / count : 0,
      avgBookings: count ? segment.customers.reduce((total, customer) => total + customer.bookingCount, 0) / count : 0,
      favoriteActivities: Array.from(segment.items.entries())
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
        .slice(0, 3),
      typicalJourneys: Array.from(segment.patterns.entries())
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
        .slice(0, 2),
    };
  });

  return {
    segments,
    highValueThreshold,
    customerCount: customers.length,
    maxRevenue: Math.max(1, ...segments.map((segment) => segment.revenue)),
    maxCount: Math.max(1, ...segments.map((segment) => segment.count)),
  };
}

function customerSegmentKey(customer, highValueThreshold) {
  if (customer.hasCrew) return "crew";
  if (customer.hasMembershipSale && customer.bookingCount >= 4) return "activeSubscribers";
  if (customer.hasMembershipSale && customer.bookingCount > 0) return "lowUseSubscribers";
  if (customer.hasMembershipSale) return "inactiveSubscribers";
  if (customer.bookingCount > 0) return "bookingOnly";
  if (customer.revenue >= highValueThreshold && customer.revenue > 0) return "highValue";
  if (customer.ticketCount >= 5 || customer.ticketWeeks.size >= 3) return "recurringTickets";
  if (customer.ticketQuarters.size >= 2) return "seasonalReturners";
  return "oneTimers";
}

function customerJourneyPattern(customer) {
  const unique = [];
  for (const event of customer.events) {
    if (unique.at(-1) !== event) unique.push(event);
  }
  if (!unique.length) return "No ticket journey";
  return unique.slice(0, 4).map((event) => {
    if (event === "ticket") return "Ticket";
    if (event === "membership") return "Paid subscription";
    if (event === "booking") return "Subscription booking";
    return "Crew";
  }).join(" -> ");
}

function groupExitPoints(rows, bookings = []) {
  const journeyRows = rows
    .filter((row) => row.totalPrice > 0.0001 || isCrewMembershipRow(row))
    .filter((row) => isActivityOrEventRow(row) || isMembershipSubscriptionRow(row) || isCrewMembershipRow(row))
    .sort((a, b) => a.date - b.date);
  const byCustomer = new Map();

  for (const row of journeyRows) {
    if (!byCustomer.has(row.customerKey)) {
      byCustomer.set(row.customerKey, {
        customerKey: row.customerKey,
        label: row.realLabel,
        realLabel: row.realLabel,
        anonymousLabel: row.anonymousLabel,
        rows: [],
        revenue: 0,
      });
    }
    const customer = byCustomer.get(row.customerKey);
    customer.rows.push({ ...row, source: "sale" });
    customer.revenue += row.totalPrice;
  }

  for (const booking of bookings.filter((item) => item.isMembershipBooking)) {
    if (!byCustomer.has(booking.customerKey)) {
      byCustomer.set(booking.customerKey, {
        customerKey: booking.customerKey,
        label: booking.realLabel,
        realLabel: booking.realLabel,
        anonymousLabel: booking.anonymousLabel,
        rows: [],
        revenue: 0,
      });
    }
    byCustomer.get(booking.customerKey).rows.push({
      ...booking,
      source: "booking",
      totalPrice: 0,
    });
  }

  const exits = new Map();
  const typeTotals = new Map();
  for (const customer of byCustomer.values()) {
    customer.rows.sort((a, b) => a.date - b.date || (a.source === "sale" ? -1 : 1));
    const last = customer.rows.at(-1);
    if (!last) continue;
    const exit = exitPointForRow(last);
    if (!exits.has(exit.key)) {
      exits.set(exit.key, {
        ...exit,
        people: new Set(),
        revenue: 0,
        totalJourneyRevenue: 0,
        sampleCustomers: [],
      });
    }
    const entry = exits.get(exit.key);
    entry.people.add(customer.customerKey);
    entry.revenue += last.totalPrice;
    entry.totalJourneyRevenue += customer.revenue;
    if (entry.sampleCustomers.length < 5) {
      entry.sampleCustomers.push({
        customerKey: customer.customerKey,
        label: customer.label,
        realLabel: customer.realLabel,
        anonymousLabel: customer.anonymousLabel,
      });
    }

    if (!typeTotals.has(exit.type)) typeTotals.set(exit.type, { type: exit.type, people: new Set(), revenue: 0 });
    const type = typeTotals.get(exit.type);
    type.people.add(customer.customerKey);
    type.revenue += last.totalPrice;
  }

  const points = Array.from(exits.values()).map((entry) => ({
    ...entry,
    count: entry.people.size,
    people: undefined,
    avgJourneyRevenue: entry.people.size ? entry.totalJourneyRevenue / entry.people.size : 0,
  })).sort((a, b) => b.count - a.count || b.revenue - a.revenue || a.label.localeCompare(b.label));

  const types = Array.from(typeTotals.values()).map((entry) => ({
    type: entry.type,
    count: entry.people.size,
    revenue: entry.revenue,
  })).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));

  return {
    points,
    types,
    customerCount: byCustomer.size,
    maxCount: Math.max(1, ...points.map((point) => point.count)),
    maxRevenue: Math.max(1, ...points.map((point) => point.revenue)),
  };
}

function exitPointForRow(row) {
  if (row.source === "booking") {
    const key = activityNodeKey(row.className) || "unknown subscription booking";
    return { key: `booking:${key}`, label: row.className || "Unknown class", type: "Subscription booking" };
  }
  if (isCrewMembershipRow(row)) return { key: "__crew", label: "Crew membership", type: "Crew" };
  if (isPaidMembershipRow(row)) return { key: "__membership", label: "Membership", type: "Membership" };
  const key = activityNodeKey(row.text) || "unknown exit";
  return {
    key,
    label: cleanValue(row.text) || "Unknown exit",
    type: row.itemType === "event" ? "Event" : "Activity",
  };
}

function groupMembershipLength(rows, options = {}) {
  const defaultCoverageDays = 35;
  const continuousRenewalDays = 62;
  const rangeStartMs = Number(options.rangeStartMs) || null;
  const rangeEndMs = Number(options.rangeEndMs) || null;
  const timeBucket = options.timeBucket || "week";
  const bookingRows = (options.bookingRows || []).filter((booking) => booking.isMembershipBooking);
  const dataEndDate = [getLastRowDate(rows), ...bookingRows.map((booking) => booking.date)]
    .filter(Boolean)
    .sort((a, b) => a - b)
    .at(-1) || null;
  const paidMembershipRows = rows
    .filter(isPaidMembershipRow)
    .sort((a, b) => a.date - b.date);
  const rowsByCustomer = new Map();

  for (const row of paidMembershipRows) {
    if (!rowsByCustomer.has(row.customerKey)) rowsByCustomer.set(row.customerKey, []);
    rowsByCustomer.get(row.customerKey).push(row);
  }

  const spans = [];
  for (const [customerKey, customerRows] of rowsByCustomer.entries()) {
    const sortedRows = customerRows.sort((a, b) => a.date - b.date);
    let spanStart = sortedRows[0]?.date;
    let spanEnd = null;
    let paymentCount = 0;
    let revenue = 0;
    let typeCounts = new Map();

    for (let index = 0; index < sortedRows.length; index += 1) {
      const row = sortedRows[index];
      const nextDate = sortedRows[index + 1]?.date;
      const daysUntilNext = nextDate ? (nextDate - row.date) / 86400000 : Infinity;
      const coverageEndDate = nextDate && daysUntilNext <= continuousRenewalDays
        ? nextDate
        : addDays(row.date, defaultCoverageDays);
      const stillActive = !nextDate && dataEndDate && coverageEndDate >= dataEndDate;
      const type = membershipTypeInfo(row.text);

      paymentCount += 1;
      revenue += row.totalPrice;
      typeCounts.set(type.label, (typeCounts.get(type.label) || 0) + 1);
      spanEnd = stillActive ? dataEndDate : coverageEndDate;

      const spanBreaks = !nextDate || daysUntilNext > continuousRenewalDays;
      if (spanBreaks) {
        const days = Math.max(1, (spanEnd - spanStart) / 86400000);
        const primaryType = Array.from(typeCounts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "Membership";
        spans.push({
          customerKey,
          label: row.customerName || row.customerEmail || customerKey,
          startDate: spanStart,
          endDate: spanEnd,
          days,
          months: days / 30.4375,
          paymentCount,
          revenue,
          primaryType,
          active: stillActive,
        });
        spanStart = nextDate;
        paymentCount = 0;
        revenue = 0;
        typeCounts = new Map();
      }
    }
  }

  for (const span of spans) {
    const spanBookings = bookingRows.filter((booking) => (
      booking.customerKey === span.customerKey &&
      startOfHopDayMs(booking.date) >= startOfHopDayMs(span.startDate) &&
      startOfHopDayMs(booking.date) <= startOfHopDayMs(span.endDate)
    )).sort((a, b) => a.date - b.date);
    span.bookingCount = spanBookings.length;
    span.bookingPeriods = new Set(spanBookings.map((booking) => periodKey(booking.date, timeBucket))).size;
    span.lastBookingDate = spanBookings.at(-1)?.date || null;
    span.bookingsPerMonth = span.months ? span.bookingCount / span.months : 0;
  }

  const visibleSpans = membershipSpansInRange(spans, rangeStartMs, rangeEndMs);
  const buckets = membershipLengthBuckets(visibleSpans);
  const distribution = membershipDistributionTimeline(spans, rangeStartMs, rangeEndMs, timeBucket, dataEndDate, bookingRows);
  const activeSpans = visibleSpans.filter((span) => span.active);
  const endedSpans = visibleSpans.filter((span) => !span.active);
  const avgMonths = visibleSpans.length ? visibleSpans.reduce((total, span) => total + span.months, 0) / visibleSpans.length : 0;
  const medianMonths = median(visibleSpans.map((span) => span.months));
  const types = membershipLengthTypes(visibleSpans);

  return {
    spans: visibleSpans.sort((a, b) => b.months - a.months),
    buckets,
    distribution,
    types,
    spanCount: visibleSpans.length,
    activeCount: activeSpans.length,
    endedCount: endedSpans.length,
    avgMonths,
    medianMonths,
    bookingCount: visibleSpans.reduce((total, span) => total + (span.bookingCount || 0), 0),
    noBookingCount: visibleSpans.filter((span) => !span.bookingCount).length,
    avgBookingsPerSpan: visibleSpans.length ? visibleSpans.reduce((total, span) => total + (span.bookingCount || 0), 0) / visibleSpans.length : 0,
    maxBucketCount: Math.max(1, ...buckets.map((bucket) => bucket.total)),
    maxTypeCount: Math.max(1, ...types.map((type) => type.count)),
  };
}

function membershipDistributionTimeline(spans, rangeStartMs, rangeEndMs, timeBucket, dataEndDate, bookings = []) {
  if (!rangeStartMs || !rangeEndMs || rangeEndMs < rangeStartMs) return { months: [], buckets: membershipDistributionBuckets(), maxTotal: 1 };
  const buckets = membershipDistributionBuckets();
  const months = [];
  let cursor = dateFromPeriodKey(periodKey(new Date(rangeStartMs), timeBucket), timeBucket);

  while (cursor.getTime() <= rangeEndMs) {
    const key = periodKey(cursor, timeBucket);
    const snapshot = periodSnapshotDate(key, timeBucket, dataEndDate);
    const snapshotMs = Math.min(snapshot.getTime(), rangeEndMs);
    const periodStart = startOfHopDayMs(cursor);
    const periodEnd = Math.min(periodEndMsForKey(key, timeBucket), rangeEndMs);
    const bookingKeys = new Set(bookings
      .filter((booking) => {
        const time = startOfHopDayMs(booking.date);
        return time >= periodStart && time <= periodEnd;
      })
      .map((booking) => booking.customerKey));
    const entry = { month: key, total: 0, bookedMembers: 0, noBookingMembers: 0 };
    for (const bucket of buckets) entry[bucket.key] = 0;

    for (const span of spans) {
      if (startOfHopDayMs(span.startDate) > snapshotMs || startOfHopDayMs(span.endDate) < snapshotMs) continue;
      const monthsActive = Math.max(0, (snapshotMs - span.startDate) / 86400000 / 30.4375);
      const bucket = buckets.find((item) => monthsActive > item.min && monthsActive <= item.max) || buckets.at(0);
      entry[bucket.key] += 1;
      entry.total += 1;
      if (bookingKeys.has(span.customerKey)) entry.bookedMembers += 1;
      else entry.noBookingMembers += 1;
    }

    months.push(entry);
    cursor = addPeriods(cursor, 1, timeBucket);
  }

  return {
    months,
    buckets,
    maxTotal: Math.max(1, ...months.map((month) => month.total)),
  };
}

function membershipDistributionBuckets() {
  return [
    { key: "m1", label: "1m", min: -Infinity, max: 1 },
    { key: "m2", label: "2m", min: 1, max: 2 },
    { key: "m5", label: "5m", min: 2, max: 5 },
    { key: "m7", label: "7m", min: 5, max: 7 },
    { key: "m10", label: "10m", min: 7, max: 10 },
    { key: "m14", label: "14m", min: 10, max: 14 },
    { key: "m22", label: "22m", min: 14, max: 22 },
    { key: "m22plus", label: "22m+", min: 22, max: Infinity },
  ];
}

function periodEndMsForKey(key, timeBucket) {
  const start = dateFromPeriodKey(key, timeBucket);
  const end = addPeriods(start, 1, timeBucket);
  return end.getTime() - 1;
}

function membershipSpansInRange(spans, rangeStartMs, rangeEndMs) {
  if (!rangeStartMs || !rangeEndMs) return spans;
  return spans
    .filter((span) => startOfHopDayMs(span.startDate) <= rangeEndMs && startOfHopDayMs(span.endDate) >= rangeStartMs)
    .map((span) => {
      const measurementDate = new Date(Math.min(startOfHopDayMs(span.endDate), rangeEndMs));
      const daysAtSlice = Math.max(1, (measurementDate - span.startDate) / 86400000);
      return {
        ...span,
        visibleInRange: true,
        measurementDate,
        days: daysAtSlice,
        months: daysAtSlice / 30.4375,
      };
    });
}

function membershipLengthBuckets(spans) {
  const buckets = [
    { key: "0-1", label: "<1 mo", min: 0, max: 1 },
    { key: "1-3", label: "1-3 mo", min: 1, max: 3 },
    { key: "3-6", label: "3-6 mo", min: 3, max: 6 },
    { key: "6-12", label: "6-12 mo", min: 6, max: 12 },
    { key: "12-24", label: "1-2 yr", min: 12, max: 24 },
    { key: "24+", label: "2+ yr", min: 24, max: Infinity },
  ].map((bucket) => ({ ...bucket, total: 0, active: 0, ended: 0, bookings: 0, noBooking: 0 }));

  for (const span of spans) {
    const bucket = buckets.find((item) => span.months >= item.min && span.months < item.max) || buckets.at(-1);
    bucket.total += 1;
    if (span.active) bucket.active += 1;
    else bucket.ended += 1;
    bucket.bookings += span.bookingCount || 0;
    if (!span.bookingCount) bucket.noBooking += 1;
  }
  return buckets;
}

function membershipLengthTypes(spans) {
  const byType = new Map();
  for (const span of spans) {
    if (!byType.has(span.primaryType)) byType.set(span.primaryType, { label: span.primaryType, count: 0, months: 0, active: 0, bookings: 0, noBooking: 0 });
    const entry = byType.get(span.primaryType);
    entry.count += 1;
    entry.months += span.months;
    if (span.active) entry.active += 1;
    entry.bookings += span.bookingCount || 0;
    if (!span.bookingCount) entry.noBooking += 1;
  }
  return Array.from(byType.values()).map((entry) => ({
    ...entry,
    avgMonths: entry.count ? entry.months / entry.count : 0,
  })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function groupUserNetwork(rows, bookings = []) {
  const ticketRows = rows
    .filter((row) => row.itemType === "class_pass_type" || row.itemType === "event")
    .sort((a, b) => a.date - b.date);
  const usersByKey = new Map();
  const buyersByActivity = new Map();

  for (const row of ticketRows) {
    if (!usersByKey.has(row.customerKey)) {
      usersByKey.set(row.customerKey, {
        key: row.customerKey,
        label: row.realLabel,
        realLabel: row.realLabel,
        anonymousLabel: row.anonymousLabel,
        revenue: 0,
        tickets: 0,
        activities: new Set(),
        events: new Set(),
        memberBookings: 0,
      });
    }
    const user = usersByKey.get(row.customerKey);
    const activityKey = activityNodeKey(row.text);
    const quantity = row.quantity || 1;
    user.revenue += row.totalPrice;
    user.tickets += quantity;
    if (row.itemType === "event") user.events.add(activityKey);
    else user.activities.add(activityKey);

    if (!buyersByActivity.has(activityKey)) buyersByActivity.set(activityKey, new Set());
    buyersByActivity.get(activityKey).add(row.customerKey);
  }

  for (const booking of bookings.filter((item) => item.isMembershipBooking)) {
    if (!usersByKey.has(booking.customerKey)) {
      usersByKey.set(booking.customerKey, {
        key: booking.customerKey,
        label: booking.realLabel,
        realLabel: booking.realLabel,
        anonymousLabel: booking.anonymousLabel,
        revenue: 0,
        tickets: 0,
        activities: new Set(),
        events: new Set(),
        memberBookings: 0,
      });
    }
    const user = usersByKey.get(booking.customerKey);
    const activityKey = activityNodeKey(booking.className);
    user.memberBookings += 1;
    user.activities.add(activityKey);
    if (!buyersByActivity.has(activityKey)) buyersByActivity.set(activityKey, new Set());
    buyersByActivity.get(activityKey).add(booking.customerKey);
  }

  const linksByKey = new Map();
  for (const buyers of buyersByActivity.values()) {
    const keys = Array.from(buyers).sort();
    for (let a = 0; a < keys.length; a += 1) {
      for (let b = a + 1; b < keys.length; b += 1) {
        const linkKey = `${keys[a]}::${keys[b]}`;
        if (!linksByKey.has(linkKey)) linksByKey.set(linkKey, { source: keys[a], target: keys[b], weight: 0 });
        linksByKey.get(linkKey).weight += 1;
      }
    }
  }

  const nodes = Array.from(usersByKey.values()).map((user) => ({
    ...user,
    activityCount: user.activities.size,
    eventCount: user.events.size,
    avgExperience: user.activities.size + user.events.size,
    totalInteractions: user.tickets + user.memberBookings,
    type: user.activities.size + user.events.size > 3 ? "Recurring" : "Occasional",
  })).sort((a, b) => b.totalInteractions - a.totalInteractions);

  const nodeKeys = new Set(nodes.map((node) => node.key));
  const links = Array.from(linksByKey.values())
    .filter((link) => nodeKeys.has(link.source) && nodeKeys.has(link.target))
    .sort((a, b) => b.weight - a.weight);

  return {
    nodes,
    links,
    maxRevenue: Math.max(1, ...nodes.map((node) => node.revenue)),
    maxTickets: Math.max(1, ...nodes.map((node) => node.tickets)),
    maxExperience: Math.max(1, ...nodes.map((node) => node.avgExperience)),
    maxInteractions: Math.max(1, ...nodes.map((node) => node.totalInteractions)),
  };
}

function groupBuyerPatterns(rows, timeBucket, bookings = []) {
  const journeyRows = rows.filter((row) => row.itemType === "class_pass_type" || row.itemType === "event" || isMembershipSubscriptionRow(row) || isCrewMembershipRow(row));
  const byCustomer = new Map();

  for (const row of journeyRows) {
    if (!byCustomer.has(row.customerKey)) {
      byCustomer.set(row.customerKey, {
        customerKey: row.customerKey,
        label: row.realLabel,
        realLabel: row.realLabel,
        anonymousLabel: row.anonymousLabel,
        firstDate: row.date,
        lastDate: row.date,
        firstTouchpointDate: row.date,
        firstTouchpointType: "unknown",
        firstTouchpointLabel: "Unknown",
        firstTouchpointText: "",
        lastTouchpointDate: row.date,
        lastTouchpointType: "unknown",
        lastTouchpointLabel: "Unknown",
        lastTouchpointText: "",
        events: [],
      });
    }
    const buyer = byCustomer.get(row.customerKey);
    if (row.date <= buyer.firstDate) {
      const touchpoint = paidTouchpointInfo(row);
      buyer.firstTouchpointDate = row.date;
      buyer.firstTouchpointType = touchpoint.type;
      buyer.firstTouchpointLabel = touchpoint.label;
      buyer.firstTouchpointText = touchpoint.text;
    }
    if (row.date >= buyer.lastDate) {
      const touchpoint = paidTouchpointInfo(row);
      buyer.lastTouchpointDate = row.date;
      buyer.lastTouchpointType = touchpoint.type;
      buyer.lastTouchpointLabel = touchpoint.label;
      buyer.lastTouchpointText = touchpoint.text;
    }
    buyer.firstDate = minDate(buyer.firstDate, row.date);
    buyer.lastDate = maxDate(buyer.lastDate, row.date);
    const isCrew = isCrewMembershipRow(row);
    buyer.events.push({
      date: row.date,
      kind: isCrew ? "crew" : isMembershipSubscriptionRow(row) ? "membership" : "ticket",
      item: row.text || row.itemType,
      revenue: row.totalPrice,
      tickets: row.itemType === "class_pass_type" || row.itemType === "event" ? row.quantity || 1 : 0,
    });
  }

  for (const booking of bookings.filter((item) => item.isMembershipBooking)) {
    if (!byCustomer.has(booking.customerKey)) {
      byCustomer.set(booking.customerKey, {
        customerKey: booking.customerKey,
        label: booking.realLabel,
        realLabel: booking.realLabel,
        anonymousLabel: booking.anonymousLabel,
        firstDate: booking.date,
        lastDate: booking.date,
        firstTouchpointDate: booking.date,
        firstTouchpointType: "booking",
        firstTouchpointLabel: "Subscription booking",
        firstTouchpointText: booking.className,
        lastTouchpointDate: booking.date,
        lastTouchpointType: "booking",
        lastTouchpointLabel: "Subscription booking",
        lastTouchpointText: booking.className,
        events: [],
      });
    }
    const buyer = byCustomer.get(booking.customerKey);
    if (booking.date <= buyer.firstTouchpointDate) {
      buyer.firstTouchpointDate = booking.date;
      buyer.firstTouchpointType = "booking";
      buyer.firstTouchpointLabel = "Subscription booking";
      buyer.firstTouchpointText = booking.className;
    }
    buyer.firstDate = minDate(buyer.firstDate, booking.date);
    buyer.lastDate = maxDate(buyer.lastDate, booking.date);
    if (booking.date >= buyer.lastTouchpointDate) {
      buyer.lastTouchpointDate = booking.date;
      buyer.lastTouchpointType = "booking";
      buyer.lastTouchpointLabel = "Subscription booking";
      buyer.lastTouchpointText = booking.className;
    }
    buyer.events.push({
      date: booking.date,
      kind: "booking",
      item: booking.className,
      revenue: 0,
      tickets: 0,
      bookings: 1,
    });
  }

  const journeys = Array.from(byCustomer.values()).map((buyer) => {
    const periods = new Map();
    for (const event of buyer.events) {
      const offset = journeyOffset(buyer.firstDate, event.date, timeBucket);
      if (!periods.has(offset)) {
        periods.set(offset, { offset, tickets: 0, bookings: 0, revenue: 0, hasTicket: false, hasMembership: false, hasCrew: false, hasBooking: false, items: new Map() });
      }
      const period = periods.get(offset);
      period.tickets += event.tickets;
      period.bookings += event.bookings || 0;
      period.revenue += event.revenue;
      if (event.item) period.items.set(event.item, (period.items.get(event.item) || 0) + 1);
      if (event.kind === "ticket") period.hasTicket = true;
      if (event.kind === "membership") period.hasMembership = true;
      if (event.kind === "crew") period.hasCrew = true;
      if (event.kind === "booking") period.hasBooking = true;
    }
    const sortedPeriods = Array.from(periods.values()).map((period) => ({
      ...period,
      items: Array.from(period.items.entries())
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    })).sort((a, b) => a.offset - b.offset);
    const firstMembership = sortedPeriods.find((period) => period.hasMembership)?.offset ?? null;
    const firstCrew = sortedPeriods.find((period) => period.hasCrew)?.offset ?? null;
    const ticketBeforeMembership = firstMembership !== null && sortedPeriods.some((period) => period.hasTicket && period.offset < firstMembership);
    const ticketAfterMembership = firstMembership !== null && sortedPeriods.some((period) => period.hasTicket && period.offset > firstMembership);
    const hasTicket = sortedPeriods.some((period) => period.hasTicket);
    const hasBooking = sortedPeriods.some((period) => period.hasBooking);
    return {
      ...buyer,
      periods: sortedPeriods,
      totalTickets: sortedPeriods.reduce((total, period) => total + period.tickets, 0),
      totalBookings: sortedPeriods.reduce((total, period) => total + period.bookings, 0),
      revenue: sortedPeriods.reduce((total, period) => total + period.revenue, 0),
      span: sortedPeriods.at(-1)?.offset || 0,
      firstMembership,
      firstCrew,
      pattern: firstMembership === null && firstCrew !== null
        ? hasTicket ? "Crew plus tickets" : "Crew only"
        : firstMembership !== null && firstCrew !== null
          ? firstCrew < firstMembership ? "Crew to membership" : "Membership plus crew"
          : firstMembership === null
        ? hasTicket && hasBooking ? "Tickets plus subscription bookings" : hasTicket ? "Ticket only" : "Booking only"
        : ticketBeforeMembership
          ? hasBooking ? "Ticket to membership to booking" : "Ticket to membership"
          : ticketAfterMembership
            ? "Membership plus tickets"
            : hasBooking ? "Membership with bookings" : "Membership no bookings",
    };
  }).sort((a, b) => b.revenue - a.revenue || b.span - a.span);

  return {
    journeys,
    summary: {
      total: journeys.length,
      ticketOnly: journeys.filter((journey) => journey.pattern === "Ticket only").length,
      ticketToMembership: journeys.filter((journey) => journey.pattern === "Ticket to membership").length,
      membershipOnly: journeys.filter((journey) => journey.pattern === "Membership no bookings").length,
      membershipWithBookings: journeys.filter((journey) => journey.pattern.includes("booking")).length,
      crew: journeys.filter((journey) => journey.pattern.includes("Crew")).length,
    },
  };
}

function groupRetention(rows, timeBucket, options = {}) {
  const activeRows = rows
    .filter((row) => row.totalPrice > 0.0001)
    .filter((row) => row.itemType === "class_pass_type" || row.itemType === "event" || (isMembershipSubscriptionRow(row) && !isCrewMembershipRow(row)))
    .sort((a, b) => a.date - b.date);
  const byCustomer = new Map();
  const bookingRows = (options.bookingRows || []).filter((booking) => booking.isMembershipBooking);
  const bookingEndDate = bookingRows.reduce((latest, booking) => maxDate(latest, booking.date), null);
  const dataEndDate = maxDate(getLastRowDate(activeRows), bookingEndDate);
  const rangeStartMs = Number(options.rangeStartMs) || null;
  const rangeEndMs = Number(options.rangeEndMs) || null;

  for (const row of activeRows) {
    if (!byCustomer.has(row.customerKey)) {
      byCustomer.set(row.customerKey, {
        customerKey: row.customerKey,
        firstDate: row.date,
        rows: [],
        bookings: [],
      });
    }
    const customer = byCustomer.get(row.customerKey);
    customer.firstDate = minDate(customer.firstDate, row.date);
    customer.rows.push(row);
  }

  for (const booking of bookingRows) {
    const customer = byCustomer.get(booking.customerKey);
    if (customer && booking.date >= customer.firstDate) customer.bookings.push(booking);
  }

  const cohorts = new Map();
  let maxOffset = 0;
  for (const customer of byCustomer.values()) {
    const firstTime = startOfHopDayMs(customer.firstDate);
    if (rangeStartMs && firstTime < rangeStartMs) continue;
    if (rangeEndMs && firstTime > rangeEndMs) continue;
    const cohortKey = periodKey(customer.firstDate, timeBucket);
    if (!cohorts.has(cohortKey)) {
      cohorts.set(cohortKey, {
        period: cohortKey,
        customers: new Set(),
        offsets: new Map(),
      });
    }
    const cohort = cohorts.get(cohortKey);
    cohort.customers.add(customer.customerKey);

    const seenOffsets = new Set();
    for (const row of customer.rows) {
      const offset = journeyOffset(customer.firstDate, row.date, timeBucket);
      maxOffset = Math.max(maxOffset, offset);
      if (!cohort.offsets.has(offset)) {
        cohort.offsets.set(offset, { customers: new Set(), purchaseCustomers: new Set(), bookingCustomers: new Set(), revenue: 0 });
      }
      const cell = cohort.offsets.get(offset);
      cell.revenue += row.totalPrice;
      cell.customers.add(customer.customerKey);
      cell.purchaseCustomers.add(customer.customerKey);
      seenOffsets.add(offset);
    }

    for (const booking of customer.bookings) {
      const offset = journeyOffset(customer.firstDate, booking.date, timeBucket);
      maxOffset = Math.max(maxOffset, offset);
      if (!cohort.offsets.has(offset)) {
        cohort.offsets.set(offset, { customers: new Set(), purchaseCustomers: new Set(), bookingCustomers: new Set(), revenue: 0 });
      }
      const cell = cohort.offsets.get(offset);
      cell.customers.add(customer.customerKey);
      cell.bookingCustomers.add(customer.customerKey);
      seenOffsets.add(offset);
    }

    if (!seenOffsets.has(0)) {
      if (!cohort.offsets.has(0)) cohort.offsets.set(0, { customers: new Set(), purchaseCustomers: new Set(), bookingCustomers: new Set(), revenue: 0 });
      cohort.offsets.get(0).customers.add(customer.customerKey);
    }
  }

  const rowsOut = Array.from(cohorts.values()).sort((a, b) => a.period.localeCompare(b.period)).map((cohort) => {
    const size = cohort.customers.size;
    const cohortStartDate = dateFromPeriodKey(cohort.period, timeBucket);
    const cells = [];
    for (let offset = 0; offset <= maxOffset; offset += 1) {
      const cell = cohort.offsets.get(offset);
      const retained = cell?.customers.size || 0;
      const purchased = cell?.purchaseCustomers.size || 0;
      const booked = cell?.bookingCustomers.size || 0;
      const periodDate = addPeriods(cohortStartDate, offset, timeBucket);
      const possible = isRetentionOffsetPossible(cohortStartDate, offset, dataEndDate, timeBucket);
      const outOfScope = possible && rangeEndMs ? startOfHopDayMs(periodDate) > rangeEndMs : false;
      cells.push({
        offset,
        possible,
        outOfScope,
        retained,
        purchased,
        booked,
        revenue: cell?.revenue || 0,
        rate: possible && size ? retained / size : 0,
        purchaseRate: possible && size ? purchased / size : 0,
        bookingRate: possible && size ? booked / size : 0,
      });
    }
    return {
      period: cohort.period,
      size,
      cells,
    };
  });

  return {
    cohorts: rowsOut,
    maxOffset,
    customerCount: rowsOut.reduce((sum, cohort) => sum + cohort.size, 0),
  };
}

function groupActivityPath(rows, options = {}) {
  const mode = options.mode === "range" ? "range" : "ever";
  const sourceMode = ["purchase", "subscription", "combined"].includes(options.sourceMode) ? options.sourceMode : "combined";
  const rangeStartMs = Number(options.rangeStartMs) || null;
  const rangeEndMs = Number(options.rangeEndMs) || null;
  const bookingRows = (options.bookingRows || []).filter((booking) => booking.isMembershipBooking);
  const byCustomer = new Map();
  const subscriberKeys = new Set(rows.filter(isPaidMembershipRow).map((row) => row.customerKey));

  for (const row of rows.filter((item) => item.totalPrice > 0.0001)) {
    if (!isActivityOrEventRow(row) && !isPaidMembershipRow(row)) continue;
    if (!byCustomer.has(row.customerKey)) byCustomer.set(row.customerKey, []);
    byCustomer.get(row.customerKey).push({
      customerKey: row.customerKey,
      date: row.date,
      timestamp: row.date.getTime(),
      key: isPaidMembershipRow(row) ? "__membership" : activityNodeKey(row.text) || "unknown activity",
      label: isPaidMembershipRow(row) ? "Subscription started" : cleanValue(row.text) || "Unknown activity",
      type: isPaidMembershipRow(row) ? "Membership" : row.itemType === "event" ? "Event" : "Activity",
      kind: isPaidMembershipRow(row) ? "membership" : "purchase",
      revenue: row.totalPrice,
    });
  }
  for (const booking of bookingRows) {
    if (!byCustomer.has(booking.customerKey)) byCustomer.set(booking.customerKey, []);
    byCustomer.get(booking.customerKey).push({
      customerKey: booking.customerKey,
      date: booking.date,
      timestamp: booking.startAt?.getTime?.() || booking.date.getTime(),
      key: `booking:${activityNodeKey(booking.className) || "unknown class"}`,
      label: booking.className || "Unknown class",
      type: "Subscription booking",
      kind: "booking",
      revenue: 0,
    });
  }

  const rowsByFirst = new Map();
  const columnsByKey = new Map();
  let customerCount = 0;
  const sourceKinds = sourceMode === "purchase" ? new Set(["purchase"]) : sourceMode === "subscription" ? new Set(["booking"]) : new Set(["purchase", "booking"]);
  const targetKinds = sourceMode === "purchase" ? new Set(["purchase", "membership"]) : sourceMode === "subscription" ? new Set(["booking"]) : new Set(["purchase", "membership", "booking"]);

  for (const customerEvents of byCustomer.values()) {
    const sortedEvents = customerEvents.sort((a, b) => a.timestamp - b.timestamp || a.kind.localeCompare(b.kind));
    const candidateEvents = sortedEvents.filter((event) => sourceKinds.has(event.kind));
    const first = mode === "range"
      ? candidateEvents.find((event) => isRowInActivityPathRange(event, rangeStartMs, rangeEndMs))
      : candidateEvents[0];
    if (!first) continue;
    if (mode === "ever" && !isRowInActivityPathRange(first, rangeStartMs, rangeEndMs)) continue;
    customerCount += 1;

    if (!rowsByFirst.has(first.key)) {
      rowsByFirst.set(first.key, {
        key: first.key,
        label: first.label,
        type: first.type,
        people: new Set(),
        targets: new Map(),
      });
    }
    const source = rowsByFirst.get(first.key);
    source.people.add(first.customerKey);

    const next = sortedEvents.find((event) => event.timestamp > first.timestamp && targetKinds.has(event.kind));
    const target = next || { key: "__no_return", label: sourceMode === "subscription" ? "No further booking" : "No return", type: "No return", revenue: 0 };
    if (!source.targets.has(target.key)) {
      source.targets.set(target.key, {
        key: target.key,
        label: target.label,
        type: target.type,
        people: new Set(),
        revenue: 0,
        totalDays: 0,
      });
    }
    const cell = source.targets.get(target.key);
    cell.people.add(first.customerKey);
    cell.revenue += target.revenue || 0;
    if (next) cell.totalDays += Math.max(0, (next.timestamp - first.timestamp) / 86400000);

    if (!columnsByKey.has(target.key)) {
      columnsByKey.set(target.key, {
        key: target.key,
        label: target.label,
        type: target.type,
        people: new Set(),
        count: 0,
      });
    }
    const column = columnsByKey.get(target.key);
    column.people.add(first.customerKey);
    column.count += 1;
  }

  const pathRows = Array.from(rowsByFirst.values()).map((row) => {
    const size = row.people.size;
    const targets = Array.from(row.targets.values()).map((target) => ({
      key: target.key,
      label: target.label,
      type: target.type,
      count: target.people.size,
      rate: size ? target.people.size / size : 0,
      revenue: target.revenue,
      avgDaysToNext: target.people.size && target.key !== "__no_return" ? target.totalDays / target.people.size : null,
    })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    return {
      key: row.key,
      label: row.label,
      type: row.type,
      size,
      targets,
    };
  }).sort((a, b) => b.size - a.size || a.label.localeCompare(b.label));

  const columns = Array.from(columnsByKey.values()).map((column) => ({
    key: column.key,
    label: column.label,
    type: column.type,
    count: column.count,
  })).sort((a, b) => {
    const specialA = a.key.startsWith("__") ? 1 : 0;
    const specialB = b.key.startsWith("__") ? 1 : 0;
    return specialA - specialB || b.count - a.count || a.label.localeCompare(b.label);
  });

  return {
    rows: pathRows,
    columns,
    customerCount,
    maxCount: Math.max(1, ...pathRows.flatMap((row) => row.targets.map((target) => target.count))),
    mode,
    sourceMode,
    subscribersWithoutBookings: Array.from(subscriberKeys).filter((key) => !bookingRows.some((booking) => booking.customerKey === key)).length,
  };
}

function isRowInActivityPathRange(row, rangeStartMs, rangeEndMs) {
  if (!rangeStartMs || !rangeEndMs) return true;
  const time = startOfHopDayMs(row.date);
  return time >= rangeStartMs && time <= rangeEndMs;
}

function groupIntroConversion(rows, bookings, options = {}) {
  const rangeStartMs = Number(options.rangeStartMs) || null;
  const rangeEndMs = Number(options.rangeEndMs) || null;
  const windows = [7, 30, 60, 90];
  const primaryWindowDays = 90;
  const dayMs = 86400000;
  const eventsByCustomer = new Map();
  const salesByCustomer = new Map();
  const firstMembershipRowByCustomer = new Map();

  for (const row of rows.filter(isPaidMembershipRow).sort((a, b) => a.date - b.date)) {
    if (!firstMembershipRowByCustomer.has(row.customerKey)) firstMembershipRowByCustomer.set(row.customerKey, row);
  }

  for (const row of rows) {
    if (!salesByCustomer.has(row.customerKey)) salesByCustomer.set(row.customerKey, []);
    salesByCustomer.get(row.customerKey).push(row);
    if (!(row.totalPrice > 0.0001)) continue;

    let event = null;
    if (isActivityOrEventRow(row)) {
      event = {
        timestamp: row.date.getTime(),
        outcomeKey: "paidClass",
        outcomeLabel: row.itemType === "event" ? "Paid event" : "Paid class",
        destinationLabel: cleanValue(row.text) || (row.itemType === "event" ? "Paid event" : "Paid class"),
      };
    } else if (isPaidMembershipRow(row) && firstMembershipRowByCustomer.get(row.customerKey) === row) {
      event = {
        timestamp: row.date.getTime(),
        outcomeKey: "subscription",
        outcomeLabel: "Started subscription",
        destinationLabel: "Started subscription",
      };
    }
    if (!event) continue;
    if (!eventsByCustomer.has(row.customerKey)) eventsByCustomer.set(row.customerKey, []);
    eventsByCustomer.get(row.customerKey).push(event);
  }

  const introSourcesByType = new Map(introConversionDefinitions().map((definition) => [definition.key, new Map()]));
  for (const booking of bookings) {
    const intro = introClassInfo(booking.className);
    const timestamp = booking.startAt?.getTime?.() || booking.date.getTime();
    const event = intro
      ? {
        timestamp,
        outcomeKey: "anotherIntro",
        outcomeLabel: "Another free introduction",
        destinationLabel: intro.label,
      }
      : booking.isMembershipBooking
        ? {
          timestamp,
          outcomeKey: "subscriptionBooking",
          outcomeLabel: "Subscription booking",
          destinationLabel: booking.className || "Unknown class",
        }
        : {
          timestamp,
          outcomeKey: "otherBooking",
          outcomeLabel: "Other booking",
          destinationLabel: booking.className || "Unknown class",
        };
    if (!eventsByCustomer.has(booking.customerKey)) eventsByCustomer.set(booking.customerKey, []);
    eventsByCustomer.get(booking.customerKey).push(event);

    if (!intro || !isRowInActivityPathRange(booking, rangeStartMs, rangeEndMs)) continue;
    const sourceByCustomer = introSourcesByType.get(intro.key);
    const existing = sourceByCustomer.get(booking.customerKey);
    if (!existing || timestamp < existing.timestamp) {
      sourceByCustomer.set(booking.customerKey, {
        customerKey: booking.customerKey,
        timestamp,
        date: booking.date,
        matchMethod: booking.matchMethod,
      });
    }
  }

  for (const events of eventsByCustomer.values()) events.sort((a, b) => a.timestamp - b.timestamp);
  for (const customerRows of salesByCustomer.values()) customerRows.sort((a, b) => a.date - b.date);

  const salesEndMs = rows.reduce((latest, row) => Math.max(latest, row.date?.getTime?.() || 0), 0);
  const bookingEndMs = bookings.reduce((latest, booking) => Math.max(
    latest,
    booking.endAt?.getTime?.() || booking.startAt?.getTime?.() || booking.date?.getTime?.() || 0,
  ), 0);
  const dataEndMs = Math.max(salesEndMs, bookingEndMs);
  const uniquePeople = new Set();
  const cohorts = introConversionDefinitions().map((definition) => {
    const sources = Array.from(introSourcesByType.get(definition.key).values());
    for (const source of sources) uniquePeople.add(source.customerKey);
    const journeys = sources.map((source) => {
      const events = eventsByCustomer.get(source.customerKey) || [];
      const nextEvents = events.filter((event) => event.timestamp > source.timestamp);
      const next = nextEvents[0] || null;
      const daysToNext = next ? (next.timestamp - source.timestamp) / dayMs : null;
      const revenue90 = (salesByCustomer.get(source.customerKey) || [])
        .filter((row) => row.date.getTime() > source.timestamp && row.date.getTime() <= source.timestamp + primaryWindowDays * dayMs)
        .reduce((total, row) => total + row.totalPrice, 0);
      return {
        ...source,
        next,
        daysToNext,
        revenue90,
      };
    });

    const windowRates = windows.map((days) => {
      const eligibleJourneys = journeys.filter((journey) => journey.timestamp + days * dayMs <= dataEndMs);
      const continued = eligibleJourneys.filter((journey) => journey.next && journey.daysToNext <= days).length;
      return {
        days,
        eligible: eligibleJourneys.length,
        continued,
        rate: eligibleJourneys.length ? continued / eligibleJourneys.length : 0,
      };
    });
    const eligibleJourneys = journeys.filter((journey) => journey.timestamp + primaryWindowDays * dayMs <= dataEndMs);
    const continuedJourneys = eligibleJourneys.filter((journey) => journey.next && journey.daysToNext <= primaryWindowDays);
    const outcomeKeys = ["paidClass", "subscription", "subscriptionBooking", "otherBooking", "anotherIntro"];
    const outcomes = outcomeKeys.map((key) => {
      const count = continuedJourneys.filter((journey) => journey.next.outcomeKey === key).length;
      return {
        key,
        label: introOutcomeLabel(key),
        count,
        rate: eligibleJourneys.length ? count / eligibleJourneys.length : 0,
      };
    });
    const noReturnCount = Math.max(0, eligibleJourneys.length - continuedJourneys.length);
    outcomes.push({
      key: "noReturn",
      label: "No later interaction",
      count: noReturnCount,
      rate: eligibleJourneys.length ? noReturnCount / eligibleJourneys.length : 0,
    });
    const destinationCounts = new Map();
    for (const journey of continuedJourneys) {
      const key = `${journey.next.outcomeKey}::${journey.next.destinationLabel}`;
      if (!destinationCounts.has(key)) {
        destinationCounts.set(key, {
          key,
          label: journey.next.destinationLabel,
          type: journey.next.outcomeKey,
          count: 0,
        });
      }
      destinationCounts.get(key).count += 1;
    }
    const revenue90 = eligibleJourneys.reduce((total, journey) => total + journey.revenue90, 0);
    return {
      ...definition,
      signups: journeys.length,
      matched: journeys.filter((journey) => journey.matchMethod !== "unmatched").length,
      matchRate: journeys.length ? journeys.filter((journey) => journey.matchMethod !== "unmatched").length / journeys.length : 0,
      eligible90: eligibleJourneys.length,
      pending90: journeys.length - eligibleJourneys.length,
      continued90: continuedJourneys.length,
      continuedRate90: eligibleJourneys.length ? continuedJourneys.length / eligibleJourneys.length : 0,
      medianDays90: median(continuedJourneys.map((journey) => journey.daysToNext)),
      revenue90,
      avgRevenue90: eligibleJourneys.length ? revenue90 / eligibleJourneys.length : 0,
      outcomes,
      windowRates,
      topDestinations: Array.from(destinationCounts.values())
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
        .slice(0, 8),
    };
  });

  const totalSignups = cohorts.reduce((total, cohort) => total + cohort.signups, 0);
  const eligible90 = cohorts.reduce((total, cohort) => total + cohort.eligible90, 0);
  const continued90 = cohorts.reduce((total, cohort) => total + cohort.continued90, 0);
  const matched = cohorts.reduce((total, cohort) => total + cohort.matched, 0);
  return {
    cohorts,
    windows,
    dataEndMs,
    summary: {
      totalSignups,
      uniquePeople: uniquePeople.size,
      eligible90,
      pending90: cohorts.reduce((total, cohort) => total + cohort.pending90, 0),
      continued90,
      continuedRate90: eligible90 ? continued90 / eligible90 : 0,
      matched,
      matchRate: totalSignups ? matched / totalSignups : 0,
      revenue90: cohorts.reduce((total, cohort) => total + cohort.revenue90, 0),
    },
  };
}

function introConversionDefinitions() {
  return [
    { key: "houseOfPlay", label: "Introduction to House of Play" },
    { key: "ropesAbsoluteBeginners", label: "Introduction to Ropes for Absolute Beginners" },
  ];
}

function introClassInfo(className) {
  const normalized = cleanValue(className).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (normalized.includes("introduction to ropes for absolute beginners")) {
    return { key: "ropesAbsoluteBeginners", label: "Introduction to Ropes for Absolute Beginners" };
  }
  if (normalized.includes("introduction to house of play")) {
    return { key: "houseOfPlay", label: "Introduction to House of Play" };
  }
  return null;
}

function introOutcomeLabel(key) {
  const labels = {
    paidClass: "Paid class or event",
    subscription: "Started subscription",
    subscriptionBooking: "Subscription booking",
    otherBooking: "Other booking",
    anotherIntro: "Another free introduction",
    noReturn: "No later interaction",
  };
  return labels[key] || "Other interaction";
}

function startOfHopDayMs(date) {
  if (!(date instanceof Date)) return 0;
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
}

function groupMembershipPipeline(rows) {
  const journeyRows = rows
    .filter((row) => row.totalPrice > 0.0001 || isCrewMembershipRow(row))
    .filter((row) => isActivityOrEventRow(row) || isMembershipSubscriptionRow(row) || isCrewMembershipRow(row))
    .sort((a, b) => a.date - b.date);
  const byCustomer = new Map();

  for (const row of journeyRows) {
    if (!byCustomer.has(row.customerKey)) {
      byCustomer.set(row.customerKey, {
        customerKey: row.customerKey,
        ticketCount: 0,
        ticketDates: new Set(),
        hasMembership: false,
        hasCrew: false,
        firstTicket: null,
        revenue: 0,
      });
    }
    const customer = byCustomer.get(row.customerKey);
    customer.revenue += row.totalPrice;
    if (isActivityOrEventRow(row)) {
      customer.ticketCount += row.quantity || 1;
      customer.ticketDates.add(periodKey(row.date, "week"));
      if (!customer.firstTicket) customer.firstTicket = row;
    }
    if (isPaidMembershipRow(row)) customer.hasMembership = true;
    if (isCrewMembershipRow(row)) customer.hasCrew = true;
  }

  const customers = Array.from(byCustomer.values());
  const ticketBuyers = customers.filter((customer) => customer.ticketCount > 0);
  const recurringTicketBuyers = ticketBuyers.filter((customer) => customer.ticketCount >= 3 || customer.ticketDates.size >= 2);
  const members = customers.filter((customer) => customer.hasMembership);
  const longTermMembers = customers.filter((customer) => customer.hasCrew || (customer.hasMembership && (customer.ticketDates.size >= 4 || customer.ticketCount >= 8)));
  const crew = customers.filter((customer) => customer.hasCrew);
  const feeders = new Map();

  for (const customer of customers) {
    if (!customer.hasMembership || !customer.firstTicket) continue;
    const key = activityNodeKey(customer.firstTicket.text) || "unknown first activity";
    if (!feeders.has(key)) {
      feeders.set(key, {
        key,
        label: cleanValue(customer.firstTicket.text) || "Unknown activity",
        type: customer.firstTicket.itemType === "event" ? "Event" : "Activity",
        people: 0,
        revenue: 0,
      });
    }
    const feeder = feeders.get(key);
    feeder.people += 1;
    feeder.revenue += customer.revenue;
  }

  return {
    stages: [
      { key: "ticket", label: "Ticket buyers", count: ticketBuyers.length },
      { key: "recurring", label: "Recurring ticket buyers", count: recurringTicketBuyers.length },
      { key: "member", label: "Paid subscribers", count: members.length },
      { key: "longterm", label: "Crew / long-term", count: longTermMembers.length },
    ],
    ticketBuyerCount: ticketBuyers.length,
    recurringTicketBuyerCount: recurringTicketBuyers.length,
    memberCount: members.length,
    longTermMemberCount: longTermMembers.length,
    crewCount: crew.length,
    feeders: Array.from(feeders.values()).sort((a, b) => b.people - a.people || b.revenue - a.revenue).slice(0, 12),
  };
}

function isActivityOrEventRow(row) {
  return row.itemType === "class_pass_type" || row.itemType === "event";
}

function isPaidMembershipRow(row) {
  return isMembershipSubscriptionRow(row) && !isCrewMembershipRow(row) && row.totalPrice > 0.0001;
}

function firstMembershipSignupRowKeys(rows) {
  const byCustomer = new Map();
  for (const row of rows.filter(isPaidMembershipRow).sort((a, b) => a.date - b.date)) {
    if (byCustomer.has(row.customerKey)) continue;
    byCustomer.set(row.customerKey, purchaseTimingRowKey(row));
  }
  return new Set(byCustomer.values());
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

function activityPathTarget(row) {
  if (!row) {
    return { key: "__no_return", label: "No return", type: "No return" };
  }
  if (isPaidMembershipRow(row)) {
    return { key: "__membership", label: "Membership", type: "Membership" };
  }
  const key = activityNodeKey(row.text) || "unknown next activity";
  return {
    key,
    label: cleanValue(row.text) || "Unknown activity",
    type: row.itemType === "event" ? "Event" : "Activity",
  };
}

function isRetentionOffsetPossible(cohortStartDate, offset, dataEndDate, timeBucket) {
  if (!dataEndDate) return false;
  const periodDate = addPeriods(cohortStartDate, offset, timeBucket);
  return periodDate <= dataEndDate;
}

function addPeriods(date, offset, timeBucket) {
  const copy = new Date(date);
  if (timeBucket === "year") {
    copy.setFullYear(copy.getFullYear() + offset);
    return copy;
  }
  if (timeBucket === "month") {
    copy.setMonth(copy.getMonth() + offset);
    return copy;
  }
  if (timeBucket === "halfyear") {
    copy.setMonth(copy.getMonth() + offset * 6);
    return copy;
  }
  if (timeBucket === "quarter") {
    copy.setMonth(copy.getMonth() + offset * 3);
    return copy;
  }
  copy.setDate(copy.getDate() + offset * 7);
  return copy;
}

function dateFromPeriodKey(key, timeBucket) {
  const text = String(key || "");
  const weekMatch = text.match(/^(\d{4})-W(\d{2})$/);
  if (weekMatch) return dateFromRetentionIsoWeek(Number(weekMatch[1]), Number(weekMatch[2]));
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

function dateFromRetentionIsoWeek(year, week) {
  const date = new Date(year, 0, 1 + (week - 1) * 7);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  date.setHours(0, 0, 0, 0);
  return date;
}

function journeyOffset(firstDate, date, timeBucket) {
  if (timeBucket === "year") {
    return date.getFullYear() - firstDate.getFullYear();
  }
  if (timeBucket === "month") {
    return (date.getFullYear() - firstDate.getFullYear()) * 12 + date.getMonth() - firstDate.getMonth();
  }
  if (timeBucket === "quarter") {
    return Math.floor(((date.getFullYear() - firstDate.getFullYear()) * 12 + date.getMonth() - firstDate.getMonth()) / 3);
  }
  if (timeBucket === "halfyear") {
    return Math.floor(((date.getFullYear() - firstDate.getFullYear()) * 12 + date.getMonth() - firstDate.getMonth()) / 6);
  }
  return Math.floor((startOfIsoWeek(date) - startOfIsoWeek(firstDate)) / (7 * 86400000));
}

function addActiveMemberWeeks(byMonth, rowsByCustomer, dataEndDate, timeBucket) {
  const defaultCoverageDays = 35;
  const continuousRenewalDays = 62;

  for (const [customerKey, rows] of rowsByCustomer.entries()) {
    const sortedRows = rows.sort((a, b) => a.date - b.date);
    for (let index = 0; index < sortedRows.length; index += 1) {
      const row = sortedRows[index];
      const start = startOfIsoWeek(row.date);
      const nextDate = sortedRows[index + 1]?.date;
      const daysUntilNext = nextDate ? (nextDate - row.date) / 86400000 : Infinity;
      const coverageEndDate = nextDate && daysUntilNext <= continuousRenewalDays
        ? nextDate
        : addDays(row.date, defaultCoverageDays);
      const stillActiveAtDataEnd = !nextDate && dataEndDate && coverageEndDate >= dataEndDate;
      const endDate = stillActiveAtDataEnd ? dataEndDate : coverageEndDate;
      const end = startOfIsoWeek(endDate);
      const activeWeeks = weeksBetweenInclusive(start, end);
      const weeklyRevenue = activeWeeks > 0 ? row.totalPrice / activeWeeks : 0;
      const endsWithoutRenewal = !stillActiveAtDataEnd && (!nextDate || daysUntilNext > continuousRenewalDays);

      for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 7)) {
        const week = periodKey(cursor, timeBucket);
        if (!byMonth.has(week)) {
          byMonth.set(week, {
            month: week,
            revenue: 0,
            customerKeys: new Set(),
            newCustomerKeys: new Set(),
            endedCustomerKeys: new Set(),
          });
        }
        const weekEntry = byMonth.get(week);
        const typeKey = row.membershipTypeKey || membershipTypeKey(row.text);
        weekEntry.revenue += weeklyRevenue;
        if (isActiveAtPeriodSnapshot(row.date, endDate, week, timeBucket, dataEndDate)) {
          weekEntry.customerKeys.add(customerKey);
          weekEntry.membershipTypeKeys = weekEntry.membershipTypeKeys || new Map();
          if (!weekEntry.membershipTypeKeys.has(typeKey)) weekEntry.membershipTypeKeys.set(typeKey, new Set());
          weekEntry.membershipTypeKeys.get(typeKey).add(customerKey);
        }
      }

      if (endsWithoutRenewal) {
        const endWeek = periodKey(end, timeBucket);
        const endWeekEntry = byMonth.get(endWeek);
        endWeekEntry.endedCustomerKeys = endWeekEntry.endedCustomerKeys || new Set();
        endWeekEntry.endedCustomerKeys.add(customerKey);
      }
    }
  }
}

function addActiveCrewWeeks(byMonth, rowsByCustomer, dataEndDate, timeBucket) {
  const defaultCoverageDays = 35;
  const continuousRenewalDays = 62;

  for (const [customerKey, rows] of rowsByCustomer.entries()) {
    const sortedRows = rows.sort((a, b) => a.date - b.date);
    for (let index = 0; index < sortedRows.length; index += 1) {
      const row = sortedRows[index];
      const start = startOfIsoWeek(row.date);
      const nextDate = sortedRows[index + 1]?.date;
      const daysUntilNext = nextDate ? (nextDate - row.date) / 86400000 : Infinity;
      const coverageEndDate = nextDate && daysUntilNext <= continuousRenewalDays
        ? nextDate
        : addDays(row.date, defaultCoverageDays);
      const stillActiveAtDataEnd = !nextDate && dataEndDate && coverageEndDate >= dataEndDate;
      const endDate = stillActiveAtDataEnd ? dataEndDate : coverageEndDate;
      const end = startOfIsoWeek(endDate);

      for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 7)) {
        const week = periodKey(cursor, timeBucket);
        if (!byMonth.has(week)) {
          byMonth.set(week, {
            month: week,
            revenue: 0,
            customerKeys: new Set(),
            newCustomerKeys: new Set(),
            endedCustomerKeys: new Set(),
          });
        }
        const weekEntry = byMonth.get(week);
        if (isActiveAtPeriodSnapshot(row.date, endDate, week, timeBucket, dataEndDate)) {
          weekEntry.crewKeys = weekEntry.crewKeys || new Set();
          weekEntry.crewKeys.add(customerKey);
        }
      }
    }
  }
}

function isActiveAtPeriodSnapshot(startDate, endDate, period, timeBucket, dataEndDate) {
  const snapshot = periodSnapshotDate(period, timeBucket, dataEndDate);
  return startOfHopDayMs(startDate) <= snapshot.getTime() && startOfHopDayMs(endDate) >= snapshot.getTime();
}

function periodSnapshotDate(period, timeBucket, dataEndDate) {
  const periodEnd = periodEndDate(period, timeBucket);
  if (dataEndDate && periodEnd > dataEndDate) return new Date(startOfHopDayMs(dataEndDate));
  return periodEnd;
}

function periodEndDate(period, timeBucket) {
  const start = dateFromPeriodKey(period, timeBucket);
  if (timeBucket === "week") return addDays(start, 6);
  const end = addPeriods(start, 1, timeBucket);
  end.setDate(end.getDate() - 1);
  return end;
}

function isMembershipRow(row) {
  return row.itemType.startsWith("membership");
}

function isMembershipSubscriptionRow(row) {
  const feeTerms = /late cancel|no-show|pause fee|admin fee|fee for/i;
  return isMembershipRow(row) && !feeTerms.test(row.text);
}

function membershipTypeKey(text) {
  return membershipTypeInfo(text).key;
}

function membershipTypeInfo(text) {
  const label = cleanMembershipTypeLabel(text);
  return {
    key: label.toLowerCase(),
    label,
  };
}

function cleanMembershipTypeLabel(text) {
  let label = cleanValue(text) || "Membership";
  label = label
    .replace(/\s+-\s+.*$/i, "")
    .replace(/\.\s*payment for.*$/i, "")
    .replace(/\s*\(monthly\)/ig, "")
    .replace(/\s*\([^)]*(free|discount|rabat|trial|january|february|march|april|may|june|july|august|september|october|november|december)[^)]*\)/ig, "")
    .replace(/\s+/g, " ")
    .trim();
  return label || "Membership";
}

function isCrewMembershipRow(row) {
  return isMembershipRow(row) && row.fullyDiscounted;
}

function getLastRowDate(rows) {
  return rows.reduce((lastDate, row) => maxDate(lastDate, row.date), null);
}

function findStaffCompInvoiceIds(rows) {
  const staffCompTerms = /volunteer|crew|staff|admin|teacher|instructor|ambassador|frivillig/i;
  const invoiceIds = new Set();
  for (const row of rows) {
    if (row.itemType === "discount_code" && staffCompTerms.test(row.text)) {
      invoiceIds.add(row.invoiceId);
    }
  }
  return invoiceIds;
}

function normalizeBookingRows(rows, salesRows = []) {
  const identity = buildBookingIdentityIndex(salesRows);
  return rows.map((row, index) => normalizeBookingRow(row, identity, index)).filter((row) => row.date);
}

function buildBookingIdentityIndex(salesRows) {
  const byEmail = new Map();
  const nameKeys = new Map();
  const people = new Map();

  for (const row of salesRows) {
    if (!people.has(row.customerKey)) {
      people.set(row.customerKey, {
        customerKey: row.customerKey,
        customerId: row.customerId,
        customerName: row.customerName,
        customerEmail: row.customerEmail,
        realLabel: row.realLabel,
        anonymousLabel: row.anonymousLabel,
      });
    }
    const email = normalizeIdentityEmail(row.customerEmail);
    if (email) byEmail.set(email, row.customerKey);
    const name = normalizeIdentityName(row.customerName);
    if (name) {
      if (!nameKeys.has(name)) nameKeys.set(name, new Set());
      nameKeys.get(name).add(row.customerKey);
    }
  }

  return { byEmail, nameKeys, people };
}

function normalizeBookingRow(row, identity, sourceIndex = 0) {
  const date = parseHopBookingDate(row.Date);
  const startAt = combineHopBookingDateTime(date, row["Start Time"]);
  let endAt = combineHopBookingDateTime(date, row["End Time"]);
  if (startAt && endAt && endAt < startAt) endAt = addDays(endAt, 1);
  const customerName = cleanValue(row.Customer);
  const customerEmail = normalizeIdentityEmail(row.Email);
  const normalizedName = normalizeIdentityName(customerName);
  let customerKey = customerEmail ? identity.byEmail.get(customerEmail) : "";
  let matchMethod = customerKey ? "email" : "";

  if (!customerKey && normalizedName) {
    const matches = identity.nameKeys.get(normalizedName);
    if (matches?.size === 1) {
      customerKey = Array.from(matches)[0];
      matchMethod = "name";
    }
  }
  if (!customerKey) {
    customerKey = customerEmail
      ? `booking-email:${customerEmail}`
      : `booking-name:${normalizedName || stableHash(`${sourceIndex}:${customerName}`)}`;
    matchMethod = "unmatched";
  }

  const salesPerson = identity.people.get(customerKey);
  const realLabel = salesPerson?.realLabel || customerName || customerEmail || "Unknown customer";
  const bookingType = cleanValue(row["Booking Type"]).toLowerCase();
  const className = cleanValue(row["Class Type"]) || "Unknown class";
  const booking = {
    date,
    startAt,
    endAt,
    customerKey,
    customerName: salesPerson?.customerName || customerName,
    customerEmail: salesPerson?.customerEmail || customerEmail,
    label: realLabel,
    realLabel,
    anonymousLabel: salesPerson?.anonymousLabel || anonymousCustomerName(customerKey),
    room: cleanValue(row.Room),
    branch: cleanValue(row.Branch),
    className,
    bookingType,
    bookingMethod: cleanValue(row["Booking Method"]),
    isMembershipBooking: bookingType === "membership" || bookingType.includes("member"),
    matchMethod,
  };
  booking.bookingKey = hopBookingKey(booking);
  return booking;
}

function parseHopBookingDate(value) {
  const text = cleanValue(value);
  if (!text) return null;
  const european = text.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
  if (european) {
    const day = Number(european[1]);
    const month = Number(european[2]) - 1;
    const year = Number(european[3]);
    const date = new Date(year, month, day);
    date.setHours(0, 0, 0, 0);
    return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : null;
  }
  return parseHopDate(text);
}

function combineHopBookingDateTime(date, value) {
  if (!(date instanceof Date)) return null;
  const match = cleanValue(value).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const result = new Date(date);
  result.setHours(Number(match[1]), Number(match[2]), Number(match[3] || 0), 0);
  return result;
}

function hopBookingKey(booking) {
  return [
    normalizeIdentityEmail(booking.customerEmail) || normalizeIdentityName(booking.customerName) || booking.customerKey,
    booking.date ? startOfHopDayMs(booking.date) : "",
    booking.startAt?.getTime?.() || "",
    booking.endAt?.getTime?.() || "",
    cleanValue(booking.room).toLowerCase(),
    cleanValue(booking.className).toLowerCase(),
  ].join("|");
}

function normalizeIdentityEmail(value) {
  return cleanEmail(value).toLowerCase();
}

function normalizeIdentityName(value) {
  return cleanValue(value).toLowerCase().replace(/\s+/g, " ");
}

function groupMemberEngagement(bookings, customers, membershipSpans, timeBucket, options = {}) {
  const rangeStartMs = Number(options.rangeStartMs) || null;
  const rangeEndMs = Number(options.rangeEndMs) || null;
  const visibleBookings = bookings.filter((booking) => {
    const time = startOfHopDayMs(booking.date);
    return (!rangeStartMs || time >= rangeStartMs) && (!rangeEndMs || time <= rangeEndMs);
  });
  const spans = (membershipSpans || []).filter((span) => {
    return (!rangeStartMs || startOfHopDayMs(span.endDate) >= rangeStartMs) &&
      (!rangeEndMs || startOfHopDayMs(span.startDate) <= rangeEndMs);
  });
  const customerByKey = new Map((customers || []).map((customer) => [customer.customerKey, customer]));
  const subscriptionKeys = new Set(spans.map((span) => span.customerKey));
  const memberBookings = visibleBookings.filter((booking) => booking.isMembershipBooking);
  const memberEvidenceKeys = new Set([...subscriptionKeys, ...memberBookings.map((booking) => booking.customerKey)]);
  const bookingsByCustomer = new Map();

  for (const booking of visibleBookings) {
    if (!bookingsByCustomer.has(booking.customerKey)) bookingsByCustomer.set(booking.customerKey, []);
    bookingsByCustomer.get(booking.customerKey).push(booking);
  }

  const members = Array.from(memberEvidenceKeys).map((customerKey) => {
    const personBookings = bookingsByCustomer.get(customerKey) || [];
    const membershipBookings = personBookings.filter((booking) => booking.isMembershipBooking);
    const classCounts = new Map();
    for (const booking of membershipBookings) {
      classCounts.set(booking.className, (classCounts.get(booking.className) || 0) + 1);
    }
    const customer = customerByKey.get(customerKey);
    return {
      customerKey,
      label: customer?.realLabel || membershipBookings[0]?.realLabel || customerKey,
      realLabel: customer?.realLabel || membershipBookings[0]?.realLabel || customerKey,
      anonymousLabel: customer?.anonymousLabel || membershipBookings[0]?.anonymousLabel || anonymousCustomerName(customerKey),
      subscriptionKnown: subscriptionKeys.has(customerKey),
      bookingCount: personBookings.length,
      membershipBookingCount: membershipBookings.length,
      firstBookingDate: membershipBookings[0]?.date || null,
      lastBookingDate: membershipBookings.at(-1)?.date || null,
      favoriteClasses: Array.from(classCounts.entries())
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
        .slice(0, 3),
    };
  }).sort((a, b) => b.membershipBookingCount - a.membershipBookingCount || a.realLabel.localeCompare(b.realLabel));

  const classesByName = new Map();
  for (const booking of memberBookings) {
    if (!classesByName.has(booking.className)) {
      classesByName.set(booking.className, { label: booking.className, bookingCount: 0, customerKeys: new Set() });
    }
    const entry = classesByName.get(booking.className);
    entry.bookingCount += 1;
    entry.customerKeys.add(booking.customerKey);
  }
  const classes = Array.from(classesByName.values()).map((entry) => ({
    label: entry.label,
    bookingCount: entry.bookingCount,
    uniqueMembers: entry.customerKeys.size,
  })).sort((a, b) => b.bookingCount - a.bookingCount || a.label.localeCompare(b.label));

  const periods = memberEngagementPeriods(visibleBookings, spans, timeBucket, rangeStartMs, rangeEndMs);
  const matchedBookings = visibleBookings.filter((booking) => booking.matchMethod !== "unmatched");
  return {
    bookings: visibleBookings,
    periods,
    members,
    classes,
    sources: Array.isArray(options.sources) ? options.sources : [],
    bookingCount: visibleBookings.length,
    membershipBookingCount: memberBookings.length,
    memberCount: members.length,
    subscribersWithBookings: members.filter((member) => member.subscriptionKnown && member.membershipBookingCount > 0).length,
    subscribersWithoutBookings: members.filter((member) => member.subscriptionKnown && member.membershipBookingCount === 0).length,
    bookingOnlyMembers: members.filter((member) => !member.subscriptionKnown && member.membershipBookingCount > 0).length,
    duplicateCount: Number(options.duplicateCount) || 0,
    matchStats: {
      total: visibleBookings.length,
      matched: matchedBookings.length,
      email: visibleBookings.filter((booking) => booking.matchMethod === "email").length,
      name: visibleBookings.filter((booking) => booking.matchMethod === "name").length,
      unmatched: visibleBookings.filter((booking) => booking.matchMethod === "unmatched").length,
      rate: visibleBookings.length ? matchedBookings.length / visibleBookings.length : 0,
    },
  };
}

function memberEngagementPeriods(bookings, spans, timeBucket, rangeStartMs, rangeEndMs) {
  const dates = [
    ...bookings.map((booking) => booking.date),
    ...spans.flatMap((span) => [span.startDate, span.endDate]),
  ].filter((date) => date instanceof Date && !Number.isNaN(date.getTime()));
  const startMs = rangeStartMs || (dates.length ? Math.min(...dates.map((date) => startOfHopDayMs(date))) : 0);
  const endMs = rangeEndMs || (dates.length ? Math.max(...dates.map((date) => startOfHopDayMs(date))) : 0);
  if (!startMs || !endMs || endMs < startMs) return [];

  const bookingsByPeriod = new Map();
  for (const booking of bookings) {
    const key = periodKey(booking.date, timeBucket);
    if (!bookingsByPeriod.has(key)) bookingsByPeriod.set(key, []);
    bookingsByPeriod.get(key).push(booking);
  }

  const periods = [];
  let cursor = dateFromPeriodKey(periodKey(new Date(startMs), timeBucket), timeBucket);
  while (cursor.getTime() <= endMs) {
    const key = periodKey(cursor, timeBucket);
    const periodBookings = bookingsByPeriod.get(key) || [];
    const membershipBookings = periodBookings.filter((booking) => booking.isMembershipBooking);
    const bookingMemberKeys = new Set(membershipBookings.map((booking) => booking.customerKey));
    const unmatchedMemberBookings = membershipBookings.filter((booking) => booking.matchMethod === "unmatched").length;
    const snapshotMs = Math.min(periodEndDate(key, timeBucket).getTime(), endMs);
    const activeSubscriberKeys = new Set(spans
      .filter((span) => startOfHopDayMs(span.startDate) <= snapshotMs && startOfHopDayMs(span.endDate) >= snapshotMs)
      .map((span) => span.customerKey));
    const subscribersWithBooking = Array.from(activeSubscriberKeys).filter((keyValue) => bookingMemberKeys.has(keyValue)).length;
    periods.push({
      month: key,
      bookingCount: periodBookings.length,
      membershipBookings: membershipBookings.length,
      uniqueBookingMembers: bookingMemberKeys.size,
      bookingsPerBookingMember: bookingMemberKeys.size ? membershipBookings.length / bookingMemberKeys.size : 0,
      unmatchedMemberBookings,
      activeSubscribers: activeSubscriberKeys.size,
      subscribersWithBooking,
      subscribersWithoutBooking: Math.max(0, activeSubscriberKeys.size - subscribersWithBooking),
      utilizationRate: activeSubscriberKeys.size ? subscribersWithBooking / activeSubscriberKeys.size : 0,
    });
    cursor = addPeriods(cursor, 1, timeBucket);
  }
  return periods;
}

function parseHopDate(value) {
  const text = cleanValue(value);
  if (!text) return null;
  const normalized = text.replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseHopNumber(value) {
  const number = Number(String(value || "0").replace(",", "."));
  return Number.isFinite(number) ? number : 0;
}

function cleanValue(value) {
  return String(value ?? "").trim();
}

function cleanEmail(value) {
  const email = cleanValue(value);
  if (!email || email.toLowerCase() === "null@yogo.dk") return "";
  return email;
}

function anonymousCustomerName(key) {
  const first = ["Aster", "Birch", "Cedar", "Dune", "Elm", "Fern", "Grove", "Hazel", "Iris", "Juniper", "Kite", "Lark", "Moss", "Nova", "Oak", "Pebble"];
  const last = ["River", "Cloud", "Stone", "Meadow", "Moon", "Harbor", "Valley", "Field", "Comet", "Bridge", "Reef", "Forest", "Rain", "Spark", "Hill", "Bloom"];
  const hash = stableHash(key);
  return `${first[hash % first.length]} ${last[Math.floor(hash / first.length) % last.length]}`;
}

function stableHash(value) {
  const text = String(value || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function periodKey(date, timeBucket) {
  if (timeBucket === "year") return yearKey(date);
  if (timeBucket === "month") return monthKey(date);
  if (timeBucket === "quarter") return quarterKey(date);
  if (timeBucket === "halfyear") return halfyearKey(date);
  return weekKey(date);
}

function yearKey(date) {
  return String(date.getFullYear());
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function quarterKey(date) {
  const quarter = Math.floor(date.getMonth() / 3) + 1;
  return `${date.getFullYear()}-Q${quarter}`;
}

function halfyearKey(date) {
  const half = date.getMonth() < 6 ? 1 : 2;
  return `${date.getFullYear()}-H${half}`;
}

function weekKey(date) {
  const weekStart = startOfIsoWeek(date);
  const iso = getIsoWeekInfo(weekStart);
  return `${iso.year}-W${String(iso.week).padStart(2, "0")}`;
}

function startOfIsoWeek(date) {
  const copy = new Date(date);
  const day = copy.getDay() || 7;
  copy.setDate(copy.getDate() - day + 1);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function getIsoWeek(date) {
  return getIsoWeekInfo(date).week;
}

function getIsoWeekInfo(date) {
  const copy = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1));
  return {
    year: copy.getUTCFullYear(),
    week: Math.ceil(((copy - yearStart) / 86400000 + 1) / 7),
  };
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function weeksBetweenInclusive(start, end) {
  return Math.max(1, Math.round((end - start) / (7 * 86400000)) + 1);
}

function minDate(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function maxDate(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}
