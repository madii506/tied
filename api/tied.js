'use strict';
/* TIED: two coins tie the knot. Everything here is read from Solana, Dexscreener, Jupiter and PumpPortal.
 * Votes are free signed messages, weighted by real token balances and re-read when the 24h window closes.
 * Nothing is ever custodied: launches and swaps are transactions the user signs in their own wallet. */
const crypto = require('crypto');
const { PublicKey } = require('@solana/web3.js');

const E = (k, d = '') => String(process.env[k] == null ? d : process.env[k]).trim();
const RPC_URL = E('RPC_URL');
const RPCS = E('TIED_RPCS') ? E('TIED_RPCS').split(',') : [RPC_URL, 'https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com'].filter(Boolean);
const DEX = E('TIED_DEX', 'https://api.dexscreener.com'), JUP = E('TIED_JUP', 'https://lite-api.jup.ag'), PP = E('TIED_PP', 'https://pumpportal.fun');
const DB_URL = E('TIED_DB_URL') || E('TIED_DB_DATABASE_URL') || E('TIED_DB_POSTGRES_URL') || E('DATABASE_URL') || E('POSTGRES_URL');
const SECRET = E('SESSION_SECRET') || crypto.createHash('sha256').update('tied-session:' + DB_URL).digest('hex');
const WINDOW_H = Number(E('TIED_WINDOW_HOURS', '24')) || 24;
const MIN_TURNOUT = Number(E('TIED_MIN_TURNOUT', '1')) || 1;           // % of each coin's supply that must vote I DO
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ATA = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SPL = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', T22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

/* ---------------- plumbing ---------------- */
function send(res, code, body, headers) { res.statusCode = code; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); if (headers) for (const k in headers) res.setHeader(k, headers[k]); res.end(JSON.stringify(body)); }
function http(code, msg, extra) { const e = new Error(msg); e.code = code; if (extra) e.extra = extra; return e; }
async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  const chunks = []; let n = 0; for await (const c of req) { chunks.push(c); n += c.length; if (n > 6e6) break; }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch (e) { return {}; }
}
const timed = ms => (url, opt = {}) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); return fetch(url, { ...opt, signal: c.signal }).finally(() => clearTimeout(t)); };
const getJson = async (url, opt, ms = 9000) => { const r = await timed(ms)(url, opt); if (!r.ok) throw http(502, 'Upstream ' + r.status); return r.json(); };
const clean = s => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ');
const hits = new Map();
function limit(key, n, ms, msg) { const t = Date.now(), a = (hits.get(key) || []).filter(x => t - x < ms); if (a.length >= n) throw http(429, msg || 'Slow down a little.'); a.push(t); hits.set(key, a); if (hits.size > 5000) hits.clear(); }
const short = a => a ? a.slice(0, 4) + '…' + a.slice(-4) : '';

const ALPH = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58dec(s) { let n = 0n; for (const c of s) { const i = ALPH.indexOf(c); if (i < 0) throw new Error('bad'); n = n * 58n + BigInt(i); } let hex = n.toString(16); if (hex.length % 2) hex = '0' + hex; const body = n === 0n ? Buffer.alloc(0) : Buffer.from(hex, 'hex'); let z = 0; while (z < s.length && s[z] === '1') z++; return Buffer.concat([Buffer.alloc(z), body]); }
function verifySig(wallet, msg, sig) { try { const pub = b58dec(wallet); if (pub.length !== 32 || sig.length !== 64) return false; const key = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), pub]), format: 'der', type: 'spki' }); return crypto.verify(null, msg, key, sig); } catch (e) { return false; } }
const b64u = b => Buffer.from(b).toString('base64url');
function issue(wallet) { const p = b64u(JSON.stringify({ w: wallet, e: Date.now() + 14 * 864e5 })); return p + '.' + b64u(crypto.createHmac('sha256', SECRET).update(p).digest()); }
function who(req) {
  const m = String(req.headers.authorization || '').match(/^Bearer ([\w-]+)\.([\w-]+)$/); if (!m) return null;
  const want = b64u(crypto.createHmac('sha256', SECRET).update(m[1]).digest());
  if (want.length !== m[2].length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(m[2]))) return null;
  try { const j = JSON.parse(Buffer.from(m[1], 'base64url').toString()); return j.w && j.e > Date.now() ? j.w : null; } catch (e) { return null; }
}

/* ---------------- database ---------------- */
let sqlFn, ready;
function db() {
  if (!sqlFn) {
    if (E('TIED_LOCAL_PG')) { const { Pool } = require('pg'); const pool = new Pool({ connectionString: E('TIED_LOCAL_PG') }); sqlFn = async (strs, ...vals) => { let q = strs[0]; vals.forEach((v, i) => { q += '$' + (i + 1) + strs[i + 1]; }); return (await pool.query(q, vals)).rows; }; }
    else { if (!DB_URL) throw http(503, 'The database is not connected yet.'); const { neon } = require('@neondatabase/serverless'); sqlFn = neon(DB_URL); }
  }
  return sqlFn;
}
async function ensure() {
  if (ready) return ready;
  ready = (async () => {
    const s = db();
    await s`CREATE TABLE IF NOT EXISTS td_nonces (nonce TEXT PRIMARY KEY, wallet TEXT NOT NULL, text TEXT NOT NULL, used BOOLEAN DEFAULT false, at TIMESTAMPTZ DEFAULT now())`;
    await s`CREATE TABLE IF NOT EXISTS td_weddings (id BIGSERIAL PRIMARY KEY, a_mint TEXT, b_mint TEXT, a JSONB, b JSONB, proposer TEXT, vow TEXT, status TEXT DEFAULT 'open', opens_at TIMESTAMPTZ DEFAULT now(), closes_at TIMESTAMPTZ, closed_at TIMESTAMPTZ, result JSONB)`;
    await s`CREATE INDEX IF NOT EXISTS td_weddings_status ON td_weddings (status, closes_at)`;
    await s`CREATE TABLE IF NOT EXISTS td_votes (wedding BIGINT, wallet TEXT, choice TEXT, a_bal NUMERIC DEFAULT 0, b_bal NUMERIC DEFAULT 0, a_final NUMERIC, b_final NUMERIC, at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (wedding, wallet))`;
    await s`CREATE TABLE IF NOT EXISTS td_meta (id TEXT PRIMARY KEY, wallet TEXT, name TEXT, symbol TEXT, description TEXT, twitter TEXT, website TEXT, mime TEXT, image TEXT, at TIMESTAMPTZ DEFAULT now())`;
    await s`CREATE TABLE IF NOT EXISTS td_launches (mint TEXT PRIMARY KEY, wallet TEXT, name TEXT, symbol TEXT, meta TEXT, sig TEXT, at TIMESTAMPTZ DEFAULT now())`;
    await s`CREATE TABLE IF NOT EXISTS td_cache (k TEXT PRIMARY KEY, v JSONB, at TIMESTAMPTZ DEFAULT now())`;
  })();
  try { await ready; } catch (e) { ready = null; throw e; }
  return ready;
}
async function cached(k, secs, fn) {
  const row = (await db()`SELECT v, extract(epoch FROM now() - at) AS age FROM td_cache WHERE k=${k}`)[0];
  if (row && row.age < secs) return row.v;
  try { const v = await fn(); await db()`INSERT INTO td_cache (k, v, at) VALUES (${k}, ${JSON.stringify(v)}, now()) ON CONFLICT (k) DO UPDATE SET v=EXCLUDED.v, at=now()`; return v; }
  catch (e) { if (row) return row.v; throw e; }
}

/* ---------------- Solana ---------------- */
async function rpc(method, params, good) {
  let last;
  for (const u of RPCS) {
    try {
      const r = await timed(9000)(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const j = await r.json(); if (j.error) throw new Error(j.error.message || 'rpc error');
      if (good && !good(j.result)) throw new Error('unusable answer'); return j.result;
    } catch (e) { last = e; }
  }
  throw http(502, 'Solana RPC is busy, try again in a moment.');
}
const mintCache = new Map();
async function mintInfo(mint) {
  const c = mintCache.get(mint); if (c && Date.now() - c.t < 300e3) return c.v;
  const r = await rpc('getAccountInfo', [mint, { encoding: 'jsonParsed' }]);
  const v = r && r.value; if (!v || !v.data || !v.data.parsed || v.data.parsed.type !== 'mint') throw http(400, 'That address is not a token.');
  const i = v.data.parsed.info, out = { program: v.owner, decimals: i.decimals, supply: Number(i.supply) / 10 ** i.decimals };
  mintCache.set(mint, { t: Date.now(), v: out }); return out;
}
async function balanceOf(owner, mint) {
  const r = await rpc('getTokenAccountsByOwner', [owner, { mint }, { encoding: 'jsonParsed' }], x => x && Array.isArray(x.value));
  return r.value.reduce((a, x) => a + Number(x.account.data.parsed.info.tokenAmount.uiAmountString || 0), 0);
}
function ataOf(owner, mint, program) { return PublicKey.findProgramAddressSync([new PublicKey(owner).toBuffer(), new PublicKey(program).toBuffer(), new PublicKey(mint).toBuffer()], ATA)[0].toBase58(); }
async function ataBalances(owners, mint, program) {
  const out = {}; const addrs = owners.map(o => ataOf(o, mint, program));
  for (let i = 0; i < addrs.length; i += 100) {
    const r = await rpc('getMultipleAccounts', [addrs.slice(i, i + 100), { encoding: 'jsonParsed' }], x => x && Array.isArray(x.value));
    r.value.forEach((v, k) => { const o = owners[i + k]; out[o] = v && v.data && v.data.parsed ? Number(v.data.parsed.info.tokenAmount.uiAmountString || 0) : 0; });
  }
  return out;
}

/* ---------------- market data (Dexscreener) ---------------- */
function bestPair(pairs) { return (pairs || []).filter(p => p.chainId === 'solana').sort((a, b) => ((b.liquidity || {}).usd || 0) - ((a.liquidity || {}).usd || 0))[0] || null; }
const shape = p => p && ({
  mint: p.baseToken.address, symbol: clean(p.baseToken.symbol).slice(0, 16), name: clean(p.baseToken.name).slice(0, 48),
  image: (p.info && p.info.imageUrl) || null, mc: Math.round(p.marketCap || p.fdv || 0), liq: Math.round((p.liquidity || {}).usd || 0),
  vol: Math.round((p.volume || {}).h24 || 0), chg: (p.priceChange || {}).h24 ?? null, price: Number(p.priceUsd || 0),
  created: p.pairCreatedAt || null, dex: p.dexId, url: p.url,
});
async function coin(ca) {
  if (!B58.test(ca)) throw http(400, 'Paste a Solana contract address.');
  return cached('coin:' + ca, 45, async () => {
    const [d, m] = await Promise.all([getJson(DEX + '/tokens/v1/solana/' + ca).catch(() => []), mintInfo(ca)]);
    const p = bestPair(Array.isArray(d) ? d : d.pairs);
    const base = p ? shape(p) : { mint: ca, symbol: '???', name: 'Unlisted token', image: null, mc: 0, liq: 0, vol: 0, chg: null, price: 0, created: null };
    return { ...base, supply: m.supply, decimals: m.decimals, program: m.program };
  });
}
async function coinsBatch(mints) {
  const out = {};
  for (let i = 0; i < mints.length; i += 30) {
    const d = await getJson(DEX + '/tokens/v1/solana/' + mints.slice(i, i + 30).join(',')).catch(() => []);
    const by = {}; (Array.isArray(d) ? d : []).forEach(p => { const k = p.baseToken.address; (by[k] = by[k] || []).push(p); });
    for (const k in by) out[k] = shape(bestPair(by[k]));
  }
  return out;
}
const norm = s => String(s || '').toLowerCase().replace(/^\$/, '').replace(/[^a-z0-9]/g, '');
async function vampsOf(q) {
  q = clean(q).trim().slice(0, 60); if (!q) throw http(400, 'Paste a ticker or a contract address.');
  let seed = null, key = q;
  if (B58.test(q)) { seed = await coin(q); key = seed.symbol; }
  const k = norm(key); if (!k) throw http(400, 'Nothing to search for.');
  return cached('vamps:' + k, 50, async () => {
    const d = await getJson(DEX + '/latest/dex/search?q=' + encodeURIComponent(key));
    const by = new Map();
    for (const p of (d.pairs || [])) {
      if (p.chainId !== 'solana') continue;
      if (norm(p.baseToken.symbol) !== k && norm(p.baseToken.name) !== k) continue;
      const m = p.baseToken.address, prev = by.get(m);
      if (!prev || (p.liquidity || {}).usd > (prev.liquidity || {}).usd || (p.pairCreatedAt && (!prev.pairCreatedAt || p.pairCreatedAt < prev.pairCreatedAt))) by.set(m, p);
    }
    const list = [...by.values()].map(shape).filter(x => x.created).sort((a, b) => a.created - b.created);
    return { key, list };
  }).then(r => {
    const list = r.list.slice(); if (seed && !list.some(x => x.mint === seed.mint) && seed.created) { list.push(seed); list.sort((a, b) => a.created - b.created); }
    const og = list[0] || null;
    const now = Date.now();
    return { q: r.key, at: now, og, vamps: og ? list.slice(1).map(x => ({ ...x, after: Math.max(0, Math.round((x.created - og.created) / 60000)), ago: Math.max(0, Math.round((now - x.created) / 60000)) })) : [], seed: seed ? seed.mint : null };
  });
}

/* ---------------- what gets written ---------------- */
const SLUR = /(n[i1!|]gg|f[a@]gg?[o0]t|k[i1]ke|ch[i1]nk|sp[i1]c|r[e3]t[a@]rd|tr[a@]nn)/i;
function tidy(t, max) { t = clean(t).replace(/\s+/g, ' ').trim().slice(0, max); if (SLUR.test(t.replace(/[\s._*-]/g, ''))) throw http(400, 'That was blocked.'); return t.replace(/https?:\/\/\S+/g, '[link]'); }

/* ---------------- weddings ---------------- */
function tally(w, votes, final) {
  const side = k => {
    const sup = w[k].supply || 0, f = k === 'a' ? 'a' : 'b';
    let yes = 0, no = 0, voters = 0;
    for (const v of votes) {
      const bal = final ? Math.min(Number(v[f + '_bal']) || 0, Number(v[f + '_final'] ?? v[f + '_bal']) || 0) : Number(v[f + '_bal']) || 0;
      if (bal <= 0) continue; voters++;
      if (v.choice === 'do') yes += bal; else no += bal;
    }
    const pct = x => sup ? x / sup * 100 : 0;
    return { yes: pct(yes), no: pct(no), voters, pass: pct(yes) > pct(no) && pct(yes) >= MIN_TURNOUT };
  };
  return { a: side('a'), b: side('b') };
}
const pubW = (w, votes, me) => {
  const t = w.status === 'open' ? tally(w, votes, false) : (w.result || tally(w, votes, true));
  const mine = me ? votes.find(v => v.wallet === me) : null;
  return {
    id: Number(w.id), a: w.a, b: w.b, vow: w.vow, by: short(w.proposer), status: w.status,
    opens: w.opens_at, closes: w.closes_at, closed: w.closed_at, tally: t, voters: votes.length, minTurnout: MIN_TURNOUT,
    mine: mine ? { choice: mine.choice } : null,
  };
};
async function finalize(w) {
  if (w.status !== 'open' || new Date(w.closes_at) > new Date()) return w;
  const lock = await db()`UPDATE td_weddings SET status='closing' WHERE id=${w.id} AND status='open' RETURNING id`;
  if (!lock.length) return (await db()`SELECT * FROM td_weddings WHERE id=${w.id}`)[0];
  try {
    const votes = await db()`SELECT * FROM td_votes WHERE wedding=${w.id}`;
    const owners = votes.map(v => v.wallet);
    if (owners.length) {
      const [fa, fb] = await Promise.all([ataBalances(owners, w.a_mint, w.a.program || SPL), ataBalances(owners, w.b_mint, w.b.program || SPL)]);
      for (const v of votes) { v.a_final = fa[v.wallet] || 0; v.b_final = fb[v.wallet] || 0; await db()`UPDATE td_votes SET a_final=${v.a_final}, b_final=${v.b_final} WHERE wedding=${w.id} AND wallet=${v.wallet}`; }
    }
    const t = tally(w, votes, true), status = t.a.pass && t.b.pass ? 'tied' : 'called_off';
    const r = await db()`UPDATE td_weddings SET status=${status}, closed_at=now(), result=${JSON.stringify(t)} WHERE id=${w.id} RETURNING *`;
    return r[0];
  } catch (e) { await db()`UPDATE td_weddings SET status='open' WHERE id=${w.id} AND status='closing'`; throw e; }
}

/* ---------------- routes ---------------- */
const R = {};
R['GET config'] = async () => ({ windowHours: WINDOW_H, minTurnout: MIN_TURNOUT });

R['GET nonce'] = async ({ q, req }) => {
  const wallet = String(q.wallet || ''); if (!B58.test(wallet)) throw http(400, 'Bad wallet.');
  limit('n:' + wallet, 8, 60e3);
  const nonce = b64u(crypto.randomBytes(12)), host = String(req.headers['x-forwarded-host'] || req.headers.host || 'tied').replace(/[^\w.:-]/g, '').slice(0, 80);
  const text = `${host} wants you to sign in with your Solana account:\n${wallet}\n\nSign in to TIED. This is a free signature, not a transaction. It cannot move anything.\n\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;
  await db()`INSERT INTO td_nonces (nonce, wallet, text) VALUES (${nonce}, ${wallet}, ${text})`;
  db()`DELETE FROM td_nonces WHERE at < now() - interval '1 day'`.catch(() => { });
  return { nonce, message: text };
};
R['POST login'] = async ({ b }) => {
  const wallet = String(b.wallet || ''); if (!B58.test(wallet)) throw http(400, 'Bad wallet.');
  const row = (await db()`SELECT * FROM td_nonces WHERE nonce=${String(b.nonce || '')} AND wallet=${wallet} AND used=false AND at > now() - interval '10 minutes'`)[0];
  if (!row) throw http(401, 'That sign-in expired. Try again.');
  let sig; try { sig = /^[1-9A-HJ-NP-Za-km-z]+$/.test(b.sig || '') ? b58dec(b.sig) : Buffer.from(String(b.sig || ''), 'base64'); } catch (e) { throw http(400, 'Bad signature.'); }
  const msg = b.msg ? Buffer.from(String(b.msg), 'base64') : Buffer.from(row.text, 'utf8');
  if (!msg.toString('utf8').includes(row.text)) throw http(401, 'The signed message does not match.');
  if (!verifySig(wallet, msg, sig)) throw http(401, 'The signature does not match this wallet.');
  if (!(await db()`UPDATE td_nonces SET used=true WHERE nonce=${row.nonce} AND used=false RETURNING nonce`).length) throw http(401, 'That sign-in was already used.');
  return { token: issue(wallet), wallet };
};

R['GET coin'] = async ({ q }) => coin(String(q.ca || '').trim());
R['GET vamps'] = async ({ q }) => vampsOf(q.q);
/* the vamp scan: what's trending on Dexscreener right now, and how many copies each one has. Rescanned every minute. */
R['GET radar'] = async () => cached('radar2', 55, async () => {
  const srcs = await Promise.all(['/token-boosts/top/v1', '/token-boosts/latest/v1', '/token-profiles/latest/v1'].map(u => getJson(DEX + u).catch(() => [])));
  const mints = [...new Set(srcs.flat().filter(x => x && x.chainId === 'solana' && x.tokenAddress).map(x => x.tokenAddress))].slice(0, 14);
  const info = await coinsBatch(mints), seen = new Set(), list = [];
  await Promise.all(mints.map(async m => {
    const c = info[m]; if (!c || seen.has(norm(c.symbol))) return; seen.add(norm(c.symbol));
    try {
      const v = await vampsOf(c.symbol), og = v.og; if (!og) return;
      const fresh = v.vamps.filter(x => x.ago <= 60).length, newest = v.vamps.length ? Math.min(...v.vamps.map(x => x.ago)) : null;
      const big = v.vamps.slice().sort((x, y) => (y.mc || 0) - (x.mc || 0))[0];
      list.push({ symbol: c.symbol, name: c.name, image: c.image || (og.mint === m ? og.image : null), mint: m, mc: c.mc, vamps: v.vamps.length, fresh, newest, og: og.mint, ogMc: og.mc, isOg: og.mint === m, top: big ? big.mint : null, topMc: big ? big.mc : 0, times: v.vamps.slice(0, 40).map(x => [x.after, x.ago, x.mc || 0]) });
    } catch (e) { }
  }));
  list.sort((a, b) => (b.fresh - a.fresh) || (b.vamps - a.vamps));
  return { at: Date.now(), list };
});

R['POST propose'] = async ({ b, me }) => {
  if (!me) throw http(401, 'Connect a wallet first.');
  const a = String(b.a || '').trim(), c = String(b.b || '').trim();
  if (!B58.test(a) || !B58.test(c)) throw http(400, 'Paste two contract addresses.');
  if (a === c) throw http(400, 'A coin cannot marry itself.');
  limit('p:' + me, 3, 3600e3, 'Three proposals an hour. Let the others speak.');
  const [A, B] = await Promise.all([coin(a), coin(c)]);
  const [ba, bb] = await Promise.all([balanceOf(me, a), balanceOf(me, c)]);
  if (ba <= 0 && bb <= 0) throw http(403, `Hold $${A.symbol} or $${B.symbol} to propose.`);
  const [x, y] = [a, c].sort();
  const open = await db()`SELECT id FROM td_weddings WHERE status IN ('open','closing') AND ((a_mint=${x} AND b_mint=${y}) OR (a_mint=${y} AND b_mint=${x}))`;
  if (open.length) throw http(409, 'These two are already at the altar.', { id: Number(open[0].id) });
  const vow = b.vow ? tidy(b.vow, 140) : '';
  // the bigger coin is A: the one the other moves into
  const [big, small] = (A.mc || 0) >= (B.mc || 0) ? [A, B] : [B, A];
  const r = await db()`INSERT INTO td_weddings (a_mint, b_mint, a, b, proposer, vow, closes_at) VALUES (${big.mint}, ${small.mint}, ${JSON.stringify(big)}, ${JSON.stringify(small)}, ${me}, ${vow}, now() + make_interval(hours => ${WINDOW_H}::int)) RETURNING id`;
  return { ok: true, id: Number(r[0].id) };
};
R['GET weddings'] = async ({ q, me }) => {
  const st = ['open', 'tied', 'called_off'].includes(q.status) ? q.status : 'open';
  const due = await db()`SELECT * FROM td_weddings WHERE status='open' AND closes_at <= now() ORDER BY closes_at ASC LIMIT 3`;
  for (const w of due) { try { await finalize(w); } catch (e) { console.error('finalize', w.id, e.message); } }
  const rows = st === 'open' ? await db()`SELECT * FROM td_weddings WHERE status IN ('open','closing') ORDER BY closes_at ASC LIMIT 60` : await db()`SELECT * FROM td_weddings WHERE status=${st} ORDER BY closed_at DESC LIMIT 60`;
  const ids = rows.map(w => w.id), votes = ids.length ? await db()`SELECT * FROM td_votes WHERE wedding = ANY(${ids})` : [];
  return { weddings: rows.map(w => pubW(w, votes.filter(v => String(v.wedding) === String(w.id)), me)) };
};
R['GET wedding'] = async ({ q, me }) => {
  const id = parseInt(q.id, 10); let w = (await db()`SELECT * FROM td_weddings WHERE id=${id}`)[0]; if (!w) throw http(404, 'No such wedding.');
  w = await finalize(w);
  const votes = await db()`SELECT * FROM td_votes WHERE wedding=${id} ORDER BY at DESC`;
  return { wedding: pubW(w, votes, me), votes: votes.slice(0, 80).map(v => ({ wallet: short(v.wallet), choice: v.choice, a: w.a.supply ? Number(v.a_bal) / w.a.supply * 100 : 0, b: w.b.supply ? Number(v.b_bal) / w.b.supply * 100 : 0, at: v.at })) };
};
R['POST vote'] = async ({ b, me }) => {
  if (!me) throw http(401, 'Connect a wallet first.');
  const id = parseInt(b.id, 10), choice = b.choice === 'object' ? 'object' : 'do';
  limit('v:' + me, 20, 60e3);
  const w = (await db()`SELECT * FROM td_weddings WHERE id=${id}`)[0]; if (!w) throw http(404, 'No such wedding.');
  if (w.status !== 'open' || new Date(w.closes_at) <= new Date()) throw http(409, 'The ceremony is over.');
  const [ba, bb] = await Promise.all([balanceOf(me, w.a_mint), balanceOf(me, w.b_mint)]);
  if (ba <= 0 && bb <= 0) throw http(403, `Only holders can speak. Hold $${w.a.symbol} or $${w.b.symbol}.`);
  await db()`INSERT INTO td_votes (wedding, wallet, choice, a_bal, b_bal) VALUES (${id}, ${me}, ${choice}, ${ba}, ${bb}) ON CONFLICT (wedding, wallet) DO UPDATE SET choice=EXCLUDED.choice, a_bal=EXCLUDED.a_bal, b_bal=EXCLUDED.b_bal, at=now()`;
  return { ok: true, choice, a: w.a.supply ? ba / w.a.supply * 100 : 0, b: w.b.supply ? bb / w.b.supply * 100 : 0 };
};

/* ---------------- launch: metadata hosted here, the coin is created by PumpPortal in a tx the user signs ---------------- */
R['POST meta'] = async ({ b, me, req }) => {
  if (!me) throw http(401, 'Connect a wallet first.');
  limit('m:' + me, 6, 3600e3);
  const m = /^data:(image\/(png|jpe?g|gif|webp));base64,(.+)$/.exec(b.image || ''); if (!m) throw http(400, 'Add an image (png, jpg, gif or webp).');
  if (m[3].length > 1.4e6) throw http(400, 'Image too large. Keep it under 1 MB.');
  const name = tidy(b.name, 32), symbol = tidy(b.symbol, 10).replace(/[^\w$]/g, '').toUpperCase();
  if (!name || !symbol) throw http(400, 'Name and ticker are required.');
  const url = s => { s = clean(s).trim().slice(0, 200); return /^https:\/\/[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(s) ? s : ''; };
  const id = crypto.randomBytes(9).toString('base64url');
  await db()`INSERT INTO td_meta (id, wallet, name, symbol, description, twitter, website, mime, image) VALUES (${id}, ${me}, ${name}, ${symbol}, ${tidy(b.description || '', 600)}, ${url(b.twitter)}, ${url(b.website)}, ${m[1]}, ${m[3]})`;
  const host = 'https://' + String(req.headers['x-forwarded-host'] || req.headers.host).replace(/[^\w.:-]/g, '');
  return { id, uri: `${host}/api/m?id=${id}`, image: `${host}/api/i?id=${id}`, name, symbol };
};
R['GET m'] = async ({ q, req }) => {
  const r = (await db()`SELECT id, name, symbol, description, twitter, website FROM td_meta WHERE id=${String(q.id || '')}`)[0]; if (!r) throw http(404, 'Not found.');
  const host = 'https://' + String(req.headers['x-forwarded-host'] || req.headers.host).replace(/[^\w.:-]/g, '');
  return { name: r.name, symbol: r.symbol, description: r.description, image: `${host}/api/i?id=${r.id}`, showName: true, createdOn: host, twitter: r.twitter || undefined, website: r.website || undefined };
};
R['POST launchtx'] = async ({ b, me }) => {
  if (!me) throw http(401, 'Connect a wallet first.');
  limit('l:' + me, 6, 3600e3);
  const meta = (await db()`SELECT id, name, symbol FROM td_meta WHERE id=${String(b.meta || '')} AND wallet=${me}`)[0]; if (!meta) throw http(400, 'Upload the coin details first.');
  if (!B58.test(String(b.mint || ''))) throw http(400, 'Bad mint.');
  const amount = Math.max(0, Math.min(20, Number(b.amount) || 0));
  const body = { publicKey: me, action: 'create', tokenMetadata: { name: meta.name, symbol: meta.symbol, uri: String(b.uri || '').slice(0, 200) }, mint: b.mint, denominatedInSol: 'true', amount, slippage: 10, priorityFee: 0.0005, pool: 'pump' };
  const r = await timed(15000)(PP + '/api/trade-local', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const buf = Buffer.from(await r.arrayBuffer());
  if (r.status !== 200 || buf.length < 100) throw http(400, buf.toString('utf8').slice(0, 160) || 'Could not build the launch transaction.');
  return { tx: buf.toString('base64') };
};
R['POST launched'] = async ({ b, me }) => {
  if (!me) throw http(401, 'Connect a wallet first.');
  const mint = String(b.mint || ''), meta = (await db()`SELECT id, name, symbol FROM td_meta WHERE id=${String(b.meta || '')} AND wallet=${me}`)[0];
  if (!meta || !B58.test(mint)) throw http(400, 'Unknown launch.');
  await mintInfo(mint).catch(() => { throw http(409, 'The coin is not on chain yet. Give it a few seconds.'); });
  await db()`INSERT INTO td_launches (mint, wallet, name, symbol, meta, sig) VALUES (${mint}, ${me}, ${meta.name}, ${meta.symbol}, ${meta.id}, ${String(b.sig || '').slice(0, 100)}) ON CONFLICT (mint) DO NOTHING`;
  return { ok: true };
};
R['GET singles'] = async () => {
  const rows = await db()`SELECT mint, name, symbol, meta, at FROM td_launches ORDER BY at DESC LIMIT 60`;
  const live = rows.length ? await cached('singles:' + rows.length + ':' + rows[0].mint, 60, () => coinsBatch(rows.map(r => r.mint))) : {};
  return { coins: rows.map(r => ({ mint: r.mint, name: r.name, symbol: r.symbol, image: `/api/i?id=${r.meta}`, at: r.at, mc: live[r.mint] ? live[r.mint].mc : null, vol: live[r.mint] ? live[r.mint].vol : null })) };
};

/* ---------------- swaps (Jupiter) and a narrow RPC relay for the page ---------------- */
R['GET quote'] = async ({ q }) => {
  const p = new URLSearchParams({ inputMint: String(q.in || ''), outputMint: String(q.out || ''), amount: String(q.amount || ''), slippageBps: String(Math.min(2000, Math.max(50, parseInt(q.slippage, 10) || 300))), restrictIntermediateTokens: 'true' });
  if (!B58.test(p.get('inputMint')) || !B58.test(p.get('outputMint')) || !/^\d+$/.test(p.get('amount'))) throw http(400, 'Bad swap.');
  const r = await timed(10000)(JUP + '/swap/v1/quote?' + p); const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw http(400, j.error || 'No route for this swap right now.'); return j;
};
R['POST swap'] = async ({ b }) => {
  if (!b.quoteResponse || !B58.test(String(b.userPublicKey || ''))) throw http(400, 'Bad swap.');
  const r = await timed(12000)(JUP + '/swap/v1/swap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quoteResponse: b.quoteResponse, userPublicKey: b.userPublicKey, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 400000, priorityLevel: 'high' } } }) });
  const j = await r.json().catch(() => ({})); if (!r.ok || !j.swapTransaction) throw http(400, j.error || 'Could not build the swap.'); return { swapTransaction: j.swapTransaction };
};
R['POST rpc'] = async ({ b }) => {
  const ok = ['getSignatureStatuses', 'sendTransaction', 'getBalance', 'getLatestBlockhash', 'getMultipleAccounts', 'getTokenAccountsByOwner'];
  if (!ok.includes(b.method)) throw http(400, 'Not allowed.');
  return { result: await rpc(b.method, Array.isArray(b.params) ? b.params : []) };
};

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = String((req.query && req.query.__p) || url.searchParams.get('__p') || url.pathname.replace(/^\/api\/?/, '')).replace(/^\/+|\/+$/g, '');
  const q = Object.fromEntries(url.searchParams);
  if (req.method === 'GET' && path === 'i') {
    try { await ensure(); const r = (await db()`SELECT mime, image FROM td_meta WHERE id=${String(q.id || '')}`)[0]; if (!r) { res.statusCode = 404; return res.end('not found'); } res.statusCode = 200; res.setHeader('Content-Type', r.mime); res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); return res.end(Buffer.from(r.image, 'base64')); }
    catch (e) { res.statusCode = 500; return res.end('error'); }
  }
  const key = `${req.method} ${path}`, fn = R[key];
  if (!fn) return send(res, 404, { ok: false, error: 'No such endpoint.' });
  try {
    if (!['GET config', 'GET quote', 'POST swap', 'POST rpc'].includes(key)) await ensure();
    const b = req.method === 'POST' ? await readBody(req) : {};
    const out = await fn({ q, b, req, me: who(req) });
    send(res, 200, out, path === 'm' ? { 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' } : null);
  } catch (e) {
    const code = e.code && e.code >= 400 && e.code < 600 ? e.code : 500;
    if (code === 500) console.error(key, e);
    send(res, code, Object.assign({ ok: false, error: code === 500 ? 'Something broke on our side. Try again.' : e.message }, e.extra || {}));
  }
};
module.exports._t = { tally, norm, ataOf };
