// Fast checks for the shared logic in extension/taxonomy.js (no browser needed).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = { self: {}, chrome: { storage: { local: { get: async () => ({}) } } } };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'extension', 'taxonomy.js'), 'utf8'), sandbox);
const T = sandbox.self.JEV_TAXONOMY;
const example = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'jev-settings-example.json'), 'utf8'));
const t = { ...T.DEFAULTS, ...example.taxonomy };

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('✓', name); };

test('defaults have no sender rules (each user learns their own)', () => assert.equal(T.DEFAULTS.rules.length, 0));
test('label names avoid characters Gmail search trips on', () => {
  for (const x of [...T.DEFAULTS.actions, ...T.DEFAULTS.topics, ...t.actions, ...t.topics]) assert.ok(!/[&"<>]/.test(x.label), x.label);
});
test('unsorted query excludes every action label', () => {
  assert.equal(T.unsortedQuery(T.DEFAULTS), '-label:jev-1-reply -label:jev-2-action -label:jev-3-read -label:jev-4-fyi -label:jev-5-low -label:jev-6-junk -label:jev-7-archive');
});
test('sender key groups company subdomains, keeps personal addresses', () => {
  assert.equal(T.senderKey('offers@news.shopmart.example'), 'shopmart.example');
  assert.equal(T.senderKey('someone@gmail.com'), 'someone@gmail.com');
  assert.equal(T.senderKey('team@mail.service.co.uk'), 'service.co.uk');
});
test('rules match full address first, then domain and parent domains', () => {
  assert.equal(T.ruleFor(t, 'boss@acme-corp.example').mustSee, true);
  assert.equal(T.ruleFor(t, 'hr@acme-corp.example').topic, 'work');
  assert.equal(T.ruleFor(t, 'x@deals.fashionhub.example').action, 'low');
  assert.equal(T.ruleFor(t, 'nobody@unknown.example'), null);
});
test('example rules only use categories that exist', () => {
  const topics = new Set(t.topics.map(x => x.key)), actions = new Set(t.actions.map(x => x.key));
  for (const r of t.rules) { assert.ok(topics.has(r.topic), r.match); if (r.action) assert.ok(actions.has(r.action), r.match); }
});
test('Gmail filters export: one label per filter, ignored senders archived', () => {
  const xml = T.filtersXml(t);
  assert.ok(xml.startsWith("<?xml") && xml.includes("schemas.google.com/apps/2006"));
  for (const entry of xml.split('<entry>').slice(1)) assert.ok((entry.match(/name='label'/g) || []).length <= 1);
  assert.match(xml, /megastore\.example[^]*?shouldArchive' value='true'/);
});

console.log(`\n${n} unit checks passed.`);
