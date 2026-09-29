#!/usr/bin/env node
import { explain, main } from '../src/cli.js';

main(process.argv.slice(2)).catch((e) => {
  process.stderr.write(`muro: ${explain(e)}\n`);
  process.exit(1);
});
