// Renders the README video from real output. It opens tools/demo/stage.html in headless
// Chrome, lets the grain engine solve the stage's gradients, photographs them for the zooms,
// then captures the stage frame by frame.
//
//   npm run demo   →   docs/media/demo.mp4 and docs/media/demo.webp
//
// Needs ffmpeg (mp4) and img2webp (the animated WebP that GitHub shows inline).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openBrowser } from '../skills/grainy-gradients/scripts/headless/capture.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const asset = name => readFileSync(join(root, 'skills', 'grainy-gradients', 'assets', name), 'utf8');
const SIZE = { width: 1280, height: 720, dpr: 1 }; // dpr 1: every video pixel is a real page pixel
const FPS = 24;
const ZOOM_PX = 100; // side of the "steps / no steps" squares, in page pixels

const out = join(root, 'docs', 'media');
mkdirSync(out, { recursive: true });
const frames = mkdtempSync(join(tmpdir(), 'grain-demo-'));
const sleep = ms => new Promise(done => setTimeout(done, ms));
const dataUrl = png => JSON.stringify(`data:image/png;base64,${png.toString('base64')}`);

const b = await openBrowser(SIZE);
try {
  await b.open(pathToFileURL(join(root, 'tools', 'demo', 'stage.html')).href, { settle: 100 });
  await b.eval(asset('grain-core.js'));
  await b.eval(asset('grain-pixels.js'));

  // 1. The engine solves the grain for the stage's card and band.
  const grain = await b.eval('prepare()');
  for (const [name, g] of Object.entries(grain)) {
    console.log(`${name}: ${g.option}, ${g.blend} at ${g.opacity}, ${g.grain.toFixed(2)} L*`);
  }

  // 2. Photograph the real pixels the zooms will magnify.
  const photograph = async pose => {
    const clip = await b.eval(`pose(${JSON.stringify(pose)})`);
    await sleep(150);
    return { clip, png: await b.shot(clip) };
  };
  const bandBefore = await photograph('band-plain');
  const bandAfter = await photograph('band-grain');
  const loupe = await photograph('loupe');

  // 3. Measure them in the page with the skill's own pixel code, and hand the stage its pictures.
  const duration = await b.eval(`(async () => {
    const P = grainPixels;
    const A = await P.load(${dataUrl(bandBefore.png)}), B = await P.load(${dataUrl(bandAfter.png)});
    const LA = P.lmap(A), LB = P.lmap(B);
    const [boost] = P.stretch([A], { x: 0, y: 0, w: A.w, h: A.h });
    const win = P.worstWindow(A, LA, ${ZOOM_PX}, ${ZOOM_PX}, { im: B, L: LB });
    const [zoomBefore, zoomAfter] = P.stretch([A, B], win);

    // The staircase: the 8-bit green level of every pixel along the middle of the band.
    const row = Math.floor(A.h / 2), levels = Array.from({ length: A.w }, (_, x) => A.data[(row * A.w + x) * 4 + 1]);
    const lo = Math.min(...levels), hi = Math.max(...levels);
    const staircase = levels.map((v, x) => x + ',' + (68 - ((v - lo) / (hi - lo)) * 66).toFixed(1)).join(' ');

    const before = P.stats(A, LA), after = P.stats(B, LB);
    const px = v => (v >= 10 ? Math.round(v) : v.toFixed(1)) + 'px';
    const shift = after.mean - before.mean;
    return init({
      boost, zoomBefore, zoomAfter, staircase,
      loupe: ${dataUrl(loupe.png)}, pick: ${JSON.stringify(loupe.clip)},
      numbers: [
        ['STRIPE WIDTH', px(P.band(A, win)) + ' <em>→</em> ' + px(P.band(B, win))],
        ['GRAIN ADDED', Math.sqrt(Math.max(0, after.grain ** 2 - before.grain ** 2)).toFixed(2) + ' L*'],
        ['BRIGHTNESS SHIFT', (shift >= 0 ? '+' : '') + shift.toFixed(2) + ' L*'],
      ],
    });
  })()`);

  // 4. One screenshot per frame.
  const total = Math.round(duration * FPS);
  for (let i = 0; i < total; i++) {
    await b.eval(`seek(${i / FPS})`);
    writeFileSync(join(frames, `${String(i).padStart(4, '0')}.png`), await b.shot());
  }
  console.log(`${total} frames`);
} finally {
  await b.close();
}

// 5. Encode. The mp4 is for sharing; the WebP plays inline in the README.
const quiet = { stdio: ['ignore', 'ignore', 'inherit'] };
const mp4 = ['-c:v', 'libx264', '-crf', '16', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
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
    ...mp4,
    join(out, 'demo.mp4'),
  ],
  quiet,
);
const pngs = readdirSync(frames)
  .sort()
  .map(f => join(frames, f));
const delay = String(Math.round(1000 / FPS));
execFileSync(
  'img2webp',
  ['-loop', '0', '-lossy', '-q', '75', '-m', '4', '-d', delay, ...pngs, '-o', join(out, 'demo.webp')],
  quiet,
);
rmSync(frames, { recursive: true, force: true });
for (const f of ['demo.mp4', 'demo.webp'])
  console.log(`docs/media/${f}  ${(readFileSync(join(out, f)).length / 1e6).toFixed(1)} MB`);
