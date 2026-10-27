import test from "node:test";
import assert from "node:assert/strict";
import { filesFromDrop, normalizeBugReport, reportsToMarkdown, markdownFence, recoverReportChat } from "../../web/bug-report-model.js";

const prompt = (content, at) => ({ role: "user", content, at });
test("recovers overlapping history regardless of revision number and excludes later prompts", () => {
  const a = prompt("red", "2026-01-01"), b = prompt("white", "2026-01-02");
  const c = prompt("fade", "2026-01-03"), later = prompt("blue", "2026-01-04");
  const report = { revisions: [
    { name: "Version 14", chat: [b, c] },
    { name: "Version 13", chat: [prompt("Unrelated branch", "2025-12-31")] },
    { name: "Version 2", chat: [a, b, c, later] },
  ] };
  const recovered = recoverReportChat(report, 0);
  assert.deepEqual(recovered.messages, [a, b, c]);
  assert.deepEqual(recovered.sources, [2]);
  assert.equal(recovered.ambiguous, false);
});

test("does not join conflicting branches or guess from text without timestamps", () => {
  const anchor = prompt("white", "2026-01-02");
  const report = { revisions: [
    { chat: [anchor] },
    { chat: [prompt("red", "2026-01-01"), anchor] },
    { chat: [prompt("blue", "2026-01-01"), anchor] },
  ] };
  assert.equal(recoverReportChat(report, 0).ambiguous, true);
  assert.deepEqual(recoverReportChat(report, 0).messages, [anchor]);
  assert.equal(recoverReportChat({ revisions: [
    { chat: [prompt("white")] }, { chat: [prompt("red"), prompt("white")] },
  ] }, 0).sources.length, 0);
});

test("preserves repeated prompts with different times and recovers successive overlaps", () => {
  const a = prompt("again", 1), b = prompt("again", 2), c = prompt("again", 3);
  const result = recoverReportChat({ revisions: [
    { chat: [c] }, { chat: [b, c] }, { chat: [a, b] },
  ] }, 0);
  assert.deepEqual(result.messages, [a, b, c]);
});

test("preserves long conversations and selects the captured revision after sorting", () => {
  const chat = Array.from({ length: 101 }, (_, i) => ({ role: "user", content: `Message ${i}`, timestamp: i }));
  const report = normalizeBugReport({ kind: "xobit-bug-report", project: {
    name: "Example", activeRevisionId: "new",
    revisions: [
      { id: "new", createdAt: "2026-02-01", chat, code: "``` nested fence" },
      { id: "old", createdAt: "2026-01-01", chat: [{ role: "assistant", content: "Earlier" }] },
    ],
  } });
  assert.equal(report.selectedIndex, 1);
  assert.equal(report.revisions[1].chat.length, 101);
  const markdown = reportsToMarkdown([report]);
  assert.match(markdown, /Message 100/);
  assert.match(markdown, /Earlier/);
  assert.match(markdown, /"timestamp": 100/);
  assert.match(markdown, /````c\n``` nested fence\n````/);
});

test("supports single revision reports and project exports, without inventing an active revision", () => {
  const legacy = normalizeBugReport({ project: { revision: { chatTranscript: "Hello", code: "test" } } });
  assert.equal(legacy.revisions.length, 1);
  assert.equal(legacy.activeIndex, -1);
  assert.match(reportsToMarkdown([legacy]), /Hello/);
  assert.equal(normalizeBugReport({ type: "xobit-project", revisions: [{ id: "a" }] }).revisions.length, 1);
  assert.throws(() => normalizeBugReport({ unrelated: true }));
  assert.throws(() => normalizeBugReport(null));
  assert.equal(normalizeBugReport({ kind: "xobit-bug-report" }).selectedIndex, -1);
  assert.equal(markdownFence("````"), "`````\n````\n`````");
});

test("folder drops read every batch, recurse, and retain readable files when a sibling fails", async () => {
  const file = (name) => ({ name, isFile: true, file: (resolve) => resolve({ name }) });
  const directory = (name, batches) => ({
    name, isDirectory: true,
    createReader: () => ({ readEntries: (resolve) => resolve(batches.shift() || []) }),
  });
  const root = directory("folder", [
    Array.from({ length: 100 }, (_, i) => file(`${i}.json`)),
    [directory("nested", [[file("last.json")]]),
      { name: "bad.json", isFile: true, file: (_, reject) => reject(new Error("unreadable")) }],
  ]);
  const result = await filesFromDrop({ items: [{ kind: "file", webkitGetAsEntry: () => root }] });
  assert.equal(result.files.length, 101);
  assert.equal(result.files[100].path, "folder/nested/last.json");
  assert.deepEqual(result.errors, ["folder/bad.json: unreadable"]);
});

test("plain file drops work without directory APIs", async () => {
  const file = { name: "report.json" };
  assert.deepEqual((await filesFromDrop({ files: [file] })).files, [{ file, path: file.name }]);
  assert.deepEqual((await filesFromDrop({ items: [{ kind: "file", getAsFile: () => file }] })).files,
    [{ file, path: file.name }]);
});
