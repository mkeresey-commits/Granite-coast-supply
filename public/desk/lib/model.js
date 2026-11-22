// The record layer: makers, products, stores and orders as plain objects that link to each other by id.
// Plain logic. No page, no network. Everything here is tested in tools/smoke.mjs.

export const TYPES = ['maker', 'product', 'store', 'order', 'settings'];

export const KINDS = {
  dome: 'Glass dome',
  cloche: 'Cloche',
  frame: 'Framed mount',
  shadowbox: 'Shadow box',
  jar: 'Specimen jar',
  other: 'Other piece',
};

// where a specimen came from, in the words a shop or a marketplace will ask for
export const SOURCES = {
  '': 'Not recorded',
  farmed: 'Farm raised',
  ranched: 'Ranched',
  natural: 'Collected after natural death',
  vintage: 'Vintage collection',
  wild: 'Wild collected',
};

export const STAGES = ['Lead', 'Contacted', 'Samples or visit', 'Terms agreed', 'Stocked', 'Reordering', 'Not a fit'];
export const REGIONS = ['Bangor area', 'Downeast and Acadia', 'Midcoast', 'Portland area', 'Central and western', 'Aroostook', 'Out of state'];
export const ORDER_STEPS = ['Draft', 'Packed', 'Delivered', 'Paid'];

const n = (v) => { const x = +v; return isFinite(x) ? x : 0; };
export const newId = (p = 'x') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const today = () => new Date().toLocaleDateString('en-CA');

export function blankProduct(sku) {
  return { type: 'product', id: newId('p'), sku, makerId: '', name: '', kind: 'dome', blurb: '', materials: '', h: '', w: '', d: '', oz: '', species: [], cost: '', wholesale: '', retail: '', casePack: 1, minOrder: 1, stock: 1, oneOff: true, photos: [], tags: '', ready: false, public: false, channels: {} };
}
export const blankSpecies = () => ({ common: '', scientific: '', origin: '', source: '', supplier: '', paper: '', cites: 'none', esa: false, real: true, madeOf: '' });
export const blankStore = () => ({ type: 'store', id: newId('s'), name: '', town: '', st: 'ME', region: REGIONS[0], kind: '', contact: '', phone: '', email: '', site: '', stage: 'Lead', terms: 'wholesale', split: 60, net: 0, next: '', due: '', notes: [] });
export const blankOrder = (storeId, terms = 'wholesale') => ({ type: 'order', id: newId('o'), storeId, terms, date: today(), deliverBy: '', method: 'drive', step: 'Draft', lines: [], note: '' });

// the next stock number: GCS-0001, GCS-0002
export function nextSku(products, prefix = 'GCS') {
  const max = products.reduce((m, p) => { const x = new RegExp('^' + prefix + '-(\\d+)$').exec(p.sku || ''); return x ? Math.max(m, +x[1]) : m; }, 0);
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

// the money on one piece. Keystone (retail at twice wholesale) is a rule of thumb, and says so where it shows.
export function money(p) {
  const cost = n(p.cost), wholesale = n(p.wholesale), retail = n(p.retail);
  return {
    cost, wholesale, retail,
    marginWholesale: wholesale ? wholesale - cost : null, marginWholesalePct: wholesale ? (wholesale - cost) / wholesale : null,
    marginRetail: retail ? retail - cost : null, markup: wholesale ? retail / wholesale : null,
    keystone: wholesale && retail ? retail / wholesale >= 2 : null,
  };
}
// what is left of a retail sale on a marketplace after its fee, when the fee percent is filled in under Settings
export const afterFee = (price, feePct) => n(price) * (1 - n(feePct) / 100);

export const sizeWords = (p) => { const s = [p.h && `${p.h} in high`, p.w && `${p.w} in wide`, p.d && `${p.d} in deep`].filter(Boolean); return s.join(', '); };
export const realSpecies = (p) => (p.species || []).filter(s => s.real !== false);
// the made ones: paper, silk, resin. They need no species papers, but the listing must say what they are.
export const madeSpecies = (p) => (p.species || []).filter(s => s.real === false);
// two lanes: a piece with any real specimen, and a piece with none
export const lane = (p) => realSpecies(p).length ? 'real' : 'free';
export const LANES = { real: 'Real specimen', free: 'No real specimen' };
// the other version of the same design, if there is one, in either direction
export const twinsOf = (p, products) => products.filter(x => x.id !== p.id && (x.id === p.twinId || x.twinId === p.id));
// a specimen-free copy of a piece: same design and words, its own stock number, no photos (they must show the real thing sold)
export function freeCopy(p, sku) {
  return { ...blankProduct(sku), makerId: p.makerId, name: p.name, kind: p.kind, blurb: p.blurb, materials: p.materials, h: p.h, w: p.w, d: p.d, oz: p.oz, tags: p.tags, oneOff: false, stock: 0, twinId: p.id,
    species: (p.species || []).map(x => ({ ...blankSpecies(), common: x.common, real: false, madeOf: x.real === false ? x.madeOf || '' : '' })) };
}

// can this piece be offered at all. A blocker stops it being marked ready; a warning does not.
export function checkProduct(p) {
  const blockers = [], warnings = [];
  if (!String(p.name || '').trim()) blockers.push('Give it a name.');
  if (!(p.photos || []).length) blockers.push('Add at least one photo.');
  if (!n(p.retail) && !n(p.wholesale)) blockers.push('Set a retail or a wholesale price.');
  for (const s of realSpecies(p)) {
    const label = s.common || s.scientific || 'A specimen';
    if (!String(s.scientific || '').trim()) blockers.push(`${label}: add the scientific name. Every marketplace and every shop will ask.`);
    if (s.esa) blockers.push(`${label}: marked as listed under the Endangered Species Act. It cannot be sold here.`);
    if (s.cites === 'I') blockers.push(`${label}: CITES Appendix I. It cannot be sold here.`);
    if (s.cites === 'II') warnings.push(`${label}: CITES Appendix II. Sell inside the United States only, and keep the permit copy with the piece.`);
    if (s.cites === 'unknown') warnings.push(`${label}: CITES status not looked up yet.`);
    if (!String(s.origin || '').trim()) warnings.push(`${label}: country of origin is missing.`);
    if (!s.source) warnings.push(`${label}: how it was sourced is not recorded.`);
    if (s.source === 'wild') warnings.push(`${label}: wild collected. Some shops and marketplaces will not take it.`);
    if (!String(s.paper || '').trim()) warnings.push(`${label}: no supplier paper on file.`);
  }
  for (const s of madeSpecies(p)) if (!String(s.madeOf || '').trim()) warnings.push(`${s.common || 'A made specimen'}: say what it is made of, so the listing can.`);
  if (n(p.wholesale) && n(p.cost) && n(p.wholesale) <= n(p.cost)) warnings.push('The wholesale price does not cover the cost.');
  return { ok: !blockers.length, blockers, warnings };
}

// ---- stores
// a store is an account only when product is on its shelf. Everything before that is a lead.
export const isAccount = (s) => ['Stocked', 'Reordering'].includes(s.stage);
export function storeNote(store, text, by = '') { return { ...store, notes: [{ on: today(), text: String(text).trim(), by }, ...(store.notes || [])].slice(0, 100) }; }

// ---- orders
export const lineTotal = (l) => n(l.qty) * n(l.price);
export function orderTotals(o) {
  const placed = o.lines.reduce((s, l) => s + lineTotal(l), 0), units = o.lines.reduce((s, l) => s + n(l.qty), 0);
  if (o.terms !== 'consignment') return { units, placed, owed: o.step === 'Paid' ? 0 : o.step === 'Delivered' ? placed : 0, sold: null };
  // consignment: the store owes its share only on what has sold. split is the percent that comes back to us.
  const soldUnits = o.lines.reduce((s, l) => s + Math.min(n(l.qty), n(l.sold)), 0), soldValue = o.lines.reduce((s, l) => s + Math.min(n(l.qty), n(l.sold)) * n(l.price), 0);
  const ours = soldValue * n(o.split ?? 60) / 100, paid = n(o.paid);
  return { units, placed, sold: soldUnits, soldValue, owed: Math.max(0, ours - paid), onShelf: units - soldUnits };
}
// taking an order from Packed to Delivered takes the pieces out of stock. Returns the changed products.
export function deliver(order, products) {
  const byId = Object.fromEntries(products.map(p => [p.id, p]));
  return order.lines.filter(l => byId[l.productId]).map(l => { const p = byId[l.productId]; return { ...p, stock: Math.max(0, n(p.stock) - n(l.qty)) }; });
}

// a delivery run: every open order that goes by car, grouped by region then town, with one packing list for the trunk
export function runs(orders, stores, products) {
  const S = Object.fromEntries(stores.map(s => [s.id, s])), P = Object.fromEntries(products.map(p => [p.id, p]));
  const open = orders.filter(o => ['Draft', 'Packed'].includes(o.step) && o.method !== 'ship' && S[o.storeId]);
  const by = {};
  for (const o of open) { const s = S[o.storeId]; (by[s.region || 'No region'] = by[s.region || 'No region'] || []).push({ order: o, store: s }); }
  return Object.entries(by).map(([region, stops]) => {
    stops.sort((a, b) => (a.store.town || '').localeCompare(b.store.town || '') || a.store.name.localeCompare(b.store.name));
    const pack = {};
    for (const { order } of stops) for (const l of order.lines) { const p = P[l.productId]; const k = l.productId; pack[k] = pack[k] || { sku: p ? p.sku : '', name: p ? p.name : 'Removed piece', qty: 0 }; pack[k].qty += n(l.qty); }
    return { region, stops, pack: Object.values(pack).sort((a, b) => a.sku.localeCompare(b.sku)), units: Object.values(pack).reduce((s, x) => s + x.qty, 0), earliest: stops.map(x => x.order.deliverBy).filter(Boolean).sort()[0] || '' };
  }).sort((a, b) => (a.earliest || '9').localeCompare(b.earliest || '9'));
}

// ---- what needs doing today, in order
export function todayList({ products = [], stores = [], orders = [] }, channels = [], day = today()) {
  const out = [], S = Object.fromEntries(stores.map(s => [s.id, s]));
  // a one-off that is gone but still shows as listed somewhere is the costliest mistake: someone can buy what you do not have
  for (const p of products) if (p.oneOff && n(p.stock) <= 0) { const live = Object.entries(p.channels || {}).filter(([, c]) => c.status === 'listed'); if (live.length) out.push({ rank: 0, kind: 'takedown', id: p.id, text: `Take down ${p.name || p.sku}: it is gone but still listed on ${live.map(([id]) => (channels.find(c => c.id === id) || { name: id }).name).join(', ')}.` }); }
  for (const s of stores) if (s.due && s.due <= day && s.stage !== 'Not a fit') out.push({ rank: s.due < day ? 1 : 2, kind: 'store', id: s.id, text: `${s.name}${s.town ? ', ' + s.town : ''}: ${s.next || 'follow up'}${s.due < day ? ` (due ${s.due})` : ''}.` });
  for (const o of orders) if (['Draft', 'Packed'].includes(o.step) && o.deliverBy && o.deliverBy <= day && S[o.storeId]) out.push({ rank: 1, kind: 'order', id: o.id, text: `Deliver to ${S[o.storeId].name}: due ${o.deliverBy}.` });
  for (const o of orders) if (o.step === 'Delivered' && S[o.storeId]) { const t = orderTotals(o); if (t.owed > 0) out.push({ rank: 3, kind: 'order', id: o.id, text: `${S[o.storeId].name} owes $${t.owed.toFixed(2)}${o.terms === 'consignment' ? ' on consignment sales' : ''}.` }); }
  const unposted = products.filter(p => p.ready && n(p.stock) > 0 && !Object.values(p.channels || {}).some(c => c.status === 'listed'));
  if (unposted.length) out.push({ rank: 4, kind: 'post', text: `${unposted.length} ready piece${unposted.length > 1 ? 's are' : ' is'} not listed anywhere yet.` });
  const drafts = products.filter(p => !p.ready).length; if (drafts) out.push({ rank: 5, kind: 'products', text: `${drafts} piece${drafts > 1 ? 's are' : ' is'} still a draft.` });
  return out.sort((a, b) => a.rank - b.rank);
}

// only what a stranger may see. Costs, wholesale prices, suppliers, papers and stock never leave the desk.
export function publicProduct(p, makers = []) {
  const m = makers.find(x => x.id === p.makerId);
  return { id: p.id, name: p.name, kind: KINDS[p.kind] || KINDS.other, blurb: p.blurb || '', materials: p.materials || '', size: sizeWords(p), oneOff: !!p.oneOff, photos: (p.photos || []).slice(0, 8),
    real: realSpecies(p).length > 0, made: madeSpecies(p).map(s => ({ common: s.common || '', madeOf: s.madeOf || '' })),
    species: realSpecies(p).map(s => ({ common: s.common || '', scientific: s.scientific || '', origin: s.origin || '', source: s.source && s.source !== 'wild' ? SOURCES[s.source] : '' })), maker: m && m.showName ? m.name : '' };
}
export const isPublic = (p) => !!(p.ready && p.public && checkProduct(p).ok);
