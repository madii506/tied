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
    // every pump.fun launch read from Solana, and every move-in verified on chain
    await s`CREATE TABLE IF NOT EXISTS td_creates (mint TEXT PRIMARY KEY, sig TEXT, name TEXT, symbol TEXT, ns TEXT, nn TEXT, creator TEXT, uri TEXT, img TEXT, t TIMESTAMPTZ)`;
    await s`CREATE INDEX IF NOT EXISTS td_creates_ns ON td_creates (ns, t)`;
    await s`CREATE INDEX IF NOT EXISTS td_creates_t ON td_creates (t)`;
    await s`CREATE TABLE IF NOT EXISTS td_moves (sig TEXT PRIMARY KEY, wedding BIGINT, wallet TEXT, from_mint TEXT, to_mint TEXT, from_amt NUMERIC, to_amt NUMERIC, at TIMESTAMPTZ DEFAULT now())`;
    await s`CREATE INDEX IF NOT EXISTS td_moves_pair ON td_moves (from_mint, to_mint)`;
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
  await ingest().catch(e => console.error('ingest', e.message));
  return cached('vamps:' + k, 50, async () => {
    const d = await getJson(DEX + '/latest/dex/search?q=' + encodeURIComponent(key));
    const by = new Map();
    for (const p of (d.pairs || [])) {
      if (p.chainId !== 'solana') continue;
      if (norm(p.baseToken.symbol) !== k && norm(p.baseToken.name) !== k) continue;
      const m = p.baseToken.address, prev = by.get(m);
      if (!prev || (p.liquidity || {}).usd > (prev.liquidity || {}).usd || (p.pairCreatedAt && (!prev.pairCreatedAt || p.pairCreatedAt < prev.pairCreatedAt))) by.set(m, p);
    }
    const list = [...by.values()].map(shape).filter(x => x.created);
    // Dexscreener search stops at 30 pairs, so add every launch with this ticker that we read from the chain ourselves
    const have = new Set(list.map(x => x.mint));
    const chain = (await db()`SELECT mint, name, symbol, img, t FROM td_creates WHERE ns=${k} OR nn=${k} ORDER BY t ASC LIMIT 400`).filter(c => !have.has(c.mint));
    if (chain.length) {
      const info = await jupInfo(chain.map(c => c.mint));
      for (const c of chain) { const j = info[c.mint] || {}; list.push({ mint: c.mint, symbol: clean(c.symbol).slice(0, 16), name: clean(c.name).slice(0, 48), image: j.icon || c.img || null, mc: Math.round(j.mcap || 0), liq: Math.round(j.liquidity || 0), vol: Math.round(j.vol || 0), chg: null, price: Number(j.usdPrice || 0), created: new Date(c.t).getTime(), dex: 'pumpfun', url: 'https://pump.fun/coin/' + c.mint, chain: true }); }
    }
    list.sort((a, b) => a.created - b.created);
    return { key, list };
  }).then(async r => {
    const list = r.list.slice(); if (seed && !list.some(x => x.mint === seed.mint) && seed.created) { list.push(seed); list.sort((a, b) => a.created - b.created); }
    const og = list[0] || null;
    const now = Date.now();
    const vamps = og ? list.slice(1).map(x => ({ ...x, after: Math.max(0, Math.round((x.created - og.created) / 60000)), ago: Math.max(0, Math.round((now - x.created) / 60000)) })) : [];
    // which of these already stood at the altar, and how much has moved in for real
    const ws = og && vamps.length ? await db()`SELECT id, b_mint, status FROM td_weddings WHERE a_mint=${og.mint} AND b_mint = ANY(${vamps.map(v => v.mint)}) ORDER BY id DESC` : [];
    const mv = og && vamps.length ? await db()`SELECT from_mint, count(DISTINCT wallet)::int AS wallets, sum(from_amt) AS amt FROM td_moves WHERE to_mint=${og.mint} AND from_mint = ANY(${vamps.map(v => v.mint)}) GROUP BY from_mint` : [];
    for (const v of vamps) {
      const w = ws.find(x => x.b_mint === v.mint); if (w) v.wed = { id: Number(w.id), status: w.status };
      const m = mv.find(x => x.from_mint === v.mint); if (m) v.moved = { wallets: m.wallets, amt: Number(m.amt) };
    }
    return { q: r.key, at: now, og, vamps, seed: seed ? seed.mint : null, chain: list.filter(x => x.chain).length };
  });
}

/* ---------------- the chain: every pump.fun launch, read straight from Solana ----------------
 * Every create touches the pump.fun mint authority; the CreateEvent in the logs carries name, symbol, uri, mint and creator.
 * This is the same ground truth Axiom's New Pairs column shows. Read at most every 25 seconds, kept 4 days. */
const MINT_AUTH = 'TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM';
const CREATE_DISC = Buffer.from([27, 114, 169, 77, 222, 235, 99, 118]);
function b58enc(buf) {
  const digits = [];
  for (const byte of buf) { let carry = byte; for (let j = 0; j < digits.length; j++) { carry += digits[j] << 8; digits[j] = carry % 58; carry = (carry / 58) | 0; } while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; } }
  let s = ''; for (const byte of buf) { if (byte) break; s += '1'; }
  for (let i = digits.length - 1; i >= 0; i--) s += ALPH[digits[i]];
  return s;
}
async function rpcBatch(calls) {
  for (const u of RPCS) {
    try {
      const r = await timed(12000)(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(calls.map((c, i) => ({ jsonrpc: '2.0', id: i, method: c[0], params: c[1] }))) });
      const j = await r.json(); if (!Array.isArray(j)) throw new Error('no batch');
      return j.sort((a, b) => a.id - b.id).map(x => x.result || null);
    } catch (e) { }
  }
  return calls.map(() => null);
}
function parseCreate(tx) {
  if (!tx || !tx.meta || tx.meta.err) return null;
  for (const line of (tx.meta.logMessages || [])) {
    if (!line.startsWith('Program data: ')) continue;
    let buf; try { buf = Buffer.from(line.slice(14), 'base64'); } catch (e) { continue; }
    if (buf.length < 8 + 12 + 96 || !buf.subarray(0, 8).equals(CREATE_DISC)) continue;
    let o = 8; const str = () => { const n = buf.readUInt32LE(o); o += 4; if (n > 400) throw new Error('long'); const s = buf.subarray(o, o + n).toString('utf8'); o += n; return s; };
    try {
      const name = str(), symbol = str(), uri = str();
      const mint = b58enc(buf.subarray(o, o + 32)); o += 32; o += 32; const user = b58enc(buf.subarray(o, o + 32)); o += 32;
      let creator = user; if (buf.length >= o + 32) { creator = b58enc(buf.subarray(o, o + 32)); o += 32; }
      let t = null; if (buf.length >= o + 8) t = Number(buf.readBigInt64LE(o)) * 1000;
      if (!t || t < 1.6e12 || t > Date.now() + 120e3) t = tx.blockTime ? tx.blockTime * 1000 : null;
      return { mint, name: clean(name).slice(0, 64), symbol: clean(symbol).slice(0, 24), uri: clean(uri).slice(0, 220), creator, t, sig: tx.transaction && tx.transaction.signatures && tx.transaction.signatures[0] };
    } catch (e) { return null; }
  }
  return null;
}
let ingesting = null;
async function ingest(force) {
  if (ingesting) return ingesting;
  ingesting = (async () => {
    // claim the slot so parallel requests don't all hit the RPC
    const claim = await db()`INSERT INTO td_cache (k, v, at) VALUES ('ingest', '{}'::jsonb, now()) ON CONFLICT (k) DO UPDATE SET at=now() WHERE td_cache.at < now() - make_interval(secs => ${force ? 8 : 25}) RETURNING v`;
    if (!claim.length) return 0;
    const st = claim[0].v || {}, opt = { limit: 120, commitment: 'confirmed' }; if (st.last) opt.until = st.last;
    const sigs = (await rpc('getSignaturesForAddress', [MINT_AUTH, opt], x => Array.isArray(x))).filter(s => !s.err);
    if (!sigs.length) return 0;
    const out = [];
    for (let i = 0; i < sigs.length; i += 30) {
      const chunk = sigs.slice(i, i + 30);
      const txs = await rpcBatch(chunk.map(s => ['getTransaction', [s.signature, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]]));
      txs.forEach((tx, k) => { const c = parseCreate(tx); if (c) { if (!c.t && chunk[k].blockTime) c.t = chunk[k].blockTime * 1000; if (c.t) out.push(c); } });
    }
    for (let i = 0; i < out.length; i += 50) {
      const part = out.slice(i, i + 50);
      await db()`INSERT INTO td_creates (mint, sig, name, symbol, ns, nn, creator, uri, t)
        SELECT * FROM unnest(${part.map(c => c.mint)}::text[], ${part.map(c => c.sig || '')}::text[], ${part.map(c => c.name)}::text[], ${part.map(c => c.symbol)}::text[], ${part.map(c => norm(c.symbol))}::text[], ${part.map(c => norm(c.name))}::text[], ${part.map(c => c.creator)}::text[], ${part.map(c => c.uri)}::text[], ${part.map(c => new Date(c.t).toISOString())}::timestamptz[])
        ON CONFLICT (mint) DO NOTHING`;
    }
    const gap = !!st.last && sigs.length >= 120;   // more launches happened since the last read than one read covers
    await db()`UPDATE td_cache SET v=${JSON.stringify({ last: sigs[0].signature, read: (st.read || 0) + out.length, gaps: (st.gaps || 0) + (gap ? 1 : 0), since: st.since || Date.now() })} WHERE k='ingest'`;
    if (Math.random() < .03) db()`DELETE FROM td_creates WHERE t < now() - interval '4 days'`.catch(() => { });
    return out.length;
  })();
  try { return await ingesting; } finally { ingesting = null; }
}
// Jupiter knows icons and market caps of new pump.fun coins within seconds (100 mints per call)
const jupMem = new Map();
async function jupInfo(mints) {
  const out = {}, need = [];
  for (const m of new Set(mints)) { const h = jupMem.get(m); if (h && Date.now() - h.at < 60e3) out[m] = h.v; else need.push(m); }
  for (let i = 0; i < need.length; i += 100) {
    try {
      const j = await getJson(JUP + '/tokens/v2/search?query=' + need.slice(i, i + 100).join(','), {}, 8000);
      for (const t of (Array.isArray(j) ? j : [])) { const v = { icon: t.icon || null, mcap: t.mcap || t.fdv || 0, liquidity: t.liquidity || 0, usdPrice: t.usdPrice || 0, vol: t.stats24h ? (t.stats24h.buyVolume || 0) + (t.stats24h.sellVolume || 0) : 0, holders: t.holderCount || 0 }; jupMem.set(t.id, { at: Date.now(), v }); out[t.id] = v; }
    } catch (e) { }
  }
  if (jupMem.size > 4000) jupMem.clear();
  return out;
}
// coins Jupiter hasn't indexed yet: the image from their own metadata (capped, stored once)
async function imgFill(rows, cap = 10) {
  const need = rows.filter(r => !r.image && !r.img && /^https?:\/\//.test(r.uri || '')).slice(0, cap);
  await Promise.all(need.map(async r => {
    try { const j = await getJson(r.uri.replace('https://ipfs.io/ipfs/', 'https://pump.mypinata.cloud/ipfs/'), {}, 3500); const im = typeof j.image === 'string' && /^https?:\/\//.test(j.image) ? j.image.slice(0, 300) : ''; r.img = im || '-'; await db()`UPDATE td_creates SET img=${r.img} WHERE mint=${r.mint}`; }
    catch (e) { r.img = '-'; await db()`UPDATE td_creates SET img='-' WHERE mint=${r.mint}`.catch(() => { }); }
  }));
}
async function live() {
  await ingest().catch(e => console.error('ingest', e.message));
  return cached('live', 15, async () => {
    const s = db();
    const radar = ((await s`SELECT v FROM td_cache WHERE k='radar2'`)[0] || {}).v || { list: [] };
    const trend = {}; for (const x of radar.list || []) trend[norm(x.symbol)] = { mint: x.og, symbol: x.symbol, mc: x.ogMc || 0 };
    const tks = Object.keys(trend);
    // the newest launches that copy a ticker already on chain (or a coin trending right now)
    const feed = await s`SELECT c.mint, c.name, c.symbol, c.ns, c.creator, c.uri, c.img, c.t,
        (SELECT count(*)::int FROM td_creates x WHERE x.ns=c.ns AND x.t < c.t) AS prior,
        (SELECT json_build_object('mint', f.mint, 'symbol', f.symbol, 't', f.t) FROM td_creates f WHERE f.ns=c.ns ORDER BY f.t ASC LIMIT 1) AS first
      FROM td_creates c WHERE c.ns <> '' AND c.t > now() - interval '6 hours'
        AND (EXISTS (SELECT 1 FROM td_creates x WHERE x.ns=c.ns AND x.t < c.t) OR c.ns = ANY(${tks}))
      ORDER BY c.t DESC LIMIT 36`;
    const hot = await s`SELECT ns, max(symbol) AS symbol, count(*) FILTER (WHERE t > now() - interval '1 hour')::int AS h1, count(*)::int AS n, min(t) AS first, max(t) AS newest,
        (array_agg(mint ORDER BY t ASC))[1] AS first_mint, (array_agg(mint ORDER BY t DESC))[1] AS new_mint
      FROM td_creates WHERE ns <> '' AND t > now() - interval '24 hours' GROUP BY ns
      HAVING count(*) FILTER (WHERE t > now() - interval '1 hour') >= 2 ORDER BY h1 DESC, newest DESC LIMIT 12`;
    const stat = (await s`SELECT count(*) FILTER (WHERE t > now() - interval '1 hour')::int AS h1, count(*) FILTER (WHERE t > now() - interval '10 minutes')::int AS m10, count(*)::int AS n, min(t) AS since, max(t) AS newest FROM td_creates`)[0];
    const st = ((await s`SELECT v, at FROM td_cache WHERE k='ingest'`)[0] || {});
    const info = await jupInfo([...feed.map(r => r.mint), ...hot.map(h => h.new_mint), ...hot.map(h => h.first_mint)]);
    for (const r of feed) { const j = info[r.mint]; r.image = j && j.icon || (r.img && r.img !== '-' ? r.img : null); r.mc = j ? Math.round(j.mcap || 0) : null; r.holders = j ? j.holders : null; }
    await imgFill(feed).catch(() => { });
    for (const r of feed) if (!r.image && r.img && r.img !== '-') r.image = r.img;
    const vh = feed.filter(r => Date.now() - new Date(r.t) < 3600e3).length;
    return {
      at: Date.now(), read: st.at || null, stats: { ...stat, gaps: (st.v || {}).gaps || 0, vampsShown: vh },
      feed: feed.map(r => {
        const tr = trend[r.ns], first = r.first && r.first.mint !== r.mint ? r.first : null;
        const og = tr && tr.mint !== r.mint ? { mint: tr.mint, symbol: tr.symbol, mc: tr.mc, trending: true } : first ? { mint: first.mint, symbol: first.symbol, t: first.t } : null;
        return { mint: r.mint, name: r.name, symbol: r.symbol, creator: r.creator, t: r.t, image: r.image, mc: r.mc, holders: r.holders, copy: r.prior + 1, og };
      }).filter(r => r.og),
      hot: hot.map(h => { const j = info[h.new_mint] || {}; return { symbol: h.symbol, h1: h.h1, n: h.n, first: h.first, newest: h.newest, firstMint: h.first_mint, newMint: h.new_mint, image: j.icon || null, trending: !!trend[h.ns] }; }),
    };
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
const pubW = (w, votes, me, mv) => {
  const t = w.status === 'open' ? tally(w, votes, false) : (w.result || tally(w, votes, true));
  const mine = me ? votes.find(v => v.wallet === me) : null;
  const amt = mv ? Number(mv.amt) || 0 : 0;
  return {
    id: Number(w.id), a: w.a, b: w.b, vow: w.vow, by: short(w.proposer), status: w.status,
    opens: w.opens_at, closes: w.closes_at, closed: w.closed_at, tally: t, voters: votes.length, minTurnout: MIN_TURNOUT,
    mine: mine ? { choice: mine.choice } : null,
    moved: { wallets: mv ? mv.wallets : 0, n: mv ? mv.n : 0, amt, got: mv ? Number(mv.got) || 0 : 0, pct: w.b.supply ? amt / w.b.supply * 100 : 0 },
  };
};
// move-ins: real swaps from the smaller coin into the bigger one, each verified on chain before it is counted
async function movedBy(pairs) {
  if (!pairs.length) return {};
  const rows = await db()`SELECT from_mint, to_mint, count(DISTINCT wallet)::int AS wallets, count(*)::int AS n, sum(from_amt) AS amt, sum(to_amt) AS got FROM td_moves WHERE from_mint = ANY(${pairs.map(p => p[0])}) GROUP BY from_mint, to_mint`;
  const out = {}; for (const r of rows) out[r.from_mint + '>' + r.to_mint] = r; return out;
}
async function verifyMove(sig, from, to) {
  const tx = await rpc('getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
  if (!tx) throw http(409, 'The swap is not on chain yet. Give it a few seconds.');
  if (!tx.meta || tx.meta.err) throw http(400, 'That transaction failed on chain.');
  const keys = ((tx.transaction || {}).message || {}).accountKeys || [], payer = keys[0] && (keys[0].pubkey || keys[0]);
  if (!payer || !B58.test(String(payer))) throw http(400, 'Could not read the signer.');
  const sum = (arr, mint) => (arr || []).filter(b => b.mint === mint && b.owner === payer).reduce((a, b) => a + Number((b.uiTokenAmount || {}).uiAmountString || 0), 0);
  const gave = sum(tx.meta.preTokenBalances, from) - sum(tx.meta.postTokenBalances, from);
  const got = sum(tx.meta.postTokenBalances, to) - sum(tx.meta.preTokenBalances, to);
  if (!(gave > 0) || !(got > 0)) throw http(400, 'That transaction is not a swap from the first coin into the second.');
  return { wallet: String(payer), gave, got, at: tx.blockTime ? new Date(tx.blockTime * 1000) : new Date() };
}
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
  if (a === c) throw http(400, 'Pick two different coins.');
  limit('p:' + me, 3, 3600e3, 'Three ties an hour. Slow down a little.');
  const [A, B] = await Promise.all([coin(a), coin(c)]);
  const [ba, bb] = await Promise.all([balanceOf(me, a), balanceOf(me, c)]);
  if (ba <= 0 && bb <= 0) throw http(403, `Hold $${A.symbol} or $${B.symbol} to start a tie.`);
  const [x, y] = [a, c].sort();
  const open = await db()`SELECT id FROM td_weddings WHERE status IN ('open','closing') AND ((a_mint=${x} AND b_mint=${y}) OR (a_mint=${y} AND b_mint=${x}))`;
  if (open.length) throw http(409, 'These two already have an open vote.', { id: Number(open[0].id) });
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
  const mv = await movedBy(rows.map(w => [w.b_mint, w.a_mint]));
  return { weddings: rows.map(w => pubW(w, votes.filter(v => String(v.wedding) === String(w.id)), me, mv[w.b_mint + '>' + w.a_mint])) };
};
R['GET wedding'] = async ({ q, me }) => {
  const id = parseInt(q.id, 10); let w = (await db()`SELECT * FROM td_weddings WHERE id=${id}`)[0]; if (!w) throw http(404, 'No such tie.');
  w = await finalize(w);
  const votes = await db()`SELECT * FROM td_votes WHERE wedding=${id} ORDER BY at DESC`;
  const mv = await movedBy([[w.b_mint, w.a_mint]]);
  const moves = await db()`SELECT sig, wallet, from_amt, to_amt, at FROM td_moves WHERE from_mint=${w.b_mint} AND to_mint=${w.a_mint} ORDER BY at DESC LIMIT 40`;
  return { wedding: pubW(w, votes, me, mv[w.b_mint + '>' + w.a_mint]), votes: votes.slice(0, 80).map(v => ({ wallet: short(v.wallet), choice: v.choice, a: w.a.supply ? Number(v.a_bal) / w.a.supply * 100 : 0, b: w.b.supply ? Number(v.b_bal) / w.b.supply * 100 : 0, at: v.at })), moves: moves.map(m => ({ sig: m.sig, wallet: short(m.wallet), gave: Number(m.from_amt), got: Number(m.to_amt), at: m.at })) };
};
/* a move-in counts only after its transaction is read back from Solana: it succeeded, and the signer's balance of the
 * smaller coin went down while their balance of the bigger coin went up */
R['POST moved'] = async ({ b, req }) => {
  const sig = String(b.sig || ''), from = String(b.from || ''), to = String(b.to || '');
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(sig) || !B58.test(from) || !B58.test(to) || from === to) throw http(400, 'Bad move.');
  limit('mv:' + (req.headers['x-forwarded-for'] || 'x'), 30, 60e3);
  const have = (await db()`SELECT wallet, from_amt, to_amt FROM td_moves WHERE sig=${sig}`)[0];
  if (have) return { ok: true, already: true, gave: Number(have.from_amt), got: Number(have.to_amt) };
  const v = await verifyMove(sig, from, to);
  const w = (await db()`SELECT id FROM td_weddings WHERE b_mint=${from} AND a_mint=${to} ORDER BY id DESC LIMIT 1`)[0];
  await db()`INSERT INTO td_moves (sig, wedding, wallet, from_mint, to_mint, from_amt, to_amt, at) VALUES (${sig}, ${w ? w.id : null}, ${v.wallet}, ${from}, ${to}, ${v.gave}, ${v.got}, ${v.at.toISOString()}) ON CONFLICT (sig) DO NOTHING`;
  return { ok: true, gave: v.gave, got: v.got, wedding: w ? Number(w.id) : null };
};
R['GET moves'] = async ({ q }) => {
  const from = String(q.from || ''), to = String(q.to || ''); if (!B58.test(from) || !B58.test(to)) throw http(400, 'Bad pair.');
  const r = (await db()`SELECT count(DISTINCT wallet)::int AS wallets, count(*)::int AS n, coalesce(sum(from_amt), 0) AS amt, coalesce(sum(to_amt), 0) AS got FROM td_moves WHERE from_mint=${from} AND to_mint=${to}`)[0];
  const list = await db()`SELECT sig, wallet, from_amt, to_amt, at FROM td_moves WHERE from_mint=${from} AND to_mint=${to} ORDER BY at DESC LIMIT 20`;
  return { wallets: r.wallets, n: r.n, amt: Number(r.amt), got: Number(r.got), list: list.map(m => ({ sig: m.sig, wallet: short(m.wallet), gave: Number(m.from_amt), got: Number(m.to_amt), at: m.at })) };
};
R['GET live'] = async () => live();
R['POST vote'] = async ({ b, me }) => {
  if (!me) throw http(401, 'Connect a wallet first.');
  const id = parseInt(b.id, 10), choice = b.choice === 'object' ? 'object' : 'do';
  limit('v:' + me, 20, 60e3);
  const w = (await db()`SELECT * FROM td_weddings WHERE id=${id}`)[0]; if (!w) throw http(404, 'No such tie.');
  if (w.status !== 'open' || new Date(w.closes_at) <= new Date()) throw http(409, 'Voting is over.');
  const [ba, bb] = await Promise.all([balanceOf(me, w.a_mint), balanceOf(me, w.b_mint)]);
  if (ba <= 0 && bb <= 0) throw http(403, `Only holders can vote. Hold $${w.a.symbol} or $${w.b.symbol}.`);
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
