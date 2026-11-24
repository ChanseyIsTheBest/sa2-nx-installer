// Checks that every NRO and file named in release/manifest.json is in release/ and has the SHA-256 the list expects.
// Usage: node .github/verify_release.mjs (from the root of the repository)
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const manifest = JSON.parse(fs.readFileSync('release/manifest.json', 'utf8'));
let bad = 0;
const check = (name, expected, what) => {
  const path = `release/${name}`;
  if (!fs.existsSync(path)) {
    console.error(`missing: ${name} (${what})`);
    bad++;
    return;
  }
  const hash = createHash('sha256').update(fs.readFileSync(path)).digest('hex');
  if (hash !== expected) {
    console.error(`wrong SHA-256: ${name} is ${hash}, the list expects ${expected}`);
    bad++;
  } else {
    console.log(`ok: ${name} (${what})`);
  }
};
if (manifest.shader_common_sha256) check('shader_common.h', manifest.shader_common_sha256, 'the translator\'s header');
for (const build of manifest.builds) {
  const what = `${build.edition} ${build.version ?? manifest.version}`;
  check(build.nro, build.nro_sha256, what);
  for (const f of build.files || []) check(f.source, f.sha256, what);
}
if (bad) {
  process.exit(1);
}
