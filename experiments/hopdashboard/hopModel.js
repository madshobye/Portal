function buildHopModel(rows, timeBucket = "week", options = {}) {
  const normalizedRows = applyTransactionDiscountNetting(rows.map(normalizeSalesRow).filter((row) => row.date));
  const activityPathRows = options.activityPathRows
    ? applyTransactionDiscountNetting(options.activityPathRows.map(normalizeSalesRow).filter((row) => row.date))
    : normalizedRows;
  const retentionRows = options.retentionRows
    ? applyTransactionDiscountNetting(options.retentionRows.map(normalizeSalesRow).filter((row) => row.date))
    : normalizedRows;
  const membershipLengthRows = options.membershipLengthRows
    ? applyTransactionDiscountNetting(options.membershipLengthRows.map(normalizeSalesRow).filter((row) => row.date))
    : normalizedRows;
  const firstTouchpointRows = options.firstTouchpointRows && !options.timelineActivity
    ? applyTransactionDiscountNetting(options.firstTouchpointRows.map(normalizeSalesRow).filter((row) => row.date))
    : normalizedRows;
  const timelineRows = options.timelineRows && (!options.timelineActivity || !options.ticketSalesTimeline)
    ? applyTransactionDiscountNetting(options.timelineRows.map(normalizeSalesRow).filter((row) => row.date))
    : normalizedRows;
  const invoices = groupInvoices(normalizedRows);
  const customers = groupCustomers(invoices);
  const months = groupMonths(invoices, timeBucket);
  const activity = options.timelineActivity || groupActivity(timelineRows, timeBucket, {
    firstTouchpointRows,
  });
  const ticketSales = groupTicketSales(normalizedRows, timeBucket);
  const ticketSalesTimeline = options.ticketSalesTimeline || groupTicketSales(timelineRows, timeBucket);
  const ticketBuyers = groupTicketBuyers(normalizedRows, timeBucket);
  const buyerPatterns = groupBuyerPatterns(normalizedRows, timeBucket);
  const activityNetwork = groupActivityNetwork(normalizedRows);
  const userNetwork = groupUserNetwork(normalizedRows);
  const retention = groupRetention(retentionRows, timeBucket, {
    rangeStartMs: options.rangeStartMs,
    rangeEndMs: options.rangeEndMs,
  });
  const activityPath = groupActivityPath(activityPathRows, {
    mode: options.activityPathMode || "ever",
    rangeStartMs: options.rangeStartMs,
    rangeEndMs: options.rangeEndMs,
  });
  const membershipPipeline = groupMembershipPipeline(normalizedRows);
  const productHealth = groupProductHealth(normalizedRows);
  const customerSegments = groupCustomerSegments(normalizedRows);
  const exitPoints = groupExitPoints(normalizedRows);
  const membershipLength = groupMembershipLength(membershipLengthRows, {
    rangeStartMs: options.rangeStartMs,
    rangeEndMs: options.rangeEndMs,
    timeBucket,
  });

  return {
    rows: normalizedRows,
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
    membershipPipeline,
    productHealth,
    customerSegments,
    exitPoints,
    membershipLength,
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

function groupActivityNetwork(rows) {
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
    avgExperience: node.purchaseCount ? node.experienceSum / node.purchaseCount : 0,
  })).sort((a, b) => b.revenue - a.revenue);

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
  };
}

function activityNodeKey(text) {
  return cleanValue(text).toLowerCase();
}

function groupProductHealth(rows) {
  const ticketRows = rows
    .filter((row) => row.totalPrice > 0.0001)
    .filter(isActivityOrEventRow)
    .sort((a, b) => a.date - b.date);
  const membershipKeys = new Set(rows.filter(isPaidMembershipRow).map((row) => row.customerKey));
  const products = new Map();
  const seenTicketCustomers = new Set();
  const buyerProductCount = new Map();
  const firstDate = ticketRows[0]?.date || null;
  const lastDate = ticketRows.at(-1)?.date || null;
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

  const items = Array.from(products.values()).map((product) => {
    const buyerCount = product.buyers.size;
    const trendBase = max(1, product.earlyRevenue);
    const trend = (product.lateRevenue - product.earlyRevenue) / trendBase;
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
      trend,
      earlyRevenue: product.earlyRevenue,
      lateRevenue: product.lateRevenue,
    };
  }).sort((a, b) => b.revenue - a.revenue || b.buyerCount - a.buyerCount);

  return {
    items,
    maxRevenue: Math.max(1, ...items.map((item) => item.revenue)),
  };
}

function groupCustomerSegments(rows) {
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
        hasCrew: false,
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
      customer.events.push("membership");
    }
    if (isCrewMembershipRow(row)) {
      customer.hasCrew = true;
      customer.events.push("crew");
    }
  }

  const customers = Array.from(byCustomer.values()).filter((customer) => customer.revenue > 0 || customer.ticketCount > 0 || customer.hasCrew);
  const positiveRevenue = customers.map((customer) => customer.revenue).filter((value) => value > 0).sort((a, b) => a - b);
  const highValueThreshold = positiveRevenue.length ? positiveRevenue[Math.floor(positiveRevenue.length * 0.9)] : Infinity;
  const segmentOrder = [
    "crew",
    "members",
    "highValue",
    "recurringTickets",
    "seasonalReturners",
    "oneTimers",
  ];
  const segmentLabels = {
    crew: "Crew",
    members: "Members",
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
  if (customer.hasMembership) return "members";
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
    if (event === "membership") return "Member";
    return "Crew";
  }).join(" -> ");
}

function groupExitPoints(rows) {
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
    customer.rows.push(row);
    customer.revenue += row.totalPrice;
  }

  const exits = new Map();
  const typeTotals = new Map();
  for (const customer of byCustomer.values()) {
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
  const dataEndDate = getLastRowDate(rows);
  const rangeStartMs = Number(options.rangeStartMs) || null;
  const rangeEndMs = Number(options.rangeEndMs) || null;
  const timeBucket = options.timeBucket || "week";
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

  const visibleSpans = membershipSpansInRange(spans, rangeStartMs, rangeEndMs);
  const buckets = membershipLengthBuckets(visibleSpans);
  const distribution = membershipDistributionTimeline(spans, rangeStartMs, rangeEndMs, timeBucket, dataEndDate);
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
    maxBucketCount: Math.max(1, ...buckets.map((bucket) => bucket.total)),
    maxTypeCount: Math.max(1, ...types.map((type) => type.count)),
  };
}

function membershipDistributionTimeline(spans, rangeStartMs, rangeEndMs, timeBucket, dataEndDate) {
  if (!rangeStartMs || !rangeEndMs || rangeEndMs < rangeStartMs) return { months: [], buckets: membershipDistributionBuckets(), maxTotal: 1 };
  const buckets = membershipDistributionBuckets();
  const months = [];
  let cursor = dateFromPeriodKey(periodKey(new Date(rangeStartMs), timeBucket), timeBucket);

  while (cursor.getTime() <= rangeEndMs) {
    const key = periodKey(cursor, timeBucket);
    const snapshot = periodSnapshotDate(key, timeBucket, dataEndDate);
    const snapshotMs = Math.min(snapshot.getTime(), rangeEndMs);
    const entry = { month: key, total: 0 };
    for (const bucket of buckets) entry[bucket.key] = 0;

    for (const span of spans) {
      if (startOfHopDayMs(span.startDate) > snapshotMs || startOfHopDayMs(span.endDate) < snapshotMs) continue;
      const monthsActive = Math.max(0, (snapshotMs - span.startDate) / 86400000 / 30.4375);
      const bucket = buckets.find((item) => monthsActive > item.min && monthsActive <= item.max) || buckets.at(0);
      entry[bucket.key] += 1;
      entry.total += 1;
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
  ].map((bucket) => ({ ...bucket, total: 0, active: 0, ended: 0 }));

  for (const span of spans) {
    const bucket = buckets.find((item) => span.months >= item.min && span.months < item.max) || buckets.at(-1);
    bucket.total += 1;
    if (span.active) bucket.active += 1;
    else bucket.ended += 1;
  }
  return buckets;
}

function membershipLengthTypes(spans) {
  const byType = new Map();
  for (const span of spans) {
    if (!byType.has(span.primaryType)) byType.set(span.primaryType, { label: span.primaryType, count: 0, months: 0, active: 0 });
    const entry = byType.get(span.primaryType);
    entry.count += 1;
    entry.months += span.months;
    if (span.active) entry.active += 1;
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

function groupUserNetwork(rows) {
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
    type: user.activities.size + user.events.size > 3 ? "Recurring" : "Occasional",
  })).sort((a, b) => b.tickets - a.tickets);

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
  };
}

function groupBuyerPatterns(rows, timeBucket) {
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

  const journeys = Array.from(byCustomer.values()).map((buyer) => {
    const periods = new Map();
    for (const event of buyer.events) {
      const offset = journeyOffset(buyer.firstDate, event.date, timeBucket);
      if (!periods.has(offset)) {
        periods.set(offset, { offset, tickets: 0, revenue: 0, hasTicket: false, hasMembership: false, hasCrew: false, items: new Map() });
      }
      const period = periods.get(offset);
      period.tickets += event.tickets;
      period.revenue += event.revenue;
      if (event.item) period.items.set(event.item, (period.items.get(event.item) || 0) + 1);
      if (event.kind === "ticket") period.hasTicket = true;
      if (event.kind === "membership") period.hasMembership = true;
      if (event.kind === "crew") period.hasCrew = true;
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
    return {
      ...buyer,
      periods: sortedPeriods,
      totalTickets: sortedPeriods.reduce((total, period) => total + period.tickets, 0),
      revenue: sortedPeriods.reduce((total, period) => total + period.revenue, 0),
      span: sortedPeriods.at(-1)?.offset || 0,
      firstMembership,
      firstCrew,
      pattern: firstMembership === null && firstCrew !== null
        ? hasTicket ? "Crew plus tickets" : "Crew only"
        : firstMembership !== null && firstCrew !== null
          ? firstCrew < firstMembership ? "Crew to membership" : "Membership plus crew"
          : firstMembership === null
        ? "Ticket only"
        : ticketBeforeMembership
          ? "Ticket to membership"
          : ticketAfterMembership
            ? "Membership plus tickets"
            : "Membership only",
    };
  }).sort((a, b) => b.revenue - a.revenue || b.span - a.span);

  return {
    journeys,
    summary: {
      total: journeys.length,
      ticketOnly: journeys.filter((journey) => journey.pattern === "Ticket only").length,
      ticketToMembership: journeys.filter((journey) => journey.pattern === "Ticket to membership").length,
      membershipOnly: journeys.filter((journey) => journey.pattern === "Membership only").length,
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
  const dataEndDate = getLastRowDate(activeRows);
  const rangeStartMs = Number(options.rangeStartMs) || null;
  const rangeEndMs = Number(options.rangeEndMs) || null;

  for (const row of activeRows) {
    if (!byCustomer.has(row.customerKey)) {
      byCustomer.set(row.customerKey, {
        customerKey: row.customerKey,
        firstDate: row.date,
        rows: [],
      });
    }
    const customer = byCustomer.get(row.customerKey);
    customer.firstDate = minDate(customer.firstDate, row.date);
    customer.rows.push(row);
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
        cohort.offsets.set(offset, { customers: new Set(), revenue: 0 });
      }
      const cell = cohort.offsets.get(offset);
      cell.revenue += row.totalPrice;
      cell.customers.add(customer.customerKey);
      seenOffsets.add(offset);
    }

    if (!seenOffsets.has(0)) {
      if (!cohort.offsets.has(0)) cohort.offsets.set(0, { customers: new Set(), revenue: 0 });
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
      const periodDate = addPeriods(cohortStartDate, offset, timeBucket);
      const possible = isRetentionOffsetPossible(cohortStartDate, offset, dataEndDate, timeBucket);
      const outOfScope = possible && rangeEndMs ? startOfHopDayMs(periodDate) > rangeEndMs : false;
      cells.push({
        offset,
        possible,
        outOfScope,
        retained,
        revenue: cell?.revenue || 0,
        rate: possible && size ? retained / size : 0,
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
  const rangeStartMs = Number(options.rangeStartMs) || null;
  const rangeEndMs = Number(options.rangeEndMs) || null;
  const paidRows = rows
    .filter((row) => row.totalPrice > 0.0001)
    .sort((a, b) => a.date - b.date);
  const byCustomer = new Map();

  for (const row of paidRows) {
    if (!byCustomer.has(row.customerKey)) byCustomer.set(row.customerKey, []);
    byCustomer.get(row.customerKey).push(row);
  }

  const rowsByFirst = new Map();
  const columnsByKey = new Map();
  let customerCount = 0;

  for (const customerRows of byCustomer.values()) {
    const activityRows = customerRows.filter(isActivityOrEventRow);
    const first = mode === "range"
      ? activityRows.find((row) => isRowInActivityPathRange(row, rangeStartMs, rangeEndMs))
      : activityRows[0];
    if (!first) continue;
    if (mode === "ever" && !isRowInActivityPathRange(first, rangeStartMs, rangeEndMs)) continue;
    customerCount += 1;

    const firstKey = activityNodeKey(first.text) || "unknown first activity";
    const firstLabel = cleanValue(first.text) || "Unknown activity";
    if (!rowsByFirst.has(firstKey)) {
      rowsByFirst.set(firstKey, {
        key: firstKey,
        label: firstLabel,
        type: first.itemType === "event" ? "Event" : "Activity",
        people: new Set(),
        targets: new Map(),
      });
    }
    const source = rowsByFirst.get(firstKey);
    source.people.add(first.customerKey);

    const next = customerRows.find((row) => row.date > first.date && (isActivityOrEventRow(row) || isPaidMembershipRow(row)));
    const target = activityPathTarget(next);
    if (!source.targets.has(target.key)) {
      source.targets.set(target.key, {
        key: target.key,
        label: target.label,
        type: target.type,
        people: new Set(),
        revenue: 0,
      });
    }
    const cell = source.targets.get(target.key);
    cell.people.add(first.customerKey);
    cell.revenue += next ? next.totalPrice : 0;

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
  };
}

function isRowInActivityPathRange(row, rangeStartMs, rangeEndMs) {
  if (!rangeStartMs || !rangeEndMs) return true;
  const time = startOfHopDayMs(row.date);
  return time >= rangeStartMs && time <= rangeEndMs;
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
      { key: "member", label: "Members", count: members.length },
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
