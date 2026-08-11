const SCHOLAR_TOPIC_COLORS = [
  "#d66c43", "#785ba7", "#287c78", "#c38a29", "#4d78ad", "#c85275",
  "#58834b", "#8c6844", "#4f8ca4", "#a45178", "#6d766f", "#9b7e2f",
  "#497b65", "#8d5a52", "#6d70af", "#ba6847", "#597984", "#8a6994",
];

function buildScholarSystem(raw) {
  validateScholarJson(raw);
  const papers = raw.papers.map((paper, index) => normalizeScholarPaper(paper, index));
  const paperById = new Map(papers.map((paper) => [paper.id, paper]));
  const topics = new Map();
  const authors = new Map();

  for (const paper of papers) {
    paper.topics.forEach((label) => {
      const id = `topic:${slugScholar(label)}`;
      if (!topics.has(id)) topics.set(id, { id, kind: "topic", label, paperIds: new Set(), authorIds: new Set() });
      topics.get(id).paperIds.add(paper.id);
    });
    paper.authors.forEach((authorData) => {
      const id = `author:${authorData.id || slugScholar(authorData.name)}`;
      if (!authors.has(id)) authors.set(id, {
        id,
        kind: "author",
        label: authorData.name || "Unknown author",
        orcid: authorData.orcid || null,
        affiliations: new Set(authorData.affiliations || []),
        paperIds: new Set(),
        topicIds: new Set(),
      });
      const author = authors.get(id);
      author.paperIds.add(paper.id);
      (authorData.affiliations || []).forEach((value) => author.affiliations.add(value));
      paper.authorIds.push(id);
      paper.topics.forEach((topicLabel) => {
        const topicId = `topic:${slugScholar(topicLabel)}`;
        author.topicIds.add(topicId);
        topics.get(topicId).authorIds.add(id);
      });
    });
  }

  const topicList = Array.from(topics.values()).sort((a, b) => b.paperIds.size - a.paperIds.size || a.label.localeCompare(b.label));
  topicList.forEach((topic, index) => { topic.color = SCHOLAR_TOPIC_COLORS[index % SCHOLAR_TOPIC_COLORS.length]; });
  const topicByLabel = new Map(topicList.map((topic) => [topic.label, topic]));
  papers.forEach((paper) => { paper.primaryTopic = topicByLabel.get(paper.topics[0]) || topicList[0]; });

  const dates = papers.map((paper) => paper.time).filter(Number.isFinite);
  const minMonth = Math.min(...dates.map(scholarMonthIndex));
  const maxMonth = Math.max(...dates.map(scholarMonthIndex));
  const recordTypes = Array.from(new Set(papers.map((paper) => paper.recordType).filter(Boolean))).sort();

  return {
    metadata: raw.metadata || {},
    papers,
    paperById,
    topics,
    topicList,
    authors,
    authorList: Array.from(authors.values()).sort((a, b) => b.paperIds.size - a.paperIds.size || a.label.localeCompare(b.label)),
    recordTypes,
    minMonth,
    maxMonth,
  };
}

function validateScholarJson(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.papers)) throw new Error("Expected a JSON object containing a papers array.");
  if (!raw.papers.length) throw new Error("The papers array is empty.");
  const invalid = raw.papers.findIndex((paper) => !paper || typeof paper !== "object" || !paper.title || !Array.isArray(paper.authors) || !Array.isArray(paper.topics));
  if (invalid >= 0) throw new Error(`Paper ${invalid + 1} must contain title, authors[], and topics[].`);
}

function normalizeScholarPaper(source, index) {
  const publication = source.publication || {};
  const alert = source.scholarAlert || {};
  const timeValue = parseScholarJsonDate(alert.latestDate)
    || parseScholarJsonDate(alert.firstDate)
    || parseScholarJsonDate(publication.date)
    || (Number(publication.year) ? new Date(Number(publication.year), 0, 1).getTime() : null);
  const id = String(source.id || source.doi || `paper-${index}`);
  const topics = [...new Set((source.topics || []).map(cleanScholarText).filter(Boolean))];
  const authors = (source.authors || []).map((author, authorIndex) => ({
    id: cleanScholarText(author?.id) || `name:${slugScholar(author?.name || `unknown-${authorIndex}`)}`,
    name: cleanScholarText(author?.name) || "Unknown author",
    orcid: cleanScholarText(author?.orcid) || null,
    affiliations: [...new Set((author?.affiliations || []).map(cleanScholarText).filter(Boolean))],
  }));
  const paper = {
    source,
    id,
    kind: "paper",
    label: cleanScholarText(source.title) || "Untitled paper",
    title: cleanScholarText(source.title) || "Untitled paper",
    doi: cleanScholarText(source.doi) || null,
    authors,
    authorIds: [],
    topics: topics.length ? topics : ["Uncategorized"],
    publicationDate: cleanScholarText(publication.date) || null,
    publicationYear: Number(publication.year) || null,
    venue: cleanScholarText(publication.venue) || null,
    recordType: cleanScholarText(publication.recordType) || "Other",
    abstract: cleanScholarText(source.abstract),
    keywords: (source.keywords || []).map(cleanScholarText).filter(Boolean),
    methods: (source.methods || []).map(cleanScholarText).filter(Boolean),
    researchContexts: (source.researchContexts || []).map(cleanScholarText).filter(Boolean),
    technologies: (source.technologies || []).map(cleanScholarText).filter(Boolean),
    countries: (source.countries || []).map(cleanScholarText).filter(Boolean),
    citationCount: source.citationCount !== null && source.citationCount !== "" && Number.isFinite(Number(source.citationCount)) ? Number(source.citationCount) : null,
    openAccess: source.openAccess === true,
    articleLink: cleanScholarText(source.articleLink),
    pdfLink: cleanScholarText(source.pdfLink),
    firstAlertDate: cleanScholarText(alert.firstDate) || null,
    latestAlertDate: cleanScholarText(alert.latestDate) || null,
    triggeredBy: (alert.triggeredBy || []).map(cleanScholarText).filter(Boolean),
    verified: source.dataQuality?.verified === true,
    completeAuthorList: source.dataQuality?.completeAuthorList === true,
    qualityNotes: cleanScholarText(source.dataQuality?.notes),
    originalTopicNote: cleanScholarText(source.originalTopicNote),
    sources: Array.isArray(source.sources) ? source.sources : [],
    time: timeValue || 0,
  };
  paper.searchText = [
    paper.title, paper.authors.map((author) => author.name).join(" "), paper.topics.join(" "), paper.venue,
    paper.abstract, paper.keywords.join(" "), paper.methods.join(" "), paper.researchContexts.join(" "),
    paper.technologies.join(" "), paper.countries.join(" "), paper.triggeredBy.join(" "), paper.doi,
  ].join(" ").toLowerCase();
  return paper;
}

function scholarMonthIndex(time) {
  const date = new Date(time);
  return date.getFullYear() * 12 + date.getMonth();
}

function scholarMonthDate(index) { return new Date(Math.floor(index / 12), index % 12, 1); }
function cleanScholarText(value) { return String(value ?? "").trim(); }
function slugScholar(value) { return cleanScholarText(value).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function parseScholarJsonDate(value) { const time = Date.parse(String(value || "")); return Number.isFinite(time) ? time : null; }
function hashScholar(value) { let hash = 2166136261; for (const char of String(value || "")) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); } return hash >>> 0; }
