import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

function recorder() {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), auth: new Headers(init.headers).get('authorization') });
    return new Response(new Uint8Array([0xff, 0xd8]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  };
  return { calls, fetchImpl };
}

test('download: klucz tylko do skonfigurowanego originu API', async () => {
  const { calls, fetchImpl } = recorder();
  const app = createApp('muro_sk_secret', { fetchImpl, base: 'https://app.usemuro.com' });
  await app.download('/api/photos/a.jpg');
  await app.download('https://app.usemuro.com/api/photos/b.jpg');
  // Bez wiodącego "/" ścieżka zostaje na originie API, a nie przykleja się do hosta.
  await app.download('.evil.example/x');
  assert.deepEqual(calls.map((c) => [c.url, c.auth]), [
    ['https://app.usemuro.com/api/photos/a.jpg', 'Bearer muro_sk_secret'],
    ['https://app.usemuro.com/api/photos/b.jpg', 'Bearer muro_sk_secret'],
    ['https://app.usemuro.com/.evil.example/x', 'Bearer muro_sk_secret'],
  ]);
});

test('download: inne originy (CDN, http, podszyty host) dostają żądanie bez klucza', async () => {
  const { calls, fetchImpl } = recorder();
  const app = createApp('muro_sk_secret', { fetchImpl, base: 'https://app.usemuro.com' });
  for (const url of [
    'https://cdn.example.com/a.jpg',
    'http://app.usemuro.com/api/photos/a.jpg',
    'https://app.usemuro.com:8443/a.jpg',
    '//evil.example/x',
  ]) {
    await app.download(url);
  }
  for (const c of calls) {
    assert.ok(!c.url.startsWith('https://app.usemuro.com/'), c.url);
    assert.equal(c.auth, null, c.url);
  }
});
