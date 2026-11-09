// Pixel measurements on screenshots, run inside headless Chrome (canvas), so the tools need
// no image library. Loaded into the composite page by shoot.mjs.
//   grain:  fine texture, the spread of L* after removing the smooth gradient (high-pass)
//   mean:   average L* (brightness)
//   band:   how wide the flat stripes are, in CSS px: the average length of runs of identical
//           colour that a pixel sits in, along rows and columns. Banded gradients give long
//           runs; grain breaks them to about 1px.
window.grainPixels = (() => {
  // Seeded, so the same pictures always give the same window and numbers.
  let seed = 1; const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const lin = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const LIN = Float32Array.from({ length: 256 }, (_, i) => lin(i / 255));
  const Lstar = y => (y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y);

  async function load(src) {
    const img = new Image(); img.src = src; await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
    return { w: c.width, h: c.height, data: g.getImageData(0, 0, c.width, c.height).data };
  }
  function lmap(im) {
    const L = new Float32Array(im.w * im.h), d = im.data;
    for (let i = 0, j = 0; i < L.length; i++, j += 4) L[i] = Lstar(0.2126 * LIN[d[j]] + 0.7152 * LIN[d[j + 1]] + 0.0722 * LIN[d[j + 2]]);
    return L;
  }
  // Mean and high-pass spread in a window (x, y, w, h in image pixels).
  function stats(im, L, win) {
    const { x = 0, y = 0, w = im.w, h = im.h } = win || {};
    const R = 4, step = Math.max(1, Math.floor(Math.sqrt((w * h) / 60000)));
    let n = 0, sum = 0, hp = 0, hp2 = 0;
    for (let yy = y + R; yy < y + h - R; yy += step) for (let xx = x + R; xx < x + w - R; xx += step) {
      let s = 0; for (let dy = -R; dy <= R; dy += 2) for (let dx = -R; dx <= R; dx += 2) s += L[(yy + dy) * im.w + xx + dx];
      const v = L[yy * im.w + xx], d = v - s / 25;
      n++; sum += v; hp += d; hp2 += d * d;
    }
    const m = hp / n;
    return { mean: sum / n, grain: Math.sqrt(Math.max(0, hp2 / n - m * m)) };
  }
  function band(im, win) {
    const { x = 0, y = 0, w = im.w, h = im.h } = win || {}, d = im.data, cap = 400;
    const same = (a, b) => d[a] === d[b] && d[a + 1] === d[b + 1] && d[a + 2] === d[b + 2];
    let tot = 0, cnt = 0;
    const runs = (len, at) => { // length-weighted mean run along one line
      let run = 1;
      for (let i = 1; i <= len; i++) {
        if (i < len && same(at(i), at(i - 1))) run++;
        else { const r = Math.min(run, cap); tot += r * r; cnt += r; run = 1; }
      }
    };
    const rs = Math.max(1, Math.floor(h / 60)), cs = Math.max(1, Math.floor(w / 60));
    for (let yy = y; yy < y + h; yy += rs) runs(w, i => ((yy * im.w) + x + i) * 4);
    for (let xx = x; xx < x + w; xx += cs) runs(h, i => (((y + i) * im.w) + xx) * 4);
    return cnt ? tot / cnt : 0;
  }
  // The window where banding is worst (longest flat runs) that isn't one flat colour.
  // `after` (optional): only windows where the grain actually lands (not under a canvas,
  // image or text drawn on top) count.
  function worstWindow(im, L, ww, wh, after) {
    seed = 1;
    let best = null;
    const sx = Math.max(1, Math.floor((im.w - ww) / 6)), sy = Math.max(1, Math.floor((im.h - wh) / 6));
    for (let y = 0; y + wh <= im.h; y += sy) for (let x = 0; x + ww <= im.w; x += sx) {
      const win = { x, y, w: ww, h: wh };
      let lo = 1e9, hi = -1e9;
      for (let i = 0; i < 400; i++) { const v = L[(y + Math.floor(rand() * wh)) * im.w + x + Math.floor(rand() * ww)]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
      if (hi - lo < 0.6) continue; // flat: nothing to band
      // Skip windows with text, buttons or objects in them: sharp edges between neighbours.
      let edges = 0;
      for (let i = 0; i < 600; i++) {
        const px = x + 1 + Math.floor(rand() * (ww - 2)), py = y + 1 + Math.floor(rand() * (wh - 2)), c = L[py * im.w + px];
        if (Math.abs(c - L[py * im.w + px + 1]) > 7 || Math.abs(c - L[(py + 1) * im.w + px]) > 7) edges++;
      }
      if (edges > 3) continue;
      if (after && after.L !== L && stats(after.im, after.L, win).grain - stats(im, L, win).grain < 0.15) continue;
      const b = band(im, win), score = b * (1 + 0.02 * (100 - (lo + hi) / 2)); // favour darker areas a little
      if (!best || score > best.score) best = { ...win, score };
    }
    if (!best && after) return worstWindow(im, L, ww, wh);
    if (!best) { // flat everywhere: take the centre
      best = { x: Math.max(0, Math.floor((im.w - ww) / 2)), y: Math.max(0, Math.floor((im.h - wh) / 2)), w: Math.min(ww, im.w), h: Math.min(wh, im.h) };
    }
    return best;
  }
  // The window cut out with its levels stretched (the same mapping for both pictures, taken
  // from the first), so 8-bit steps show as stripes and grain shows as noise.
  function stretch(ims, win) {
    // Stretch brightness only, then tint it with the area's own average colour, so hues stay
    // true (stretching each channel on its own turns a peach area blue).
    const a = ims[0], ys = [], mean = [0, 0, 0];
    const Y = (d, j) => 0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2];
    for (let i = 0; i < 4000; i++) {
      const x = win.x + Math.floor(rand() * win.w), y = win.y + Math.floor(rand() * win.h), j = (y * a.w + x) * 4;
      ys.push(Y(a.data, j)); for (let k = 0; k < 3; k++) mean[k] += a.data[j + k] / 4000;
    }
    ys.sort((p, q) => p - q);
    const lo = ys[Math.floor(ys.length * 0.01)], hi = Math.max(lo + 4, ys[Math.floor(ys.length * 0.99)]);
    const top = Math.max(...mean, 1), light = mean.map(v => v / top * 245), dark = mean.map(v => v / top * 18);
    return ims.map(im => {
      const c = document.createElement('canvas'); c.width = win.w; c.height = win.h;
      const g = c.getContext('2d'), out = g.createImageData(win.w, win.h);
      for (let y = 0; y < win.h; y++) for (let x = 0; x < win.w; x++) {
        const j = ((win.y + y) * im.w + win.x + x) * 4, o = (y * win.w + x) * 4;
        const t = Math.max(0, Math.min(1, (Y(im.data, j) - lo) / (hi - lo)));
        for (let k = 0; k < 3; k++) out.data[o + k] = dark[k] + t * (light[k] - dark[k]);
        out.data[o + 3] = 255;
      }
      g.putImageData(out, 0, 0);
      return c.toDataURL('image/png');
    });
  }
  return { load, lmap, stats, band, worstWindow, stretch };
})();
