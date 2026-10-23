// Runs v0-auth-diagnose.php and classifies the answer. Prints only booleans / status / AWS error codes. Exit 0 = credentials usable, 1 = diagnosed problem, 2 = could not run.
//   S3_ENDPOINT=… S3_KEY=… S3_SECRET=… S3_BUCKET=… node v0-auth-diagnose.mjs --autoload=/path/to/vendor/autoload.php
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, toMarkdown } from './v0-auth-diagnosis.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const autoload = (process.argv.find((a) => a.startsWith('--autoload=')) ?? '').slice('--autoload='.length) || join(here, 'vendor/autoload.php');
const r = spawnSync('php', [join(here, 'v0-auth-diagnose.php'), autoload], { encoding: 'utf8', env: process.env, maxBuffer: 1 << 20 });
let out;
try { out = JSON.parse(r.stdout); } catch { console.error('diagnosis could not run (php produced no JSON)'); process.exit(2); }
const result = classify(out);
console.log(toMarkdown(result, out.format));
console.log(`\nverdict=${result.verdict}`);
process.exit(result.credentialsUsable ? 0 : 1);
