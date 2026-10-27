import test from "node:test";
import assert from "node:assert/strict";
import { parseCodeMap } from "../../web/code-map-model.js";
import { layoutCodeMap } from "../../web/code-map-layout.js";

const layout = source => layoutCodeMap(parseCodeMap(source));
const find = (graph, label) => graph.nodes.find(n => n.label === label);
const connects = (graph, a, b, label) => graph.edges.some(e => e.from === a.id && e.to === b.id && (label === undefined || e.label === label));

test("branches have labelled alternatives, return exits, and helper call links", () => {
  const g = layout('function loop() { if (pressed) { paint(1); } else { return; } delay(20); } function paint(v) { ledShow(); }');
  const branch = find(g, 'pressed'), paint = find(g, 'paint(1);'), ret = find(g, 'return;'), delay = find(g, 'delay(20);');
  assert.ok(connects(g, branch, paint, 'Yes'));
  assert.ok(connects(g, branch, ret, 'No'));
  assert.ok(connects(g, paint, delay));
  assert.ok(!connects(g, ret, delay));
  assert.ok(g.edges.some(e => e.from === ret.id && e.label === 'Return'));
  assert.ok(g.edges.some(e => e.from === paint.id && e.to === find(g, 'paint(v)').id && e.kind === 'call'));
  assert.ok(paint.x + paint.width < ret.x);
});

test("continue and break target the innermost loop and for updates precede the next test", () => {
  const g = layout('function loop() { for (i=0;i<10;i++) { while (ready) { break; } if (skip) continue; paint(); } done(); }');
  const outer = g.nodes.find(n => n.kind === 'for'), inner = find(g, 'ready');
  const update = g.nodes.find(n => n.kind === 'update');
  const innerExit = g.nodes.find(n => connects(g, inner, n, 'No'));
  const outerExit = g.nodes.find(n => connects(g, outer, n, 'No'));
  assert.ok(connects(g, find(g, 'break;'), innerExit, 'break'));
  assert.ok(!connects(g, find(g, 'break;'), outerExit));
  assert.ok(connects(g, find(g, 'continue;'), update, 'continue'));
  assert.ok(connects(g, update, outer, 'Test again'));
  assert.ok(connects(g, outerExit, find(g, 'done();')));
});

test("nested branch layout has no node overlaps and all edge endpoints exist", () => {
  const g = layout('var a=0; function setup() { init(); } function loop() { if(a) { if(b) { go(); } else { stop(); } } else { while(c) { if(d) { f(); } else { g(); } } } finish(); }');
  for (const a of g.nodes) {
    assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y));
    for (const b of g.nodes) {
      if (a === b) continue;
      assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, `${a.label} overlaps ${b.label}`);
    }
  }
  for (const e of g.edges) assert.ok(g.nodes.some(n => n.id === e.from) && g.nodes.some(n => n.id === e.to));
});

test("empty, malformed and unsupported code do not invent flow connections", () => {
  assert.deepEqual(layout(''), { nodes: [], edges: [], groups: [] });
  assert.equal(layout('function loop() {').nodes.length, 0);
  const g = layout('function loop() { switch(a) { case 1: f(); } next(); }');
  const unknown = g.nodes.find(n => n.kind === 'source');
  assert.ok(!connects(g, unknown, find(g, 'next();')));
});

test("helper calls in conditions link to the helper function", () => {
  const g = layout('function loop() { if (ready()) go(); } function ready() { return digitalRead(33); }');
  assert.ok(g.edges.some(e => e.from === find(g, 'ready()').id && e.to === g.nodes.find(n => n.kind === 'entry' && n.label === 'ready()').id && e.kind === 'call'));
});
