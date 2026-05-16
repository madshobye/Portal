function buildHopModel(rows, timeBucket = "week") {
  const normalizedRows = applyTransactionDiscountNetting(rows.map(normalizeSalesRow).filter((row) => row.date));
  const invoices = groupInvoices(normalizedRows);
  const customers = groupCustomers(invoices);
  const months = groupMonths(invoices, timeBucket);
  const activity = groupActivity(normalizedRows, timeBucket);
  const ticketSales = groupTicketSales(normalizedRows, timeBucket);
  const ticketBuyers = groupTicketBuyers(normalizedRows, timeBucket);
  const buyerPatterns = groupBuyerPatterns(normalizedRows, timeBucket);
  const activityNetwork = groupActivityNetwork(normalizedRows);
  const userNetwork = groupUserNetwork(normalizedRows);

  return {
    rows: normalizedRows,
    invoices,
    customers,
    months,
    activity,
    ticketSales,
    ticketBuyers,
    buyerPatterns,
    activityNetwork,
    userNetwork,
  };
}

function normalizeSalesRow(row) {
  const date = parseHopDate(row["Invoice date/time"]);
  const customerId = cleanValue(row["Customer ID"]);
  const customerName = cleanValue(row["Customer name"]);
  const customerEmail = cleanEmail(row["Customer email"]);
  const grossTotalPrice = parseHopNumber(row["Total price"]);
  const vatAmount = parseHopNumber(row["VAT amount"]);

  return {
    date,
    invoiceId: cleanValue(row["Invoice #"]),
    pspId: cleanValue(row["PSP ID"]),
    customerId,
    customerName,
    customerEmail,
    customerKey: customerId || customerEmail || customerName || "unknown",
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
        firstDate: invoice.date,
        lastDate: invoice.date,
        revenue: 0,
        invoiceCount: 0,
        classPassCount: 0,
        eventCount: 0,
        membershipCount: 0,
      });
    }
    const customer = byCustomer.get(invoice.customerKey);
    customer.firstDate = minDate(customer.firstDate, invoice.date);
    customer.lastDate = maxDate(customer.lastDate, invoice.date);
    customer.revenue += invoice.totalPrice;
    customer.invoiceCount += 1;
    if (invoice.itemTypes.has("class_pass_type")) customer.classPassCount += 1;
    if (invoice.itemTypes.has("event")) customer.eventCount += 1;
    if (Array.from(invoice.itemTypes).some((type) => type.startsWith("membership"))) {
      customer.membershipCount += 1;
    }
  }
  return Array.from(byCustomer.values()).sort((a, b) => b.revenue - a.revenue);
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

function groupActivity(rows, timeBucket) {
  const staffCompInvoiceIds = findStaffCompInvoiceIds(rows);
  const rawMembershipRows = rows.filter((row) => isMembershipRow(row) && !staffCompInvoiceIds.has(row.invoiceId));
  const paidMemberKeys = new Set(
    rawMembershipRows
      .filter((row) => row.totalPrice > 0)
      .map((row) => row.customerKey)
  );
  const membershipRows = rawMembershipRows.filter((row) => paidMemberKeys.has(row.customerKey));
  const byMonth = new Map();
  const firstMembershipByCustomer = new Map();
  const membershipRowsByCustomer = new Map();

  for (const row of membershipRows) {
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
    membershipRowsByCustomer.get(row.customerKey).push(row);
  }

  addActiveMemberWeeks(byMonth, membershipRowsByCustomer, getLastRowDate(rows), timeBucket);

  return {
    months: Array.from(byMonth.values()).map((month) => ({
      month: month.month,
      revenue: month.revenue,
      memberCount: month.customerKeys.size,
      customerKeys: month.customerKeys,
      newMemberships: month.newCustomerKeys.size,
      endedMemberships: month.endedCustomerKeys?.size || 0,
    })),
  };
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
        label: row.customerName || row.customerEmail || row.customerId || "Unknown customer",
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
        label: row.customerName || row.customerEmail || row.customerId || "Unknown customer",
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
  const staffCompInvoiceIds = findStaffCompInvoiceIds(rows);
  const journeyRows = rows.filter((row) => row.itemType === "class_pass_type" || row.itemType === "event" || isMembershipRow(row));
  const byCustomer = new Map();

  for (const row of journeyRows) {
    if (!byCustomer.has(row.customerKey)) {
      byCustomer.set(row.customerKey, {
        customerKey: row.customerKey,
        label: row.customerName || row.customerEmail || row.customerId || "Unknown customer",
        firstDate: row.date,
        lastDate: row.date,
        events: [],
      });
    }
    const buyer = byCustomer.get(row.customerKey);
    buyer.firstDate = minDate(buyer.firstDate, row.date);
    buyer.lastDate = maxDate(buyer.lastDate, row.date);
    const isCrew = isCrewMembershipRow(row, staffCompInvoiceIds);
    buyer.events.push({
      date: row.date,
      kind: isCrew ? "crew" : isMembershipRow(row) ? "membership" : "ticket",
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

function journeyOffset(firstDate, date, timeBucket) {
  if (timeBucket === "month") {
    return (date.getFullYear() - firstDate.getFullYear()) * 12 + date.getMonth() - firstDate.getMonth();
  }
  if (timeBucket === "quarter") {
    return Math.floor(((date.getFullYear() - firstDate.getFullYear()) * 12 + date.getMonth() - firstDate.getMonth()) / 3);
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
        weekEntry.customerKeys.add(customerKey);
        weekEntry.revenue += weeklyRevenue;
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

function isMembershipRow(row) {
  return row.itemType.startsWith("membership");
}

function isCrewMembershipRow(row, staffCompInvoiceIds) {
  const crewTerms = /volunteer|crew|staff|admin|teacher|instructor|ambassador|frivillig/i;
  return isMembershipRow(row) && (staffCompInvoiceIds.has(row.invoiceId) || crewTerms.test(row.text));
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

function periodKey(date, timeBucket) {
  if (timeBucket === "month") return monthKey(date);
  if (timeBucket === "quarter") return quarterKey(date);
  return weekKey(date);
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function quarterKey(date) {
  const quarter = Math.floor(date.getMonth() / 3) + 1;
  return `${date.getFullYear()}-Q${quarter}`;
}

function weekKey(date) {
  const weekStart = startOfIsoWeek(date);
  return `${weekStart.getFullYear()}-W${String(getIsoWeek(weekStart)).padStart(2, "0")}`;
}

function startOfIsoWeek(date) {
  const copy = new Date(date);
  const day = copy.getDay() || 7;
  copy.setDate(copy.getDate() - day + 1);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function getIsoWeek(date) {
  const copy = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1));
  return Math.ceil(((copy - yearStart) / 86400000 + 1) / 7);
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
