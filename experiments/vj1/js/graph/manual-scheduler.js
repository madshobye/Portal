export function createManualScheduler() {
  const queue = [];

  function enqueue(event = {}) {
    queue.push({
      id: event.id || `event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      type: event.type || "event",
      target: event.target || "",
      payload: event.payload || {},
      createdAt: performance.now(),
    });
  }

  function drain(context = {}) {
    if (!queue.length) return [];
    const events = queue.splice(0, queue.length);
    return events.map((event) => ({
      ...event,
      frame: context.frame || 0,
      time: context.time || 0,
    }));
  }

  function clear() {
    queue.splice(0, queue.length);
  }

  return { enqueue, drain, clear, get size() { return queue.length; } };
}
