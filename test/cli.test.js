import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../src/cli.js';
import { parseColorSpec } from '../src/colors.js';
import { parseRpc } from '../src/mcp.js';
import { KEY_RE } from '../src/config.js';

test('kolory z linii poleceń', () => {
  assert.deepEqual(parseColorSpec('#3d4e57'), { hex: '#3D4E57' });
  assert.deepEqual(parseColorSpec('3D4E57'), { hex: '#3D4E57' });
  assert.deepEqual(parseColorSpec('Farrow & Ball:Hague Blue'), { brand: 'Farrow & Ball', nameOrCode: 'Hague Blue' });
  assert.deepEqual(parseColorSpec('Sherwin-Williams:SW 7029'), { brand: 'Sherwin-Williams', nameOrCode: 'SW 7029' });
  assert.deepEqual(parseColorSpec('RAL 9005'), { brand: 'RAL', nameOrCode: 'RAL 9005' });
  assert.deepEqual(parseColorSpec('ral:9005'), { brand: 'RAL', nameOrCode: 'RAL 9005' });
  assert.throws(() => parseColorSpec('blue'), /not a colour/);
  assert.throws(() => parseColorSpec('Dulux:'), /not a colour/);
});

test('argumenty: powtarzalne -c, flagi logiczne i z wartością', () => {
  const { pos, flags } = parseArgs(['visualize', 'room.jpg', '-c', '#111111', '--color', 'RAL 9005', '--quality', 'hd', '--yes', '--out=dir', '--json']);
  assert.deepEqual(pos, ['visualize', 'room.jpg']);
  assert.deepEqual(flags.color, ['#111111', 'RAL 9005']);
  assert.equal(flags.quality, 'hd');
  assert.equal(flags.yes, true);
  assert.equal(flags.out, 'dir');
  assert.equal(flags.json, true);
});

test('odpowiedź MCP jako JSON i jako SSE', () => {
  assert.deepEqual(parseRpc('{"jsonrpc":"2.0","id":1,"result":{"a":1}}').result, { a: 1 });
  assert.deepEqual(parseRpc('event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"b":2}}\n\n').result, { b: 2 });
  assert.throws(() => parseRpc('event: message\n\n'), /Empty/);
});

test('kształt klucza', () => {
  assert.ok(KEY_RE.test('muro_sk_' + 'a'.repeat(43)));
  assert.ok(!KEY_RE.test('muro_sk_short'));
  assert.ok(!KEY_RE.test('sk_' + 'a'.repeat(48)));
});
