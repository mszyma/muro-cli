// Klucz API: MURO_API_KEY albo ~/.config/muro/config.json (tylko dla właściciela pliku).
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DIR = process.env.MURO_CONFIG_DIR ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'muro');
const FILE = join(DIR, 'config.json');

export const KEY_RE = /^muro_sk_[A-Za-z0-9_-]{43}$/;

export function readKey() {
  if (process.env.MURO_API_KEY) return process.env.MURO_API_KEY.trim();
  if (!existsSync(FILE)) return null;
  try {
    return JSON.parse(readFileSync(FILE, 'utf8')).apiKey ?? null;
  } catch {
    return null;
  }
}

export function saveKey(key) {
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  writeFileSync(FILE, JSON.stringify({ apiKey: key }, null, 2) + '\n', { mode: 0o600 });
  chmodSync(FILE, 0o600);
  return FILE;
}

export function forgetKey() {
  rmSync(FILE, { force: true });
  return FILE;
}
