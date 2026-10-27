import test from "node:test";
import assert from "node:assert/strict";
import { parseCodeMap, describeCodeNode, canContinueCodeFlow } from "../../web/code-map-model.js";

test("parses setup, loop, nested branches and loops with source locations", () => {
  const source = `var pin = 33;
function setup() { pinMode(pin, INPUT_PULLUP); }
function loop() {
  if (digitalRead(pin) == LOW) { paint(255); } else { paint(0); }
  for (var i=0; i<15; i++) { ledSet(0,i,255,0,0); }
  delay(20);
}
function paint(value) { ledShow(); }`;
  const result = parseCodeMap(source);
  assert.equal(result.error, "");
  const loop = result.nodes[2];
  assert.equal(loop.name, "loop");
  assert.equal(loop.children[0].kind, "if");
  assert.deepEqual(loop.children[0].children[0].calls, ["paint"]);
  assert.equal(loop.children[0].line, 4);
  assert.equal(loop.children[1].kind, "for");
  assert.equal(loop.children[1].children.length, 1);
  assert.equal(describeCodeNode(loop.children[2]).label, "Wait");
  assert.equal(source.slice(loop.start, loop.end), loop.text);
});

test("comments and quoted braces cannot change structure", () => {
  const result = parseCodeMap('/* { ignored */ function loop() { println("if (x) { \\\" };"); // }\n delay(1); }');
  assert.equal(result.error, "");
  assert.equal(result.nodes[0].children.length, 2);
});

test("single statement branches bind else correctly and terminal branches do not join", () => {
  const result = parseCodeMap('function f() { if (a) if (b) return 1; else return 2; else return 3; println(4); }');
  assert.equal(result.error, "");
  const branch = result.nodes[0].children[0];
  assert.equal(branch.children[0].alternate[0].text, 'return 2;');
  assert.equal(branch.alternate[0].text, 'return 3;');
  assert.equal(canContinueCodeFlow(branch), false);
});

test("unknown flow remains intact and malformed code gives an error", () => {
  const source = 'function loop() { switch (a) { case 1: break; default: f(); } do { f(); } while(a); g(); }';
  const result = parseCodeMap(source);
  assert.equal(result.error, "");
  assert.deepEqual(result.nodes[0].children.map(n => n.kind), ['source', 'source', 'statement']);
  for (const code of ['function f() {', 'function f() { println("bad); }', '/* bad', 'function f() { if x; }']) {
    assert.ok(parseCodeMap(code).error, code);
  }
  assert.ok(parseCodeMap('x'.repeat(150001)).error);
});
