#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distMain = path.join(__dirname, '..', 'dist', 'main.js');
const srcMain = path.join(__dirname, '..', 'src', 'main.ts');

if (fs.existsSync(distMain)) {
  const { runCli } = await import(pathToFileURL(distMain).href);
  const code = await runCli();
  if (code !== 0) process.exit(code);
} else {
  const { runCli } = await import(pathToFileURL(srcMain).href);
  const code = await runCli();
  if (code !== 0) process.exit(code);
}
