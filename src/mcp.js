// Klient serwera MCP Muro (mcp.usemuro.com/mcp): JSON-RPC tools/call po HTTP.
// Serwer jest bezstanowy, więc wystarczy jedno żądanie na wywołanie narzędzia.

export const MCP_ENDPOINT = process.env.MURO_MCP_URL ?? 'https://mcp.usemuro.com/mcp';

let seq = 0;

/** Wywołuje narzędzie i zwraca `result` (content + isError). */
export async function callTool(name, args = {}, { key, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(MCP_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'User-Agent': 'muro-cli',
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`MCP ${res.status}: ${body.slice(0, 200)}`);
  const msg = parseRpc(body);
  if (msg.error) throw new Error(msg.error.message ?? 'MCP error');
  return msg.result;
}

/** Odpowiedź przychodzi jako JSON albo jako strumień SSE (`data: {...}`). */
export function parseRpc(body) {
  const t = body.trim();
  if (t.startsWith('{')) return JSON.parse(t);
  const data = t
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
    .filter(Boolean);
  if (!data.length) throw new Error('Empty MCP response');
  return JSON.parse(data[data.length - 1]);
}

/** Narzędzia katalogu oddają JSON w pierwszym bloku tekstu. */
export async function callJson(name, args, opts) {
  const r = await callTool(name, args, opts);
  const text = r?.content?.find((c) => c.type === 'text')?.text ?? '';
  if (r?.isError) throw new Error(text || `${name} failed`);
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}
