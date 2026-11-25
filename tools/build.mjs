// Bundles the browser-side code into skills/grainy-gradients/assets/ (committed, so the
// skill works straight after install with no build step).
//
//   npm run build            write the bundles
//   npm run build -- --check fail if the committed bundles are out of date (CI)
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const skill = new URL('../skills/grainy-gradients/', import.meta.url);
const bundles = { 'grain-page': 'page', 'grain-core': 'core', 'grain-pixels': 'pixels' };
const check = process.argv.includes('--check');
let stale = 0;

for (const [name, entry] of Object.entries(bundles)) {
  const outfile = fileURLToPath(new URL(`assets/${name}.js`, skill));
  const result = await build({
    entryPoints: [fileURLToPath(new URL(`scripts/browser/${entry}.entry.mjs`, skill))],
    bundle: true,
    format: 'iife',
    target: 'es2022',
    charset: 'utf8',
    legalComments: 'none',
    banner: { js: `// ${name}.js: part of the grainy-gradients skill. Built by tools/build.mjs; don't edit by hand.` },
    outfile,
    write: !check,
  });
  if (check) {
    let current = '';
    try {
      current = readFileSync(outfile, 'utf8');
    } catch {}
    if (current !== result.outputFiles[0].text) {
      stale++;
      console.error(`out of date: assets/${name}.js`);
    }
  } else {
    console.log(`assets/${name}.js  ${(readFileSync(outfile).length / 1024).toFixed(1)} KB`);
  }
}
if (stale) {
  console.error('Run `npm run build` and commit the result.');
  process.exit(1);
}
