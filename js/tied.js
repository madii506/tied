/* TIED: two coins. one knot. Every number on this page is read live; every action is a signature or a transaction you sign. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { v == null || v === '' ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { } } };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const short = a => a ? a.slice(0, 4) + '…' + a.slice(-4) : '';
  const usd = v => !v ? '$0' : v >= 1e9 ? '$' + (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? '$' + (v / 1e3).toFixed(1) + 'K' : '$' + Math.round(v);
  const ago = t => { if (!t) return '—'; const s = Math.max(0, (Date.now() - new Date(t)) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + 'm ago' : s < 86400 ? Math.floor(s / 3600) + 'h ago' : Math.floor(s / 86400) + 'd ago'; };
  const mins = m => m < 60 ? m + 'm' : m < 1440 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : Math.floor(m / 1440) + 'd';
  const pct = v => (v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toFixed(3)) + '%';
  const pad = n => String(n).padStart(2, '0');
  const left = t => { const s = Math.max(0, Math.floor((new Date(t) - Date.now()) / 1000)); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s % 3600 / 60))}:${pad(s % 60)}`; };
  const av = (c, lg) => c && c.image ? `<img class="av${lg ? ' lg' : ''}" src="${esc(c.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('i'),{className:'av${lg ? ' lg' : ''}',textContent:'${esc(((c && c.symbol) || '?')[0])}'}))">` : `<i class="av${lg ? ' lg' : ''}">${esc(((c && c.symbol) || '?')[0])}</i>`;
  const agoS = t => { const s = Math.max(0, Math.round((Date.now() - new Date(t)) / 1000)); return s < 60 ? s + 's ago' : s < 3600 ? Math.floor(s / 60) + 'm ago' : Math.floor(s / 3600) + 'h ago'; };
  const amtF = v => v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : v >= 1 ? v.toFixed(2) : v.toPrecision(3);
  const links = m => `<a class="lk" href="https://axiom.trade/meme/${esc(m)}?chain=sol" target="_blank" rel="noopener">Axiom</a><a class="lk" href="https://pump.fun/coin/${esc(m)}" target="_blank" rel="noopener">pump</a><a class="lk" href="https://dexscreener.com/solana/${esc(m)}" target="_blank" rel="noopener">dex</a>`;
  const say = t => { $('#srlive').textContent = t; };
  function toast(t, ms = 2600) { $$('.toast').forEach(x => x.remove()); const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); say(t); setTimeout(() => d.remove(), ms); }
  const S = { tok: store.get('td:tok'), wallet: store.get('td:w'), prov: null, cfg: { windowHours: 24, minTurnout: 1 } };

  async function api(p, body) {
    const h = { 'content-type': 'application/json' }; if (S.tok) h.authorization = 'Bearer ' + S.tok;
    const r = await fetch('/api/' + p, { method: body ? 'POST' : 'GET', headers: h, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    let j = {}; try { j = await r.json(); } catch (e) { }
    if (r.status === 401 && S.tok && !/^(login|nonce)/.test(p)) { S.tok = null; store.set('td:tok', ''); }
    if (!r.ok) { const e = new Error(j.error || 'Something went wrong (' + r.status + ').'); e.status = r.status; e.data = j; throw e; }
    return j;
  }

  /* ---------------- the bow tie, in design units (600 × 300) ---------------- */
  const WING = [[258, 104], [[200, 76], [120, 34], [70, 36]], [[34, 40], [26, 100], [28, 150]], [[26, 200], [34, 260], [70, 264]], [[120, 266], [200, 224], [258, 196]]];
  function wingPath(g, mirror) {
    const X = x => mirror ? 600 - x : x; g.beginPath(); g.moveTo(X(WING[0][0]), WING[0][1]);
    for (const seg of WING.slice(1)) g.bezierCurveTo(X(seg[0][0]), seg[0][1], X(seg[1][0]), seg[1][1], X(seg[2][0]), seg[2][1]);
    g.closePath();
  }
  function knotPath(g, k = 1) { const w = 92 * k, h = 108 * k, r = 18 * k; g.beginPath(); g.roundRect ? g.roundRect(300 - w / 2, 150 - h / 2, w, h, r) : g.rect(300 - w / 2, 150 - h / 2, w, h); }
  // fill white with a grey rim, like a lit LED shape
  function lit(g, path, s, rim, alpha = 1) { g.globalAlpha = alpha; path(); g.fillStyle = '#fff'; g.fill(); g.lineWidth = rim / s; g.strokeStyle = 'rgb(118,118,118)'; g.lineJoin = 'round'; g.stroke(); g.globalAlpha = 1; }
  function drawTie(g, cx, cy, w, { rot = 0, wings = 1, knot = 1, rim = 1.6, glow = 0, flap = 0 } = {}) {
    const s = w / 600; g.save(); g.translate(cx, cy); g.rotate(rot); g.scale(s, s); g.translate(-300, -150);
    if (wings > 0) {
      g.save(); g.translate(258, 150); g.scale(1 + flap, 1 - flap * .6); g.translate(-258, -150); lit(g, () => wingPath(g, false), s, rim, wings); g.restore();
      g.save(); g.translate(342, 150); g.scale(1 + flap, 1 - flap * .6); g.translate(-342, -150); lit(g, () => wingPath(g, true), s, rim, wings); g.restore();
    }
    if (knot > 0) {
      g.save(); g.translate(300, 150); g.scale(knot, knot); g.translate(-300, -150);
      g.globalAlpha = 1; knotPath(g); g.fillStyle = '#000'; g.lineWidth = 2.2 * rim / s; g.strokeStyle = '#000'; g.stroke();
      knotPath(g); g.fillStyle = `rgb(${Math.round(225 + glow * 30)},${Math.round(225 + glow * 30)},${Math.round(225 + glow * 30)})`; g.fill();
      g.restore();
    }
    g.restore();
  }
  function tieSvg(sz = 34) {
    return `<svg width="${sz}" height="${sz / 2}" viewBox="0 0 600 300" aria-hidden="true"><path d="M258 104C200 76 120 34 70 36C34 40 26 100 28 150C26 200 34 260 70 264C120 266 200 224 258 196Z" fill="#efefef" stroke="#6a6a6a" stroke-width="22"/><path d="M342 104C400 76 480 34 530 36C566 40 574 100 572 150C574 200 566 260 530 264C480 266 400 224 342 196Z" fill="#efefef" stroke="#6a6a6a" stroke-width="22"/><rect x="254" y="96" width="92" height="108" rx="18" fill="#fff" stroke="#000" stroke-width="16"/></svg>`;
  }

  /* ---------------- the chapel: the intro plays once and becomes the hero ---------------- */
  const ease = { out: x => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3), back: x => { x = Math.min(1, Math.max(0, x)); const c = 1.9; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); } };
  const seen = (() => { try { return sessionStorage.getItem('td:intro') === '1'; } catch (e) { return false; } })();
  const END = 4.1;                                     // the intro hands over to the hero here
  let skipAt = null, offset = reduce ? END : seen ? 2.6 : 0, introDone = false;
  document.body.classList.add('intro');
  const led = $('#led');
  // the vamps: copies that pop up around the original, then get pulled into it
  const rnd = (i, k) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
  const VAMPS = Array.from({ length: 18 }, (_, i) => ({ a: i / 18 * Math.PI * 2 + rnd(i, 1) * .5, d: .55 + rnd(i, 2) * .5, r: .2 + rnd(i, 3) * .22, t: .55 + rnd(i, 4) * .75, w: rnd(i, 5) * 6.28 }));
  const GLYPH = 'ABCDEFGHJKLMNOPQRSUVWXYZ0123456789$#%&';
  const coin = (g, x, y, r, a = 1) => { if (r <= .2 || a <= 0) return; g.globalAlpha = a; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.lineWidth = Math.min(1.7, r * .35); g.strokeStyle = 'rgb(118,118,118)'; g.stroke(); g.globalAlpha = 1; };
  const hero = window.LED(led, {
    cell: (W, H) => W < 700 ? 7 : W < 1200 ? 8 : 9, fps: 50, ease: .22, idle: false,
    post(ctx, w, h, t0) {                                // the panel powers on from the centre
      const t = skipAt != null ? END : t0 + offset; if (t > 1.1) return;
      const k = ease.out(t / 1.05), r = Math.hypot(w, h) * .55 * k, gr = ctx.createRadialGradient(w / 2, h * .38, Math.max(1, r * .82), w / 2, h * .38, Math.max(2, r));
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,1)'); ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
    },
    draw(g, gw, gh, t0, A) {
      const t = skipAt != null ? t0 - skipAt + END : t0 + offset;
      const mob = gw < 70, TW = Math.min(gw * (mob ? .58 : .27), gh * .36 * 2), TH = TW / 2, cx = gw / 2, cy = gh * (mob ? .29 : .31);
      const mx = A.mouse.x > -50 ? (A.mouse.x - cx) / gw : 0, rot = reduce ? 0 : Math.sin(t * .9) * .015 + mx * .1;
      const R = TH * .42, span = Math.min(gw, gh) * (mob ? .42 : .36);
      if (t < 2.75) {
        // 1. one coin appears, then vamps pop up all around it
        const grow = ease.back((t - .25) / .45), pull = (t - 1.45) / .6;
        let fed = 0;
        for (const v of VAMPS) {
          const born = ease.back((t - v.t) / .3); if (born <= 0) continue;
          const k = Math.min(1, Math.max(0, pull)), kk = k * k * k;
          if (kk >= 1) { fed++; continue; }
          const d = span * v.d * (1 - kk), jig = Math.sin(t * 9 + v.w) * .6 * (1 - k);
          coin(g, cx + Math.cos(v.a + kk * 1.2) * d + jig, cy + Math.sin(v.a + kk * 1.2) * d * .62, R * v.r * born * (1 - kk * .6), .95);
        }
        // 2. the original eats every vamp, then splits into two halves that become the wings
        const swell = 1 + fed / VAMPS.length * .35, split = ease.out((t - 2.05) / .45);
        if (split <= 0) coin(g, cx, cy, R * grow * swell);
        else {
          const off = split * TW * .26;
          coin(g, cx - off, cy, R * swell * (1 - split * .15), 1 - ease.out((t - 2.35) / .35));
          coin(g, cx + off, cy, R * swell * (1 - split * .15), 1 - ease.out((t - 2.35) / .35));
          const m = ease.out((t - 2.3) / .45); if (m > 0) drawTie(g, cx, cy, TW, { rot, wings: m, knot: ease.back((t - 2.45) / .3), rim: 1.7 });
        }
      } else {
        const breathe = reduce ? 0 : Math.sin(t * 1.6) * .012, pulse = Math.max(0, Math.sin(t * 2.2 - 1)) ** 6;
        drawTie(g, cx, cy, TW * (1 + breathe), { rot, wings: 1, knot: 1 + pulse * .06, rim: 1.7, glow: pulse, flap: Math.max(0, Math.sin(t * 1.6)) * .02 });
      }
      if (t >= 2.6 && !A._rip) { A._rip = true; A.ripple(cx, cy); }
      // 3. the name decodes, letter by letter, out of random glyphs
      const fs = Math.min(gh * (mob ? .1 : .13), gw * (mob ? .2 : .11)), ty = gh * (mob ? .49 : .53);
      g.font = `800 ${fs}px I, Inter, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      try { g.letterSpacing = '0px'; } catch (e) { }
      const word = 'TIED', gap = fs * .08, ws = [...word].map(c => g.measureText(c).width), total = ws.reduce((a, b) => a + b, 0) + gap * 3;
      let x = cx - total / 2; const base = ty + fs * .36;
      for (let i = 0; i < 4; i++) {
        const show = t - (2.75 + i * .1), settle = t - (3.05 + i * .17), mid = x + ws[i] / 2;
        if (show > 0) {
          const ch = settle >= 0 ? word[i] : GLYPH[Math.floor(t * 18 + i * 7) % GLYPH.length];
          g.fillStyle = settle >= 0 ? 'rgb(230,230,230)' : 'rgb(150,150,150)'; g.fillText(ch, mid, base);
          if (settle >= 0) { g.lineWidth = .7; g.strokeStyle = 'rgb(120,120,120)'; g.strokeText(ch, mid, base); }
          if (settle >= 0 && settle < .25) { g.fillStyle = `rgba(255,255,255,${1 - settle * 4})`; g.fillText(ch, mid, base); }
        }
        x += ws[i] + gap;
      }
      if (t > 3.7) {                                   // a slow sweep of light across the word
        const sw = ((t * .22) % 1.6 - .3) * gw, gr = g.createLinearGradient(sw - 10, 0, sw + 10, 0);
        gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.5, 'rgba(255,255,255,.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; x = cx - total / 2; for (let i = 0; i < 4; i++) { g.fillText(word[i], x + ws[i] / 2, base); x += ws[i] + gap; }
      }
      if (!introDone && t >= END - .4) finishIntro();
      return false;
    },
  });
  requestAnimationFrame(() => led.classList.add('on'));
  function finishIntro() { introDone = true; document.body.classList.remove('intro'); try { sessionStorage.setItem('td:intro', '1'); } catch (e) { } }
  const skip = () => { if (!introDone && skipAt == null) skipAt = hero.t; };  // jumps straight to the finished hero
  ['wheel', 'keydown', 'touchstart'].forEach(ev => addEventListener(ev, skip, { passive: true, once: true }));
  $('#chapel').addEventListener('click', e => { if (!introDone && !e.target.closest('form,a,button')) skip(); });
  setTimeout(() => { if (!introDone && skipAt == null) skipAt = hero.t; }, 7000);

  /* ---------------- smooth scroll, reveal, nav ---------------- */
  let lenis = null;
  if (!reduce && window.Lenis) { lenis = new Lenis({ lerp: .085, smoothWheel: true }); const raf = t => { lenis.raf(t); requestAnimationFrame(raf); }; requestAnimationFrame(raf); }
  const goTo = (el, off = 70) => { if (!el) return; const y = el.getBoundingClientRect().top + scrollY - off; lenis ? lenis.scrollTo(Math.max(0, y), { duration: 1.2 }) : scrollTo({ top: y, behavior: 'smooth' }); };
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('vis'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
  $$('.rv').forEach(el => io.observe(el));
  const nav = $('#nav'), navLinks = $$('#links a'), ind = $('#ind');
  function moveInd(a) { navLinks.forEach(x => x.classList.toggle('on', x === a)); if (!a) { ind.style.opacity = 0; return; } ind.style.opacity = 1; ind.style.width = a.offsetWidth + 'px'; ind.style.transform = `translateX(${a.offsetLeft - 4}px)`; }
  function spy() { nav.classList.toggle('scrolled', scrollY > 10); let cur = null; navLinks.forEach(a => { const s = $('#' + a.dataset.s); if (s && s.getBoundingClientRect().top < innerHeight * .45) cur = a; }); moveInd(cur); }
  addEventListener('scroll', spy, { passive: true }); addEventListener('resize', spy); spy();
  document.addEventListener('click', e => { const a = e.target.closest('a[data-s], a[data-go]'); if (!a) return; e.preventDefault(); goTo($('#' + (a.dataset.s || a.dataset.go))); });

  /* ---------------- section titles in dots ---------------- */
  function ledTitles() {
    const mob = innerWidth < 700, H = mob ? 52 : 84, cell = mob ? 3 : 4;
    $$('.led-t').forEach(h => {
      if (h.querySelector('canvas')) return;
      const t = h.dataset.t, c = document.createElement('canvas'); c.setAttribute('aria-hidden', 'true');
      const span = document.createElement('span'); span.className = 'ttxt sr'; span.textContent = h.textContent; h.textContent = ''; h.append(span, c);
      const m = document.createElement('canvas').getContext('2d'); m.font = `800 ${H * .86}px I, Inter, sans-serif`; try { m.letterSpacing = (H * .86 * .04) + 'px'; } catch (e) { }
      c.style.width = Math.min(h.parentElement.clientWidth, Math.ceil(m.measureText(t).width + cell * 4)) + 'px'; c.style.height = H + 'px'; h.classList.add('ready');
      let start = null;
      const L = window.LED(c, {
        cell, fit: 'self', fps: 30, ease: .25,
        draw(g, gw, gh, tt) {
          if (start == null) return true;
          const p = ease.out((tt - start) / 1), fs = gh * .86;
          g.font = `800 ${fs}px I, Inter, sans-serif`; try { g.letterSpacing = (fs * .04) + 'px'; } catch (e) { }
          g.textBaseline = 'alphabetic'; g.save(); g.beginPath(); g.rect(0, 0, gw * p, gh); g.clip();
          g.fillStyle = 'rgb(232,232,232)'; g.fillText(t, 1, gh * .86); g.lineWidth = .5; g.strokeStyle = 'rgb(120,120,120)'; g.strokeText(t, 1, gh * .86); g.restore();
          const sw = ((tt * .3) % 1.8 - .4) * gw, gr = g.createLinearGradient(sw - 8, 0, sw + 8, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.5, 'rgba(255,255,255,.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
          g.save(); g.beginPath(); g.rect(0, 0, gw * p, gh); g.clip(); g.fillStyle = gr; g.fillText(t, 1, gh * .86); g.restore();
          return false;
        },
      });
      new IntersectionObserver((es, o) => { if (es[0].isIntersecting) { start = L.t; L.wake(); o.disconnect(); } }, { threshold: .4 }).observe(c);
    });
  }
  (document.fonts && document.fonts.load ? document.fonts.load('800 80px I').catch(() => { }) : Promise.resolve()).then(ledTitles);
  // the knot between the two coins on the altar
  const knotLed = window.LED($('#knotC'), {
    cell: 4, fit: 'self', fps: 30, ease: .2,
    draw(g, gw, gh, t) { const k = S.pTied ? 1 : .55 + Math.sin(t * 2) * .05; drawTie(g, gw / 2, gh / 2, gw * .92 * k, { rot: Math.sin(t) * .04, rim: 1, wings: S.pTied ? 1 : .55 }); return false; },
  });

  /* ---------------- wallet ---------------- */
  const PROV = {
    phantom: () => (window.phantom && window.phantom.solana && window.phantom.solana.isPhantom) ? window.phantom.solana : ((window.solana && window.solana.isPhantom) ? window.solana : null),
    solflare: () => (window.solflare && window.solflare.isSolflare) ? window.solflare : null,
    backpack: () => (window.backpack && window.backpack.isBackpack) ? window.backpack : null,
  };
  const mobile = /iphone|ipad|android/i.test(navigator.userAgent);
  function modal(html, onBuild) {
    const m = document.createElement('div'); m.className = 'modal'; m.innerHTML = `<div class="mbox" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(m); if (lenis) lenis.stop();
    const close = () => { m.remove(); if (lenis && !$('.drawer.on')) lenis.start(); document.removeEventListener('keydown', k); };
    const k = e => { if (e.key === 'Escape') close(); }; document.addEventListener('keydown', k);
    m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-x]')) close(); });
    if (onBuild) onBuild(m, close); return close;
  }
  function walletModal(then) {
    const here = encodeURIComponent(location.href);
    modal(`<h3>Connect</h3><p>Sign in with one free signature. It is not a transaction and cannot move anything.</p><div class="wl">${['phantom', 'solflare', 'backpack'].map(k => `<button class="btn" type="button" data-pv="${k}"><span>${k[0].toUpperCase() + k.slice(1)}</span><small class="mono${PROV[k]() ? ' ok' : ''}">${PROV[k]() ? 'DETECTED' : mobile ? 'OPEN APP' : 'INSTALL'}</small></button>`).join('')}</div><p class="err" data-err style="margin:12px 0 0"></p>`, (m, close) => {
      m.addEventListener('click', async e => {
        const b = e.target.closest('[data-pv]'); if (!b) return; const k = b.dataset.pv, p = PROV[k]();
        if (!p) { if (k === 'phantom') return mobile ? location.href = `https://phantom.app/ul/browse/${here}?ref=${encodeURIComponent(location.origin)}` : open('https://phantom.com/download', '_blank', 'noopener'); if (k === 'solflare') return mobile ? location.href = `https://solflare.com/ul/v1/browse/${here}` : open('https://solflare.com/download', '_blank', 'noopener'); return open('https://backpack.app/download', '_blank', 'noopener'); }
        const err = $('[data-err]', m); err.textContent = ''; b.disabled = true; b.querySelector('small').textContent = 'CHECK WALLET';
        try { await connect(p); close(); if (then) setTimeout(then, 150); }
        catch (x) { err.textContent = /reject|cancel|denied|declin/i.test(x.message) ? 'Cancelled.' : x.message; b.disabled = false; b.querySelector('small').textContent = 'DETECTED'; }
      });
    });
  }
  const ALPH = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function b58(bytes) { let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b); let s = ''; while (n > 0n) { s = ALPH[Number(n % 58n)] + s; n /= 58n; } for (const b of bytes) { if (b === 0) s = '1' + s; else break; } return s; }
  const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function connect(p) {
    const r = await p.connect(); const k = (r && r.publicKey) || p.publicKey; const wallet = k.toString();
    if (!S.tok || S.wallet !== wallet) {
      const n = await api('nonce?wallet=' + wallet), bytes = new TextEncoder().encode(n.message);
      const o = await p.signMessage(bytes, 'utf8'), sig = o.signature || o;
      const j = await api('login', { wallet, nonce: n.nonce, sig: b58(new Uint8Array(sig)), msg: b64(bytes) });
      S.tok = j.token; store.set('td:tok', S.tok);
    }
    S.wallet = wallet; S.prov = p; store.set('td:w', wallet); renderMe(); toast('Connected ' + short(wallet));
    refreshAll();
  }
  async function disconnect() { try { S.prov && S.prov.disconnect && await S.prov.disconnect(); } catch (e) { } S.wallet = S.tok = S.prov = null; store.set('td:w', ''); store.set('td:tok', ''); renderMe(); refreshAll(); }
  function renderMe() { const on = !!(S.wallet && S.tok); $('#wBtn').classList.toggle('on', on); $('#wLabel').textContent = on ? short(S.wallet) : 'Connect'; }
  $('#wBtn').addEventListener('click', () => S.wallet && S.tok ? modal(`<h3>${esc(short(S.wallet))}</h3><p>Signed in. Votes and proposals use this wallet.</p><div class="wl"><button class="btn" data-x type="button" data-out>Disconnect</button></div>`, (m, close) => { $('[data-out]', m).onclick = () => { disconnect(); close(); }; }) : walletModal());
  // a provider is needed for transactions; the sign-in token alone covers votes
  async function needWallet(then) {
    if (S.tok && S.wallet) {
      if (!S.prov) { for (const k of ['phantom', 'solflare', 'backpack']) { const p = PROV[k](); if (p) { try { const r = await p.connect({ onlyIfTrusted: true }); const pk = ((r && r.publicKey) || p.publicKey); if (pk && pk.toString() === S.wallet) { S.prov = p; break; } } catch (e) { } } } }
      if (S.prov || !then.tx) return then();
    }
    walletModal(then);
  }
  const needAuth = fn => needWallet(Object.assign(fn, { tx: false }));
  const needTx = fn => needWallet(Object.assign(fn, { tx: true }));

  /* transactions */
  const W = () => window.solanaWeb3;
  async function rpc(method, params) { return (await api('rpc', { method, params })).result; }
  async function sendRaw(tx) { return rpc('sendTransaction', [b64(tx.serialize()), { encoding: 'base64', preflightCommitment: 'confirmed', maxRetries: 5 }]); }
  async function signSend(tx, extra = []) {
    if (!S.prov) throw new Error('Connect a wallet first.');
    if (extra.length || !S.prov.signAndSendTransaction) { const signed = await S.prov.signTransaction(tx); if (extra.length) signed.sign(extra); return sendRaw(signed); }
    const r = await S.prov.signAndSendTransaction(tx); return typeof r === 'string' ? r : r.signature;
  }
  async function confirm(sig, secs = 75) {
    for (let i = 0; i < secs / 1.5; i++) {
      await sleep(1500);
      try { const r = await rpc('getSignatureStatuses', [[sig], { searchTransactionHistory: false }]); const s = r.value[0]; if (s) { if (s.err) throw new Error('The transaction failed on chain.'); if (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized') return true; } } catch (e) { if (/failed on chain/.test(e.message)) throw e; }
    }
    return false;
  }
  async function tokenBalance(mint) {
    const r = await rpc('getTokenAccountsByOwner', [S.wallet, { mint }, { encoding: 'jsonParsed' }]);
    let ui = 0, raw = 0n, dec = 0; for (const a of r.value || []) { const t = a.account.data.parsed.info.tokenAmount; ui += Number(t.uiAmountString || 0); raw += BigInt(t.amount); dec = t.decimals; }
    return { ui, raw, dec };
  }
  const errMsg = e => /reject|cancel|denied|declin/i.test(e && e.message) ? 'Cancelled in the wallet.' : (e && e.message) || 'Something went wrong.';

  /* ---------------- radar: the most vamped coins right now ---------------- */
  let radarAt = 0;
  async function loadRadar() {
    try {
      const r = await api('radar'), list = (Array.isArray(r) ? r : r.list || []).filter(x => x.vamps > 0); radarAt = r.at || Date.now(); tickRadar();
      S.radar = list; renderBoard(list); renderSugg(list); setMarquee(list);
      if (!list.length) return;
      const one = list.map(x => `<button type="button" data-vq="${esc(x.symbol)}">${av(x)}<b>$${esc(x.symbol)}</b><span>${x.vamps} vamp${x.vamps === 1 ? '' : 's'}</span>${x.fresh ? `<i class="fresh">+${x.fresh} this hour</i>` : ''}<em>${x.newest != null ? 'newest ' + (x.newest < 1 ? 'just now' : mins(x.newest) + ' ago') : ''}</em></button>`).join('');
      $('#radarIn').innerHTML = one + one; $('#radarIn').style.animationDuration = Math.max(30, list.length * 9) + 's'; $('#radar').hidden = false;
    } catch (e) { }
  }
  function tickRadar() { const s = Math.max(0, Math.round((Date.now() - radarAt) / 1000)); const el = $('#radarAge'); if (el && radarAt) el.textContent = s < 5 ? 'just now' : s + 's ago'; }
  setInterval(tickRadar, 1000);
  document.addEventListener('click', e => { const b = e.target.closest('[data-vq]'); if (!b) return; $('#vQ').value = b.dataset.vq; findVamps(b.dataset.vq); goTo($('#vamps')); });

  /* ---------------- live from Solana: every new pump.fun launch that copies a ticker ---------------- */
  let liveAt = 0, liveSeen = null;
  async function loadLive() {
    try {
      const r = await api('live'); liveAt = r.read ? new Date(r.read).getTime() : r.at; tickLive();
      const first = liveSeen == null, fresh = first ? new Set() : new Set(r.feed.filter(x => !liveSeen.has(x.mint)).map(x => x.mint));
      liveSeen = new Set(r.feed.map(x => x.mint));
      $('#chFeed').innerHTML = r.feed.length ? r.feed.slice(0, 14).map((x, i) => `<div class="chrow${fresh.has(x.mint) ? ' new' : ''}" style="--i:${first ? i : 0}">${av(x)}<span class="nm"><b>$${esc(x.symbol)} <span>${esc(x.name)}</span></b><span>${x.og.trending ? 'copies trending' : 'copy #' + x.copy + ' of'} <button type="button" class="ogb" data-vq="${esc(x.og.symbol)}">$${esc(x.og.symbol)}</button> · <span data-ago="${esc(x.t)}">${agoS(x.t)}</span>${x.mc ? ' · ' + usd(x.mc) : ''}</span></span><span class="acts"><span class="lks">${links(x.mint)}</span><button class="btn sm" type="button" data-prop="${esc(x.og.mint)}|${esc(x.mint)}">Tie</button></span></div>`).join('')
        : `<div class="empty">No copies in the latest launches yet. Every new pump.fun coin is being read; vamps land here the moment they launch.</div>`;
      const max = Math.max(1, ...r.hot.map(h => h.h1));
      $('#chHot').innerHTML = r.hot.length ? r.hot.map(h => `<button type="button" class="hrow" data-vq="${esc(h.symbol)}">${av(h)}<span class="hn"><b>$${esc(h.symbol)}${h.trending ? ' <i class="fresh">TRENDING</i>' : ''}</b><span>${h.h1} this hour · ${h.n} in 24h</span></span><span class="hc">${h.h1}</span><i class="hb" style="width:${h.h1 / max * 100}%"></i></button>`).join('') : `<div class="empty">No ticker launched twice in the last hour.</div>`;
      const st = r.stats || {};
      $('#chStat').innerHTML = `<b>${(st.h1 || 0).toLocaleString()}</b> launches read from Solana in the last hour · <b>${(st.m10 || 0).toLocaleString()}</b> in the last 10 min`;
      if (fresh.size && !document.hidden && $('#vamps').getBoundingClientRect().top < innerHeight) say(`${fresh.size} new vamp${fresh.size === 1 ? '' : 's'} just launched`);
    } catch (e) { if (liveSeen == null) $('#chFeed').innerHTML = `<div class="empty">Could not read the chain right now. Trying again in 20 seconds.</div>`; }
  }
  function tickLive() { const el = $('#chAge'); if (el && liveAt) { const s = Math.max(0, Math.round((Date.now() - liveAt) / 1000)); el.textContent = 'read ' + (s < 3 ? 'just now' : s + 's ago'); } $$('[data-ago]').forEach(x => { x.textContent = agoS(x.dataset.ago); }); }
  setInterval(tickLive, 1000);

  /* ---------------- vamps ---------------- */
  async function findVamps(q, quiet) {
    q = String(q || '').trim(); if (!q) return; const out = $('#vOut');
    const before = new Set(quiet && S.vamps && S.vq === q ? S.vamps.vamps.map(v => v.mint) : []);
    if (!quiet) out.innerHTML = `<div class="empty">Scanning every pair called ${esc(q)}…</div>`;
    try {
      const r = await api('vamps?q=' + encodeURIComponent(q)); S.vamps = r; S.vq = q; S.vAt = r.at || Date.now();
      if (!r.og) { out.innerHTML = `<div class="empty"><b>Nothing found for ${esc(q)}.</b><br>Try the exact ticker or paste the contract address.</div>`; return; }
      const o = r.og;
      out.innerHTML = `<div class="og">${av(o, true)}<div><h3>$${esc(o.symbol)} <span style="color:var(--mu);font-weight:500;font-size:16px">${esc(o.name)}</span></h3><div class="m mono"><span>launched <b>${ago(o.created)}</b></span><span>mc <b>${usd(o.mc)}</b></span><span>vol 24h <b>${usd(o.vol)}</b></span><span class="mono">${esc(short(o.mint))}</span></div></div>
        <div class="acts"><a class="btn sm" href="https://axiom.trade/meme/${esc(o.mint)}?chain=sol" target="_blank" rel="noopener">Axiom</a><a class="btn sm" href="${esc(o.url || 'https://dexscreener.com/solana/' + o.mint)}" target="_blank" rel="noopener">Chart</a><button class="btn sm" type="button" data-copy="${esc(o.mint)}">Copy CA</button></div></div>
        ${r.vamps.length ? `<div class="bline">${bloodline(r.vamps.map(v => [v.after, v.ago, v.mc]), o.mc, 900, 84)}<div class="ft"><span>THE ORIGINAL · launched ${ago(o.created)}</span><span>EACH DOT IS A VAMP · SIZE = MARKET CAP · WHITE = THIS HOUR</span><span>NOW</span></div></div>` : ''}
        <div class="vhead"><span><b>${r.vamps.length}</b> VAMP${r.vamps.length === 1 ? '' : 'S'} · <b>${r.vamps.filter(v => v.ago <= 60).length}</b> THIS HOUR · ${usd(r.vamps.reduce((a, v) => a + (v.vol || 0), 0))} VOLUME${r.chain ? ` · <b>${r.chain}</b> READ FROM CHAIN` : ''}</span><span class="live"><i></i>RESCANS EVERY MINUTE · <b id="vAge">just now</b></span></div>
        ${r.vamps.length ? `<div class="vlist">${r.vamps.map((v, i) => `<div class="vrow${before.size && !before.has(v.mint) ? ' new' : ''}" style="--i:${quiet ? 0 : Math.min(i, 20)}"><span class="n">#${i + 1}</span>${av(v)}<span class="nm"><b>$${esc(v.symbol)} · ${esc(v.name)}${v.ago <= 60 ? ' <i class="fresh">NEW</i>' : ''}${v.wed ? ` <i class="fresh${v.wed.status === 'tied' ? '' : ' dim'}">${v.wed.status === 'tied' ? 'TIED INTO $' + esc(o.symbol) : v.wed.status === 'called_off' ? 'NOT TIED' : 'VOTING'}</i>` : ''}</b><span>${esc(short(v.mint))} · ${v.ago < 1 ? 'just now' : mins(v.ago) + ' ago'}${v.moved ? ` · <b class="mvn">${v.moved.wallets} swapped in</b>` : ''} · ${links(v.mint)}</span></span><span class="h-a">+${mins(v.after)}</span><span class="h-m">${usd(v.mc)}</span><span class="h-v">${usd(v.vol)} vol</span><span class="acts"><button class="btn sm" type="button" data-prop="${esc(o.mint)}|${esc(v.mint)}">Tie</button><button class="btn sm" type="button" data-mv="${esc(v.mint)}|${esc(o.mint)}">Swap in</button></span></div>`).join('')}</div>` : `<div class="empty"><b>No vamps.</b> This one is the only one.</div>`}`;
      if (quiet && before.size) { const n = r.vamps.filter(v => !before.has(v.mint)).length; if (n) toast(`${n} new vamp${n === 1 ? '' : 's'} of $${r.og.symbol} just launched`); }
    } catch (e) { if (!quiet) out.innerHTML = `<div class="empty"><b>Search failed.</b><br>${esc(e.message)}</div>`; }
  }
  setInterval(() => { const el = $('#vAge'); if (el && S.vAt) { const s = Math.round((Date.now() - S.vAt) / 1000); el.textContent = s < 5 ? 'just now' : s + 's ago'; } }, 1000);
  $('#vFind').addEventListener('submit', e => { e.preventDefault(); findVamps($('#vQ').value); });
  $('#heroFind').addEventListener('submit', e => { e.preventDefault(); const q = $('#heroQ').value.trim(); if (!q) return $('#heroQ').focus(); $('#vQ').value = q; findVamps(q); goTo($('#vamps')); });
  document.addEventListener('click', async e => {
    const c = e.target.closest('[data-copy]'); if (c) { try { await navigator.clipboard.writeText(c.dataset.copy); toast('Copied'); } catch (x) { } }
    const p = e.target.closest('[data-prop]'); if (p) { const [a, b] = p.dataset.prop.split('|'); $('#pAin').value = a; $('#pBin').value = b; loadSide('A'); loadSide('B'); goTo($('#propose')); }
    const m = e.target.closest('[data-mv]'); if (m) { const [from, to] = m.dataset.mv.split('|'); openMoveIn(from, to); }
  });

  /* ---------------- propose ---------------- */
  const P = { A: null, B: null };
  async function loadSide(k) {
    const inp = $(`#p${k}in`), card = $(`#p${k}c`), ca = inp.value.trim();
    P[k] = null; renderTerms();
    if (!ca) { card.innerHTML = ''; return; }
    if (!B58.test(ca)) { card.innerHTML = 'That is not a Solana address.'; return; }
    card.innerHTML = 'Reading the chain…';
    try { const c = await api('coin?ca=' + encodeURIComponent(ca)); if (inp.value.trim() !== ca) return; P[k] = c; card.innerHTML = `${av(c, true)}<div><b>$${esc(c.symbol)}</b><div class="m">${esc(c.name)}</div><div class="m">mc ${usd(c.mc)} · liq ${usd(c.liq)} · ${c.created ? 'launched ' + ago(c.created) : 'no pair yet'}</div></div>`; }
    catch (e) { if (inp.value.trim() === ca) card.innerHTML = esc(e.message); }
    renderTerms();
  }
  let pT = {}; ['A', 'B'].forEach(k => $(`#p${k}in`).addEventListener('input', () => { clearTimeout(pT[k]); pT[k] = setTimeout(() => loadSide(k), 380); }));
  function renderTerms() {
    const A = P.A, B = P.B, box = $('#pTerms'), go = $('#pGo'); S.pTied = !!(A && B); knotLed.wake();
    if (!A || !B || A.mint === B.mint) { box.classList.remove('show'); go.disabled = true; $('#pErr').textContent = A && B ? 'Pick two different coins.' : ''; return; }
    const [big, small] = (A.mc || 0) >= (B.mc || 0) ? [A, B] : [B, A], tot = (big.mc || 0) + (small.mc || 0) || 1, sb = (big.mc || 0) / tot * 100;
    const rate = small.price && big.price ? small.price / big.price : null;
    box.innerHTML = `<div class="tsay">$${esc(big.symbol)} stays. $${esc(small.symbol)} holders swap into it.</div>
      <div class="share"><i style="width:${sb}%"></i><i style="width:${100 - sb}%"></i></div>
      <div class="tline"><span>$${esc(big.symbol)} <b>${sb.toFixed(1)}%</b> of the total</span><span>$${esc(small.symbol)} <b>${(100 - sb).toFixed(1)}%</b></span></div>
      <div class="tline" style="margin-top:8px"><span>rate today <b>1 ${esc(small.symbol)} ≈ ${rate ? (rate >= 1 ? rate.toFixed(4) : rate.toPrecision(4)) : '—'} ${esc(big.symbol)}</b></span><span>vote: <b>${S.cfg.windowHours}h</b> · both sides need a majority and ${S.cfg.minTurnout}% of supply voting yes</span></div>`;
    box.classList.add('show'); go.disabled = false; $('#pErr').textContent = '';
  }
  $('#pGo').addEventListener('click', () => needAuth(async () => {
    const btn = $('#pGo'); btn.disabled = true; $('#pErr').textContent = '';
    try { const r = await api('propose', { a: P.A.mint, b: P.B.mint }); toast('Tie started. Voting is open for 24 hours.'); await loadCeremonies(); openWedding(r.id); }
    catch (e) { $('#pErr').textContent = e.message; if (e.data && e.data.id) openWedding(e.data.id); }
    btn.disabled = false;
  }));

  /* ---------------- ceremonies ---------------- */
  function bars(w) {
    const T = w.tally || { a: {}, b: {} }, row = (c, t) => { const y = t.yes || 0, n = t.no || 0, scale = Math.max(4, w.minTurnout * 3, y + n); return `<div class="bar"><span>$${esc(c.symbol)}</span><span class="tr"><i class="yes" style="width:${Math.min(100, y / scale * 100)}%"></i><i class="no" style="width:${Math.min(100, n / scale * 100)}%"></i><i class="tick" style="left:${Math.min(100, w.minTurnout / scale * 100)}%"></i></span><span class="v">${pct(y)} · ${pct(n)}</span></div>`; };
    return `<div class="bars">${row(w.a, T.a || {})}${row(w.b, T.b || {})}</div>`;
  }
  const movedLine = w => { const m = w.moved || {}; return `<div class="mvd mono"><span>SWAPPED IN</span><span class="mvbar"><i style="width:${Math.min(100, (m.pct || 0) * 4)}%"></i></span><span><b>${m.wallets || 0}</b> wallet${m.wallets === 1 ? '' : 's'} · <b>${pct(m.pct || 0)}</b> of $${esc(w.b.symbol)}</span></div>`; };
  const pairHtml = w => `<div class="pair"><span class="c">${av(w.a)}<span><b>$${esc(w.a.symbol)}</b><span>${usd(w.a.mc)} · stays</span></span></span><span class="x">${tieSvg(34)}</span><span class="c"><span><b>$${esc(w.b.symbol)}</b><span>${usd(w.b.mc)} · swaps in</span></span>${av(w.b)}</span></div>`;
  async function loadCeremonies() {
    const box = $('#cList');
    try {
      const r = await api('weddings?status=open'); S.open = r.weddings;
      box.innerHTML = r.weddings.length ? r.weddings.map(w => `<div class="wcard" data-w="${w.id}">${pairHtml(w)}<div class="clock"><span>VOTING · ${w.voters} vote${w.voters === 1 ? '' : 's'}</span><b data-left="${esc(w.closes)}">${left(w.closes)}</b></div>${bars(w)}${movedLine(w)}<div class="vote"><button class="btn sm${w.mine && w.mine.choice === 'do' ? ' on' : ''}" type="button" data-vote="${w.id}|do">Yes</button><button class="btn sm${w.mine && w.mine.choice === 'object' ? ' on' : ''}" type="button" data-vote="${w.id}|object">No</button></div></div>`).join('')
        : `<div class="empty" style="grid-column:1/-1"><b>No open votes.</b><br>Find a vamp and start the first tie.</div>`;
    } catch (e) { if (!S.open) box.innerHTML = `<div class="empty" style="grid-column:1/-1"><b>Could not load votes.</b><br>${esc(e.message)}</div>`; }
  }
  setInterval(() => $$('[data-left]').forEach(el => { el.textContent = left(el.dataset.left); }), 1000);
  async function vote(id, choice) {
    needAuth(async () => {
      try { const r = await api('vote', { id, choice }); toast(`${choice === 'do' ? 'Yes' : 'No'} counted at ${pct(Math.max(r.a, r.b))} of supply.`); loadCeremonies(); if (S.drawer === id) openWedding(id); }
      catch (e) { toast(e.message, 4000); }
    });
  }
  document.addEventListener('click', e => {
    const v = e.target.closest('[data-vote]'); if (v) { e.stopPropagation(); const [id, c] = v.dataset.vote.split('|'); return vote(+id, c); }
    const w = e.target.closest('[data-w]'); if (w) openWedding(+w.dataset.w);
  });

  /* ---------------- the registry ---------------- */
  let tSt = 'tied';
  async function loadTied() {
    const box = $('#tList');
    try {
      const r = await api('weddings?status=' + tSt);
      box.innerHTML = r.weddings.length ? r.weddings.map(w => { const t = w.tally || { a: {}, b: {} }; return `<button type="button" class="trow" data-w="${w.id}"><span class="mono">#${w.id}</span>${pairHtml(w)}<span class="h-d">${new Date(w.closed || w.closes).toLocaleDateString()}</span><span class="h-c">${w.status === 'tied' ? `swapped in ${pct((w.moved || {}).pct || 0)} · ${(w.moved || {}).wallets || 0}w` : `yes ${pct((t.a || {}).yes || 0)} · ${pct((t.b || {}).yes || 0)}`}</span><span><span class="st ${w.status === 'tied' ? 'tied' : ''}">${w.status === 'tied' ? 'TIED' : 'NOT TIED'}</span></span></button>`; }).join('')
        : `<div class="empty">${tSt === 'tied' ? '<b>Nothing tied yet.</b><br>The first tie lands here.' : 'Nothing here yet.'}</div>`;
    } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }
  $('#tTabs').addEventListener('click', e => { const b = e.target.closest('[data-st]'); if (!b) return; tSt = b.dataset.st; $$('#tTabs button').forEach(x => x.classList.toggle('on', x === b)); loadTied(); });

  /* ---------------- the drawer: one wedding ---------------- */
  const drawer = $('#drawer'), dPanel = $('#dPanel');
  function openDrawer(html) { dPanel.innerHTML = html; drawer.classList.add('on'); drawer.setAttribute('aria-hidden', 'false'); if (lenis) lenis.stop(); }
  function closeDrawer() { drawer.classList.remove('on'); drawer.setAttribute('aria-hidden', 'true'); S.drawer = null; if (lenis) lenis.start(); if (/^#w=/.test(location.hash)) history.replaceState(null, '', location.pathname); }
  drawer.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeDrawer(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && drawer.classList.contains('on') && !$('.modal')) closeDrawer(); });
  async function openWedding(id) {
    S.drawer = id; try { history.replaceState(null, '', '#w=' + id); } catch (e) { }
    if (!drawer.classList.contains('on')) openDrawer(`<div class="empty">Loading…</div>`);
    try {
      const r = await api('wedding?id=' + id), w = r.wedding; if (S.drawer !== id) return;
      const st = w.status === 'open' || w.status === 'closing' ? `<span class="st">VOTING</span>` : w.status === 'tied' ? `<span class="st tied">TIED</span>` : `<span class="st">NOT TIED</span>`;
      dPanel.innerHTML = `<div class="dtop"><span class="mono" style="color:var(--fa);font-size:12px">TIE #${w.id} · started by ${esc(w.by)}</span><button class="dclose" type="button" data-close aria-label="Close">×</button></div>
        ${pairHtml(w)}
        <div class="dsec" style="margin-top:18px">${st} ${w.status === 'open' ? `<span class="mono" style="color:var(--mu);font-size:12px;margin-left:8px">closes in <b data-left="${esc(w.closes)}" style="color:var(--tx);font-weight:500">${left(w.closes)}</b></span>` : `<span class="mono" style="color:var(--mu);font-size:12px;margin-left:8px">${new Date(w.closed || w.closes).toLocaleString()}</span>`}</div>
        <div class="dsec"><h4>THE VOTE · % OF EACH SUPPLY</h4>${bars(w)}<p class="mono" style="color:var(--fa);font-size:11.5px;margin-top:10px">white: yes · grey: no · line: ${w.minTurnout}% needed</p>
          ${w.status === 'open' ? `<div class="vote" style="margin-top:14px"><button class="btn${w.mine && w.mine.choice === 'do' ? ' on' : ''}" type="button" data-vote="${w.id}|do">Yes</button><button class="btn${w.mine && w.mine.choice === 'object' ? ' on' : ''}" type="button" data-vote="${w.id}|object">No</button></div><p class="mono" style="color:var(--fa);font-size:11.5px;margin-top:10px">free signature · weight = your balance, read again when the window closes</p>` : ''}</div>
        ${w.status === 'tied' ? `<div class="dsec"><h4>SHARE CARD</h4><div class="cert"><canvas id="certC" width="1200" height="630"></canvas></div><div class="vote" style="margin-top:12px"><button class="btn sm" type="button" id="certDl">Download</button><a class="btn sm" target="_blank" rel="noopener" href="https://x.com/intent/tweet?text=${encodeURIComponent(`$${w.a.symbol} and $${w.b.symbol} just got TIED. two coins. one knot.\n${location.origin}/#w=${w.id}`)}">Share on X</a></div></div>` : ''}
        <div class="dsec"><h4>TIE YOUR BAG · $${esc(w.b.symbol)} → $${esc(w.a.symbol)}</h4>${w.status === 'tied' ? `<p class="mvq">Tied. Holders of $${esc(w.b.symbol)} swap into $${esc(w.a.symbol)} with one click. Every swap is read back from Solana before it counts.</p>` : ''}<div id="mvBox"></div></div>
        <div class="dsec"><h4>VOTES · ${w.voters}</h4><div class="vlog">${r.votes.length ? r.votes.map(v => `<div><span>${esc(v.wallet)}</span><span class="${v.choice === 'do' ? 'do' : ''}">${v.choice === 'do' ? 'YES' : 'NO'}</span><span>${v.a > 0 ? pct(v.a) + ' ' + esc(w.a.symbol) : ''} ${v.b > 0 ? pct(v.b) + ' ' + esc(w.b.symbol) : ''}</span></div>`).join('') : '<span>No votes yet.</span>'}</div></div>`;
      mountMoveIn($('#mvBox'), w.b, w.a, () => { if (S.drawer === id) { loadCeremonies(); loadTied(); } });
      if (w.status === 'tied') drawCert($('#certC'), w);
    } catch (e) { if (S.drawer === id) dPanel.innerHTML = `<div class="dtop"><span></span><button class="dclose" type="button" data-close>×</button></div><div class="empty">${esc(e.message)}</div>`; }
  }

  /* ---------------- move in: a real Jupiter swap from one coin into the other ---------------- */
  async function openMoveIn(from, to) {
    openDrawer(`<div class="dtop"><span class="mono" style="color:var(--fa);font-size:12px">TIE YOUR BAG</span><button class="dclose" type="button" data-close>×</button></div><div class="empty">Reading both coins…</div>`);
    try { const [a, b] = await Promise.all([api('coin?ca=' + from), api('coin?ca=' + to)]);
      dPanel.innerHTML = `<div class="dtop"><span class="mono" style="color:var(--fa);font-size:12px">TIE YOUR BAG</span><button class="dclose" type="button" data-close>×</button></div><div class="pair"><span class="c">${av(a)}<span><b>$${esc(a.symbol)}</b><span>the vamp · ${usd(a.mc)}</span></span></span><span class="x">${tieSvg(34)}</span><span class="c"><span><b>$${esc(b.symbol)}</b><span>the original · ${usd(b.mc)}</span></span>${av(b)}</span></div><div class="dsec" style="margin-top:18px"><h4>SWAP YOUR $${esc(a.symbol)} INTO $${esc(b.symbol)}</h4><div id="mvBox"></div></div>`;
      mountMoveIn($('#mvBox'), a, b);
    } catch (e) { dPanel.innerHTML = `<div class="dtop"><span></span><button class="dclose" type="button" data-close>×</button></div><div class="empty">${esc(e.message)}</div>`; }
  }
  function mountMoveIn(box, from, to, after) {
    box.innerHTML = `<div class="mv"><div class="mvp"><div class="kv"><span>swapped in so far · verified on chain</span><b data-mvs>reading…</b></div><div class="mvbar big"><i data-mvbar></i></div></div>
      <div class="kv"><span>your $${esc(from.symbol)}</span><b data-bal>${S.wallet ? '…' : 'connect to see'}</b></div>
      <div class="kv"><span>you get</span><b data-out>—</b></div>
      <button class="btn pri wide" type="button" data-all>${S.wallet ? 'Tie my whole bag' : 'Connect to tie your bag'}</button>
      <div class="mvr"><input data-amt inputmode="decimal" placeholder="or move part: amount of $${esc(from.symbol)}"><button class="btn sm" type="button" data-go>Move</button></div>
      <p class="err" data-err></p><div class="mvlog" data-log></div></div>`;
    let bal = null, q = null, qt, busy = false; const out = $('[data-out]', box), err = $('[data-err]', box), amt = $('[data-amt]', box), go = $('[data-go]', box), all = $('[data-all]', box);
    const loadBal = async () => { if (!S.wallet) return; try { bal = await tokenBalance(from.mint); $('[data-bal]', box).textContent = bal.ui.toLocaleString(undefined, { maximumFractionDigits: 4 }); } catch (e) { $('[data-bal]', box).textContent = '—'; } };
    const loadMoves = async () => {
      try {
        const m = await api(`moves?from=${from.mint}&to=${to.mint}`), p = from.supply ? m.amt / from.supply * 100 : 0;
        $('[data-mvs]', box).textContent = m.wallets ? `${m.wallets} wallet${m.wallets === 1 ? '' : 's'} · ${amtF(m.amt)} $${from.symbol}${from.supply ? ' · ' + pct(p) + ' of supply' : ''}` : 'nobody yet · be the first';
        $('[data-mvbar]', box).style.width = Math.min(100, p) + '%';
        $('[data-log]', box).innerHTML = m.list.map(x => `<a href="https://solscan.io/tx/${esc(x.sig)}" target="_blank" rel="noopener"><span>${esc(x.wallet)}</span><span>${amtF(x.gave)} $${esc(from.symbol)} → ${amtF(x.got)} $${esc(to.symbol)}</span><span>${ago(x.at)} ↗</span></a>`).join('');
      } catch (e) { $('[data-mvs]', box).textContent = '—'; }
    };
    const showOut = j => { const o = Number(j.outAmount) / 10 ** (to.decimals || 6); out.textContent = `${o.toLocaleString(undefined, { maximumFractionDigits: 4 })} $${to.symbol}${j.priceImpactPct ? ' · impact ' + (Number(j.priceImpactPct) * 100).toFixed(2) + '%' : ''}`; };
    const getQuote = async raw => { const j = await api(`quote?in=${from.mint}&out=${to.mint}&amount=${raw}`); showOut(j); return j; };
    const rawOf = v => { const dec = (bal && bal.dec) || from.decimals || 6; return BigInt(Math.floor(v * 10 ** Math.min(dec, 9))) * (dec > 9 ? 10n ** BigInt(dec - 9) : 1n); };
    const quote = async () => {
      q = null; out.textContent = '—'; err.textContent = ''; const v = parseFloat(amt.value); if (!(v > 0)) return;
      out.textContent = 'quoting…'; try { q = await getQuote(rawOf(v)); } catch (e) { out.textContent = '—'; err.textContent = e.message; }
    };
    amt.addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(quote, 380); });
    // swap → sign → confirm → the server reads the transaction back from Solana and counts it
    async function run(btn, label, quoteFn) {
      if (busy) return; busy = true; err.textContent = ''; btn.disabled = true;
      try {
        btn.textContent = 'Quoting…'; const qq = await quoteFn(); if (!qq) return;
        btn.textContent = 'Building…'; const j = await api('swap', { quoteResponse: qq, userPublicKey: S.wallet });
        btn.textContent = 'Check wallet'; const sig = await signSend(W().VersionedTransaction.deserialize(unb64(j.swapTransaction)));
        btn.textContent = 'Confirming…'; const ok = await confirm(sig);
        btn.textContent = 'Verifying on chain…'; let v = null;
        for (let i = 0; i < 10 && !v; i++) { try { v = await api('moved', { sig, from: from.mint, to: to.mint }); } catch (e) { if (e.status !== 409) { err.textContent = e.message; break; } await sleep(2500); } }
        toast(v ? `Tied. ${amtF(v.gave)} $${from.symbol} swapped into $${to.symbol}, verified on chain.` : ok ? 'Swapped. Waiting for the chain to show it.' : 'Sent. Waiting for the network.', 4500);
        if (!err.textContent) err.innerHTML = `<a href="https://solscan.io/tx/${esc(sig)}" target="_blank" rel="noopener" style="color:var(--tx)">view on Solscan ↗</a>`;
        amt.value = ''; q = null; loadBal(); loadMoves(); if (after) after();
      } catch (e) { err.textContent = errMsg(e); }
      finally { busy = false; btn.disabled = false; btn.textContent = label; }
    }
    all.onclick = () => needTx(() => run(all, 'Tie my whole bag', async () => {
      await loadBal(); if (!bal || bal.raw <= 0n) { err.textContent = `This wallet holds no $${from.symbol}.`; return null; }
      amt.value = ''; return getQuote(bal.raw.toString());
    }));
    go.onclick = () => needTx(() => run(go, 'Move', async () => { if (!(parseFloat(amt.value) > 0)) { amt.focus(); toast('Enter an amount'); return null; } if (!bal) await loadBal(); return q || getQuote(rawOf(parseFloat(amt.value))); }));
    loadBal(); loadMoves();
  }

  /* ---------------- the certificate, drawn in dots ---------------- */
  function drawCert(c, w) {
    const g = c.getContext('2d'), Wd = c.width, Hd = c.height, cell = 10, gw = Wd / cell, gh = Hd / cell;
    const lo = document.createElement('canvas'); lo.width = gw; lo.height = gh; const l = lo.getContext('2d');
    l.fillStyle = '#000'; l.fillRect(0, 0, gw, gh); drawTie(l, gw / 2, gh * .3, gw * .32, { rim: 1.4 });
    const d = l.getImageData(0, 0, gw, gh).data; g.fillStyle = '#000'; g.fillRect(0, 0, Wd, Hd);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { const v = d[(y * gw + x) * 4] / 255, lum = Math.round(22 + v * 220); g.fillStyle = `rgb(${lum},${lum},${lum})`; g.beginPath(); g.arc(x * cell + cell / 2, y * cell + cell / 2, cell * (.33 + v * .11), 0, Math.PI * 2); g.fill(); }
    const T = w.tally || { a: {}, b: {} };
    g.textAlign = 'center'; g.fillStyle = 'rgba(0,0,0,.75)'; g.fillRect(0, Hd * .52, Wd, Hd * .48);
    g.fillStyle = '#efefef'; g.font = '800 64px I, Inter, sans-serif'; g.fillText(`$${w.a.symbol}  ×  $${w.b.symbol}`, Wd / 2, Hd * .66);
    g.fillStyle = '#8a8a8a'; g.font = '500 24px M, monospace'; g.fillText(`TIED ON ${new Date(w.closed || w.closes).toDateString().toUpperCase()} · TIE #${w.id}`, Wd / 2, Hd * .76);
    g.fillText(`YES  ${pct((T.a || {}).yes || 0)} OF $${w.a.symbol}  ·  ${pct((T.b || {}).yes || 0)} OF $${w.b.symbol}`, Wd / 2, Hd * .83);
    g.fillStyle = '#efefef'; g.font = '500 20px M, monospace'; g.fillText(`SWAPPED IN · ${pct((w.moved || {}).pct || 0)} OF $${w.b.symbol} · ${(w.moved || {}).wallets || 0} WALLETS`, Wd / 2, Hd * .93);
    const dl = $('#certDl'); if (dl) dl.onclick = () => c.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `tied-${w.a.symbol}-${w.b.symbol}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); });
  }

  /* ---------------- launch: a real pump.fun coin ---------------- */
  let IMG = null; const drop = $('#lDrop');
  function readImg(f) {
    if (!f || !/^image\//.test(f.type)) return toast('Pick an image');
    const r = new FileReader(); r.onload = () => { const im = new Image(); im.onload = () => { const s = Math.min(1, 512 / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * s); c.height = Math.round(im.height * s); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); IMG = f.type === 'image/gif' && f.size < 900e3 ? r.result : c.toDataURL(f.type === 'image/png' ? 'image/png' : 'image/jpeg', .9); drop.style.backgroundImage = `url(${IMG})`; drop.classList.add('has'); }; im.src = r.result; };
    r.readAsDataURL(f);
  }
  $('#lImg').addEventListener('change', e => readImg(e.target.files[0]));
  ['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); if (ev === 'drop') readImg(e.dataTransfer.files[0]); }));
  document.addEventListener('paste', e => { const f = [...(e.clipboardData && e.clipboardData.files || [])].find(f => f.type.startsWith('image/')); if (f && $('#launch').getBoundingClientRect().top < innerHeight) readImg(f); });
  const step = n => $$('#lSteps li').forEach(li => { const k = +li.dataset.s; li.classList.toggle('done', k < n); li.classList.toggle('on', k === n); });
  $('#lForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('#lName').value.trim(), sym = $('#lSym').value.trim().toUpperCase(), amount = parseFloat($('#lBuy').value) || 0;
    if (!IMG) { drop.classList.add('over'); setTimeout(() => drop.classList.remove('over'), 900); return toast('Add an image'); }
    if (!name) { $('#lName').focus(); return toast('Add a name'); }
    if (!sym) { $('#lSym').focus(); return toast('Add a ticker'); }
    if (amount < 0 || amount > 20) return toast('Dev buy is 0 to 20 SOL');
    needTx(async () => {
      const btn = $('#lGo'), lab = btn.querySelector('span'), out = $('#lOut'); btn.disabled = true; out.innerHTML = '';
      try {
        const w = W(), kp = w.Keypair.generate(), mint = kp.publicKey.toBase58();
        step(1); lab.textContent = 'Uploading…';
        const meta = await api('meta', { image: IMG, name, symbol: sym, description: $('#lDesc').value, twitter: $('#lX').value, website: $('#lWeb').value || `${location.origin}` });
        step(2); lab.textContent = 'Building…';
        const bt = await api('launchtx', { meta: meta.id, uri: meta.uri, mint, amount });
        step(3); lab.textContent = 'Check wallet';
        const sig = await signSend(w.VersionedTransaction.deserialize(unb64(bt.tx)), [kp]);
        lab.textContent = 'Confirming…'; const ok = await confirm(sig);
        step(ok ? 5 : 4);
        for (let i = 0; i < 6; i++) { try { await api('launched', { mint, sig, meta: meta.id }); break; } catch (x) { await sleep(2500); } }
        out.innerHTML = `<div class="done-card"><b>${ok ? 'Live' : 'Sent'} · $${esc(meta.symbol)}</b><div class="acts"><a class="btn sm" href="https://pump.fun/coin/${esc(mint)}" target="_blank" rel="noopener">pump.fun</a><button class="btn sm" type="button" data-copy="${esc(mint)}">Copy CA</button><a class="btn sm" href="https://solscan.io/tx/${esc(sig)}" target="_blank" rel="noopener">Solscan</a><button class="btn sm" type="button" data-vq="${esc(meta.symbol)}">Find its vamps</button></div></div>`;
        loadSingles();
      } catch (x) { step(0); out.innerHTML = `<p class="err">${esc(errMsg(x))}</p>`; }
      btn.disabled = false; lab.textContent = 'Launch on pump.fun';
    });
  });
  async function loadSingles() {
    try { const r = await api('singles'); if (!r.coins.length) return; $('#sList').innerHTML = r.coins.map(c => `<div class="srow">${av(c)}<span><b>$${esc(c.symbol)}</b>${esc(c.name)} · ${c.mc ? usd(c.mc) : 'new'}</span><span class="acts" style="display:flex;gap:6px"><a class="btn sm" href="https://pump.fun/coin/${esc(c.mint)}" target="_blank" rel="noopener">Buy</a><button class="btn sm" type="button" data-vq="${esc(c.symbol)}">Vamps</button></span></div>`).join(''); } catch (e) { }
  }

  /* ---------------- the bloodline: the original on the left, every vamp placed by when it launched ---------------- */
  function bloodline(pts, ogMc, w, h) {
    const pad = 14, maxA = Math.max(30, ...pts.map(p => p[0])), maxMc = Math.max(1, ogMc || 0, ...pts.map(p => p[2])), L = Math.log(1 + maxA);
    const X = a => pad + 18 + (w - pad * 2 - 18) * Math.log(1 + a) / L, mid = h / 2;
    const ticks = [[60, '1h'], [1440, '1d'], [10080, '1w'], [43200, '30d']].filter(t => t[0] < maxA).map(t => `<line x1="${X(t[0])}" x2="${X(t[0])}" y1="${mid - 4}" y2="${mid + 4}" stroke="#333"/><text x="${X(t[0])}" y="${h - 2}" fill="#555" font-size="10" font-family="M,monospace" text-anchor="middle">${t[1]}</text>`).join('');
    const dots = pts.map((p, i) => { const r = 2 + 9 * Math.sqrt((p[2] || 0) / maxMc), y = mid + ((i % 5) - 2) * Math.min(5, h / 12); return `<circle cx="${X(p[0]).toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${p[1] <= 60 ? '#efefef' : '#5c5c5c'}" stroke="#000" stroke-width="1"><animate attributeName="r" from="0" to="${r.toFixed(1)}" dur=".6s" begin="${(i * .03).toFixed(2)}s" fill="freeze"/></circle>`; }).join('');
    const ogR = 3 + 10 * Math.sqrt((ogMc || 0) / maxMc);
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><line x1="${pad}" x2="${w - pad}" y1="${mid}" y2="${mid}" stroke="#2a2a2a"/>${ticks}${dots}<circle cx="${pad + 4}" cy="${mid}" r="${Math.max(6, ogR)}" fill="#fff" stroke="#777" stroke-width="2"/></svg>`;
  }
  function renderBoard(list) {
    const box = $('#vBoard'); $('#vbAge').textContent = 'rescans every minute';
    if (!list.length) { box.innerHTML = `<div class="empty" style="grid-column:1/-1">Nothing trending has been copied yet. Give it a minute.</div>`; return; }
    box.innerHTML = list.slice(0, 8).map((x, i) => `<button type="button" class="vb" data-vq="${esc(x.symbol)}" style="--i:${i}"><span class="top">${av(x)}<span style="min-width:0"><b>$${esc(x.symbol)}</b><span>${esc(x.name)} · ${x.isOg ? 'the original' : 'itself a vamp'}</span></span></span>
      <span class="cnt"><b>${x.vamps}</b><span>vamp${x.vamps === 1 ? '' : 's'}${x.fresh ? ` · <i class="fresh">+${x.fresh} THIS HOUR</i>` : ''}</span></span>
      ${bloodline(x.times || [], x.ogMc, 300, 34)}
      <span class="ft"><span>newest <b>${x.newest == null ? '—' : x.newest < 1 ? 'just now' : mins(x.newest) + ' ago'}</b></span><span>mc <b>${usd(x.mc)}</b></span></span></button>`).join('');
  }
  function renderSugg(list) {
    const pairs = list.filter(x => x.og && (x.isOg ? x.top : true)).slice(0, 4).map(x => ({ a: x.og, b: x.isOg ? x.top : x.mint, sym: x.symbol, img: x }));
    $('#pSugg').hidden = !pairs.length;
    $('#pSuggIn').innerHTML = pairs.map(p => `<button type="button" data-prop="${esc(p.a)}|${esc(p.b)}">${av(p.img)}$${esc(p.sym)} × its ${p.a === p.b ? 'twin' : 'biggest vamp'}</button>`).join('');
  }
  /* the marquee between the chapel and the scan: a dot-matrix sign of what's being copied right now */
  let MARQ = 'SCANNING FOR VAMPS   ·   TWO COINS IN   ·   ONE COIN RUNS   ·   ';
  function setMarquee(list) { if (list.length) MARQ = 'MOST VAMPED RIGHT NOW   ·   ' + list.slice(0, 10).map(x => `$${x.symbol.toUpperCase()} ${x.vamps} VAMPS${x.fresh ? ' (+' + x.fresh + ' THIS HOUR)' : ''}`).join('   ·   ') + '   ·   '; }
  const marq = window.LED($('#marq'), {
    cell: () => innerWidth < 700 ? 3 : 4, fit: 'self', fps: 40, ease: .45,
    draw(g, gw, gh, t) {
      const fs = gh * .78; g.font = `800 ${fs}px I, Inter, sans-serif`; g.textBaseline = 'middle'; try { g.letterSpacing = (fs * .08) + 'px'; } catch (e) { }
      const w = g.measureText(MARQ).width || 1, x = -((t * gw * .07) % w);
      g.fillStyle = 'rgb(232,232,232)'; for (let k = x; k < gw; k += w) g.fillText(MARQ, k, gh / 2 + 1);
      return false;
    },
  });
  /* launch preview */
  function lPreview() {
    const sym = $('#lSym').value.trim().toUpperCase(), name = $('#lName').value.trim(), desc = $('#lDesc').value.trim();
    $('#lpSym').textContent = '$' + (sym || 'TICKER'); $('#lpName').textContent = name || 'your coin'; $('#lpDesc').textContent = desc || 'what it is, in one line';
    const im = $('#lpImg'); if (IMG && im.tagName !== 'IMG') { const n = document.createElement('img'); n.className = 'av lg'; n.id = 'lpImg'; n.alt = ''; im.replaceWith(n); } if (IMG) $('#lpImg').src = IMG;
  }
  ['#lSym', '#lName', '#lDesc'].forEach(sel => $(sel).addEventListener('input', lPreview));
  new MutationObserver(lPreview).observe($('#lDrop'), { attributes: true, attributeFilter: ['style'] });
  /* the vows, each drawn as a tiny loop on the dot panel */
  const VOW = {
    1(g, w, h, t) { const k = (t % 4) / 4, cx = w / 2, cy = h / 2, r = h * .22; coin(g, cx, cy, r);
      for (let i = 0; i < 7; i++) { const a = i / 7 * 6.28 + .4, b = ease.back((k - .1 - i * .05) / .15) * (1 - ease.out((k - .8) / .15)); if (b > 0) coin(g, cx + Math.cos(a) * w * .3, cy + Math.sin(a) * h * .33, r * .45 * b, .9); } },
    2(g, w, h, t) { const k = (t % 3.6) / 3.6, d = w * .32 * (1 - ease.out(k / .5)) + w * .12, cy = h / 2, r = h * .24; coin(g, w / 2 - d, cy, r); coin(g, w / 2 + d, cy, r);
      const tie = ease.back((k - .5) / .2) * (1 - ease.out((k - .9) / .1)); if (tie > 0) drawTie(g, w / 2, cy - r * 1.45, r * 2.2 * tie, { rim: .8 }); },
    3(g, w, h, t) { const k = Math.min(1, (t % 4) / 2.6), bw = w * .78, x0 = (w - bw) / 2;
      [[.34, .72], [.62, .61]].forEach(([y, f]) => { g.fillStyle = 'rgb(60,60,60)'; g.fillRect(x0, h * y - 2, bw, 4); g.fillStyle = '#fff'; g.fillRect(x0, h * y - 2, bw * f * ease.out(k), 4); });
      g.fillStyle = 'rgb(160,160,160)'; g.fillRect(x0 + bw * .5, h * .18, 1, h * .64); },
    4(g, w, h, t) { const k = (t % 3.4) / 3.4, bx = w * .66, cy = h / 2, R = h * .3, m = ease.out(k / .6), sx = w * .18 + (bx - w * .18) * m;
      coin(g, bx, cy, R * (1 + (k > .6 && k < .8 ? Math.sin((k - .6) / .2 * Math.PI) * .12 : 0))); if (k < .62) coin(g, sx, cy, R * .55 * (1 - m * .6), 1); },
  };
  $$('.vled').forEach(c => { const f = VOW[c.dataset.v]; window.LED(c, { cell: 5, fit: 'self', fps: 30, ease: .3, draw(g, gw, gh, t) { f(g, gw, gh, t); return false; } }); });

  /* ---------------- start ---------------- */
  function refreshAll() { loadCeremonies(); loadTied(); if (S.drawer) openWedding(S.drawer); }
  renderMe();
  api('config').then(c => { S.cfg = c; $$('.minT').forEach(x => x.textContent = c.minTurnout); }).catch(() => { });
  loadRadar(); loadLive(); loadCeremonies(); loadTied(); loadSingles();
  setInterval(() => { if (!document.hidden) loadLive(); }, 20000);
  setInterval(() => { if (!document.hidden) loadCeremonies(); }, 20000);
  setInterval(() => { if (!document.hidden) { loadTied(); loadSingles(); } }, 60000);
  setInterval(() => { if (!document.hidden) loadRadar(); }, 60000);
  setInterval(() => { if (!document.hidden && S.vq && $('#vamps').getBoundingClientRect().top < innerHeight && $('#vamps').getBoundingClientRect().bottom > 0) findVamps(S.vq, true); }, 60000);
  const deep = (location.hash.match(/^#w=(\d+)/) || [])[1]; if (deep) setTimeout(() => openWedding(+deep), 600);
})();
