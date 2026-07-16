(async function initHopReport() {
  const root = document.getElementById("report");
  try {
    const storedSales = loadHopCsv();
    if (!storedSales?.text) {
      root.innerHTML = `<div class="empty-state"><p class="eyebrow">Ingen data</p><h2>Rapporten mangler dashboarddata</h2><p>Åbn dashboardet, indlæs salgs-CSV'en og bookingfilerne, og gem dem i browseren.</p><p><a href="./">Gå til dashboardet →</a></p></div>`;
      return;
    }
    const salesRows = parseCsvText(storedSales.text).rows;
    const bookingSources = await loadHopBookingCsvs();
    const bookingRows = dedupeHopReportBookings(bookingSources.flatMap((source) => parseCsvText(source.text).rows));
    const allDateMs = [
      ...salesRows.map((row) => parseHopDate(row["Invoice date/time"])?.getTime?.() || 0),
      ...bookingRows.map((row) => parseHopBookingDate(row.Date)?.getTime?.() || 0),
    ].filter(Boolean);
    const rangeStartMs = allDateMs.reduce((earliest, value) => Math.min(earliest, value), Infinity);
    const rangeEndMs = allDateMs.reduce((latest, value) => Math.max(latest, value), 0);
    const model = buildHopModel(salesRows, "month", {
      bookingRows,
      historicalBookingRows: bookingRows,
      activityPathRows: salesRows,
      retentionRows: salesRows,
      membershipLengthRows: salesRows,
      purchaseTimingRows: salesRows,
      firstTouchpointRows: salesRows,
      rangeStartMs: Number.isFinite(rangeStartMs) ? rangeStartMs : null,
      rangeEndMs: rangeEndMs || null,
      activityPathSource: "combined",
    });
    const report = buildHopReportModel(model);
    root.innerHTML = renderHopReport(report, bookingSources.length);
  } catch (error) {
    console.error("[hopdashboard report]", error);
    root.innerHTML = `<div class="empty-state"><p class="eyebrow">Fejl</p><h2>Rapporten kunne ikke bygges</h2><p>${escapeReportHtml(error?.message || String(error))}</p><p><a href="./">Tilbage til dashboardet →</a></p></div>`;
  }
})();

function renderHopReport(report, bookingFileCount) {
  const coverage = report.coverage;
  return [
    reportSection("overblik", "01", "Overblik og læsevejledning", `
      <p class="lead">Rapporten samler de vigtigste spørgsmål om introduktioner, kerneaktiviteter, events, medlemmer, community og crew. Tallene er deskriptive: de viser observerede køb og bookinger, ikke nødvendigvis fremmøde eller kausal effekt.</p>
      <div class="metric-grid">
        ${metric("Personidentiteter", n(coverage.people), "Samlet på tværs af salg og bookinger")}
        ${metric("Salgslinjer", n(coverage.salesRows), `${date(coverage.salesStart)} – ${date(coverage.salesEnd)}`)}
        ${metric("Bookinger", n(coverage.bookingRows), `${date(coverage.bookingStart)} – ${date(coverage.bookingEnd)}`)}
        ${metric("Bookingfiler", n(bookingFileCount), "Årlige eksportfiler efter dubletfjernelse")}
      </div>
      <div class="warning-card"><h3>Vigtig fortolkning</h3><p>En booking dokumenterer tilmelding, ikke fremmøde. Medlemskab estimeres fra betalte abonnementstransaktioner. Aktivitetstitler normaliseres, men forretningskategorier som “regular” og “special” findes ikke direkte i eksporten.</p></div>
    `),
    reportSection("introduktioner", "02", "Hvor går folk hen fra introduktionsaktiviteterne?", renderIntroReport(report.intro)),
    reportSection("intensives", "03", "Historien om de to store intensives", `
      <p class="lead">Her undersøges publikum, gentagelse, medlemsrelation, økonomi og de hyppigste aktiviteter før og efter de to navngivne formater.</p>
      <div class="story-grid">${report.intensiveProfiles.length ? report.intensiveProfiles.map(renderActivityStory).join("") : missingCard("De to intensive-titler blev ikke fundet i de indlæste data.")}</div>
    `),
    reportSection("reb-og-play", "04", "Samme spørgsmål til rebkurserne og Play Parties", `
      <p class="lead">Grupperne er fundet via aktivitetstitler med rope/ropes/shibari/bondage og Play Party/Play Night. Resultaterne skal kvalitetssikres mod jeres egen aktivitetstaksonomi.</p>
      <div class="comparison">
        ${renderGroupStory("Rebkurser og rebaktiviteter", report.ropeCourses)}
        ${renderGroupStory("Play Parties og Play Night", report.playParties)}
      </div>
    `),
    reportSection("kerneevents", "05", "Hvilken rolle spiller de vigtigste events?", `
      <p class="lead">Tabellen læser events som både økonomiske produkter, community-ankre og trin i deltagernes rejse. “Første” og “sidste” er inden for den indlæste datadækning.</p>
      ${renderCoreEventTable(report.coreEvents)}
      <div class="finding"><h3>Sådan læses rollerne</h3><p>Høj andel “første aktivitet” peger på gateway-potentiale. Høj gentagelse peger på vane og community. Mange relaterede aktivitetstyper viser en brofunktion. Omsætningen viser økonomisk bidrag, men kan ikke sammenlignes rent med gratis eller medlemsinkluderede bookinger.</p></div>
    `),
    reportSection("regular-special", "06", "Regular events versus special events", renderRegularSpecial(report)),
    reportSection("nye-events", "07", "Hvis vi skulle skabe to nye events", `
      <p class="lead">Forslagene er dataunderstøttede produkt-hypoteser. De bør testes som små pilotforløb med klare mål for gentagelse, medlemskonvertering, dækningsbidrag og oplevet community-værdi.</p>
      <div class="story-grid">${report.recommendations.map((item, index) => `
        <article class="recommendation"><span class="recommendation-tag">Forslag ${index + 1}</span><h3>${e(item.title)}</h3><p>${e(item.format)}</p><p class="source-note">Datagrundlag: ${e(item.evidence)}</p></article>
      `).join("")}</div>
    `),
    reportSection("medlemmer", "08", "Hvem bliver medlemmer, og hvad sker der bagefter?", renderMembership(report.membership)),
    reportSection("kerne", "09", "Hvor stor er gruppen, der udgør kernen?", renderCore(report.core, report.definitions.core)),
    reportSection("crew", "10", "Crew og facilitatorer", renderCrew(report.crew)),
    reportSection("metode", "11", "Metode, definitioner og datagab", `
      <div class="story-grid">
        <article class="story-card"><h3>Regular event</h3><p>${e(report.definitions.regular)}</p></article>
        <article class="story-card"><h3>Special event</h3><p>${e(report.definitions.special)}</p></article>
        <article class="story-card"><h3>Kerne</h3><p>${e(report.definitions.core)}</p></article>
        <article class="story-card"><h3>Identitetsmatch</h3><p>E-mail er den primære nøgle. Navn bruges som sekundær nøgle. Bookinger uden match kan følges i bookingdata, men ikke sikkert kobles til køb eller medlemskab.</p></article>
      </div>
      <div class="warning-card"><h3>Data der vil løfte næste version</h3><p>Fremmøde/afbud/no-show, facilitator pr. session, kapacitet, officiel aktivitetstype, regular/special-flag, eventdato for solgte billetter, medlemsstopårsag, dækningsbidrag og kvalitative community-målinger. Salgsfilens dato er købstidspunktet; kun bookingfilen giver en egentlig planlagt aktivitetsdato.</p></div>
    `),
  ].join("");
}

function renderIntroReport(intro) {
  const summary = intro.summary || {};
  const rows = (intro.cohorts || []).map((cohort) => {
    const outcomes = Object.fromEntries((cohort.outcomes || []).map((item) => [item.key, item]));
    return `<tr><td>${e(cohort.label)}</td><td>${n(cohort.signups)}</td><td>${n(cohort.eligible90)}</td><td>${pct(cohort.continuedRate90)}</td><td>${n(outcomes.paidClass?.count)}</td><td>${n(outcomes.subscription?.count)}</td><td>${n(outcomes.subscriptionBooking?.count)}</td><td>${n(outcomes.anotherIntro?.count)}</td><td>${n(outcomes.noReturn?.count)}</td><td>${cohort.continued90 ? `${decimal(cohort.medianDays90)} dage` : "—"}</td><td>${dkk(cohort.revenue90)}</td></tr>`;
  }).join("");
  return `
    <p class="lead">En person tælles én gang pr. introduktion. Destinationen er den første senere booking eller det første senere køb inden for 90 dage. Nyere tilmeldinger uden 90 dages datadækning holdes ude af konverteringsraten.</p>
    <div class="metric-grid">
      ${metric("Introtilmeldinger", n(summary.totalSignups), `${n(summary.uniquePeople)} unikke personer`)}
      ${metric("90-dages modne", n(summary.eligible90), `${n(summary.pending90)} afventer`)}
      ${metric("Fortsatte inden 90 dage", pct(summary.continuedRate90), `${n(summary.continued90)} personer`)}
      ${metric("Identitetsmatch", pct(summary.matchRate), "Kan kobles til salg og medlemskab")}
    </div>
    <table class="data-table"><thead><tr><th>Introduktion</th><th>Tilmeld.</th><th>Modne 90d</th><th>Fortsat</th><th>Betalt</th><th>Nyt medlem</th><th>Medlemsbooking</th><th>Ny intro</th><th>Ingen</th><th>Median</th><th>90d oms.</th></tr></thead><tbody>${rows || `<tr><td colspan="11" class="missing">Ingen introduktionstilmeldinger fundet.</td></tr>`}</tbody></table>
    <div class="story-grid">${(intro.cohorts || []).map((cohort) => `<article class="story-card"><h3>${e(cohort.label)}</h3><p>Hyppigste næste destinationer blandt modne forløb:</p>${rankList(cohort.topDestinations, "count")}</article>`).join("")}</div>`;
}

function renderActivityStory(profile) {
  return `<article class="story-card">
    <p class="eyebrow">${e(profile.sourceLabel)}</p><h3>${e(profile.label)}</h3>
    <div class="metric-grid compact">
      ${metric("Personer", n(profile.totalPeople))}${metric("Omsætning", dkk(profile.revenue))}${metric("Gentagelse", pct(profile.repeatRate))}${metric("Medlemmer ved start", n(profile.subscribersAtSelection))}
    </div>
    <p>${n(profile.firstElementPeople)} (${pct(profile.firstElementRate)}) har aktiviteten som første registrerede aktivitet; ${n(profile.lastElementPeople)} (${pct(profile.lastElementRate)}) som sidste. Medianen til en anden aktivitet er ${profile.next?.length ? `${decimal(profile.medianDaysToNext)} dage` : "ikke tilgængelig"}.</p>
    <h3>Næste destinationer</h3>${rankList(profile.next, "people")}
    <h3>Stærkeste relationer</h3>${rankList(profile.related, "people")}
  </article>`;
}

function renderGroupStory(title, group) {
  return `<article class="story-card"><h3>${e(title)}</h3>
    <div class="metric-grid compact">${metric("Aktivitetstyper", n(group.itemCount))}${metric("Personer", n(group.people))}${metric("Medlemsandel", pct(group.memberRate))}${metric("Gentagelse", pct(group.repeatRate))}</div>
    <p>Registreret brug: ${n(group.use)}. Salgsomsætning: ${dkk(group.revenue)}.</p>
    <h3>Næste andre aktiviteter</h3>${rankList(group.next, "count")}
    <h3>Andre fælles aktiviteter</h3>${rankList(group.related, "count")}
  </article>`;
}

function renderCoreEventTable(events) {
  const rows = events.map((item) => item.missing
    ? `<tr><td>${e(item.requestedLabel)}</td><td colspan="8" class="missing">Ikke fundet som aktivitetstitel i data</td></tr>`
    : `<tr><td>${e(item.label)}</td><td>${n(item.totalPeople)}</td><td>${n(item.totalRecordedUse)}</td><td>${dkk(item.revenue)}</td><td>${pct(item.repeatRate)}</td><td>${pct(item.firstElementRate)}</td><td>${pct(item.lastElementRate)}</td><td>${n(item.knownSubscriberCount)}</td><td>${e(item.related?.[0]?.label || "—")}</td></tr>`).join("");
  return `<table class="data-table"><thead><tr><th>Event</th><th>Personer</th><th>Brug</th><th>Omsætning</th><th>Gentagelse</th><th>Første</th><th>Sidste</th><th>Medlemmer</th><th>Stærkeste relation</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderRegularSpecial(report) {
  const r = report.recurrence;
  return `<p class="lead">Da eksporten ikke har et regular/special-felt, bruges bookingfrekvens som en foreløbig, transparent proxy. Paid-only events uden sessionsdato vil typisk lande som special og bør klassificeres manuelt.</p>
    <div class="definition"><strong>Regular:</strong> ${e(report.definitions.regular)}<br><strong>Special:</strong> ${e(report.definitions.special)}</div>
    <table class="data-table"><thead><tr><th>Gruppe</th><th>Typer</th><th>Personer</th><th>Brug</th><th>Omsætning</th><th>Medlemsandel</th><th>Gentagelse</th></tr></thead><tbody>
      <tr><td>Regular events</td><td>${n(r.regular.itemCount)}</td><td>${n(r.regular.people)}</td><td>${n(r.regular.use)}</td><td>${dkk(r.regular.revenue)}</td><td>${pct(r.regular.memberRate)}</td><td>${pct(r.regular.repeatRate)}</td></tr>
      <tr><td>Special events</td><td>${n(r.special.itemCount)}</td><td>${n(r.special.people)}</td><td>${n(r.special.use)}</td><td>${dkk(r.special.revenue)}</td><td>${pct(r.special.memberRate)}</td><td>${pct(r.special.repeatRate)}</td></tr>
    </tbody></table>
    <div class="comparison"><article class="story-card"><h3>Største regular events</h3>${rankList(r.regularItems.slice(0, 10), "use")}</article><article class="story-card"><h3>Største special events</h3>${rankList(r.specialItems.slice(0, 10), "use")}</article></div>`;
}

function renderMembership(m) {
  return `<p class="lead">Historien starter ved den første observerede betalte abonnementstransaktion. “Stoppet” er et estimeret afsluttet betalingsforløb; årsagen findes ikke i disse CSV'er.</p>
    <div class="metric-grid">${metric("Betalte medlemmer", n(m.count))}${metric("Aktivitet før medlemskab", pct(m.activityBeforeRate), `${n(m.activityBefore)} personer`)}${metric("Aktivitet efter start", pct(m.activityAfterRate), `${n(m.activityAfter)} personer`)}${metric("Booking efter start", pct(m.bookingAfterRate), `${n(m.bookingAfter)} personer`)}</div>
    <div class="metric-grid">${metric("Median varighed", `${decimal(m.medianMonths)} mdr.`)}${metric("Gennemsnitlig varighed", `${decimal(m.avgMonths)} mdr.`)}${metric("Estimeret aktive", n(m.activeCount))}${metric("Afsluttede forløb", n(m.endedCount), `${n(m.noBookingCount)} forløb uden booking`)}</div>
    <div class="comparison"><article class="story-card"><h3>Aktiviteter før medlemskab</h3>${rankList(m.before, "count")}</article><article class="story-card"><h3>Aktiviteter efter medlemsstart</h3>${rankList(m.after, "count")}</article></div>`;
}

function renderCore(core, definition) {
  return `<p class="lead">Kernen er defineret adfærdsmæssigt og kan justeres. Den er ikke det samme som medlemmer eller crew.</p>
    <div class="definition">${e(definition)}</div>
    <div class="metric-grid">${metric("Personer i kernen", n(core.count), `${pct(core.share)} af aktive personer`)}${metric("Medlemsandel", pct(core.memberRate), `${n(core.memberCount)} medlemmer`)}${metric("Crew i kernen", n(core.crewCount))}${metric("Gns. bredde", `${decimal(core.avgTypes)} typer`, `${decimal(core.avgInteractions)} interaktioner`)}</div>
    <div class="story-card"><h3>Kernens vigtigste aktiviteter</h3>${rankList(core.topActivities, "count")}</div>`;
}

function renderCrew(crew) {
  return `<div class="metric-grid">${metric("Crew-identiteter", n(crew.count))}${metric("Crew med aktivitet", n(crew.activeCrew))}</div>
    <div class="comparison"><article class="story-card"><h3>Aktiviteter crew selv deltager i</h3>${rankList(crew.topActivities, "count")}</article><article class="warning-card"><h3>Facilitatorrangering kan ikke beregnes</h3><p>Customer-feltet fortæller, hvem der købte eller bookede—ikke hvem der faciliterede. Crew-medlemskab er heller ikke dokumentation for facilitering af en bestemt aktivitet.</p><p>Tilføj minimum: session-ID, facilitatornavn/-ID, rolle, dato, kapacitet, fremmøde og aktivitetstype.</p></article></div>`;
}

function reportSection(id, number, title, body) {
  return `<section id="${id}" class="report-section"><span class="section-number">${number}</span><h2>${title}</h2>${body}</section>`;
}
function metric(label, value, note = "") { return `<div class="metric"><span class="metric-label">${e(label)}</span><strong class="metric-value">${e(value)}</strong>${note ? `<span class="metric-note">${e(note)}</span>` : ""}</div>`; }
function missingCard(message) { return `<article class="warning-card"><h3>Ikke tilgængeligt</h3><p>${e(message)}</p></article>`; }
function rankList(items, valueKey) {
  const entries = (items || []).slice(0, 8);
  if (!entries.length) return `<p class="missing">Ingen relationer fundet.</p>`;
  return `<ol class="rank-list">${entries.map((item) => `<li><span>${e(item.label)}</span><span>${n(item[valueKey] || 0)}${item.share != null ? ` · ${pct(item.share)}` : ""}</span></li>`).join("")}</ol>`;
}
function n(value) { return Math.round(Number(value) || 0).toLocaleString("da-DK"); }
function decimal(value) { return (Number(value) || 0).toLocaleString("da-DK", { maximumFractionDigits: 1 }); }
function pct(value) { return `${Math.round((Number(value) || 0) * 100)}%`; }
function dkk(value) { return `${Math.round(Number(value) || 0).toLocaleString("da-DK")} kr.`; }
function date(value) { return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toLocaleDateString("da-DK") : "—"; }
function e(value) { return escapeReportHtml(value); }
function escapeReportHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }

function dedupeHopReportBookings(rows) {
  const byKey = new Map();
  for (const row of rows || []) {
    const dateValue = parseHopBookingDate(row.Date);
    if (!dateValue) continue;
    const key = [
      normalizeIdentityEmail(row.Email) || normalizeIdentityName(row.Customer),
      dateValue.getTime(),
      cleanValue(row["Start Time"]),
      cleanValue(row["End Time"]),
      cleanValue(row.Room).toLowerCase(),
      cleanValue(row["Class Type"]).toLowerCase(),
    ].join("|");
    if (!byKey.has(key)) byKey.set(key, row);
  }
  return Array.from(byKey.values());
}
