// The places a piece can be posted, and what each one needs. One master record goes in; each channel gets its own
// title, description, tags and file, cut to that channel's limits. Plain logic, tested in tools/smoke.mjs.
// Rules for real specimens were read from each marketplace's own policy page on the date shown. Rules change:
// the page links the source so it can be read again before a first listing.
import { KINDS, SOURCES, sizeWords, realSpecies, madeSpecies, checkProduct } from './model.js';

const CHECKED = '2026-11-21';
export const CHANNELS = [
  { id: 'etsy', real: 'yes', name: 'Etsy', lane: 'Shoppers', how: 'paste', title: 140, tags: 13, tagLen: 20, materials: 13,
    rule: { state: 'conditions', text: 'Etsy bans anything made from species listed under the Endangered Species Act or CITES Appendix I. Its rules page does not mention insects, so other species are not banned by name.', src: 'https://www.etsy.com/legal/prohibited', on: CHECKED },
    steps: ['Etsy has no file upload for new listings, so each piece is pasted in once.', 'Open Shop Manager, Listings, Add a listing.', 'Copy each field below into the matching box, add the photos, and publish.', 'Paste the listing link back here so the piece shows as listed.'] },
  { id: 'ebay', real: 'yes', name: 'eBay', lane: 'Shoppers', how: 'file', title: 80,
    rule: { state: 'conditions', text: 'eBay allows items from animals that are not endangered or threatened, and the listing must name the species. CITES Appendix II species cannot be offered with international shipping. It notes that many butterflies used in display mounts are CITES species.', src: 'https://www.ebay.com/help/policies/prohibited-restricted-items/animal-products-policy?id=5046', on: CHECKED },
    steps: ['Fill in the eBay category number and your three business policy names under Settings first.', 'Download the file below.', 'In Seller Hub open Reports, Uploads, and upload it.', 'Upload one piece the first time and read the result file eBay sends back before sending the rest.'] },
  { id: 'faire', real: 'yes', name: 'Faire', lane: 'Stores', how: 'file',
    rule: { state: 'conditions', text: 'Faire permits leather and other materials from animals that are not endangered. It does not take fine art or used goods, so one of a kind pieces may be turned down. It wants a wholesale price, a retail price, a case quantity and a minimum order for every product.', src: 'https://www.faire.com/support/articles/360015893192', on: CHECKED },
    steps: ['Faire takes a catalog file in any clear layout and its team maps the columns.', 'Download the file below and upload it on the Products page, or in the sign-up form if the shop is new.', 'Photos load from the links in the file.'] },
  { id: 'shopify', real: 'yes', name: 'Shopify-format file', lane: 'Your own store', how: 'file',
    rule: { state: 'yours', text: 'Your own store, your own rules. This is the standard product file Shopify reads, and many other tools accept the same layout.', src: 'https://help.shopify.com/en/manual/products/import-export/using-csv', on: CHECKED },
    steps: ['Use this if you open your own store, or for any site that says it imports a Shopify product file.', 'Products arrive as drafts so nothing goes live by accident.'] },
  { id: 'meta', real: 'ask', name: 'Facebook Marketplace and Instagram', lane: 'Shoppers', how: 'paste', title: 99,
    rule: { state: 'unchecked', text: 'Not confirmed. Meta restricts animal products and its policy page did not load when checked. Read its commerce rules before listing a real specimen.', src: 'https://transparency.meta.com/policies/ad-standards/restricted-goods-services/live-endangered-nonendangered-animals/', on: CHECKED },
    steps: ['Paste each field into a new Marketplace listing.'] },
  { id: 'tiktok', real: 'ask', name: 'TikTok Shop', lane: 'Shoppers', how: 'paste',
    rule: { state: 'unchecked', text: 'Not confirmed. TikTok\'s advertising policy bars promoting animal parts, but it does not name insects, and its separate Shop product rules were not read.', src: 'https://ads.tiktok.com/help/article/tiktok-ads-policy-animals-and-environment', on: CHECKED },
    steps: ['Paste each field into a new product in Seller Center.'] },
  { id: 'amazon', real: 'ask', name: 'Amazon Handmade', lane: 'Shoppers', how: 'paste', title: 200,
    rule: { state: 'unchecked', text: 'Not confirmed. Mounted butterflies are listed for sale on Amazon. Its policy page for animal products did not load when checked, so the exact rule was not read. Handmade also needs an approved application.', src: 'https://sellercentral.amazon.com/gp/help/external/200164370', on: CHECKED },
    steps: ['Paste each field into a new Handmade listing.'] },
  { id: 'michaels', real: 'ask', name: 'Michaels MakerPlace', lane: 'Shoppers', how: 'paste',
    rule: { state: 'unchecked', text: 'Not confirmed. Its product policy does not mention animal products. It removes items it judges are not meant for arts, crafts and creativity.', src: 'https://www.michaels.com/product-policy', on: CHECKED },
    steps: ['Paste each field into a new MakerPlace listing.'] },
  { id: 'resale', real: 'ask', name: 'Vinted, Depop, Poshmark, Mercari', lane: 'Shoppers', how: 'paste',
    rule: { state: 'unchecked', text: 'Not read. These are resale apps with no posting access for ordinary sellers, so they stay copy and paste.', src: '', on: CHECKED },
    steps: ['Paste each field into a new listing in the app.'] },
  { id: 'other', real: 'ask', name: 'Any other site', lane: 'Shoppers', how: 'paste',
    rule: { state: 'unchecked', text: 'Read the site\'s rules on animal products before listing a real specimen. If a site is worth adding here with its own limits, say so and it gets its own row.', src: '', on: CHECKED },
    steps: ['A plain listing with no length limits. Copy what the site asks for.'] },
];
export const channel = (id) => CHANNELS.find(c => c.id === id);

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
// cut to a limit on a word, never mid-word
export function fit(s, max) { s = clean(s); if (!max || s.length <= max) return s; const cut = s.slice(0, max + 1), at = cut.lastIndexOf(' '); return (at > max * 0.5 ? cut.slice(0, at) : s.slice(0, max)).replace(/[\s,;:-]+$/, ''); }

export function titleFor(p, ch) {
  const sp = realSpecies(p), first = sp[0], kind = (KINDS[p.kind] || '').toLowerCase();
  const parts = [clean(p.name)];
  if (first && first.common && !new RegExp(first.common, 'i').test(p.name)) parts.push(first.common);
  if (kind && !kind.split(' ').some(w => w.length > 3 && new RegExp(w.slice(0, 5), 'i').test(p.name))) parts.push(kind);
  if (first && first.scientific && (!ch.title || ch.title >= 120)) parts.push(first.scientific);
  let t = parts[0]; for (const x of parts.slice(1)) { const nxt = t + ', ' + x; if (!ch.title || nxt.length <= ch.title) t = nxt; }
  return fit(t, ch.title);
}

// the description says only what is on the record. Nothing about sourcing is claimed unless it was entered.
export function descriptionFor(p, set = {}) {
  const sp = realSpecies(p), lines = [clean(p.blurb)], d = [];
  if (sizeWords(p)) d.push('Size: ' + sizeWords(p) + '.');
  if (clean(p.materials)) d.push('Materials: ' + clean(p.materials) + '.');
  for (const s of sp) { const bits = [s.common && s.scientific ? `${s.common} (${s.scientific})` : s.common || s.scientific, s.origin && 'from ' + s.origin, s.source && s.source !== 'wild' && SOURCES[s.source].toLowerCase()].filter(Boolean); if (bits.length) d.push('Specimen: ' + bits.join(', ') + '.'); }
  for (const m of madeSpecies(p)) d.push(`${m.common || 'The specimen'}${m.madeOf ? ' made of ' + clean(m.madeOf) : ''}: made by hand, not a real specimen.`);
  if (!sp.length && (p.species || []).length) d.push('No real insect or animal is used in this piece.');
  if (sp.length) d.push('This is a real specimen. No two are identical, so markings will differ slightly from the photos.');
  if (p.oneOff) d.push('One of a kind.');
  if (clean(set.care)) d.push(clean(set.care));
  if (clean(set.shipNote)) d.push(clean(set.shipNote));
  return [...lines.filter(Boolean), d.join('\n')].filter(Boolean).join('\n\n');
}

export function tagsFor(p, ch) {
  const sp = realSpecies(p), seen = new Set(), out = [];
  const raw = [...String(p.tags || '').split(','), ...sp.map(s => s.common), (KINDS[p.kind] || ''), ...(sp.length ? ['real specimen', 'entomology', 'natural history'] : madeSpecies(p).length ? ['faux specimen', 'no real insects', ...madeSpecies(p).map(m => m.common)] : []), 'oddities', 'curiosity cabinet', 'oddity decor', 'gothic decor', 'gift for collector'];
  for (let t of raw) { t = clean(t).toLowerCase(); if (!t || (ch.tagLen && t.length > ch.tagLen) || seen.has(t)) continue; seen.add(t); out.push(t); if (ch.tags && out.length >= ch.tags) break; }
  return out;
}

// does this site take real specimens: 'yes', 'ask' (rules not confirmed: allowed, with a warning) or 'no'.
// Nothing is held back on a guess. A site is 'no' only when the owner sets it under Settings.
export const takesReal = (ch, set = {}) => ((set.channels || {})[ch.id] || {}).real || ch.real || 'ask';
export const REAL_WORDS = { yes: 'Takes real specimens', no: 'No real specimens: you set this', ask: 'Rules not confirmed: posts with a warning' };

// can this piece go on this channel
export function eligible(p, ch, set = {}) {
  const base = checkProduct(p), blockers = [...base.blockers], warnings = [...base.warnings], cs = (set.channels || {})[ch.id] || {};
  if (!p.ready) blockers.push('Mark the piece ready first.');
  if (+p.stock <= 0) blockers.push('None in stock.');
  if (ch.id === 'faire') {
    if (!+p.wholesale) blockers.push('Faire needs a wholesale price.'); if (!+p.retail) blockers.push('Faire needs a retail price.');
    if (p.oneOff) warnings.push('One of a kind. Faire wants products a store can reorder, so it may turn this down.');
  } else if (ch.lane !== 'Stores' && !+p.retail) blockers.push('Set a retail price.');
  if (ch.id === 'ebay') { if (!cs.category) blockers.push('Set the eBay category number under Settings.'); if (realSpecies(p).some(s => s.cites === 'II')) warnings.push('CITES Appendix II: offer United States shipping only on eBay.'); }
  if (realSpecies(p).length) { const t = takesReal(ch, set);
    if (t === 'no') blockers.push(`${ch.name} does not take real specimens. Offer the version with no real specimen there.`);
    else if (t === 'ask') warnings.push('This site\'s rules for real specimens are not confirmed. Read them first.'); }
  return { ok: !blockers.length, blockers, warnings };
}

// everything one listing needs, already cut to the channel's limits
export function listing(p, ch, set = {}, origin = '') {
  return { sku: p.sku, title: titleFor(p, ch), description: descriptionFor(p, set), tags: tagsFor(p, ch), materials: clean(p.materials).split(',').map(clean).filter(Boolean).slice(0, ch.materials || 99),
    price: ch.lane === 'Stores' ? +p.wholesale || 0 : +p.retail || 0, quantity: Math.max(0, +p.stock || 0), photos: (p.photos || []).map(id => `${origin}/img/${id}.jpg`), weightOz: +p.oz || 0 };
}

// ---- files
const cell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export const csv = (rows) => rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
const html = (text) => String(text).split(/\n\n+/).map(par => '<p>' + par.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>') + '</p>').join('');

export function fileFor(chId, products, set = {}, origin = '') {
  const ch = channel(chId), cs = (set.channels || {})[chId] || {}, L = (p) => listing(p, ch, set, origin);
  if (chId === 'ebay') {
    const head = ['*Action(SiteID=US|Country=US|Currency=USD|Version=1193)', 'CustomLabel', '*Category', '*Title', '*ConditionID', 'PicURL', '*Description', '*Format', '*Duration', '*StartPrice', '*Quantity', '*Location', 'ShippingProfileName', 'ReturnProfileName', 'PaymentProfileName'];
    return { name: 'ebay-upload.csv', text: csv([head, ...products.map(p => { const l = L(p); return ['Add', l.sku, cs.category || '', l.title, 1000, l.photos.join('|'), html(l.description), 'FixedPrice', 'GTC', l.price.toFixed(2), l.quantity, cs.location || '', cs.shipping || '', cs.returns || '', cs.payment || '']; })]) };
  }
  if (chId === 'faire') {
    const head = ['Product Name', 'SKU', 'Description', 'Wholesale Price', 'Retail Price', 'Case Quantity', 'Minimum Order Quantity', 'Materials', 'Dimensions', 'Weight (oz)', 'Image URLs'];
    return { name: 'faire-catalog.csv', text: csv([head, ...products.map(p => { const l = L(p); return [l.title, l.sku, l.description, (+p.wholesale || 0).toFixed(2), (+p.retail || 0).toFixed(2), +p.casePack || 1, +p.minOrder || 1, l.materials.join(', '), sizeWords(p), l.weightOz || '', l.photos.join(' ')]; })]) };
  }
  if (chId === 'shopify') {
    const head = ['Handle', 'Title', 'Body (HTML)', 'Vendor', 'Type', 'Tags', 'Published', 'Option1 Name', 'Option1 Value', 'Variant SKU', 'Variant Grams', 'Variant Inventory Tracker', 'Variant Inventory Qty', 'Variant Inventory Policy', 'Variant Fulfillment Service', 'Variant Price', 'Variant Requires Shipping', 'Variant Taxable', 'Image Src', 'Image Position', 'Status'];
    const rows = [head];
    for (const p of products) { const l = L(p), handle = (l.sku + '-' + clean(p.name)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      rows.push([handle, l.title, html(l.description), set.brand || 'Granite Coast Supply', KINDS[p.kind] || '', l.tags.join(', '), 'FALSE', 'Title', 'Default Title', l.sku, Math.round(l.weightOz * 28.3495), 'shopify', l.quantity, 'deny', 'manual', l.price.toFixed(2), 'TRUE', 'TRUE', l.photos[0] || '', l.photos[0] ? 1 : '', 'draft']);
      l.photos.slice(1).forEach((u, i) => rows.push([handle, ...Array(17).fill(''), u, i + 2, ''])); }
    return { name: 'shopify-products.csv', text: csv(rows) };
  }
  // everything, for a spreadsheet or a site not listed here
  const head = ['SKU', 'Name', 'Kind', 'Description', 'Retail', 'Wholesale', 'Stock', 'Size', 'Weight (oz)', 'Materials', 'Species', 'Tags', 'Photos'];
  return { name: 'all-pieces.csv', text: csv([head, ...products.map(p => { const l = listing(p, channel('other'), set, origin); return [p.sku, p.name, KINDS[p.kind] || '', l.description, p.retail, p.wholesale, p.stock, sizeWords(p), p.oz, p.materials, realSpecies(p).map(s => s.scientific).join('; '), l.tags.join(', '), l.photos.join(' ')]; })]) };
}

// where each piece stands on each channel
export const statusOf = (p, chId) => ((p.channels || {})[chId] || {}).status || 'none';
export function toPost(products, chId, set = {}) { const ch = channel(chId); return products.filter(p => statusOf(p, chId) !== 'listed' && eligible(p, ch, set).ok); }
