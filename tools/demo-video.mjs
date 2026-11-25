// Renders the README video from real output: it runs the skill on a test page in headless
// Chrome, then plays tools/demo/stage.html frame by frame over the screenshots it took.
//
//   npm run demo                    → docs/media/demo.mp4 and docs/media/demo.webp
//   npm run demo -- showcase-moss   another page from tests/pages
//
// Needs ffmpeg (mp4) and img2webp (the animated WebP that GitHub shows inline).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  openBrowser,
  openPage,
  lookAt,
  shootOptions,
  LABEL,
} from '../skills/grainy-gradients/scripts/headless/capture.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const page = process.argv[2] || 'showcase-ember';
const SELECTOR = '#hero';
const SIZE = { width: 1280, height: 720, dpr: 1 }; // dpr 1: every video pixel is a real page pixel
const FPS = 24;
const ZOOM_PX = 60; // side of the magnified square, in page pixels

const dataUrl = png => `data:image/png;base64,${png.toString('base64')}`;
const out = join(root, 'docs', 'media');
mkdirSync(out, { recursive: true });
const frames = mkdtempSync(join(tmpdir(), 'grain-demo-'));

const b = await openBrowser(SIZE);
try {
  // 1. Run the skill on the page: look, pick the recommended option, photograph before and after.
  await openPage(b, pathToFileURL(join(root, 'tests', 'pages', `${page}.html`)).href);
  const info = await lookAt(b, SELECTOR);
  const option = info.recommended;
  const { shots } = await shootOptions(b, SELECTOR, info, [option]);
  const before = dataUrl(shots.before),
    after = dataUrl(shots[option]);

  // 2. Open the stage and measure the two screenshots there, with the skill's own pixel code.
  await b.open(pathToFileURL(join(root, 'tools', 'demo', 'stage.html')).href, { settle: 100 });
  await b.eval(readFileSync(join(root, 'skills', 'grainy-gradients', 'assets', 'grain-pixels.js'), 'utf8'));
  const duration = await b.eval(`(async () => {
    const P = grainPixels;
    const A = await P.load(${JSON.stringify(before)}), B = await P.load(${JSON.stringify(after)});
    const LA = P.lmap(A), LB = P.lmap(B);
    const win = P.worstWindow(A, LA, ${ZOOM_PX}, ${ZOOM_PX}, { im: B, L: LB });
    const [zoomBefore, zoomAfter] = P.stretch([A, B], win);
    const whole = { a: P.stats(A, LA), b: P.stats(B, LB) };
    const stripes = v => (v >= 10 ? Math.round(v) : v.toFixed(1)) + 'px';
    const shift = whole.b.mean - whole.a.mean;
    return init({
      before: ${JSON.stringify(before)}, after: ${JSON.stringify(after)}, zoomBefore, zoomAfter, win,
      stats: [
        ['Stripe width', stripes(P.band(A, win)) + ' <em>→</em> ' + stripes(P.band(B, win))],
        // Text edges count as texture too, so the grain that was added is the difference in quadrature.
        ['Grain added', Math.sqrt(Math.max(0, whole.b.grain ** 2 - whole.a.grain ** 2)).toFixed(2) + ' L*'],
        ['Brightness shift', (shift >= 0 ? '+' : '') + shift.toFixed(2) + ' L*'],
      ],
    });
  })()`);

  // 3. One screenshot per frame.
  const total = Math.round(duration * FPS);
  for (let i = 0; i < total; i++) {
    await b.eval(`seek(${i / FPS})`);
    writeFileSync(join(frames, `${String(i).padStart(4, '0')}.png`), await b.shot());
    if (i % FPS === 0) process.stdout.write(`\r${page} · ${LABEL[option]} · frame ${i}/${total}`);
  }
  process.stdout.write('\n');
} finally {
  await b.close();
}

// 4. Encode. The mp4 is for sharing; the WebP plays inline in the README.
const quiet = { stdio: ['ignore', 'ignore', 'inherit'] };
execFileSync(
  'ffmpeg',
  [
    '-y',
    '-loglevel',
    'error',
    '-framerate',
    String(FPS),
    '-i',
    join(frames, '%04d.png'),
    '-c:v',
    'libx264',
    '-crf',
    '17',
    '-preset',
    'slow',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    join(out, 'demo.mp4'),
  ],
  quiet,
);
const list = execFileSync('ls', [frames])
  .toString()
  .trim()
  .split('\n')
  .map(f => join(frames, f));
execFileSync(
  'img2webp',
  [
    '-loop',
    '0',
    '-lossy',
    '-q',
    '72',
    '-m',
    '4',
    '-d',
    String(Math.round(1000 / FPS)),
    ...list,
    '-o',
    join(out, 'demo.webp'),
  ],
  quiet,
);
rmSync(frames, { recursive: true, force: true });
for (const f of ['demo.mp4', 'demo.webp'])
  console.log(`docs/media/${f}  ${(readFileSync(join(out, f)).length / 1e6).toFixed(1)} MB`);
