/* LED: draws any 2D scene onto a panel of round dots. The scene is painted in grayscale on a tiny canvas
 * (one pixel per dot); every dot eases toward its pixel's brightness, so shapes fade and morph like a real panel.
 * Big panels are drawn by the GPU in one pass (WebGL); small ones repaint only the dots that changed. */
(() => {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const LEVELS = 16;
  function sprites(px) {
    const out = [], s = Math.max(2, px);
    for (let i = 0; i < LEVELS; i++) {
      const v = i / (LEVELS - 1), c = document.createElement('canvas'); c.width = c.height = s; const g = c.getContext('2d');
      g.fillStyle = '#000'; g.fillRect(0, 0, s, s);
      const lum = Math.round(22 + v * 220), r = s * (.33 + v * .11);
      if (v > .55) { const gl = g.createRadialGradient(s / 2, s / 2, r * .6, s / 2, s / 2, s * .5); gl.addColorStop(0, `rgba(255,255,255,${(v - .55) * .35})`); gl.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gl; g.fillRect(0, 0, s, s); }
      g.fillStyle = `rgb(${lum},${lum},${lum})`; g.beginPath(); g.arc(s / 2, s / 2, r, 0, Math.PI * 2); g.fill();
      out.push(c);
    }
    return out;
  }
  // one fragment shader draws every dot: which cell am I in, how bright is it, am I inside its circle
  const VS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  const FS = `precision mediump float;uniform sampler2D lv;uniform vec2 grid,off,res;uniform float cp;uniform vec3 pw;
void main(){vec2 q=vec2(gl_FragCoord.x,res.y-gl_FragCoord.y)-off;vec2 c=floor(q/cp);
if(c.x<0.||c.y<0.||c.x>=grid.x||c.y>=grid.y){gl_FragColor=vec4(0.,0.,0.,1.);return;}
float v=texture2D(lv,(c+.5)/grid).r;vec2 l=q/cp-c-.5;float d=length(l),r=.33+v*.11,aa=.8/cp;
float a=1.-smoothstep(r-aa,r+aa,d);float g=v>.55?(v-.55)*.35*(1.-smoothstep(r*.6,.5,d)):0.;
float lum=(22.+v*220.)/255.;float o=mix(g,lum,a);if(pw.z>=0.){o*=1.-smoothstep(pw.z*.82,pw.z,length(c+.5-pw.xy));}gl_FragColor=vec4(o,o,o,1.);}`;
  // only use the GPU when there is a real one: software WebGL is slower than plain 2D
  let gpuOK = null;
  function realGPU() {
    if (gpuOK != null) return gpuOK;
    try { const t = document.createElement('canvas'), g = t.getContext('webgl', { failIfMajorPerformanceCaveat: true }); if (!g) return gpuOK = false;
      const x = g.getExtension('WEBGL_debug_renderer_info'), rn = x ? String(g.getParameter(x.UNMASKED_RENDERER_WEBGL)) : '';
      gpuOK = !/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i.test(rn); const l = g.getExtension('WEBGL_lose_context'); if (l) l.loseContext();
    } catch (e) { gpuOK = false; }
    return gpuOK;
  }
  function makeGL(canvas) {
    if (!realGPU()) return null;
    let gl; try { gl = canvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: false, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: true }); } catch (e) { }
    if (!gl) return null;
    const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    try {
      const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return null; gl.useProgram(pr);
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(k => gl.texParameteri(gl.TEXTURE_2D, k, gl.NEAREST));
      [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(k => gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE));
      const U = n => gl.getUniformLocation(pr, n);
      return { gl, u: { grid: U('grid'), off: U('off'), res: U('res'), cp: U('cp'), lv: U('lv'), pw: U('pw') }, tw: 0, th: 0 };
    } catch (e) { return null; }
  }
  window.LED = function (canvas, opts = {}) {
    const { cell = 9, draw, ease = .18, fps = 60, fit = 'parent', idle = true } = opts;
    const G = opts.gpu && !opts.post ? makeGL(canvas) : null;
    const ctx = G ? null : canvas.getContext('2d', { alpha: false }), lo = document.createElement('canvas'), lg = lo.getContext('2d', { willReadFrequently: true });
    let W, H, gw, gh, cur, shown, px8, spr, dpr, xs, ys, cp, ox, oy, t0 = performance.now(), last = 0, on = true, cellPx = cell, frozen = false, full = true;
    const api = { t: 0, gw: 0, gh: 0, mouse: { x: -99, y: -99 }, ripples: [], cell, gpu: !!G };
    function size() {
      const r = (fit === 'parent' ? canvas.parentElement : canvas).getBoundingClientRect();
      W = Math.max(1, r.width); H = Math.max(1, r.height); dpr = Math.min(2, devicePixelRatio || 1); if (!G && opts.gpu) dpr = 1;
      cellPx = typeof cell === 'function' ? cell(W, H) : cell;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      gw = Math.max(1, Math.floor(W / cellPx)); gh = Math.max(1, Math.floor(H / cellPx)); lo.width = gw; lo.height = gh;
      const old = cur; cur = new Float32Array(gw * gh); if (old && old.length === cur.length) cur.set(old);
      shown = new Int8Array(gw * gh).fill(-1); px8 = new Uint8Array(gw * gh);
      cp = cellPx * dpr; ox = (canvas.width - gw * cp) / 2; oy = (canvas.height - gh * cp) / 2;
      if (G) {
        const gl = G.gl; gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform2f(G.u.grid, gw, gh); gl.uniform2f(G.u.off, ox, oy); gl.uniform2f(G.u.res, canvas.width, canvas.height); gl.uniform1f(G.u.cp, cp); gl.uniform1i(G.u.lv, 0);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, gw, gh, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, px8); G.tw = gw; G.th = gh;
      } else {
        // whole-pixel dot boxes: neighbours never overlap, so a dot can be repainted on its own
        xs = new Int32Array(gw + 1); ys = new Int32Array(gh + 1);
        for (let x = 0; x <= gw; x++) xs[x] = Math.round(ox + x * cp);
        for (let y = 0; y <= gh; y++) ys[y] = Math.round(oy + y * cp);
        spr = sprites(Math.ceil(cp));
      }
      api.gw = gw; api.gh = gh; api.cell = cellPx; frozen = false; full = true;
    }
    function frame(ts) {
      requestAnimationFrame(frame);
      if (!on || document.hidden) return;
      if (ts - last < 1000 / fps - 4) return; last = ts; api.t = (ts - t0) / 1000;
      if (frozen && !api.ripples.length) return;
      lg.globalCompositeOperation = 'source-over'; lg.fillStyle = '#000'; lg.fillRect(0, 0, gw, gh);
      lg.save(); const still = draw(lg, gw, gh, api.t, api); lg.restore();
      // ripples: rings of light that travel out from a click
      api.ripples = api.ripples.filter(r => api.t - r.t < 1.4);
      for (const r of api.ripples) { const k = (api.t - r.t) / 1.4, rad = k * Math.max(gw, gh) * .55; lg.strokeStyle = `rgba(255,255,255,${(1 - k) * .55})`; lg.lineWidth = 1.6; lg.beginPath(); lg.arc(r.x, r.y, rad, 0, Math.PI * 2); lg.stroke(); }
      const d = lg.getImageData(0, 0, gw, gh).data, e = reduce ? 1 : ease, mx = api.mouse.x, my = api.mouse.y, n = LEVELS - 1;
      if (!G && full) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height); shown.fill(-1); full = false; }
      let moving = false;
      for (let y = 0, i = 0; y < gh; y++) {
        const near = Math.abs(y - my) < 6, y0 = G ? 0 : ys[y], h = G ? 0 : ys[y + 1] - y0;
        for (let x = 0; x < gw; x++, i++) {
          let v = d[i * 4] / 255;
          if (near) { const dx = x - mx, dy = y - my, dd = dx * dx + dy * dy; if (dd < 36) v = Math.max(v, (1 - Math.sqrt(dd) / 6) * .32); }
          const p = cur[i], c = p + (v - p) * e;
          if (c - p > .002 || p - c > .002) moving = true;
          cur[i] = c;
          if (G) { px8[i] = c * 255; continue; }
          const k = (c * n + .5) | 0;
          if (k !== shown[i]) { shown[i] = k; const x0 = xs[x]; ctx.drawImage(spr[k > n ? n : k], x0, y0, xs[x + 1] - x0, h); }
        }
      }
      if (G) { const gl = G.gl, pw = opts.power ? opts.power(api.t, gw, gh) : null; gl.uniform3f(G.u.pw, pw ? pw[0] : 0, pw ? pw[1] : 0, pw ? pw[2] : -1); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gw, gh, gl.LUMINANCE, gl.UNSIGNED_BYTE, px8); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
      else if (opts.post) { ctx.setTransform(1, 0, 0, 1, 0, 0); if (opts.post(ctx, canvas.width, canvas.height, api.t) !== false) full = true; }
      if (still && !moving && idle) frozen = true;
    }
    function toGrid(e) { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / cellPx, y: (e.clientY - r.top) / cellPx }; }
    canvas.addEventListener('pointermove', e => { const g = toGrid(e); api.mouse.x = g.x; api.mouse.y = g.y; frozen = false; }, { passive: true });
    canvas.addEventListener('pointerleave', () => { api.mouse.x = api.mouse.y = -99; frozen = false; });
    canvas.addEventListener('pointerdown', e => { const g = toGrid(e); api.ripples.push({ x: g.x, y: g.y, t: api.t }); frozen = false; });
    if (G) canvas.addEventListener('webglcontextlost', e => e.preventDefault());
    new IntersectionObserver(es => { on = es[0].isIntersecting; }).observe(canvas);
    let rw = 0; addEventListener('resize', () => { clearTimeout(rw); rw = setTimeout(size, 150); });
    size(); requestAnimationFrame(frame);
    api.wake = () => { frozen = false; }; api.resize = size; api.ripple = (x, y) => { api.ripples.push({ x, y, t: api.t }); frozen = false; };
    return api;
  };
})();
