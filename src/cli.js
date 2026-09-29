// muro — prawdziwe kolory farb w terminalu i malowanie własnych zdjęć przez Muro.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { APP_URL, ApiError, createApp } from './app.js';
import { marketBrands, resolveColor, shoppingList } from './colors.js';
import { KEY_RE, forgetKey, readKey, saveKey } from './config.js';
import { callJson } from './mcp.js';

export const VERSION = '0.1.0';
const KEYS_URL = `${APP_URL}/ustawienia`;
const COST = { standard: 1, hd: 2, ultra: 3 };
const KIND = { interior: 'wnetrze', facade: 'elewacja', roof: 'dach' };
const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const MAX_BYTES = 12 * 1024 * 1024;

const HELP = `muro ${VERSION} — real paint colours, and your own room painted with them

Colours (free, no key):
  muro colors search <query> [--brand B] [--limit N]
  muro colors get <brand> <name-or-code>
  muro colors equivalents <brand> <name-or-code> | --hex #RRGGBB  [--country PL] [--limit N]
  muro brands [--country PL]

Painting (Muro API key, uses your plan's credits: 1/2/3 per colour for standard/hd/ultra):
  muro login [muro_sk_…]          save your key (create one at ${KEYS_URL})
  muro logout
  muro credits
  muro visualize <photo|url> -c <colour> [-c <colour> …]  (1–12 colours)
        [--surface interior|facade|roof] [--quality standard|hd|ultra] [--ceiling]
        [--country PL] [--out DIR] [--yes]
  muro relight <project-id> <colour-key> --time day|evening|night [--lamps] [--out DIR]

Colours: "#3D4E57", "Farrow & Ball:Hague Blue", "Sherwin-Williams:SW 7029", "RAL 9005".
Every command takes --json. Docs: https://usemuro.com/en/developers`;

/** Minimalny parser: pozycyjne, --flaga wartość, --flaga, powtarzalne -c/--color. */
export function parseArgs(argv) {
  const pos = [];
  const flags = { color: [] };
  const BOOL = new Set(['json', 'yes', 'ceiling', 'lamps', 'help', 'version']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-c' || a === '--color' || a === '--colour') {
      flags.color.push(argv[++i]);
    } else if (a === '-h') flags.help = true;
    else if (a === '-y') flags.yes = true;
    else if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=', 2);
      if (BOOL.has(k)) flags[k] = v === undefined ? true : v !== 'false';
      else flags[k] = v ?? argv[++i];
    } else pos.push(a);
  }
  return { pos, flags };
}

const slug = (s) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const label = (c) => [c.brand, c.name !== c.hex ? c.name : null, c.code && c.code !== c.name ? `(${c.code})` : null, c.hex].filter(Boolean).join(' ');

function need(key) {
  if (!key) throw new Error(`This needs a Muro API key. Create one at ${KEYS_URL} (Settings → API keys), then run: muro login`);
  return key;
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const a = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
  rl.close();
  return a === 'y' || a === 'yes';
}

async function readPhoto(src) {
  if (/^https?:\/\//i.test(src)) {
    const res = await fetch(src, { headers: { 'User-Agent': 'muro-cli' } });
    if (!res.ok) throw new Error(`Could not download the photo (${res.status}).`);
    const type = (res.headers.get('content-type') ?? '').split(';')[0];
    if (!Object.values(TYPES).includes(type)) throw new Error(`The photo must be JPEG, PNG or WebP (got ${type || 'unknown'}).`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_BYTES) throw new Error('The photo is larger than 12 MB.');
    return { bytes, type, name: basename(new URL(src).pathname) || 'photo' };
  }
  if (!existsSync(src)) throw new Error(`No such file: ${src}`);
  const type = TYPES[extname(src).toLowerCase()];
  if (!type) throw new Error('The photo must be a .jpg, .png or .webp file.');
  if (statSync(src).size > MAX_BYTES) throw new Error('The photo is larger than 12 MB.');
  return { bytes: readFileSync(src), type, name: basename(src) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── komendy ────────────────────────────────────────────────────────────

async function colors(sub, pos, f, out) {
  if (sub === 'search') {
    if (!pos[0]) throw new Error('Usage: muro colors search <query>');
    const r = await callJson('search_paint_colors', { query: pos.join(' '), ...(f.brand ? { brand: f.brand } : {}), limit: Number(f.limit ?? 10) });
    return out(r, () => (r.colors ?? []).map((c) => `${label(c)}  ${c.url ?? ''}`).join('\n') || 'Nothing found.');
  }
  if (sub === 'get') {
    if (pos.length < 2) throw new Error('Usage: muro colors get <brand> <name-or-code>');
    let code = pos.slice(1).join(' ');
    if (/^ral$/i.test(pos[0]) && /^\d{4}$/.test(code)) code = `RAL ${code}`;
    const r = await callJson('get_paint_color', { brand: pos[0], name_or_code: code });
    return out(r, () =>
      r.found
        ? r.colors.map((c) => `${label(c)}  LRV ${c.lrv ?? '–'}  ${c.url ?? ''}`).join('\n')
        : `${r.message ?? 'Not found.'}${r.suggestions?.length ? `\nDid you mean: ${r.suggestions.slice(0, 5).map((s) => `${s.brand}:${s.code ?? s.name}`).join(', ')}` : ''}`,
    );
  }
  if (sub === 'equivalents') {
    const args = f.hex ? { hex: f.hex } : pos.length >= 2 ? { brand: pos[0], name_or_code: pos.slice(1).join(' ') } : null;
    if (!args) throw new Error('Usage: muro colors equivalents <brand> <name-or-code>  or  --hex #RRGGBB');
    if (f.country) args.brands = await marketBrands(f.country);
    args.limit = Number(f.limit ?? 8);
    const r = await callJson('find_equivalents', args);
    return out(r, () =>
      [r.source_color ? `Source: ${label(r.source_color)}` : null, ...(r.equivalents ?? []).map((e) => `  ΔE ${e.delta_e.toFixed(2)}  ${label(e)}  — ${e.match}`)]
        .filter(Boolean)
        .join('\n'),
    );
  }
  throw new Error('Usage: muro colors search|get|equivalents …');
}

async function brands(f, out) {
  const r = await callJson('list_brands', f.country ? { country: f.country } : {});
  return out(r, () => (r.brands ?? []).map((b) => `${b.brand} (${b.country}) — ${b.colors} colours  [${b.brand_id}]`).join('\n'));
}

async function login(pos, out) {
  let key = pos[0];
  if (!key) {
    process.stderr.write(`Create a key at ${KEYS_URL} (Settings → API keys) and paste it here.\n`);
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    key = (await rl.question('API key: ')).trim();
    rl.close();
  }
  if (!KEY_RE.test(key)) throw new Error('That does not look like a Muro key (muro_sk_ followed by 43 characters).');
  const c = await createApp(key).credits();
  const file = saveKey(key);
  return out({ ok: true, credits: c.credits, tier: c.account?.tier, config: file }, () => `Saved to ${file}. ${c.credits} credits, plan: ${c.account?.tier ?? 'free'}.`);
}

async function credits(key, out) {
  const c = await createApp(need(key)).credits();
  return out({ credits: c.credits, tier: c.account?.tier ?? null }, () => `${c.credits} credits · plan: ${c.account?.tier ?? 'free'}`);
}

async function visualize(pos, f, key, out) {
  need(key);
  const src = pos[0];
  if (!src) throw new Error('Usage: muro visualize <photo|url> -c <colour> [-c <colour> …]');
  if (!f.color.length) throw new Error('Give at least one colour with -c, e.g. -c "Farrow & Ball:Hague Blue".');
  if (f.color.length > 12) throw new Error('At most 12 colours per call.');
  const surface = f.surface ?? 'interior';
  const quality = f.quality ?? 'standard';
  if (!KIND[surface]) throw new Error('--surface must be interior, facade or roof.');
  if (!COST[quality]) throw new Error('--quality must be standard, hd or ultra.');

  const resolved = [];
  for (const spec of f.color) {
    const c = await resolveColor(spec);
    if (resolved.some((r) => r.hex === c.hex)) throw new Error(`${c.hex} is in the list twice. Each colour is charged, so give it once.`);
    resolved.push(c);
  }
  const photo = await readPhoto(src);
  const app = createApp(key);
  const cost = resolved.length * COST[quality];
  const bal = await app.credits();
  if (bal.credits < cost) throw new Error(`This needs ${cost} credits and you have ${bal.credits}. Top up at ${APP_URL}/plan`);
  if (!f.yes) {
    if (!process.stdin.isTTY) throw new Error(`This will use ${cost} credits. Add --yes to confirm.`);
    if (!(await confirm(`Paint ${resolved.length} colour${resolved.length > 1 ? 's' : ''} in ${quality} for ${cost} credit${cost > 1 ? 's' : ''} (you have ${bal.credits})?`))) {
      return out({ ok: false, cancelled: true }, () => 'Cancelled.');
    }
  }

  const log = (s) => !f.json && process.stderr.write(s);
  log('Uploading the photo…\n');
  const project = await app.createProject(KIND[surface], photo.name.replace(/\.[a-z]+$/i, '').slice(0, 80));
  await app.uploadPhoto(project.id, photo.bytes, photo.type);
  const started = await app.visualise({
    projectId: project.id,
    kind: KIND[surface],
    quality,
    ...(f.ceiling && surface === 'interior' ? { ceiling: true } : {}),
    colors: resolved.map((c, i) => ({ key: `c${i + 1}`, primary: c.name, secondary: c.code, hex: c.hex, brand: c.brand })),
  });

  let job;
  const deadline = Date.now() + 15 * 60_000;
  for (;;) {
    job = await app.job(started.jobId);
    log(`\rPainting ${job.done}/${job.total}…`);
    if (job.status !== 'working') break;
    if (Date.now() > deadline) throw new Error(`Still painting after 15 minutes. Check ${APP_URL}/wynik/${project.id}`);
    await sleep(3000);
  }
  log('\n');

  const dir = f.out ?? join(process.cwd(), 'muro-out');
  mkdirSync(dir, { recursive: true });
  const local = f.country ? await marketBrands(f.country) : null;
  const results = [];
  for (const [i, c] of resolved.entries()) {
    const jc = job.colors.find((x) => x.key === `c${i + 1}`);
    const r = { key: `c${i + 1}`, ...c, file: null, error: jc?.error ?? null, shoppingList: [] };
    if (jc?.resultUrl) {
      const img = await app.download(jc.resultUrl);
      const ext = img.type.includes('png') ? 'png' : img.type.includes('webp') ? 'webp' : 'jpg';
      r.file = join(dir, `${String(i + 1).padStart(2, '0')}-${slug([c.brand, c.name].filter(Boolean).join(' ')) || c.hex.slice(1)}.${ext}`);
      writeFileSync(r.file, img.bytes);
    }
    r.shoppingList = await shoppingList(c.hex, { brands: local, exclude: c.brand, limit: 4 });
    results.push(r);
  }

  const summary = {
    projectId: project.id,
    jobId: started.jobId,
    link: `${APP_URL}/wynik/${project.id}`,
    cost: started.cost ?? cost,
    creditsLeft: started.credits ?? null,
    colors: results,
  };
  return out(summary, () =>
    [
      ...results.flatMap((r, i) => [
        `${i + 1}. ${label(r)}  [${r.key}]`,
        r.file ? `   → ${r.file}` : `   ✗ ${r.error ?? 'not painted'}`,
        r.shoppingList.length
          ? `   Buy: ${r.shoppingList.map((s) => `${s.brand} ${s.name}${s.code && s.code !== s.name ? ` (${s.code})` : ''} ΔE ${s.deltaE.toFixed(2)}`).join(' · ')}`
          : null,
      ]),
      '',
      `Project: ${summary.link}  (id ${project.id})`,
      `Cost: ${summary.cost} credits${summary.creditsLeft !== null ? `, ${summary.creditsLeft} left` : ''}.`,
      surface === 'interior' ? `Another light: muro relight ${project.id} c1 --time evening` : null,
      'Screen colours approximate real paint; test a sample on the wall before you buy.',
    ]
      .filter((l) => l !== null)
      .join('\n'),
  );
}

async function relight(pos, f, key, out) {
  const [projectId, colorKey] = pos;
  if (!projectId || !colorKey || !f.time) throw new Error('Usage: muro relight <project-id> <colour-key> --time day|evening|night [--lamps]');
  if (!['day', 'evening', 'night'].includes(f.time)) throw new Error('--time must be day, evening or night.');
  const app = createApp(need(key));
  if (!f.yes && process.stdin.isTTY && !(await confirm('This uses 1 credit. Continue?'))) return out({ ok: false, cancelled: true }, () => 'Cancelled.');
  const r = await app.relight({ projectId, colorKey, time: f.time, lamps: Boolean(f.lamps) });
  const img = await app.download(r.url);
  const dir = f.out ?? join(process.cwd(), 'muro-out');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${colorKey}-${f.time}${f.lamps ? '-lamps' : ''}.jpg`);
  writeFileSync(file, img.bytes);
  return out({ file, cost: r.cost, creditsLeft: r.credits }, () => `→ ${file}\nCost: ${r.cost} credit, ${r.credits} left.`);
}

export async function main(argv, { stdout = process.stdout } = {}) {
  const { pos, flags } = parseArgs(argv);
  const out = (data, human) => {
    stdout.write((flags.json ? JSON.stringify(data, null, 2) : human()) + '\n');
    return data;
  };
  if (flags.version) return out({ version: VERSION }, () => VERSION);
  const [cmd, ...rest] = pos;
  if (!cmd || flags.help || cmd === 'help') return out({ help: HELP }, () => HELP);
  const key = readKey();
  switch (cmd) {
    case 'colors':
    case 'colours':
      return colors(rest[0], rest.slice(1), flags, out);
    case 'brands':
      return brands(flags, out);
    case 'login':
      return login(rest, out);
    case 'logout':
      return out({ ok: true, removed: forgetKey() }, () => 'Key removed.');
    case 'credits':
      return credits(key, out);
    case 'visualize':
    case 'visualise':
    case 'paint':
      return visualize(rest, flags, key, out);
    case 'relight':
      return relight(rest, flags, key, out);
    default:
      throw new Error(`Unknown command "${cmd}". Run: muro --help`);
  }
}

export function explain(e) {
  if (e instanceof ApiError && e.status === 401) return `Your API key was not accepted. Create a new one at ${KEYS_URL} and run: muro login`;
  if (e instanceof ApiError && e.status === 402) return `${e.message} Top up at ${APP_URL}/plan`;
  return e.message ?? String(e);
}
