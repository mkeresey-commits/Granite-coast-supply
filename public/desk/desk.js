// The desk: pieces, posting, stores, orders and delivery runs. Private. Everything is kept on the server behind the login.
import { KINDS, SOURCES, STAGES, REGIONS, ORDER_STEPS, newId, today, blankProduct, blankSpecies, blankStore, blankOrder, nextSku, money, afterFee, checkProduct, isAccount, storeNote, orderTotals, deliver, runs, todayList, sizeWords, lane, LANES, twinsOf, freeCopy } from './lib/model.js';
import { CHANNELS, channel, eligible, listing, fileFor, statusOf, toPost, takesReal, REAL_WORDS } from './lib/channels.js';

const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = (v) => v == null || v === '' || !isFinite(+v) ? '' : '$' + (+v).toFixed(2);
const D = { maker: [], product: [], store: [], order: [], settings: { type: 'settings', id: 'settings', brand: 'Granite Coast Supply', channels: {} } };
const main = $('#main'), say = (t, bad) => { const s = $('#status'); s.textContent = t; s.classList.toggle('bad', !!bad); };

// ---- server
async function api(path, opt = {}) {
  const r = await fetch('/api/desk' + path, { ...opt, headers: { 'x-desk': '1', ...(opt.headers || {}) } }), j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'The server answered ' + r.status); return j;
}
const timers = {};
function put(o, now) {
  const list = o.type === 'settings' ? null : D[o.type]; if (list && !list.includes(o)) list.push(o);
  clearTimeout(timers[o.id]); say('Saving');
  const go = async () => { try { await api(`/obj/${o.type}/${o.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) }); say('Saved ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })); } catch (e) { say('Not saved: ' + e.message, true); } };
  if (now) return go(); timers[o.id] = setTimeout(go, 600);
}
async function drop(o) { D[o.type] = D[o.type].filter(x => x !== o); try { await api(`/obj/${o.type}/${o.id}`, { method: 'DELETE' }); say('Removed'); } catch (e) { say('Not removed: ' + e.message, true); } }
const byId = (type, id) => D[type].find(x => x.id === id);
const set = () => D.settings, origin = location.origin;

// ---- small parts
const field = (label, k, v, o = {}) => `<label class="${o.wide ? 'wide' : ''}">${label} ${o.area ? `<textarea data-k="${k}" rows="${o.rows || 3}">${h(v)}</textarea>` : `<input data-k="${k}" type="${o.type || 'text'}" value="${h(v)}" ${o.type === 'number' ? 'step="any" min="0" inputmode="decimal"' : ''} ${o.ph ? `placeholder="${h(o.ph)}"` : ''}>`}${o.help ? `<small>${o.help}</small>` : ''}</label>`;
const pick = (label, k, v, opts, o = {}) => `<label class="${o.wide ? 'wide' : ''}">${label} <select data-k="${k}">${Object.entries(opts).map(([a, b]) => `<option value="${h(a)}" ${String(v) === String(a) ? 'selected' : ''}>${h(b)}</option>`).join('')}</select></label>`;
const tick = (label, k, v, o = {}) => `<label class="tick ${o.wide ? 'wide' : ''}"><input type="checkbox" data-k="${k}" ${v ? 'checked' : ''} ${o.off ? 'disabled' : ''}> <span>${label}</span></label>`;
const listOf = (a) => Object.fromEntries(a.map(x => [x, x]));
// bind every [data-k] inside el to obj, save as you type, and call after() to refresh the parts that depend on it
function bind(el, obj, after) {
  el.addEventListener('input', (e) => { const t = e.target, k = t.dataset.k; if (!k) return; obj[k] = t.type === 'checkbox' ? t.checked : t.value; put(obj); if (after) after(k); });
}
const copyBtn = (text, label = 'Copy') => `<button type="button" class="ghost copy" data-copy="${h(text)}">${label}</button>`;
document.addEventListener('click', async (e) => { const b = e.target.closest('[data-copy]'); if (!b) return; try { await navigator.clipboard.writeText(b.dataset.copy); const was = b.textContent; b.textContent = 'Copied'; setTimeout(() => { b.textContent = was; }, 1200); } catch (x) { say('Could not copy. Select the text and copy it by hand.', true); } });
function download(name, text, type = 'text/csv') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }

// ---- straight to eBay and Etsy, when they are connected under Settings
let MK = { ebay: {}, etsy: {} };
const AUTO = ['ebay', 'etsy'], live = (id) => !!(MK[id] && MK[id].connected);
const swap = (o) => { const mine = byId(o.type, o.id); if (mine) { clearTimeout(timers[o.id]); Object.assign(mine, o); } return mine; };
async function postOne(p, site) { try { const r = await api(`/market/post/${site}/${p.id}`, { method: 'POST' }); swap(r.object); const cs = r.object.channels[site]; return { ok: true, p, site, url: cs.url, status: cs.status, note: r.note }; } catch (e) { return { ok: false, p, site, note: e.message }; } }
async function downOne(p, site) { try { const r = await api(`/market/takedown/${site}/${p.id}`, { method: 'POST' }); swap(r.object); return { ok: true, p, site, note: 'Taken down.' }; } catch (e) { return { ok: false, p, site, note: e.message }; } }
// every site this piece was posted to from the desk and is still up on
const upOn = (p) => AUTO.filter(s => live(s) && ['listed', 'paused'].includes(statusOf(p, s)) && ((p.channels[s] || {}).offerId || (p.channels[s] || {}).listingId) && !(p.channels[s] || {}).off);
async function takeDown(p) { const out = []; for (const s of upOn(p)) out.push(await downOne(p, s)); return out; }
const resultRow = (r) => `<li class="${r.ok ? '' : 'bad'}"><b>${h(channel(r.site).name)}</b> · ${h(r.p.name)}: ${r.ok ? (r.status === 'listed' ? 'listed' : r.status === 'paused' && r.url ? 'saved as a draft' : 'done') : 'not posted'}${r.url ? ` <a href="${h(r.url)}" target="_blank" rel="noopener">Open</a>` : ''}${r.note ? ` <span class="quiet">${h(r.note)}</span>` : ''}</li>`;
async function postMany(pairs, box, btn) {
  btn.disabled = true; box.innerHTML = '<ul class="plain results" id="resList"></ul>'; let n = 0, bad = 0;
  for (const [p, site] of pairs) { say(`Posting ${++n} of ${pairs.length}`); const r = await postOne(p, site); if (!r.ok) bad++; $('#resList').insertAdjacentHTML('beforeend', resultRow(r)); }
  say(bad ? `${pairs.length - bad} posted, ${bad} not` : `${pairs.length} posted`, !!bad); btn.disabled = false;
}

// ---- today
function vToday() {
  const list = todayList({ products: D.product, stores: D.store, orders: D.order }, CHANNELS), accounts = D.store.filter(isAccount).length, ready = D.product.filter(p => p.ready).length, listed = D.product.filter(p => Object.values(p.channels || {}).some(c => c.status === 'listed')).length;
  const owed = D.order.reduce((s, o) => s + (o.step === 'Delivered' ? orderTotals(o).owed : 0), 0), link = { takedown: (x) => '#piece/' + x.id, store: (x) => '#store/' + x.id, order: (x) => '#order/' + x.id, post: () => '#post', products: () => '#pieces' };
  main.innerHTML = `<h1>Today</h1>
    <div class="nums"><div><b>${D.product.length}</b><span>pieces, ${ready} ready</span></div><div><b>${listed}</b><span>listed somewhere</span></div><div><b>${accounts}</b><span>stores stocked, of ${D.store.length} on the list</span></div><div><b>${usd(owed) || '$0.00'}</b><span>owed by stores</span></div></div>
    <h2>Do next, in order</h2>
    ${list.length ? `<ol class="todo">${list.map(x => `<li><a href="${link[x.kind](x)}">${h(x.text)}</a></li>`).join('')}</ol>` : `<p class="quiet">Nothing is due. ${D.product.length ? '' : 'Start by adding the first piece.'}</p>`}
    <p class="row"><a class="btn" href="#piece/new">Add a piece</a> <a class="btn ghost" href="#store/new">Add a store</a></p>`;
}

// ---- pieces
function vPieces() {
  const rows = [...D.product].sort((a, b) => (a.sku || '').localeCompare(b.sku || ''));
  main.innerHTML = `<h1>Pieces</h1><p class="row"><a class="btn" href="#piece/new">Add a piece</a> <a class="btn ghost" href="#sheet">Line sheet for stores</a></p>
    ${rows.length ? `<div class="scroll"><table class="grid"><thead><tr><th></th><th>Piece</th><th>Stock</th><th>Wholesale</th><th>Retail</th>${CHANNELS.map(c => `<th class="ch" title="${h(c.name)}">${h(c.name.split(' ')[0])}</th>`).join('')}</tr></thead><tbody>
    ${rows.map(p => { const c = checkProduct(p); return `<tr><td>${p.photos[0] ? `<img class="thumb" src="/img/${p.photos[0]}.jpg" alt="" loading="lazy" width="48" height="48">` : '<span class="thumb none"></span>'}</td><td><a href="#piece/${p.id}"><b>${h(p.name || 'Unnamed piece')}</b></a><br><span class="quiet">${h(p.sku)} · ${p.ready ? 'Ready' : c.ok ? 'Draft, can be marked ready' : 'Draft, ' + c.blockers.length + ' to fix'}${p.public && p.ready ? ' · In the public catalog' : ''} · ${LANES[lane(p)]}</span></td><td>${h(p.stock)}</td><td>${usd(p.wholesale)}</td><td>${usd(p.retail)}</td>${CHANNELS.map(ch => { const s = statusOf(p, ch.id); return `<td class="ch"><span class="dot ${s}" title="${h(ch.name)}: ${s === 'none' ? 'not listed' : s}"></span></td>`; }).join('')}</tr>`; }).join('')}</tbody></table></div>
    <p class="quiet">Dots: filled is listed, ring is paused, crossed is sold there.</p>` : '<p class="quiet">No pieces yet. Add the first one with a photo, the species and a price, and it can go everywhere from here.</p>'}`;
}

async function shrink(file) {
  const img = await createImageBitmap(file), max = 2000, k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  for (const q of [0.88, 0.8, 0.7, 0.6]) { const b = await new Promise(r => c.toBlob(r, 'image/jpeg', q)); if (b && b.size < 1800000) return b; }
  throw new Error('That photo is too large even after shrinking.');
}

function vPiece(id) {
  let p = id === 'new' ? null : byId('product', id);
  if (id === 'new') { p = blankProduct(nextSku(D.product)); if (D.maker[0]) p.makerId = D.maker[0].id; put(p, true); history.replaceState(null, '', '#piece/' + p.id); }
  if (!p) { main.innerHTML = '<p>That piece is gone. <a href="#pieces">Back to pieces</a></p>'; return; }
  main.innerHTML = `<p><a href="#pieces">All pieces</a></p><h1 id="pTitle">${h(p.name || 'New piece')}</h1><p class="quiet">${h(p.sku)}</p>
  <div class="two"><div data-own="piece" id="pForm">
    <fieldset><legend>The piece</legend>
      ${field('Name', 'name', p.name, { wide: true, ph: 'Blue morpho under glass' })}
      ${pick('Kind', 'kind', p.kind, KINDS)} ${pick('Maker', 'makerId', p.makerId, { '': 'Not set', ...Object.fromEntries(D.maker.map(m => [m.id, m.name])) })}
      ${field('What it is, in two or three plain sentences', 'blurb', p.blurb, { wide: true, area: true, rows: 4, help: 'This becomes the opening of every listing.' })}
      ${field('Materials, with commas between', 'materials', p.materials, { wide: true, ph: 'glass, walnut base, dried moss' })}
      ${field('Height (in)', 'h', p.h, { type: 'number' })} ${field('Width (in)', 'w', p.w, { type: 'number' })} ${field('Depth (in)', 'd', p.d, { type: 'number' })} ${field('Weight packed (oz)', 'oz', p.oz, { type: 'number' })}
      ${field('Your own search words, with commas between', 'tags', p.tags, { wide: true, help: 'Added ahead of the standard ones.' })}
    </fieldset>
    <fieldset><legend>Money and stock</legend>
      ${field('Cost to make or buy ($)', 'cost', p.cost, { type: 'number' })} ${field('Wholesale to stores ($)', 'wholesale', p.wholesale, { type: 'number' })} ${field('Retail ($)', 'retail', p.retail, { type: 'number' })} ${field('In stock', 'stock', p.stock, { type: 'number' })}
      ${field('Case pack', 'casePack', p.casePack, { type: 'number', help: 'How many a store buys at a time.' })} ${field('Minimum order', 'minOrder', p.minOrder, { type: 'number' })}
      ${tick('One of a kind. When it sells, it comes down everywhere.', 'oneOff', p.oneOff, { wide: true })}
      <p class="wide quiet" id="pMoney"></p>
    </fieldset></div>
    <div>
    <fieldset class="one"><legend>Photos</legend><div class="photos" id="pPhotos"></div>
      <label class="filebtn">Add photos <input type="file" id="pFile" accept="image/*" multiple></label><small>The first photo leads every listing. Photos are shrunk to 2000 pixels and get a public link, because marketplaces load them from it.</small></fieldset>
    <fieldset class="one"><legend>Specimens</legend><div id="pSpecies"></div><button type="button" class="ghost" id="spAdd">Add a specimen</button>
      <small>Look each species up before listing: <a href="https://checklist.cites.org/" target="_blank" rel="noopener">CITES checklist</a>, <a href="https://ecos.fws.gov/ecp/" target="_blank" rel="noopener">federal endangered species list</a>. Imported specimens should come with the supplier's copy of the Fish and Wildlife declaration (Form 3-177).</small></fieldset>
    <fieldset class="one"><legend>Can it go out</legend><div id="pCheck"></div><div data-own="flags" id="pFlags"></div></fieldset>
    <fieldset class="one"><legend>Where it is listed</legend><div id="pChan"></div></fieldset>
    <fieldset class="one"><legend>Versions</legend><div id="pVer"></div></fieldset>
    <div id="pDown"></div>
    <p><button type="button" class="ghost danger" id="pDrop">Remove this piece</button></p>
    </div></div>`;
  const photos = () => { $('#pPhotos').innerHTML = p.photos.map((id, i) => `<figure><img src="/img/${id}.jpg" alt="Photo ${i + 1}" width="120" height="120"><figcaption>${i ? `<button type="button" class="ghost" data-first="${i}">Make first</button>` : 'First'} <button type="button" class="ghost" data-rm="${i}">Remove</button></figcaption></figure>`).join('') || '<p class="quiet">No photos yet.</p>'; };
  const species = () => { $('#pSpecies').innerHTML = p.species.map((s, i) => `<div class="sp" data-i="${i}">
      ${tick('A real specimen', 'real', s.real !== false)} ${s.real === false ? field('Made of', 'madeOf', s.madeOf, { ph: 'hand-cut paper, silk, resin' }) : '<span></span>'}
      ${field('Common name', 'common', s.common, { ph: 'Blue morpho' })} ${field('Scientific name', 'scientific', s.scientific, { ph: 'Morpho menelaus' })}
      ${field('Country of origin', 'origin', s.origin, { ph: 'Peru' })} ${pick('How it was sourced', 'source', s.source, SOURCES)}
      ${field('Supplier', 'supplier', s.supplier)} ${field('Paper on file', 'paper', s.paper, { ph: 'Invoice 1042, declaration copy' })}
      ${pick('CITES', 'cites', s.cites, { none: 'Not listed', II: 'Appendix II', I: 'Appendix I', unknown: 'Not looked up yet' })} ${tick('Listed under the Endangered Species Act', 'esa', s.esa)}
      <button type="button" class="ghost" data-sprm="${i}">Remove specimen</button></div>`).join('') || '<p class="quiet">None. Add one for each real specimen in the piece.</p>'; };
  const check = () => { const c = checkProduct(p), m = money(p);
    if (!c.ok && p.ready) { p.ready = false; put(p); }
    $('#pCheck').innerHTML = (c.blockers.length ? `<ul class="issues bad">${c.blockers.map(x => `<li>${h(x)}</li>`).join('')}</ul>` : '<p class="good">Nothing stops this piece.</p>') + (c.warnings.length ? `<ul class="issues warn">${c.warnings.map(x => `<li>${h(x)}</li>`).join('')}</ul>` : '');
    $('#pFlags').innerHTML = tick('Ready to post and sell', 'ready', p.ready, { off: !c.ok }) + tick('Show in the public catalog (no prices are shown there)', 'public', p.public, { off: !p.ready });
    $('#pMoney').textContent = m.marginWholesale != null ? `Wholesale leaves ${usd(m.marginWholesale)} a piece (${Math.round(m.marginWholesalePct * 100)}%).${m.markup ? ` Retail is ${m.markup.toFixed(2)} times wholesale${m.keystone ? '.' : '; stores usually want 2 times or more, as a rule of thumb.'}` : ''}` : 'Fill in cost and wholesale to see what a piece leaves.';
    $('#pTitle').textContent = p.name || 'New piece'; };
  const chan = () => { $('#pChan').innerHTML = CHANNELS.map(ch => { const cs = (p.channels || {})[ch.id] || {}; return `<div class="chrow" data-ch="${ch.id}"><b>${h(ch.name)}</b><select data-cs="status" aria-label="${h(ch.name)} status">${Object.entries({ none: 'Not listed', listed: 'Listed', paused: 'Paused', sold: 'Sold there' }).map(([a, b]) => `<option value="${a}" ${(cs.status || 'none') === a ? 'selected' : ''}>${b}</option>`).join('')}</select><input data-cs="url" type="url" placeholder="Link to the listing" value="${h(cs.url)}" aria-label="${h(ch.name)} listing link">${cs.url ? `<a href="${h(cs.url)}" target="_blank" rel="noopener">Open</a>` : ''}</div>`; }).join(''); };
  const down = () => { const up = upOn(p); $('#pDown').innerHTML = up.length ? `<p class="row"><button type="button" id="pDownGo">Take it down on ${up.map(x => channel(x).name).join(' and ')}</button></p><ul class="plain results" id="pDownOut"></ul>` : ''; const b = $('#pDownGo'); if (b) b.onclick = async () => { b.disabled = true; const rs = await takeDown(p); chan(); down(); $('#pDown').insertAdjacentHTML('beforeend', `<ul class="plain results">${rs.map(resultRow).join('')}</ul>`); }; };
  const versions = () => { const tw = twinsOf(p, D.product), real = lane(p) === 'real', held = CHANNELS.filter(ch => real && takesReal(ch, set()) === 'no').map(ch => ch.name);
    $('#pVer').innerHTML = `<p><b>${LANES[lane(p)]}.</b> ${real ? (held.length ? `Held back from ${h(held.join(', '))}.` : 'Every site on the list takes it.') : 'It can go on every site.'}</p>${tw.map(x => `<p>${LANES[lane(x)]} version: <a href="#piece/${x.id}">${h(x.name)}</a> <span class="quiet">${h(x.sku)}</span></p>`).join('')}${real && !tw.some(x => lane(x) === 'free') ? '<p><button type="button" class="ghost" id="pFree">Make a version with no real specimen</button></p><small>Same design and words, its own stock number. It needs its own photos, because a listing must show what is sold.</small>' : ''}`;
    const b = $('#pFree'); if (b) b.onclick = () => { const c = freeCopy(p, nextSku(D.product)); put(c, true); location.hash = '#piece/' + c.id; }; };
  photos(); species(); check(); chan(); down(); versions();
  bind($('#pForm'), p, check); bind($('#pFlags'), p, check);
  $('#pSpecies').addEventListener('input', (e) => { const row = e.target.closest('.sp'), k = e.target.dataset.k; if (!row || !k) return; p.species[+row.dataset.i][k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; put(p); check(); if (k === 'real') { species(); versions(); } });
  $('#pSpecies').addEventListener('click', (e) => { const i = e.target.dataset.sprm; if (i == null) return; p.species.splice(+i, 1); put(p); species(); check(); });
  $('#spAdd').onclick = () => { p.species.push(blankSpecies()); put(p); species(); check(); };
  $('#pFile').onchange = async (e) => { for (const f of e.target.files) { try { say('Sending ' + f.name); const b = await shrink(f), r = await api('/photo', { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: b }); p.photos.push(r.id); put(p, true); photos(); check(); } catch (x) { say(x.message, true); } } e.target.value = ''; };
  $('#pPhotos').addEventListener('click', async (e) => { const t = e.target; if (t.dataset.first) { const [x] = p.photos.splice(+t.dataset.first, 1); p.photos.unshift(x); } else if (t.dataset.rm) { const [x] = p.photos.splice(+t.dataset.rm, 1); api('/photo/' + x, { method: 'DELETE' }).catch(() => {}); } else return; put(p); photos(); check(); });
  $('#pChan').addEventListener('change', (e) => { const row = e.target.closest('.chrow'), k = e.target.dataset.cs; if (!row || !k) return; p.channels = p.channels || {}; const cs = p.channels[row.dataset.ch] = p.channels[row.dataset.ch] || {}; cs[k] = e.target.value; if (k === 'status' && e.target.value === 'listed' && !cs.on) cs.on = today(); put(p); chan(); });
  $('#pDrop').onclick = (e) => { const b = e.target; if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = 'Click again to remove it for good'; return; } for (const x of p.photos) api('/photo/' + x, { method: 'DELETE' }).catch(() => {}); drop(p); location.hash = '#pieces'; };
}

// ---- post
const RULE = { conditions: 'Allowed with conditions', yours: 'Your own rules', unchecked: 'Rules not confirmed' };
function vPost(chId) {
  if (chId && channel(chId)) return vChannel(channel(chId));
  main.innerHTML = `<h1>Post</h1><p class="lead">One record for each piece, cut to fit each site. Pick a site to get its file or its paste sheet. A piece shows here once it is marked ready.</p>
    <section class="auto" id="auto"></section>
    <div class="cards">${CHANNELS.map(ch => { const can = toPost(D.product, ch.id, set()).length, on = D.product.filter(p => statusOf(p, ch.id) === 'listed').length; return `<article class="card"><h2><a href="#post/${ch.id}">${h(ch.name)}</a></h2><p class="quiet">${h(ch.lane)} · ${ch.how === 'file' ? 'One file for every piece' : 'Paste one piece at a time'}</p>
      <p><b>${can}</b> to post, <b>${on}</b> listed</p><p class="takes ${takesReal(ch, set())}">${REAL_WORDS[takesReal(ch, set())]}</p><p class="rule ${ch.rule.state}"><b>${RULE[ch.rule.state]}.</b> ${h(ch.rule.text)}${ch.rule.src ? ` <a href="${h(ch.rule.src)}" target="_blank" rel="noopener">Its rules</a>, read ${h(ch.rule.on)}.` : ''}</p></article>`; }).join('')}</div>
    <p class="row"><button type="button" class="ghost" id="allCsv">Download every piece as one spreadsheet</button></p>
    <p class="quiet">Google Shopping, Pinterest and Instagram shopping tags all need a page where a shopper can check out on your own site. This site is a catalog, not a store, so those are not offered here.</p>`;
  $('#allCsv').onclick = () => { const f = fileFor('all', D.product, set(), origin); download(f.name, f.text); };
  const on = AUTO.filter(live), pairs = on.flatMap(site => toPost(D.product, site, set()).filter(p => !(p.channels[site] || {}).listingId || site === 'ebay').map(p => [p, site]));
  $('#auto').innerHTML = on.length ? `<h2>Post automatically</h2><p>${on.map(x => channel(x).name).join(' and ')} ${on.length > 1 ? 'are' : 'is'} connected. <b>${pairs.length}</b> listing${pairs.length === 1 ? '' : 's'} waiting.${live('etsy') ? ` Etsy listings ${(set().channels.etsy || {}).live ? 'go live, and Etsy charges its listing fee for each one' : 'are saved as drafts for you to publish'}.` : ''}</p>
    <p class="row"><button type="button" id="autoGo" ${pairs.length ? '' : 'disabled'}>Post ${pairs.length} listing${pairs.length === 1 ? '' : 's'} now</button></p><div id="autoOut" aria-live="polite"></div>`
    : `<h2>Post automatically</h2><p class="quiet">Connect eBay or Etsy under <a href="#settings">Settings</a> and this becomes one button for every ready piece.</p>`;
  const go = $('#autoGo'); if (go) go.onclick = () => postMany(pairs, $('#autoOut'), go);
}
function vChannel(ch) {
  const ready = toPost(D.product, ch.id, set()), held = D.product.filter(p => statusOf(p, ch.id) !== 'listed' && !eligible(p, ch, set()).ok), on = D.product.filter(p => statusOf(p, ch.id) === 'listed'), fee = ((set().channels || {})[ch.id] || {}).fee;
  const sheet = (p) => { const l = listing(p, ch, set(), origin), e = eligible(p, ch, set()), row = (name, text, note = '') => `<div class="pf"><span>${name}${note ? ` <small>${note}</small>` : ''}</span><pre>${h(text)}</pre>${copyBtn(text)}</div>`;
    return `<article class="card sheet" data-p="${p.id}"><h3>${h(p.name)} <span class="quiet">${h(p.sku)}</span></h3>${e.warnings.length ? `<ul class="issues warn">${e.warnings.map(x => `<li>${h(x)}</li>`).join('')}</ul>` : ''}
      ${row('Title', l.title, ch.title ? `${l.title.length} of ${ch.title} characters` : '')}${row('Description', l.description)}${row('Price', l.price.toFixed(2), fee ? `leaves ${usd(afterFee(l.price, fee))} after the ${fee}% fee you entered` : '')}${row('Quantity', String(l.quantity))}
      ${ch.tags ? row('Tags', l.tags.join(', '), `${l.tags.length} of ${ch.tags}`) : row('Search words', l.tags.join(', '))}${l.materials.length ? row('Materials', l.materials.join(', ')) : ''}
      <div class="pf"><span>Photos</span><div class="plinks">${l.photos.map((u, i) => `<a href="${h(u)}" download="${h(p.sku)}-${i + 1}.jpg"><img src="${h(u)}" alt="Photo ${i + 1}" width="64" height="64" loading="lazy"></a>`).join('')}</div><small>Click a photo to save it, then add it to the listing.</small></div>
      <div class="pf done"><input type="url" placeholder="Paste the listing link" aria-label="Listing link for ${h(p.name)}"><button type="button" data-listed="${p.id}">Mark as listed</button></div></article>`; };
  main.innerHTML = `<p><a href="#post">All sites</a></p><h1>${h(ch.name)}</h1>
    <p class="rule ${ch.rule.state}"><b>${RULE[ch.rule.state]}.</b> ${h(ch.rule.text)}${ch.rule.src ? ` <a href="${h(ch.rule.src)}" target="_blank" rel="noopener">Its rules</a>, read ${h(ch.rule.on)}. Read them again before the first listing.` : ''}</p>
    <ol class="steps">${ch.steps.map(s => `<li>${h(s)}</li>`).join('')}</ol>
    <h2>Ready to post (${ready.length})</h2>
    ${!ready.length ? '<p class="quiet">Nothing is waiting for this site.</p>' : ch.how === 'file' ? `<ul class="plain">${ready.map(p => `<li><a href="#piece/${p.id}">${h(p.name)}</a> <span class="quiet">${h(p.sku)}</span>${eligible(p, ch, set()).warnings.map(w => `<br><span class="warnline">${h(w)}</span>`).join('')}</li>`).join('')}</ul>
      <p class="row"><button type="button" id="chFile">Download the file (${ready.length} piece${ready.length > 1 ? 's' : ''})</button> <button type="button" class="ghost" id="chAll">Mark all ${ready.length} as listed</button></p>` : ready.map(sheet).join('')}
    ${held.length ? `<h2>Held back (${held.length})</h2><ul class="plain">${held.map(p => `<li><a href="#piece/${p.id}">${h(p.name || 'Unnamed piece')}</a>: ${h(eligible(p, ch, set()).blockers.join(' '))}</li>`).join('')}</ul>` : ''}
    ${on.length ? `<h2>Listed (${on.length})</h2><ul class="plain">${on.map(p => { const cs = p.channels[ch.id]; return `<li><a href="#piece/${p.id}">${h(p.name)}</a> <span class="quiet">since ${h(cs.on || '')}</span> ${cs.url ? `<a href="${h(cs.url)}" target="_blank" rel="noopener">Open the listing</a>` : ''}</li>`; }).join('')}</ul>` : ''}`;
  const mark = (p, url) => { p.channels = p.channels || {}; p.channels[ch.id] = { ...(p.channels[ch.id] || {}), status: 'listed', on: today(), ...(url ? { url } : {}) }; put(p, true); };
  if (AUTO.includes(ch.id) && live(ch.id) && ready.length) { $('h2', main).insertAdjacentHTML('afterend', `<p class="row"><button type="button" id="chAuto">Post all ${ready.length} to ${h(ch.name)} now</button></p><div id="chAutoOut" aria-live="polite"></div>`); $('#chAuto').onclick = () => postMany(ready.map(p => [p, ch.id]), $('#chAutoOut'), $('#chAuto')); }
  const f = $('#chFile'); if (f) f.onclick = () => { const x = fileFor(ch.id, ready, set(), origin); download(x.name, x.text); };
  const a = $('#chAll'); if (a) a.onclick = () => { ready.forEach(p => mark(p)); vChannel(ch); };
  main.onclick = (e) => { const id = e.target.dataset.listed; if (!id) return; mark(byId('product', id), e.target.closest('.pf').querySelector('input').value.trim()); vChannel(ch); };
}

// ---- stores
function vStores() {
  const groups = STAGES.map(st => [st, D.store.filter(s => s.stage === st).sort((a, b) => (a.due || '9').localeCompare(b.due || '9'))]).filter(([, l]) => l.length);
  main.innerHTML = `<h1>Stores</h1><p class="lead">A store counts as an account when a piece is on its shelf. Until then it is a lead, however friendly the call was.</p><p class="row"><a class="btn" href="#store/new">Add a store</a> <a class="btn ghost" href="#sheet">Line sheet</a> <a class="btn ghost" href="#runs">Delivery runs</a></p>
    ${groups.map(([st, l]) => `<h2>${h(st)} (${l.length})</h2><div class="scroll"><table class="grid"><thead><tr><th>Store</th><th>Region</th><th>Next step</th><th>Due</th></tr></thead><tbody>${l.map(s => `<tr><td><a href="#store/${s.id}"><b>${h(s.name || 'Unnamed store')}</b></a><br><span class="quiet">${h([s.town, s.st].filter(Boolean).join(', '))}${s.kind ? ' · ' + h(s.kind) : ''}</span></td><td>${h(s.region)}</td><td>${h(s.next)}</td><td class="${s.due && s.due < today() ? 'late' : ''}">${h(s.due)}</td></tr>`).join('')}</tbody></table></div>`).join('') || '<p class="quiet">No stores yet.</p>'}`;
}
function vStore(id) {
  let s = id === 'new' ? null : byId('store', id);
  if (id === 'new') { s = blankStore(); put(s, true); history.replaceState(null, '', '#store/' + s.id); }
  if (!s) { main.innerHTML = '<p>That store is gone. <a href="#stores">Back to stores</a></p>'; return; }
  const orders = D.order.filter(o => o.storeId === s.id).sort((a, b) => b.date.localeCompare(a.date));
  main.innerHTML = `<p><a href="#stores">All stores</a></p><h1 id="sTitle">${h(s.name || 'New store')}</h1>
  <div class="two"><div data-own="store" id="sForm"><fieldset><legend>The store</legend>
    ${field('Name', 'name', s.name, { wide: true })} ${field('Town', 'town', s.town)} ${field('State', 'st', s.st)}
    ${pick('Region, for delivery runs', 'region', s.region, listOf(REGIONS))} ${field('Kind of shop', 'kind', s.kind, { ph: 'Gift, rock shop, museum store' })}
    ${field('Who buys', 'contact', s.contact)} ${field('Phone', 'phone', s.phone, { type: 'tel' })} ${field('Email', 'email', s.email, { type: 'email' })} ${field('Website', 'site', s.site, { type: 'url' })}
    </fieldset><fieldset><legend>Where it stands</legend>
    ${pick('Stage', 'stage', s.stage, listOf(STAGES))} ${pick('Terms', 'terms', s.terms, { wholesale: 'Wholesale, they buy it', consignment: 'Consignment, paid as it sells' })}
    ${field('Our share on consignment (%)', 'split', s.split, { type: 'number' })} ${field('Days to pay on wholesale', 'net', s.net, { type: 'number', help: '0 means paid on delivery.' })}
    ${field('Next step', 'next', s.next, { wide: true, ph: 'Bring three sample domes' })} ${field('Due', 'due', s.due, { type: 'date' })}
    </fieldset></div>
    <div><fieldset class="one"><legend>Notes</legend><div class="noteadd"><textarea id="nText" rows="2" aria-label="New note" placeholder="What was said, and by whom"></textarea><button type="button" id="nAdd">Add note</button></div><ul class="notes" id="nList"></ul></fieldset>
    <fieldset class="one"><legend>Orders</legend>${orders.length ? `<ul class="plain">${orders.map(o => { const t = orderTotals(o); return `<li><a href="#order/${o.id}">${h(o.date)}</a> · ${h(o.step)} · ${t.units} piece${t.units === 1 ? '' : 's'}, ${usd(t.placed)}${t.owed ? `, <b>${usd(t.owed)} owed</b>` : ''}</li>`; }).join('')}</ul>` : '<p class="quiet">No orders yet.</p>'}<button type="button" id="oNew">New order for this store</button></fieldset>
    <p><button type="button" class="ghost danger" id="sDrop">Remove this store</button></p></div></div>`;
  const notes = () => { $('#nList').innerHTML = (s.notes || []).map(x => `<li><span class="quiet">${h(x.on)}</span> ${h(x.text)}</li>`).join(''); }; notes();
  bind($('#sForm'), s, () => { $('#sTitle').textContent = s.name || 'New store'; });
  $('#nAdd').onclick = () => { const t = $('#nText').value.trim(); if (!t) return; Object.assign(s, storeNote(s, t)); put(s, true); $('#nText').value = ''; notes(); };
  $('#oNew').onclick = () => { const o = blankOrder(s.id, s.terms); o.split = s.split; put(o, true); location.hash = '#order/' + o.id; };
  $('#sDrop').onclick = (e) => { const b = e.target; if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = 'Click again to remove it for good'; return; } drop(s); location.hash = '#stores'; };
}

// ---- orders
function vOrders() {
  const rows = [...D.order].sort((a, b) => b.date.localeCompare(a.date));
  main.innerHTML = `<h1>Orders</h1><p class="row"><a class="btn ghost" href="#runs">Delivery runs</a></p>${rows.length ? `<div class="scroll"><table class="grid"><thead><tr><th>Date</th><th>Store</th><th>Terms</th><th>Step</th><th>Pieces</th><th>Value</th><th>Owed</th></tr></thead><tbody>${rows.map(o => { const s = byId('store', o.storeId), t = orderTotals(o); return `<tr><td><a href="#order/${o.id}">${h(o.date)}</a></td><td>${h(s ? s.name : 'Removed store')}</td><td>${h(o.terms)}</td><td>${h(o.step)}</td><td>${t.units}</td><td>${usd(t.placed)}</td><td>${t.owed ? usd(t.owed) : ''}</td></tr>`; }).join('')}</tbody></table></div>` : '<p class="quiet">No orders yet. Start one from a store\'s page.</p>'}`;
}
function vOrder(id) {
  const o = byId('order', id); if (!o) { main.innerHTML = '<p>That order is gone. <a href="#orders">Back to orders</a></p>'; return; }
  const s = byId('store', o.storeId) || { name: 'Removed store' }, cons = o.terms === 'consignment', stockable = D.product.filter(p => p.ready);
  const draw = () => { const t = orderTotals(o), i = ORDER_STEPS.indexOf(o.step), nextStep = ORDER_STEPS[i + 1];
    main.innerHTML = `<p class="noprint"><a href="#store/${o.storeId}">${h(s.name)}</a> · <a href="#orders">All orders</a></p><h1>${cons ? 'Consignment' : 'Order'} for ${h(s.name)}</h1><p class="quiet">${h([s.town, s.st].filter(Boolean).join(', '))} · ${h(o.date)} · ${h(o.step)}</p>${set().legalName ? `<p class="seller">From ${h(set().legalName)}${set().brand ? ` (${h(set().brand)})` : ''}. Make payment to ${h(set().legalName)}.</p>` : ''}
    <div data-own="order" id="oForm" class="noprint"><fieldset>${pick('Terms', 'terms', o.terms, { wholesale: 'Wholesale', consignment: 'Consignment' })} ${field('Deliver by', 'deliverBy', o.deliverBy, { type: 'date' })} ${pick('How it gets there', 'method', o.method, { drive: 'By car, on a run', ship: 'Shipped' })} ${cons ? field('Our share (%)', 'split', o.split ?? 60, { type: 'number' }) + field('Paid so far ($)', 'paid', o.paid, { type: 'number' }) : ''} ${field('Note on the slip', 'note', o.note, { wide: true })}</fieldset></div>
    <div class="scroll"><table class="grid" id="oLines"><thead><tr><th>Piece</th><th>Qty</th><th>${cons ? 'Shelf price' : 'Price each'}</th>${cons ? '<th>Sold</th>' : ''}<th>Line</th><th class="noprint"></th></tr></thead><tbody>
      ${o.lines.map((l, k) => { const p = byId('product', l.productId); return `<tr data-i="${k}"><td>${h(p ? p.name : 'Removed piece')} <span class="quiet">${h(p ? p.sku : '')}</span></td><td><input data-l="qty" type="number" min="0" step="1" value="${h(l.qty)}" aria-label="Quantity"></td><td><input data-l="price" type="number" min="0" step="any" value="${h(l.price)}" aria-label="Price"></td>${cons ? `<td><input data-l="sold" type="number" min="0" step="1" value="${h(l.sold || 0)}" aria-label="Sold"></td>` : ''}<td>${usd(l.qty * l.price)}</td><td class="noprint"><button type="button" class="ghost" data-lrm="${k}">Remove</button></td></tr>`; }).join('')}
      </tbody><tfoot><tr><td>Total</td><td>${t.units}</td><td></td>${cons ? `<td>${t.sold}</td>` : ''}<td>${usd(t.placed)}</td><td class="noprint"></td></tr></tfoot></table></div>
    ${cons ? `<p>Sold so far: ${usd(t.soldValue)}. Our share: ${usd(t.soldValue * (o.split ?? 60) / 100)}. <b>Owed now: ${usd(t.owed) || '$0.00'}</b>. Still on the shelf: ${t.onShelf}.</p>` : `<p><b>${o.step === 'Paid' ? 'Paid.' : 'Total due: ' + (usd(t.placed) || '$0.00')}</b>${s.net > 0 ? ` Payable in ${h(s.net)} days.` : ''}</p>`}
    ${o.note ? `<p>${h(o.note)}</p>` : ''}
    <p class="row noprint"><select id="oAdd" aria-label="Add a piece"><option value="">Add a piece</option>${stockable.map(p => `<option value="${p.id}">${h(p.sku)} ${h(p.name)} (${h(p.stock)} in stock)</option>`).join('')}</select>
      ${nextStep ? `<button type="button" id="oNext">Mark ${nextStep.toLowerCase()}</button>` : ''} <button type="button" class="ghost" id="oPrint">Print the slip</button> <button type="button" class="ghost danger" id="oDrop">Remove order</button></p>
    ${!stockable.length ? '<p class="quiet noprint">Only pieces marked ready can go on an order.</p>' : ''}<p class="quiet noprint">Marking an order delivered takes its pieces out of stock.</p>`;
    bind($('#oForm'), o, (k) => { if (k === 'terms') vOrder(id); });
    $('#oForm').addEventListener('change', (e) => { if (['split', 'paid'].includes(e.target.dataset.k)) draw(); });
    $('#oLines').addEventListener('change', (e) => { const tr = e.target.closest('tr'), k = e.target.dataset.l; if (!tr || !k) return; o.lines[+tr.dataset.i][k] = +e.target.value; put(o); draw(); });
    $('#oLines').addEventListener('click', (e) => { const k = e.target.dataset.lrm; if (k == null) return; o.lines.splice(+k, 1); put(o); draw(); });
    $('#oAdd').onchange = (e) => { const p = byId('product', e.target.value); if (!p) return; o.lines.push({ productId: p.id, qty: Math.max(1, +p.minOrder || 1), price: +(cons ? p.retail : p.wholesale) || 0, sold: 0 }); put(o); draw(); };
    const nx = $('#oNext'); if (nx) nx.onclick = () => { if (nextStep === 'Delivered') { for (const p of deliver(o, D.product)) { Object.assign(byId('product', p.id), p); put(byId('product', p.id), true); } for (const l of o.lines) { const p = byId('product', l.productId); if (p && p.oneOff && +p.stock <= 0 && upOn(p).length) takeDown(p).then(rs => say(rs.every(r => r.ok) ? `${p.name} was taken down online.` : `${p.name} could not be taken down everywhere. Open the piece.`, !rs.every(r => r.ok))); } const st = byId('store', o.storeId); if (st && STAGES.indexOf(st.stage) < STAGES.indexOf('Stocked')) { st.stage = 'Stocked'; put(st, true); } o.delivered = today(); } o.step = nextStep; put(o, true); draw(); };
    $('#oPrint').onclick = () => window.print();
    $('#oDrop').onclick = (e) => { const b = e.target; if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = 'Click again to remove'; return; } drop(o); location.hash = '#orders'; };
  }; draw();
}

// ---- delivery runs
function vRuns() {
  const list = runs(D.order, D.store, D.product);
  main.innerHTML = `<h1>Delivery runs</h1><p class="lead noprint">Every open order that goes by car, grouped by region. One page for each run: the stops in town order, and one packing list for the car.</p>
    ${list.length ? list.map(r => `<section class="run"><h2>${h(r.region)}${r.earliest ? `, first due ${h(r.earliest)}` : ''}</h2>
      <h3>Stops</h3><ol class="stops">${r.stops.map(({ order, store }) => `<li><b>${h(store.name)}</b>, ${h(store.town)}${store.contact ? ' · ask for ' + h(store.contact) : ''}${store.phone ? ' · ' + h(store.phone) : ''}<br>${order.lines.map(l => { const p = byId('product', l.productId); return `${l.qty} × ${h(p ? p.sku + ' ' + p.name : 'Removed piece')}`; }).join('; ') || 'No pieces on the order yet'} <a class="noprint" href="#order/${order.id}">Open order</a></li>`).join('')}</ol>
      <h3>Pack the car: ${r.units} piece${r.units === 1 ? '' : 's'}</h3><ul class="pack">${r.pack.map(x => `<li><span class="box"></span>${x.qty} × ${h(x.sku)} ${h(x.name)}</li>`).join('')}</ul></section>`).join('') + '<p class="row noprint"><button type="button" id="rPrint">Print the runs</button></p>' : '<p class="quiet">No open orders going by car.</p>'}`;
  const b = $('#rPrint'); if (b) b.onclick = () => window.print();
}

// ---- line sheet for stores
function vSheet() {
  const rows = D.product.filter(p => p.ready && +p.wholesale > 0).sort((a, b) => (a.sku || '').localeCompare(b.sku || ''));
  main.innerHTML = `<p class="noprint"><a href="#stores">Stores</a></p><h1>${h(set().brand || 'Granite Coast Supply')}: wholesale line sheet</h1><p class="quiet">Prices for stores, ${h(today())}. Not for the public.${set().publicEmail ? ' Orders: ' + h(set().publicEmail) + '.' : ''}${set().legalName ? ` Sold by ${h(set().legalName)}. Make payment to ${h(set().legalName)}.` : ''}</p>
    ${rows.length ? `<table class="grid line"><thead><tr><th></th><th>Piece</th><th>Wholesale</th><th>Suggested retail</th><th>Case pack</th><th>Minimum</th></tr></thead><tbody>${rows.map(p => `<tr><td>${p.photos[0] ? `<img class="thumb big" src="/img/${p.photos[0]}.jpg" alt="" width="84" height="84">` : ''}</td><td><b>${h(p.name)}</b><br><span class="quiet">${h(p.sku)}${sizeWords(p) ? ' · ' + h(sizeWords(p)) : ''}</span>${p.species.filter(s => s.real !== false && s.scientific).map(s => `<br><i>${h(s.scientific)}</i>${s.origin ? ', ' + h(s.origin) : ''}`).join('')}${p.oneOff ? '<br><span class="quiet">One of a kind</span>' : ''}</td><td>${usd(p.wholesale)}</td><td>${usd(p.retail)}</td><td>${h(p.casePack)}</td><td>${h(p.minOrder)}</td></tr>`).join('')}</tbody></table>
    <p class="row noprint"><button type="button" id="lPrint">Print or save as a PDF</button></p>` : '<p class="quiet">No ready pieces with a wholesale price yet.</p>'}`;
  const b = $('#lPrint'); if (b) b.onclick = () => window.print();
}

// ---- makers and settings
function vMakers() {
  main.innerHTML = `<h1>Makers</h1><p class="lead">Who makes what. One maker today, room for more.</p><div id="mList"></div><p><button type="button" id="mAdd">Add a maker</button></p>`;
  const draw = () => { $('#mList').innerHTML = D.maker.map(m => `<fieldset data-m="${m.id}">${field('Name', 'name', m.name)} ${field('Town', 'town', m.town)} ${field('Contact', 'contact', m.contact)} ${field('What they are paid, and when', 'pay', m.pay)} ${tick('Show the maker\'s name in the public catalog', 'showName', m.showName, { wide: true })} ${field('Notes', 'notes', m.notes, { wide: true, area: true, rows: 2 })}<p class="wide quiet">${D.product.filter(p => p.makerId === m.id).length} pieces. <button type="button" class="ghost danger" data-mrm="${m.id}">Remove</button></p></fieldset>`).join('') || '<p class="quiet">No makers yet.</p>'; };
  draw();
  $('#mList').addEventListener('input', (e) => { const f = e.target.closest('[data-m]'), k = e.target.dataset.k; if (!f || !k) return; const m = byId('maker', f.dataset.m); m[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; put(m); });
  $('#mList').addEventListener('click', (e) => { const id = e.target.dataset.mrm; if (!id) return; drop(byId('maker', id)); draw(); });
  $('#mAdd').onclick = () => { put({ type: 'maker', id: newId('m'), name: '', town: '', contact: '', pay: '', showName: false, notes: '' }, true); draw(); };
}
function vSettings() {
  const s = set(); s.channels = s.channels || {};
  main.innerHTML = `<h1>Settings</h1><div data-own="set" id="setForm"><fieldset><legend>The public catalog</legend>
    ${field('Brand name', 'brand', s.brand)} ${field('Legal name of the seller', 'legalName', s.legalName, { help: 'The company stores pay. Printed on the line sheet and on order slips, never in the public catalog.' })} ${field('Email shown to stores', 'publicEmail', s.publicEmail, { type: 'email', help: 'The catalog shows a contact line only when this is filled in.' })}
    ${field('Opening lines of the catalog', 'publicIntro', s.publicIntro, { wide: true, area: true, help: 'Leave empty to use the standard lines.' })}</fieldset>
    <fieldset><legend>Added to every listing</legend>${field('Care', 'care', s.care, { wide: true, area: true, rows: 2, ph: 'Keep out of direct sun.' })} ${field('Shipping', 'shipNote', s.shipNote, { wide: true, area: true, rows: 2 })}</fieldset></div>
    <div id="chSet">${CHANNELS.filter(c => c.id !== 'other').map(ch => { const c = s.channels[ch.id] || {}, f = (label, k, o = {}) => `<label>${label} <input data-c="${k}" type="${o.type || 'text'}" value="${h(c[k])}" ${o.type === 'number' ? 'step="any" min="0"' : ''}></label>`;
      return `<fieldset data-ch="${ch.id}"><legend>${h(ch.name)}</legend>${f('Your shop link', 'shop', { type: 'url' })} ${f('Fee they take (%)', 'fee', { type: 'number' })}<label>Real specimens <select data-c="real"><option value="">As read on ${h(ch.rule.on)}: ${h(REAL_WORDS[ch.real || 'ask'].toLowerCase())}</option><option value="yes" ${c.real === 'yes' ? 'selected' : ''}>I read its rules: it takes them</option><option value="no" ${c.real === 'no' ? 'selected' : ''}>It does not take them</option></select></label>${ch.id === 'ebay' ? f('Category number', 'category') + f('Item location', 'location') + f('Shipping policy name', 'shipping') + f('Return policy name', 'returns') + f('Payment policy name', 'payment') + '<small class="wide">The category number is in the address of the eBay category page you would list under. The three policy names are under Account, Business policies.</small>' : ''}</fieldset>`; }).join('')}</div>
    <h2>Automatic posting</h2><div id="conn"></div>
    <fieldset class="one"><legend>Keep a copy</legend><p class="quiet">Everything on the desk as one file you save. Photos are not in it.</p><button type="button" id="backup">Download a backup</button></fieldset>`;
  bind($('#setForm'), s);
  $('#chSet').addEventListener('input', (e) => { const f = e.target.closest('[data-ch]'), k = e.target.dataset.c; if (!f || !k) return; (s.channels[f.dataset.ch] = s.channels[f.dataset.ch] || {})[k] = e.target.value; put(s); });
  drawConn();
  $('#backup').onclick = () => download(`granite-coast-supply-${today()}.json`, JSON.stringify({ kind: 'gcs-backup', at: new Date().toISOString(), ...D }, null, 1), 'application/json');
}


// the eBay and Etsy connections: sign in, then choose the shop settings each listing will use
async function drawConn() {
  const s = set(); s.channels = s.channels || {}; const box = $('#conn'); if (!box) return;
  const KEYS = { ebay: 'EBAY_CLIENT_ID, EBAY_CLIENT_SECRET and EBAY_RUNAME', etsy: 'ETSY_KEYSTRING and ETSY_SECRET' };
  const sel = (label, k, list, cur) => `<label>${label} <select data-o="${k}"><option value="">Choose</option>${list.map(x => `<option value="${h(x.id)}" ${String(cur) === String(x.id) ? 'selected' : ''}>${h(x.name)}</option>`).join('')}</select></label>`;
  box.innerHTML = AUTO.map(site => { const m = MK[site] || {}, name = channel(site).name;
    return `<fieldset data-site="${site}" class="conn"><legend>${name}</legend>${!m.keys ? `<p class="wide">Not switched on. The ${name} app keys go in Cloudflare as secrets named ${KEYS[site]}. You enter them yourself. The address ${name} must send you back to is <code>${h(m.back || '')}</code>.</p>`
      : !m.connected ? `<p class="wide">The keys are in. Sign in to ${name} to let the desk post for your shop.</p><p class="wide"><button type="button" data-connect="${site}">Connect ${name}</button></p>`
      : `<p class="wide good">Connected${m.shop ? ' to ' + h(m.shop) : ''}.</p><div class="wide opts" data-opts="${site}"><p class="quiet">Loading your shop settings</p></div><p class="wide"><button type="button" class="ghost danger" data-disconnect="${site}">Disconnect</button></p>`}</fieldset>`; }).join('');
  for (const site of AUTO.filter(live)) { const el = $(`[data-opts="${site}"]`), c = s.channels[site] = s.channels[site] || {}; if (!el) continue;
    try { const o = await api('/market/options/' + site); if (!el.isConnected) return; if (o.shop) { MK[site].shop = o.shop; el.parentElement.querySelector('.good').textContent = 'Connected to ' + o.shop + '.'; }
      el.innerHTML = site === 'ebay' ? `<div class="optgrid">${sel('Shipping policy', 'fulfillmentPolicyId', o.fulfillment, c.fulfillmentPolicyId)}${sel('Payment policy', 'paymentPolicyId', o.payment, c.paymentPolicyId)}${sel('Return policy', 'returnPolicyId', o.returns, c.returnPolicyId)}${sel('Item location', 'merchantLocationKey', o.locations, c.merchantLocationKey)}
          <label class="wide">Item specifics for the category, one to a line <textarea data-o="aspects" rows="3" placeholder="Brand: Unbranded&#10;Type: Butterfly">${h(c.aspects)}</textarea><small>eBay asks for certain specifics in each category and says which are missing if a post is refused. The species is added for you. The category number is set above.</small></label></div>${!o.locations.length ? '<p class="warnline">eBay has no item location for this account yet. Add one in Seller Hub, then come back.</p>' : ''}`
        : `<div class="optgrid">${sel('Shipping profile', 'shippingProfileId', o.shipping, c.shippingProfileId)}${sel('Processing profile', 'readinessStateId', o.readiness, c.readinessStateId)}${sel('Return policy (optional)', 'returnPolicyId', o.returns, c.returnPolicyId)}
          ${pick('Who made it', 'whoMade', c.whoMade || 'i_did', { i_did: 'I did', collective: 'A member of my shop', someone_else: 'Another company or person' }).replace('data-k=', 'data-o=')}
          <label>When it was made <input data-o="whenMade" value="${h(c.whenMade || 'made_to_order')}"><small>Etsy's own code, such as made_to_order or a range like 2020_2026.</small></label>
          <label class="wide">Category <span class="row"><input id="taxQ" placeholder="Search Etsy categories, for example taxidermy" aria-label="Search Etsy categories"><button type="button" class="ghost" id="taxGo">Search</button></span><select data-o="taxonomyId" id="taxSel">${c.taxonomyId ? `<option value="${h(c.taxonomyId)}" selected>${h(c.taxonomyName || 'Category ' + c.taxonomyId)}</option>` : '<option value="">Search, then choose</option>'}</select></label>
          <label class="tick wide"><input type="checkbox" data-o="live" ${c.live ? 'checked' : ''}> <span>Go live at once. Etsy charges its listing fee for each listing that goes live. Left off, listings are saved as drafts and you publish them on Etsy.</span></label></div>`;
    } catch (e) { if (el.isConnected) el.innerHTML = `<p class="warnline">${h(e.message)}</p>`; } }
  box.oninput = box.onchange = (e) => { const f = e.target.closest('[data-site]'), k = e.target.dataset.o; if (!f || !k) return; const c = s.channels[f.dataset.site] = s.channels[f.dataset.site] || {}; c[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; if (k === 'taxonomyId') c.taxonomyName = e.target.selectedOptions[0] ? e.target.selectedOptions[0].textContent : ''; put(s); };
  box.onclick = async (e) => { const t = e.target;
    if (t.dataset.connect) { t.disabled = true; try { const r = await api('/market/connect/' + t.dataset.connect, { method: 'POST' }); location.href = r.url; } catch (x) { say(x.message, true); t.disabled = false; } }
    if (t.dataset.disconnect) { if (!t.dataset.sure) { t.dataset.sure = 1; t.textContent = 'Click again to disconnect'; return; } await api('/market/disconnect/' + t.dataset.disconnect, { method: 'POST' }).catch(() => {}); MK = await api('/market/status').catch(() => MK); drawConn(); }
    if (t.id === 'taxGo') { try { const r = await api('/market/options/etsy?q=' + encodeURIComponent($('#taxQ').value)); $('#taxSel').innerHTML = '<option value="">Choose</option>' + r.categories.map(x => `<option value="${h(x.id)}">${h(x.name)}</option>`).join(''); if (!r.categories.length) say('No Etsy category matches that.', true); } catch (x) { say(x.message, true); } } };
}

// ---- routing
const ROUTES = { today: vToday, pieces: vPieces, piece: vPiece, post: vPost, stores: vStores, store: vStore, orders: vOrders, order: vOrder, runs: vRuns, sheet: vSheet, makers: vMakers, settings: vSettings };
function route() {
  const [name, arg] = (location.hash.slice(1) || 'today').split('/'), fn = ROUTES[name] || vToday; main.onclick = null;
  $$('nav a').forEach(a => a.toggleAttribute('aria-current', a.getAttribute('href') === '#' + ({ piece: 'pieces', store: 'stores', order: 'orders', runs: 'orders', sheet: 'stores' }[name] || name)));
  fn(arg); window.scrollTo(0, 0); main.focus({ preventScroll: true });
}
(async () => {
  try {
    const j = await api('/all'); for (const o of j.objects) { if (o.type === 'settings') Object.assign(D.settings, o); else if (D[o.type]) D[o.type].push(o); }
    MK = await api('/market/status').catch(() => MK);
    const back = new URLSearchParams(location.search).get('connect'); if (back) history.replaceState(null, '', location.pathname + location.hash);
    $('#me').textContent = j.me; say(back || '', /did not|refused|tripped/.test(back || '')); window.addEventListener('hashchange', route); route(); window.__desk = { D, MK: () => MK };
  } catch (e) { main.innerHTML = `<h1>The desk did not load</h1><p>${h(e.message)}</p>`; }
})();
