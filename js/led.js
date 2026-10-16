/* LED: draws any 2D scene onto a panel of round dots. The scene is painted in grayscale on a tiny canvas
 * (one pixel per dot); every dot eases toward its pixel's brightness, so shapes fade and morph like a real panel. */
(() => {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function sprites(cell, dpr) {
    const n = 12, out = [], s = Math.ceil(cell * dpr);
    for (let i = 0; i < n; i++) {
      const v = i / (n - 1), c = document.createElement('canvas'); c.width = c.height = s; const g = c.getContext('2d');
      const lum = Math.round(22 + v * 220), r = s * (.33 + v * .11);
      if (v > .55) { const gl = g.createRadialGradient(s / 2, s / 2, r * .6, s / 2, s / 2, s * .62); gl.addColorStop(0, `rgba(255,255,255,${(v - .55) * .35})`); gl.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gl; g.fillRect(0, 0, s, s); }
      g.fillStyle = `rgb(${lum},${lum},${lum})`; g.beginPath(); g.arc(s / 2, s / 2, r, 0, Math.PI * 2); g.fill();
      out.push(c);
    }
    return out;
  }
  window.LED = function (canvas, opts = {}) {
    const { cell = 9, draw, ease = .18, fps = 45, fit = 'parent', idle = true } = opts;
    const ctx = canvas.getContext('2d'), lo = document.createElement('canvas'), lg = lo.getContext('2d', { willReadFrequently: true });
    let W, H, gw, gh, cur, spr, dpr, t0 = performance.now(), last = 0, raf, on = true, cellPx = cell, frozen = false;
    const api = { t: 0, gw: 0, gh: 0, mouse: { x: -99, y: -99 }, ripples: [], cell };
    function size() {
      const r = (fit === 'parent' ? canvas.parentElement : canvas).getBoundingClientRect();
      dpr = Math.min(2, devicePixelRatio || 1); W = Math.max(1, r.width); H = Math.max(1, r.height);
      cellPx = typeof cell === 'function' ? cell(W, H) : cell;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      gw = Math.max(1, Math.floor(W / cellPx)); gh = Math.max(1, Math.floor(H / cellPx)); lo.width = gw; lo.height = gh;
      const old = cur; cur = new Float32Array(gw * gh); if (old && old.length === cur.length) cur.set(old);
      spr = sprites(cellPx, dpr); api.gw = gw; api.gh = gh; api.cell = cellPx; frozen = false;
    }
    function frame(ts) {
      raf = requestAnimationFrame(frame);
      if (!on || document.hidden) return;
      if (ts - last < 1000 / fps) return; last = ts; api.t = (ts - t0) / 1000;
      if (frozen && !api.ripples.length) return;
      lg.globalCompositeOperation = 'source-over'; lg.fillStyle = '#000'; lg.fillRect(0, 0, gw, gh);
      lg.save(); const still = draw(lg, gw, gh, api.t, api); lg.restore();
      // ripples: rings of light that travel out from a click
      api.ripples = api.ripples.filter(r => api.t - r.t < 1.4);
      for (const r of api.ripples) { const k = (api.t - r.t) / 1.4, rad = k * Math.max(gw, gh) * .55; lg.strokeStyle = `rgba(255,255,255,${(1 - k) * .55})`; lg.lineWidth = 1.6; lg.beginPath(); lg.arc(r.x, r.y, rad, 0, Math.PI * 2); lg.stroke(); }
      const d = lg.getImageData(0, 0, gw, gh).data, e = reduce ? 1 : ease;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      const cp = cellPx * dpr, ox = (canvas.width - gw * cp) / 2, oy = (canvas.height - gh * cp) / 2, mx = api.mouse.x, my = api.mouse.y, n = spr.length - 1;
      let moving = false;
      for (let y = 0, i = 0; y < gh; y++) for (let x = 0; x < gw; x++, i++) {
        let v = d[i * 4] / 255;
        const dx = x - mx, dy = y - my, dd = dx * dx + dy * dy; if (dd < 36) v = Math.max(v, (1 - Math.sqrt(dd) / 6) * .32);
        const c = cur[i] + (v - cur[i]) * e; if (Math.abs(c - cur[i]) > .002) moving = true; cur[i] = c;
        ctx.drawImage(spr[Math.min(n, Math.round(c * n))], ox + x * cp, oy + y * cp);
      }
      if (opts.post) { ctx.setTransform(1, 0, 0, 1, 0, 0); opts.post(ctx, canvas.width, canvas.height, api.t); }
      if (still && !moving && idle) frozen = true;
    }
    function toGrid(e) { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / cellPx, y: (e.clientY - r.top) / cellPx }; }
    canvas.addEventListener('pointermove', e => { const g = toGrid(e); api.mouse.x = g.x; api.mouse.y = g.y; frozen = false; });
    canvas.addEventListener('pointerleave', () => { api.mouse.x = api.mouse.y = -99; frozen = false; });
    canvas.addEventListener('pointerdown', e => { const g = toGrid(e); api.ripples.push({ x: g.x, y: g.y, t: api.t }); frozen = false; });
    new IntersectionObserver(es => { on = es[0].isIntersecting; }).observe(canvas);
    addEventListener('resize', () => { clearTimeout(size.t); size.t = setTimeout(size, 120); });
    size(); raf = requestAnimationFrame(frame);
    api.wake = () => { frozen = false; }; api.resize = size; api.ripple = (x, y) => { api.ripples.push({ x, y, t: api.t }); frozen = false; };
    return api;
  };
})();
