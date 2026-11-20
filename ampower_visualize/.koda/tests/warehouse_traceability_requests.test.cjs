const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const source = readFileSync(path.join(__dirname, '../../ampower_visualize/page/warehouse_traceability/warehouse_traceability.js'), 'utf8');
const View = runInNewContext(`(${source.slice(source.indexOf('class WarehouseTraceView')).trim()})`);

test('initial and expansion requests send the company, dates and exactly one seed', () => {
  const scope = { company: 'Ambibuzz Technologies', direction: -1,
    from_datetime: '2025-01-15 00:00:00', to_datetime: '2025-01-16 23:59:59' };
  const first = View.trace_request(scope, 'Warehouse', 'Stores - AT', 0);
  assert.match(first.method, /\.warehouse_traceability\.trace_warehouse$/);
  assert.deepEqual({ ...first.args }, { ...scope, max_depth: 0, warehouse: 'Stores - AT' });
  const expanded = View.trace_request(scope, 'Batch', 'B1', 1);
  assert.match(expanded.method, /\.warehouse_traceability\.trace_batch$/);
  assert.deepEqual({ ...expanded.args }, { ...scope, max_depth: 1, batch_no: 'B1' });
  assert.equal(View.trace_request(scope, 'Warehouse', '', 0), null);
  for (const invalid of [{ company: '' }, { to_datetime: null }, { from_datetime: '2025-02-01 00:00:00' }]) {
    assert.equal(View.trace_request({ ...scope, ...invalid }, 'Batch', 'B1', 1), null);
  }
});
