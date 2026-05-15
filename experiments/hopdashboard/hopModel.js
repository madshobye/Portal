function buildHopModel(rows, timeBucket = "week") {
  const normalizedRows = rows.map(normalizeSalesRow).filter((row) => row.date);
  const invoices = groupInvoices(normalizedRows);
  const customers = groupCustomers(invoices);
  const months = groupMonths(invoices, timeBucket);
  const activity = groupActivity(normalizedRows, timeBucket);
  const ticketSales = groupTicketSales(normalizedRows, timeBucket);

  return {
    rows: normalizedRows,
    invoices,
    customers,
    months,
    activity,
    ticketSales,
  };
}

function normalizeSalesRow(row) {
  const date = parseHopDate(row["Invoice date/time"]);
  const customerId = cleanValue(row["Customer ID"]);
  const customerName = cleanValue(row["Customer name"]);
  const customerEmail = cleanEmail(row["Customer email"]);

  return {
    date,
    invoiceId: cleanValue(row["Invoice #"]),
    customerId,
    customerName,
    customerEmail,
    customerKey: customerId || customerEmail || customerName || "unknown",
    text: cleanValue(row.Text),
    itemType: cleanValue(row["Item type"]),
    itemId: cleanValue(row["Item ID"]),
    quantity: parseHopNumber(row.Quantity),
    itemPrice: parseHopNumber(row["Item price"]),
    totalPrice: parseHopNumber(row["Total price"]),
    vatAmount: parseHopNumber(row["VAT amount"]),
    vatPercent: parseHopNumber(row["VAT %"]),
    paymentMethod: cleanValue(row["Payment method"]),
  };
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
        vatAmount: 0,
        lines: [],
        itemTypes: new Set(),
      });
    }
    const invoice = byInvoice.get(key);
    invoice.totalPrice += row.totalPrice;
    invoice.vatAmount += row.vatAmount;
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
        vat: 0,
        invoiceCount: 0,
        customerKeys: new Set(),
      });
    }
    const month = byMonth.get(key);
    month.revenue += invoice.totalPrice;
    month.vat += invoice.vatAmount;
    month.invoiceCount += 1;
    month.customerKeys.add(invoice.customerKey);
  }
  return Array.from(byMonth.values()).map((month) => ({
    month: month.month,
    revenue: month.revenue,
    vat: month.vat,
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
      });
    }
    const weekEntry = byWeek.get(week);
    const quantity = row.quantity || 1;
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
    weeks: Array.from(byWeek.values()),
    items: Array.from(byItem.values()).sort((a, b) => b.revenue - a.revenue),
  };
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
