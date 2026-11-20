const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const source = readFileSync(path.join(__dirname, '../../ampower_visualize/page/warehouse_traceability/warehouse_traceability.js'), 'utf8');
// Evaluate the real class without executing the Desk registration or creating a view.
const View = runInNewContext(`(${source.slice(source.indexOf('class WarehouseTraceView')).trim()})`);
const makeModel = () => ({ nodes: new Map(), movements: new Map(), warehouseMoves: new Map(),
  linkKeys: new Map(), links: [], voucherSides: new Map(), batchVouchers: new Map() });
const warehouse = 'W::Stores - AT';
const node = (id) => ({ id, kind: id.startsWith('B::') ? 'batch' : 'warehouse', label: id.slice(3) });
const row = (id, batch_no, qty, posting_datetime, wh = warehouse) => ({ id, batch_no, qty, posting_datetime, warehouse: wh.slice(3), stock_uom: 'Nos' });
const edge = (source, target, movement_ids, depth = 0) => ({ source, target, kind: 'movement', movement_ids, depth });
const payload = (nodes, movements, graph_links) => ({ nodes: nodes.map(node), movements, graph_links });

 test('merging expansion deduplicates rows while keeping directed links and their latest events', () => {
  const model = makeModel();
  const batch = 'B::B1';
  const first = row('a', 'B1', -5, '2025-01-15 10:00:00');
  const next = row('b', 'B1', -7, '2025-01-16 10:00:00');
  const receipt = row('c', 'B1', 5, '2025-01-15 10:00:00');
  View.merge_model(model, payload([warehouse, batch], [first], [edge(warehouse, batch, ['a'])]), 0);
  const expansion = payload([warehouse, batch], [first, next, receipt], [edge(warehouse, batch, ['a', 'b']), edge(batch, warehouse, ['c'], 1)]);
  assert.ok(View.merge_model(model, expansion, 2) > 0);
  assert.equal(View.merge_model(model, expansion, 2), 0);
  assert.equal(model.nodes.size, 2);
  assert.equal(model.links.length, 2);
  assert.equal(model.links[0].depth, 0);
  assert.equal(model.links[1].depth, 3);
  assert.equal(View.link_label(model.links[0], model), '7 Nos · 2025-01-16 10:00:00 · 2 movements');
  assert.deepEqual(Array.from(View.details_rows(model, { link: model.links[0] }), r => r.id), ['b', 'a']);
  assert.deepEqual(Array.from(View.details_rows(model, { warehouse }), r => r.id), ['b', 'a', 'c']);
});

 test('a lineage connector labels independently recorded issue and receipt', () => {
  const model = makeModel();
  const old = row('issue', 'B1', -5, '2025-01-15 10:00:00');
  const next = row('receipt', 'B2', 3, '2025-01-15 10:01:00', 'W::Finished Goods - AT');
  const link = { source: 'B::B1', target: 'B::B2', kind: 'lineage', movement_ids: ['issue', 'receipt'], pairs: [['issue', 'receipt']], depth: 1 };
  View.merge_model(model, payload([link.source, link.target], [old, next], [link]), 0);
  assert.equal(View.link_label(model.links[0], model), '5 issued / 3 received · 2025-01-15 10:00:00 → 2025-01-15 10:01:00');
});

 test('warehouse visibility keeps expanded batches and respects manual show and hide', () => {
  const model = makeModel();
  const batches = Array.from({ length: 6 }, (_, index) => `B::B${index}`);
  const rows = batches.map(id => row(id, id.slice(3), -1, '2025-01-15 10:00:00'));
  View.merge_model(model, payload([warehouse, ...batches], rows, batches.map(id => edge(warehouse, id, [id]))), 0);
  const view = Object.assign(Object.create(View.prototype), { graph_model: model, batch_no: batches[0],
    expanded: new Set([batches[5]]), hidden: new Set(), manual_visibility: new Map(), partial: true });
  view.auto_truncate();
  assert.equal(view.visible_model().links.length, 4);
  assert.equal(view.is_hidden_on(warehouse, batches[5]), false);
  assert.match(view.badge_text(), /2 hidden.*Partial trace/);
  view.manual_visibility.set(view.hide_key(warehouse, batches[4]), false);
  view.manual_visibility.set(view.hide_key(warehouse, batches[1]), true);
  view.auto_truncate();
  assert.equal(view.visible_model().links.some(link => link.to === batches[4]), true);
  assert.equal(view.visible_model().links.some(link => link.to === batches[1]), false);
});
