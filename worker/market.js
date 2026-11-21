// Posting straight to eBay and Etsy. Private: every route here sits behind the desk login.
// The app keys are Cloudflare secrets the owner enters. The sign-in tokens each site hands back are kept in the
// database and never sent to a page. Nothing here runs by itself: a person presses Post or Take down on the desk.
import { checkProduct, realSpecies } from '../public/desk/lib/model.js';
import { channel, listing } from '../public/desk/lib/channels.js';

const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const form = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)]));
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rand = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const short = (s, n = 400) => String(s || '').replace(/\s+/g, ' ').slice(0, n);
class Refused extends Error { }

// stand-in addresses are honored on a local address only, for the flow tests
const local = (url) => ['localhost', '127.0.0.1'].includes(url.hostname);
const base = (env, url) => ({
  ebayApi: (local(url) && env.EBAY_API) || 'https://api.ebay.com', ebayAuth: (local(url) && env.EBAY_AUTH) || 'https://auth.ebay.com',
  etsyApi: (local(url) && env.ETSY_API) || 'https://api.etsy.com', etsyAuth: (local(url) && env.ETSY_AUTH) || 'https://www.etsy.com',
});
const EBAY_SCOPES = 'https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.account';
const ETSY_SCOPES = 'listings_r listings_w shops_r';
const keys = (env) => ({ ebay: !!(env.EBAY_CLIENT_ID && env.EBAY_CLIENT_SECRET && env.EBAY_RUNAME), etsy: !!(env.ETSY_KEYSTRING && env.ETSY_SECRET) });

async function vault(d) { await d.prepare('CREATE TABLE IF NOT EXISTS vault (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated TEXT NOT NULL)').run(); }
const getV = async (d, id) => { const r = await d.prepare('SELECT data FROM vault WHERE id = ?').bind(id).first(); return r ? JSON.parse(r.data) : null; };
const putV = (d, id, o) => d.prepare('INSERT INTO vault (id, data, updated) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET data = ?2, updated = ?3').bind(id, JSON.stringify(o), new Date().toISOString()).run();
const delV = (d, id) => d.prepare('DELETE FROM vault WHERE id = ?').bind(id).run();
const getObj = async (d, id) => { const r = await d.prepare('SELECT data FROM objects WHERE id = ?').bind(id).first(); return r ? JSON.parse(r.data) : null; };
const putObj = (d, o) => { o.updated = new Date().toISOString(); return d.prepare('INSERT INTO objects (id, type, data, updated) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(id) DO UPDATE SET data = ?3, updated = ?4').bind(o.id, o.type, JSON.stringify(o), o.updated).run(); };

// ---------------------------------------------------------------- eBay
async function ebayToken(env, d, B) {
  const t = await getV(d, 'ebay'); if (!t) throw new Refused('eBay is not connected yet. Connect it under Settings.');
  if (t.access && t.until > Date.now() + 60000) return t.access;
  const r = await fetch(B.ebayApi + '/identity/v1/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic ' + btoa(env.EBAY_CLIENT_ID + ':' + env.EBAY_CLIENT_SECRET) }, body: form({ grant_type: 'refresh_token', refresh_token: t.refresh }) });
  const j = await r.json().catch(() => ({})); if (!r.ok || !j.access_token) throw new Refused('eBay would not renew the sign-in. Connect it again under Settings. ' + short(j.error_description || j.error));
  await putV(d, 'ebay', { ...t, access: j.access_token, until: Date.now() + (j.expires_in || 7200) * 1000 }); return j.access_token;
}
async function ebay(env, d, B, method, path, body) {
  const tok = await ebayToken(env, d, B);
  const r = await fetch(B.ebayApi + path, { method, headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json', 'content-language': 'en-US', accept: 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let j = {}; try { j = text ? JSON.parse(text) : {}; } catch (e) { /* not JSON */ }
  if (!r.ok) { const e = (j.errors || [])[0] || {}; throw new Refused(`eBay said no (${r.status}): ${short(e.longMessage || e.message || text)}${(e.parameters || []).length ? ' [' + e.parameters.map(p => p.name + ': ' + p.value).join(', ').slice(0, 200) + ']' : ''}`); }
  return j;
}
// "Brand: Unbranded" lines from Settings become the item specifics eBay asks for in the chosen category
export const aspectsOf = (text) => Object.fromEntries(String(text || '').split(/\n+/).map(l => l.split(':')).filter(a => a.length >= 2 && a[0].trim() && a.slice(1).join(':').trim()).map(a => [a[0].trim(), [a.slice(1).join(':').trim()]]));
const htmlOf = (text) => String(text).split(/\n\n+/).map(par => '<p>' + par.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>') + '</p>').join('');

export function ebayBodies(p, set, origin) {
  const cs = (set.channels || {}).ebay || {}, l = listing(p, channel('ebay'), set, origin), missing = [];
  for (const [k, name] of [['category', 'the category number'], ['fulfillmentPolicyId', 'a shipping policy'], ['paymentPolicyId', 'a payment policy'], ['returnPolicyId', 'a return policy'], ['merchantLocationKey', 'an item location']]) if (!cs[k]) missing.push(name);
  if (missing.length) throw new Refused('Under Settings, eBay still needs ' + missing.join(', ') + '.');
  if (!l.photos.length || !(l.price > 0) || !(l.quantity > 0)) throw new Refused('The piece needs a photo, a retail price and stock.');
  const aspects = aspectsOf(cs.aspects); const sp = realSpecies(p)[0]; if (sp && sp.scientific && !aspects.Species) aspects.Species = [sp.scientific];
  const item = { availability: { shipToLocationAvailability: { quantity: l.quantity } }, condition: 'NEW', product: { title: l.title, description: l.description.slice(0, 4000), aspects, imageUrls: l.photos.slice(0, 24) } };
  if (l.weightOz > 0) item.packageWeightAndSize = { weight: { value: l.weightOz, unit: 'OUNCE' } };
  const offer = { sku: p.sku, marketplaceId: 'EBAY_US', format: 'FIXED_PRICE', availableQuantity: l.quantity, categoryId: String(cs.category), listingDescription: htmlOf(l.description), listingDuration: 'GTC', merchantLocationKey: cs.merchantLocationKey,
    listingPolicies: { fulfillmentPolicyId: cs.fulfillmentPolicyId, paymentPolicyId: cs.paymentPolicyId, returnPolicyId: cs.returnPolicyId }, pricingSummary: { price: { value: l.price.toFixed(2), currency: 'USD' } } };
  return { item, offer };
}
async function ebayPost(env, d, B, p, set, origin) {
  const { item, offer } = ebayBodies(p, set, origin), sku = encodeURIComponent(p.sku);
  await ebay(env, d, B, 'PUT', `/sell/inventory/v1/inventory_item/${sku}`, item);
  // an offer may be left from an earlier try: reuse it instead of making a second one
  const had = await ebay(env, d, B, 'GET', `/sell/inventory/v1/offer?sku=${sku}&marketplace_id=EBAY_US`).catch(() => ({})), old = (had.offers || [])[0];
  let offerId = old && old.offerId;
  if (offerId) await ebay(env, d, B, 'PUT', `/sell/inventory/v1/offer/${offerId}`, offer); else offerId = (await ebay(env, d, B, 'POST', '/sell/inventory/v1/offer', offer)).offerId;
  const pub = await ebay(env, d, B, 'POST', `/sell/inventory/v1/offer/${offerId}/publish`);
  return { status: 'listed', offerId, listingId: pub.listingId, url: pub.listingId ? 'https://www.ebay.com/itm/' + pub.listingId : '' };
}
async function ebayDown(env, d, B, cs) { if (!cs.offerId) throw new Refused('This listing was not posted from the desk, so take it down on eBay by hand.'); await ebay(env, d, B, 'POST', `/sell/inventory/v1/offer/${cs.offerId}/withdraw`); }
async function ebayOptions(env, d, B) {
  const [f, pay, ret, loc] = await Promise.all(['fulfillment_policy', 'payment_policy', 'return_policy'].map(k => ebay(env, d, B, 'GET', `/sell/account/v1/${k}?marketplace_id=EBAY_US`)).concat(ebay(env, d, B, 'GET', '/sell/inventory/v1/location')));
  const m = (a, id) => (a || []).map(x => ({ id: x[id], name: x.name }));
  return { fulfillment: m(f.fulfillmentPolicies, 'fulfillmentPolicyId'), payment: m(pay.paymentPolicies, 'paymentPolicyId'), returns: m(ret.returnPolicies, 'returnPolicyId'), locations: (loc.locations || []).map(x => ({ id: x.merchantLocationKey, name: x.name || x.merchantLocationKey })) };
}

// ---------------------------------------------------------------- Etsy
const etsyKey = (env) => env.ETSY_KEYSTRING + ':' + env.ETSY_SECRET;
async function etsyToken(env, d, B) {
  const t = await getV(d, 'etsy'); if (!t) throw new Refused('Etsy is not connected yet. Connect it under Settings.');
  if (t.access && t.until > Date.now() + 60000) return t;
  const r = await fetch(B.etsyApi + '/v3/public/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'refresh_token', client_id: env.ETSY_KEYSTRING, refresh_token: t.refresh }) });
  const j = await r.json().catch(() => ({})); if (!r.ok || !j.access_token) throw new Refused('Etsy would not renew the sign-in. Connect it again under Settings. ' + short(j.error_description || j.error));
  const n = { ...t, access: j.access_token, refresh: j.refresh_token || t.refresh, until: Date.now() + (j.expires_in || 3600) * 1000 }; await putV(d, 'etsy', n); return n;
}
async function etsy(env, d, B, method, path, body, raw) {
  const t = await etsyToken(env, d, B), headers = { authorization: 'Bearer ' + t.access, 'x-api-key': etsyKey(env), accept: 'application/json' };
  if (body && !raw) headers['content-type'] = 'application/x-www-form-urlencoded';
  const r = await fetch(B.etsyApi + '/v3/application' + path, { method, headers, body: body ? (raw ? body : form(body)) : undefined });
  const text = await r.text(); let j = {}; try { j = text ? JSON.parse(text) : {}; } catch (e) { /* not JSON */ }
  if (!r.ok) throw new Refused(`Etsy said no (${r.status}): ${short(j.error || j.error_description || text)}`);
  return j;
}
const etsyShop = async (env, d, B) => { const t = await etsyToken(env, d, B); if (t.shopId) return t; const uid = String(t.access).split('.')[0], s = await etsy(env, d, B, 'GET', `/users/${uid}/shops`); if (!s.shop_id) throw new Refused('Etsy found no shop on this account.'); const n = { ...(await getV(d, 'etsy')), shopId: s.shop_id, shopName: s.shop_name }; await putV(d, 'etsy', n); return n; };

export function etsyBody(p, set, origin) {
  const cs = (set.channels || {}).etsy || {}, l = listing(p, channel('etsy'), set, origin), missing = [];
  for (const [k, name] of [['taxonomyId', 'a category'], ['shippingProfileId', 'a shipping profile'], ['readinessStateId', 'a processing profile']]) if (!cs[k]) missing.push(name);
  if (missing.length) throw new Refused('Under Settings, Etsy still needs ' + missing.join(', ') + '.');
  if (!l.photos.length || !(l.price > 0) || !(l.quantity > 0)) throw new Refused('The piece needs a photo, a retail price and stock.');
  return { quantity: l.quantity, title: l.title, description: l.description, price: l.price.toFixed(2), who_made: cs.whoMade || 'i_did', when_made: cs.whenMade || 'made_to_order', taxonomy_id: cs.taxonomyId, shipping_profile_id: cs.shippingProfileId, readiness_state_id: cs.readinessStateId, return_policy_id: cs.returnPolicyId || undefined,
    type: 'physical', tags: l.tags.join(','), materials: l.materials.map(m => m.replace(/[^\p{L}\p{N} ]/gu, '')).filter(Boolean).join(','), is_supply: 'false', should_auto_renew: 'false' };
}
async function etsyPost(env, d, B, p, set, origin) {
  const body = etsyBody(p, set, origin), t = await etsyShop(env, d, B), cs = (set.channels || {}).etsy || {}, S = `/shops/${t.shopId}/listings`;
  const made = await etsy(env, d, B, 'POST', S, body), id = made.listing_id; if (!id) throw new Refused('Etsy made no listing.');
  // read the price back before anything goes live: a listing must never go up at the wrong price
  const got = made.price && made.price.divisor ? made.price.amount / made.price.divisor : null;
  const out = { status: 'paused', listingId: id, url: made.url || `https://www.etsy.com/listing/${id}`, note: '' };
  let n = 0; for (const pid of (p.photos || []).slice(0, 10)) { const row = await d.prepare('SELECT bytes FROM photos WHERE id = ?').bind(pid).first(); if (!row) continue; const fd = new FormData(); fd.append('image', new Blob([row.bytes], { type: 'image/jpeg' }), `${p.sku}-${++n}.jpg`); fd.append('rank', String(n)); await etsy(env, d, B, 'POST', `${S}/${id}/images`, fd, true); }
  if (got !== null && Math.abs(got - +body.price) > 0.005) { out.note = `Left as a draft: Etsy shows the price as $${got.toFixed(2)}, not $${body.price}. Fix it on Etsy before publishing.`; return out; }
  if (!cs.live) { out.note = 'Saved on Etsy as a draft. Publish it there, or switch on "go live" under Settings.'; return out; }
  if (!n) { out.note = 'Left as a draft: no photo reached Etsy.'; return out; }
  await etsy(env, d, B, 'PATCH', `${S}/${id}`, { state: 'active' }); out.status = 'listed'; return out;
}
async function etsyDown(env, d, B, cs) { if (!cs.listingId) throw new Refused('This listing was not posted from the desk, so take it down on Etsy by hand.'); const t = await etsyShop(env, d, B); await etsy(env, d, B, 'PATCH', `/shops/${t.shopId}/listings/${cs.listingId}`, { state: 'inactive' }); }
let TAX = null;
async function etsyOptions(env, d, B, q) {
  const t = await etsyShop(env, d, B);
  if (q !== null) { // category search by name
    if (!TAX) { const flat = [], walk = (nodes, trail) => { for (const x of nodes || []) { const path = [...trail, x.name]; flat.push({ id: x.id, name: path.join(' > ') }); walk(x.children, path); } }; walk((await etsy(env, d, B, 'GET', '/seller-taxonomy/nodes')).results, []); TAX = flat; }
    const words = q.toLowerCase().split(/\s+/).filter(Boolean); return { categories: TAX.filter(x => words.every(w => x.name.toLowerCase().includes(w))).slice(0, 40) };
  }
  const [ship, ready, ret] = await Promise.all([etsy(env, d, B, 'GET', `/shops/${t.shopId}/shipping-profiles`), etsy(env, d, B, 'GET', `/shops/${t.shopId}/readiness-state-definitions`).catch(() => ({ results: [] })), etsy(env, d, B, 'GET', `/shops/${t.shopId}/policies/return`).catch(() => ({ results: [] }))]);
  return { shop: t.shopName, shipping: (ship.results || []).map(x => ({ id: x.shipping_profile_id, name: x.title })), readiness: (ready.results || []).map(x => ({ id: x.readiness_state_id, name: `${x.readiness_state === 'made_to_order' ? 'Made to order' : 'Ready to ship'}, ${x.min_processing_time} to ${x.max_processing_time} ${x.processing_time_unit || 'days'}` })), returns: (ret.results || []).map(x => ({ id: x.return_policy_id, name: x.accepts_returns ? `Returns within ${x.return_deadline} days` : 'No returns' })) };
}

// ---------------------------------------------------------------- routes
const SITES = { ebay: { post: ebayPost, down: ebayDown }, etsy: { post: etsyPost, down: etsyDown } };

// the page a site sends the owner back to after sign-in: /desk/connect/ebay or /desk/connect/etsy
export async function connectBack(request, env, d, url) {
  await vault(d); const site = url.pathname.split('/').pop(), B = base(env, url), q = url.searchParams, back = (msg) => Response.redirect(`${url.origin}/desk/?connect=${encodeURIComponent(msg)}#settings`, 302);
  const st = await getV(d, 'state-' + site); await delV(d, 'state-' + site);
  if (!st || !q.get('code') || q.get('state') !== st.state || Date.now() - st.at > 900000) return back(`${site === 'ebay' ? 'eBay' : 'Etsy'} sign-in did not finish. Try Connect again.`);
  try {
    if (site === 'ebay') {
      const r = await fetch(B.ebayApi + '/identity/v1/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic ' + btoa(env.EBAY_CLIENT_ID + ':' + env.EBAY_CLIENT_SECRET) }, body: form({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: env.EBAY_RUNAME }) });
      const j = await r.json().catch(() => ({})); if (!r.ok || !j.refresh_token) return back('eBay refused the sign-in: ' + short(j.error_description || j.error || r.status, 120));
      await putV(d, 'ebay', { access: j.access_token, until: Date.now() + (j.expires_in || 7200) * 1000, refresh: j.refresh_token, refreshUntil: Date.now() + (j.refresh_token_expires_in || 0) * 1000 }); return back('eBay is connected.');
    }
    if (site === 'etsy') {
      const r = await fetch(B.etsyApi + '/v3/public/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'authorization_code', client_id: env.ETSY_KEYSTRING, redirect_uri: `${url.origin}/desk/connect/etsy`, code: q.get('code'), code_verifier: st.verifier }) });
      const j = await r.json().catch(() => ({})); if (!r.ok || !j.refresh_token) return back('Etsy refused the sign-in: ' + short(j.error_description || j.error || r.status, 120));
      await putV(d, 'etsy', { access: j.access_token, until: Date.now() + (j.expires_in || 3600) * 1000, refresh: j.refresh_token }); return back('Etsy is connected.');
    }
  } catch (e) { return back('The sign-in tripped. Try Connect again.'); }
  return back('Unknown site.');
}

export async function market(request, env, d, url, path) {
  await vault(d); const B = base(env, url), K = keys(env), write = request.method === 'POST';
  try {
    if (path === '/status') { const [eb, et] = await Promise.all([getV(d, 'ebay'), getV(d, 'etsy')]); return J({ ebay: { keys: K.ebay, connected: !!eb, back: `${url.origin}/desk/connect/ebay` }, etsy: { keys: K.etsy, connected: !!et, shop: et && et.shopName || '', back: `${url.origin}/desk/connect/etsy` } }); }
    let m = /^\/(connect|disconnect|options)\/(ebay|etsy)$/.exec(path);
    if (m) {
      const [, act, site] = m; if (!K[site]) return J({ error: `The ${site === 'ebay' ? 'eBay' : 'Etsy'} app keys are not set in Cloudflare yet.` }, 409);
      if (act === 'disconnect' && write) { await delV(d, site); return J({ ok: true }); }
      if (act === 'options') return J(site === 'ebay' ? await ebayOptions(env, d, B) : await etsyOptions(env, d, B, url.searchParams.has('q') ? url.searchParams.get('q') : null));
      if (act === 'connect' && write) {
        const state = rand(24);
        if (site === 'ebay') { await putV(d, 'state-ebay', { state, at: Date.now() }); return J({ url: `${B.ebayAuth}/oauth2/authorize?${form({ client_id: env.EBAY_CLIENT_ID, redirect_uri: env.EBAY_RUNAME, response_type: 'code', scope: EBAY_SCOPES, state })}` }); }
        const verifier = rand(48), challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))); await putV(d, 'state-etsy', { state, verifier, at: Date.now() });
        return J({ url: `${B.etsyAuth}/oauth/connect?${form({ response_type: 'code', client_id: env.ETSY_KEYSTRING, redirect_uri: `${url.origin}/desk/connect/etsy`, scope: ETSY_SCOPES, state, code_challenge: challenge, code_challenge_method: 'S256' })}` });
      }
    }
    m = /^\/(post|takedown)\/(ebay|etsy)\/([a-z0-9_-]{1,64})$/i.exec(path);
    if (m && write) {
      const [, act, site, id] = m, p = await getObj(d, id), set = (await getObj(d, 'settings')) || {};
      if (!p || p.type !== 'product') return J({ error: 'That piece is gone.' }, 404);
      if (!K[site]) return J({ error: 'The app keys are not set in Cloudflare yet.' }, 409);
      p.channels = p.channels || {}; const cs = p.channels[site] || {};
      if (act === 'post') {
        const c = checkProduct(p); if (!c.ok || !p.ready) return J({ error: 'This piece is not ready: ' + (c.blockers[0] || 'mark it ready first.') }, 409);
        if (cs.status === 'listed' && (cs.offerId || cs.listingId)) return J({ error: 'Already listed there.' }, 409);
        if (site === 'etsy' && cs.listingId && cs.status !== 'sold') return J({ error: 'This piece already has a listing on Etsy, as a draft or switched off. Open it there.' }, 409);
        const res = await SITES[site].post(env, d, B, p, set, url.origin);
        const fresh = (await getObj(d, id)) || p; fresh.channels = fresh.channels || {}; fresh.channels[site] = { ...cs, ...res, on: new Date().toLocaleDateString('en-CA'), by: 'desk' }; await putObj(d, fresh);
        return J({ ok: true, object: fresh, note: res.note || '' });
      }
      await SITES[site].down(env, d, B, cs);
      const fresh = (await getObj(d, id)) || p; fresh.channels[site] = { ...cs, status: +fresh.stock <= 0 ? 'sold' : 'paused', off: new Date().toLocaleDateString('en-CA') }; await putObj(d, fresh);
      return J({ ok: true, object: fresh });
    }
    return J({ error: 'not found' }, 404);
  } catch (e) { return J({ error: e instanceof Refused ? e.message : 'The posting step tripped. Nothing else was changed. Try again.' }, e instanceof Refused ? 422 : 500); }
}
