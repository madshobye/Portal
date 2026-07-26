export const SIGNAL_LOAD_CATEGORIES = Object.freeze([
  "transactions",
  "invalidations",
  "compiles",
  "resourceRevisions",
  "cacheInvalidations",
  "cacheHits",
  "previewPresentations",
  "outputPresentations",
]);

const BUCKET_MS = 100;
const WINDOW_MS = 1000;
const registryKey = Symbol.for("vj1.signal-load-meters");

export function signalLoadMeter(scope = "control", {
  now = () => performance.now(),
} = {}) {
  const registry = globalThis[registryKey] ||= new Map();
  const key = String(scope || "control");
  if (!registry.has(key)) registry.set(key, createSignalLoadMeter({ now }));
  return registry.get(key);
}

export function createSignalLoadMeter({
  now = () => performance.now(),
} = {}) {
  const buckets = new Map();

  function record(category, count = 1, reason = "") {
    if (!SIGNAL_LOAD_CATEGORIES.includes(category)) {
      throw new Error(`VJ1_SIGNAL_LOAD_CATEGORY_UNKNOWN:${category}`);
    }
    const amount = Math.max(0, Number(count) || 0);
    if (!amount) return;
    const timestamp = Math.max(0, Number(now()) || 0);
    const bucketId = Math.floor(timestamp / BUCKET_MS);
    let bucket = buckets.get(bucketId);
    if (!bucket) {
      bucket = {
        categories: Object.create(null),
        reasons: Object.create(null),
      };
      buckets.set(bucketId, bucket);
    }
    bucket.categories[category] = (bucket.categories[category] || 0) + amount;
    const reasonKey = String(reason || "");
    if (reasonKey) {
      const key = `${category}:${reasonKey}`;
      bucket.reasons[key] = (bucket.reasons[key] || 0) + amount;
    }
    prune(timestamp);
  }

  function snapshot() {
    const timestamp = Math.max(0, Number(now()) || 0);
    prune(timestamp);
    const categories = emptyCategories();
    const reasons = Object.create(null);
    for (const bucket of buckets.values()) {
      for (const [category, count] of Object.entries(bucket.categories)) {
        categories[category] += count;
      }
      for (const [reason, count] of Object.entries(bucket.reasons)) {
        reasons[reason] = (reasons[reason] || 0) + count;
      }
    }
    return normalizeSignalLoadSnapshot({ categories, reasons });
  }

  function reset() {
    buckets.clear();
  }

  function prune(timestamp) {
    const oldestBucket = Math.floor((timestamp - WINDOW_MS) / BUCKET_MS);
    for (const bucketId of buckets.keys()) {
      if (bucketId <= oldestBucket) buckets.delete(bucketId);
    }
  }

  return { record, reset, snapshot };
}

export function mergeSignalLoadSnapshots(...snapshots) {
  const categories = emptyCategories();
  const reasons = Object.create(null);
  for (const snapshot of snapshots.filter(Boolean)) {
    for (const category of SIGNAL_LOAD_CATEGORIES) {
      categories[category] += Math.max(0, Number(snapshot.categories?.[category]) || 0);
    }
    for (const [reason, count] of Object.entries(snapshot.reasons || {})) {
      reasons[reason] = (reasons[reason] || 0) + Math.max(0, Number(count) || 0);
    }
  }
  return normalizeSignalLoadSnapshot({ categories, reasons });
}

function normalizeSignalLoadSnapshot({ categories, reasons }) {
  const totalPerSecond = SIGNAL_LOAD_CATEGORIES.reduce(
    (sum, category) => sum + categories[category],
    0,
  );
  // Presentations and successful cache reuse are expected throughput. The
  // pressure light describes coordination churn: authored edits, wakeups,
  // recompilation, resource changes, and cache destruction.
  const pressurePerSecond =
    categories.transactions * 4 +
    categories.invalidations +
    categories.compiles * 12 +
    categories.resourceRevisions * 2 +
    categories.cacheInvalidations * 3;
  const topReasons = Object.entries(reasons)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
  return {
    windowMs: WINDOW_MS,
    categories: { ...categories },
    reasons: { ...reasons },
    topReasons,
    totalPerSecond,
    pressurePerSecond,
    pressure: Math.min(1.5, pressurePerSecond / 120),
  };
}

function emptyCategories() {
  return Object.fromEntries(SIGNAL_LOAD_CATEGORIES.map((category) => [category, 0]));
}
