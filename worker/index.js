// Granite Coast Supply. One server in front of everything.
// Public: the catalog page, the published pieces, and the photos.
// Private: everything under /desk and /api/desk. A request gets through only when Cloudflare Access has logged the
// visitor in AND the email is on the allow list. With no Access settings the desk is locked, so a mistake fails closed.
import { TYPES, isPublic, publicProduct } from '../public/desk/lib/model.js';
import { market, connectBack } from './market.js';

const b64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0));
let KEYS = null, KEYS_AT = 0;
async function keysFor(team) {
  if (KEYS && Date.now() - KEYS_AT < 3600e3) return KEYS;
  const r = await fetch(`https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`); if (!r.ok) throw new Error('certs ' + r.status);
  KEYS = (await r.json()).keys || []; KEYS_AT = Date.now(); return KEYS;
}
const isLocal = (url) => ['localhost', '127.0.0.1'].includes(url.hostname);
async function whoIs(request, env, url) {
  // local testing only: wrangler dev passes DEV_USER. It is ignored on any real address.
  if (env.DEV_USER && isLocal(url)) return { ok: true, email: env.DEV_USER };
  if (!env.ACCESS_TEAM || !env.ACCESS_AUD) return { ok: false, why: 'not configured' };
  const tok = request.headers.get('cf-access-jwt-assertion'); if (!tok) return { ok: false, why: 'no login' };
  const [h, p, s] = tok.split('.'); if (!s) return { ok: false, why: 'bad token' };
  let head, body; try { head = JSON.parse(new TextDecoder().decode(b64(h))); body = JSON.parse(new TextDecoder().decode(b64(p))); } catch (e) { return { ok: false, why: 'bad token' }; }
  if (head.alg !== 'RS256') return { ok: false, why: 'bad token' };
  const jwk = (await keysFor(env.ACCESS_TEAM)).find(k => k.kid === head.kid); if (!jwk) return { ok: false, why: 'unknown key' };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const good = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64(s), new TextEncoder().encode(h + '.' + p)); if (!good) return { ok: false, why: 'bad signature' };
  const aud = Array.isArray(body.aud) ? body.aud : [body.aud];
  if (!aud.includes(env.ACCESS_AUD) || body.iss !== `https://${env.ACCESS_TEAM}.cloudflareaccess.com` || !(body.exp * 1000 > Date.now())) return { ok: false, why: 'wrong audience or expired' };
  const email = String(body.email || '').toLowerCase(), allow = String(env.ALLOW_EMAILS || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
  if (!allow.includes(email)) return { ok: false, why: 'not on the list' };
  return { ok: true, email };
}

const SEC = { 'content-security-policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'", 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', 'x-frame-options': 'DENY', 'permissions-policy': 'camera=(), microphone=(), geolocation=()' };
const J = (o, status = 200, cache = 'no-store') => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': cache, ...SEC } });
const locked = () => new Response('<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>Private</title><p>Private. Sign in through the link you were given.</p>', { status: 403, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...SEC } });
const withSec = (res, extra = {}) => { const h = new Headers(res.headers); for (const [k, v] of Object.entries({ ...SEC, ...extra })) h.set(k, v); return new Response(res.body, { status: res.status, headers: h }); };

let READY = false;
async function db(env) {
  if (!READY) {
    await env.DB.batch([
      env.DB.prepare('CREATE TABLE IF NOT EXISTS objects (id TEXT PRIMARY KEY, type TEXT NOT NULL, data TEXT NOT NULL, updated TEXT NOT NULL)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS objects_type ON objects (type)'),
      env.DB.prepare('CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, bytes BLOB NOT NULL, created TEXT NOT NULL)'),
    ]);
    READY = true;
  }
  return env.DB;
}
const rowsOf = async (d, type) => (await d.prepare('SELECT data FROM objects WHERE type = ?').bind(type).all()).results.map(r => JSON.parse(r.data));
const ID = /^[a-z0-9_-]{1,64}$/i;

async function desk(request, env, url, who) {
  const d = await db(env), path = url.pathname.slice('/api/desk'.length), write = request.method !== 'GET';
  // a change must come from the desk page itself: same origin, and the header a plain form cannot send
  if (write && (request.headers.get('x-desk') !== '1' || (request.headers.get('origin') && request.headers.get('origin') !== url.origin))) return J({ error: 'not from the desk' }, 403);
  if (path.startsWith('/market/')) return market(request, env, d, url, path.slice('/market'.length));
  if (path === '/all' && !write) {
    const all = (await d.prepare('SELECT data FROM objects').all()).results.map(r => JSON.parse(r.data));
    return J({ me: who.email, objects: all });
  }
  let m = /^\/obj\/([a-z]+)\/([^/]+)$/.exec(path);
  if (m && TYPES.includes(m[1]) && ID.test(m[2])) {
    if (request.method === 'PUT') {
      const text = await request.text(); if (text.length > 200000) return J({ error: 'too large' }, 413);
      let o; try { o = JSON.parse(text); } catch (e) { return J({ error: 'not JSON' }, 400); }
      if (!o || typeof o !== 'object' || Array.isArray(o)) return J({ error: 'not an object' }, 400);
      o.id = m[2]; o.type = m[1]; o.updated = new Date().toISOString(); o.by = who.email;
      await d.prepare('INSERT INTO objects (id, type, data, updated) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(id) DO UPDATE SET type = ?2, data = ?3, updated = ?4').bind(o.id, o.type, JSON.stringify(o), o.updated).run();
      return J({ ok: true, object: o });
    }
    if (request.method === 'DELETE') { await d.prepare('DELETE FROM objects WHERE id = ? AND type = ?').bind(m[2], m[1]).run(); return J({ ok: true }); }
  }
  if (path === '/photo' && request.method === 'POST') {
    const buf = await request.arrayBuffer(), b = new Uint8Array(buf);
    if (buf.byteLength < 100 || buf.byteLength > 1900000) return J({ error: 'A photo must be under 1.9 MB after the page shrinks it.' }, 413);
    if (!(b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)) return J({ error: 'not a JPEG' }, 415);
    const id = [...crypto.getRandomValues(new Uint8Array(12))].map(x => x.toString(16).padStart(2, '0')).join('');
    await d.prepare('INSERT INTO photos (id, bytes, created) VALUES (?, ?, ?)').bind(id, buf, new Date().toISOString()).run();
    return J({ ok: true, id });
  }
  m = /^\/photo\/([a-f0-9]{24})$/.exec(path);
  if (m && request.method === 'DELETE') { await d.prepare('DELETE FROM photos WHERE id = ?').bind(m[1]).run(); return J({ ok: true }); }
  return J({ error: 'not found' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url), p = url.pathname;
    try {
      if (p === '/desk' || p.startsWith('/desk/') || p.startsWith('/api/desk')) {
        let who; try { who = await whoIs(request, env, url); } catch (e) { who = { ok: false, why: 'check failed' }; }
        if (!who.ok) return locked();
        if (p.startsWith('/api/desk')) return await desk(request, env, url, who);
        if (/^\/desk\/connect\/(ebay|etsy)$/.test(p) && request.method === 'GET') return await connectBack(request, env, await db(env), url);
        return withSec(await env.ASSETS.fetch(request), { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' });
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') return J({ error: 'read only' }, 405);
      if (p === '/api/catalog') {
        const d = await db(env), [products, makers, settings] = await Promise.all([rowsOf(d, 'product'), rowsOf(d, 'maker'), rowsOf(d, 'settings')]), set = settings[0] || {};
        return J({ pieces: products.filter(isPublic).sort((a, b) => (a.sku || '').localeCompare(b.sku || '')).map(x => publicProduct(x, makers)), email: set.publicEmail || '', intro: set.publicIntro || '' }, 200, 'public, max-age=120');
      }
      const img = /^\/img\/([a-f0-9]{24})\.jpg$/.exec(p);
      if (img) {
        // a photo is public by its link alone: marketplaces fetch photos from these links. The link is a random 24-character name.
        const d = await db(env), r = await d.prepare('SELECT bytes FROM photos WHERE id = ?').bind(img[1]).first();
        if (!r) return new Response('Not found', { status: 404, headers: SEC });
        return new Response(r.bytes instanceof ArrayBuffer ? r.bytes : new Uint8Array(r.bytes), { headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable', ...SEC } });
      }
      // the site is not announced to search engines until it is switched on with INDEX_OK
      const res = await env.ASSETS.fetch(request);
      return withSec(res, env.INDEX_OK === 'yes' ? {} : { 'x-robots-tag': 'noindex, nofollow' });
    } catch (e) { return J({ error: 'The server tripped. Try again.' }, 500); }
  },
};
