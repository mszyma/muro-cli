// Klient API app.usemuro.com z kluczem `muro_sk_…` (te same trasy co aplikacja webowa).

export const APP_URL = process.env.MURO_APP_URL ?? 'https://app.usemuro.com';

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.reason ?? body?.error ?? `HTTP ${status}`);
    this.status = status;
    this.code = body?.error ?? null;
  }
}

export function createApp(key, { fetchImpl = fetch, base = APP_URL } = {}) {
  const auth = { Authorization: `Bearer ${key}`, 'User-Agent': 'muro-cli', 'Accept-Language': 'en' };

  async function json(path, init = {}) {
    const res = await fetchImpl(base + path, { ...init, headers: { ...auth, ...(init.headers ?? {}) } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, body);
    return body;
  }

  return {
    credits: () => json('/api/credits'),
    createProject: (kind, name) =>
      json('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, name }) }),
    async uploadPhoto(projectId, bytes, type) {
      const form = new FormData();
      form.set('photo', new Blob([bytes], { type }), 'room');
      form.set('projectId', projectId);
      return json('/api/photos', { method: 'POST', body: form });
    },
    visualise: (body) =>
      json('/api/visualise', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    job: (id) => json(`/api/jobs/${encodeURIComponent(id)}`),
    relight: (body) =>
      json('/api/relight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    /** Pobiera obraz wyniku (`/api/photos/…`) w pełnej rozdzielczości. */
    async download(url) {
      const res = await fetchImpl(url.startsWith('http') ? url : base + url, { headers: auth });
      if (!res.ok) throw new ApiError(res.status, {});
      return { bytes: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') ?? 'image/jpeg' };
    },
  };
}
