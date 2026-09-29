// Specyfikacja koloru z linii poleceń → kolor z katalogu Muro.
//   "#3D4E57" | "3D4E57"              → sam hex
//   "Farrow & Ball:Hague Blue"          → marka + nazwa albo kod
//   "RAL 9005" | "RAL:9005"             → RAL Classic
import { callJson } from './mcp.js';

const HEX = /^#?([0-9a-f]{6})$/i;

export function parseColorSpec(spec) {
  const s = String(spec ?? '').trim();
  const hex = HEX.exec(s);
  if (hex) return { hex: `#${hex[1].toUpperCase()}` };
  const ral = /^RAL[\s:]*(\d{4})$/i.exec(s);
  if (ral) return { brand: 'RAL', nameOrCode: `RAL ${ral[1]}` };
  const i = s.indexOf(':');
  if (i > 0 && i < s.length - 1) {
    const brand = s.slice(0, i).trim();
    let nameOrCode = s.slice(i + 1).trim();
    if (/^ral$/i.test(brand) && /^\d{4}$/.test(nameOrCode)) nameOrCode = `RAL ${nameOrCode}`;
    return { brand, nameOrCode };
  }
  throw new Error(`"${s}" is not a colour. Use a hex like #3D4E57, "Brand:Name or code", or "RAL 9005".`);
}

/** Rozwiązuje kolor w katalogu. Zwraca { name, brand, code, hex, url }. */
export async function resolveColor(spec, opts) {
  const p = parseColorSpec(spec);
  if (p.hex) return { name: p.hex, brand: null, code: null, hex: p.hex, url: null };
  const r = await callJson('get_paint_color', { brand: p.brand, name_or_code: p.nameOrCode }, opts);
  const c = r.colors?.[0];
  if (!r.found || !c) {
    const sug = (r.suggestions ?? []).slice(0, 5).map((x) => `${x.brand}:${x.code ?? x.name}`).join(', ');
    throw new Error(`No colour "${p.nameOrCode}" in ${p.brand}.${sug ? ` Did you mean: ${sug}?` : ''}`);
  }
  return { name: c.name, brand: c.brand, code: c.code ?? null, hex: c.hex.toUpperCase(), url: c.url ?? null };
}

/** Marki z danego rynku (ISO-2 albo nazwa kraju), do listy zakupów. */
export async function marketBrands(country, opts) {
  const r = await callJson('list_brands', { country }, opts);
  return (r.brands ?? []).map((b) => b.brand_id);
}

/** Lista zakupów: najbliższa farba z każdej marki (CIEDE2000). */
export async function shoppingList(hex, { brands, limit = 4, exclude } = {}, opts) {
  const r = await callJson('find_equivalents', { hex, limit: limit + 2, ...(brands?.length ? { brands } : {}) }, opts);
  return (r.equivalents ?? [])
    .filter((e) => !exclude || e.brand !== exclude)
    .slice(0, limit)
    .map((e) => ({ brand: e.brand, name: e.name, code: e.code ?? null, hex: e.hex, deltaE: e.delta_e, match: e.match, url: e.url }));
}
