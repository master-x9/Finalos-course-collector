import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
};
const pass = (message) => console.log(`PASS: ${message}`);

let manifest;
try {
  manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
  pass('manifest.json parses as JSON');
} catch (error) {
  fail(`manifest.json is invalid: ${error.message}`);
  process.exit(1);
}

if (manifest.manifest_version !== 3) fail('manifest_version must be 3');
else pass('Manifest V3 is configured');

if (!manifest.name || !manifest.version) fail('manifest must include name and version');
else pass(`Extension metadata present (${manifest.name} ${manifest.version})`);

const referencedFiles = new Set([
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  ...(manifest.content_scripts || []).flatMap((item) => item.js || []),
  ...(manifest.content_scripts || []).flatMap((item) => item.css || [])
].filter(Boolean));

for (const relativePath of referencedFiles) {
  if (existsSync(resolve(root, relativePath))) pass(`Referenced file exists: ${relativePath}`);
  else fail(`Manifest references a missing file: ${relativePath}`);
}

if (!manifest.permissions?.includes('storage')) fail('storage permission is missing');
if (!manifest.permissions?.includes('webRequest')) fail('webRequest permission is missing');
if (!manifest.host_permissions?.some((item) => item.includes('nkb-backend-ccbp-media-static.s3.amazonaws.com'))) {
  fail('Expected transcript-host permission is missing');
} else pass('Transcript host permission is narrowly scoped');

for (const relativePath of ['background.js', 'content.js', 'popup.js']) {
  const result = spawnSync(process.execPath, ['--check', resolve(root, relativePath)], { encoding: 'utf8' });
  if (result.status === 0) pass(`JavaScript syntax valid: ${relativePath}`);
  else fail(`${relativePath}: ${(result.stderr || result.stdout || 'syntax check failed').trim()}`);
}

if (process.exitCode) process.exit(process.exitCode);
console.log('\nExtension static checks passed. Live browser behavior still requires manual testing.');
