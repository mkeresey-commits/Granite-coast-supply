// Smoke suite: the record layer and the channel logic, with made-up pieces. No network. Run before calling any change done.
import * as M from '../public/desk/lib/model.js';
import * as C from '../public/desk/lib/channels.js';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const DASH = String.fromCharCode(8212);
let pass = 0, fail = 0; const ok = (c, name) => { if (c) pass++; else { fail++; console.log('FAIL ' + name); } };

const good = { ...M.blankProduct('GCS-0001'), name: 'Blue morpho under glass', kind: 'dome', blurb: 'A single blue morpho set over moss in a hand-blown dome.', materials: 'glass, walnut, moss', h: 9, w: 5, d: 5, oz: 40, cost: 22, wholesale: 48, retail: 98, stock: 1, photos: ['aaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbb'], tags: 'blue morpho, butterfly dome',
  species: [{ ...M.blankSpecies(), common: 'Blue morpho', scientific: 'Morpho menelaus', origin: 'Peru', source: 'farmed', supplier: 'Made-up Supply Co', paper: 'Invoice 1', cites: 'none' }], ready: true, public: true };

// ---- the piece
ok(M.checkProduct(good).ok && M.checkProduct(good).warnings.length === 0, 'a complete piece has nothing against it');
ok(!M.checkProduct({ ...good, photos: [] }).ok && !M.checkProduct({ ...good, name: '' }).ok && !M.checkProduct({ ...good, retail: '', wholesale: '' }).ok, 'no photo, no name or no price each stop a piece');
ok(!M.checkProduct({ ...good, species: [{ ...good.species[0], scientific: '' }] }).ok, 'a real specimen with no scientific name stops the piece');
ok(!M.checkProduct({ ...good, species: [{ ...good.species[0], cites: 'I' }] }).ok && !M.checkProduct({ ...good, species: [{ ...good.species[0], esa: true }] }).ok, 'CITES Appendix I and Endangered Species Act species can never be marked sellable');
const w2 = M.checkProduct({ ...good, species: [{ ...good.species[0], cites: 'II', paper: '', origin: '' }] });
ok(w2.ok && w2.warnings.some(x => /Appendix II/.test(x)) && w2.warnings.some(x => /no supplier paper/.test(x)) && w2.warnings.some(x => /country of origin/.test(x)), 'Appendix II, a missing paper and a missing origin warn but do not stop');
ok(M.checkProduct({ ...good, species: [{ ...good.species[0], real: false, scientific: '' }] }).ok, 'a paper or silk butterfly needs no species name');
ok(M.nextSku([]) === 'GCS-0001' && M.nextSku([{ sku: 'GCS-0009' }, { sku: 'GCS-0003' }, { sku: 'odd' }]) === 'GCS-0010', 'stock numbers count up');
const mo = M.money(good); ok(mo.marginWholesale === 26 && Math.abs(mo.marginWholesalePct - 26 / 48) < 1e-9 && mo.keystone === true && M.money({ ...good, retail: 80 }).keystone === false && M.afterFee(100, 6.5) === 93.5, 'the money on a piece: margin, the two-times rule of thumb, and what a fee leaves');

// ---- nothing private leaves the desk
const pub = M.publicProduct(good, []), flat = JSON.stringify(pub);
ok(M.isPublic(good) && !M.isPublic({ ...good, ready: false }) && !M.isPublic({ ...good, public: false }) && !M.isPublic({ ...good, species: [{ ...good.species[0], cites: 'I' }] }), 'only ready, published, clean pieces are public');
ok(!/cost|wholesale|retail|supplier|Made-up Supply|Invoice|stock|"98"|48|22/.test(flat) && pub.species[0].scientific === 'Morpho menelaus' && pub.size === '9 in high, 5 in wide, 5 in deep', 'the public record carries no price, cost, stock, supplier or paper');
ok(M.publicProduct(good, [{ id: 'm1', name: 'A Maker', showName: false }]).maker === '' && M.publicProduct({ ...good, makerId: 'm1' }, [{ id: 'm1', name: 'A Maker', showName: true }]).maker === 'A Maker', 'a maker is named in public only when that is switched on');

// ---- channels
const etsy = C.channel('etsy'), ebay = C.channel('ebay'), faire = C.channel('faire'), set = { channels: { ebay: { category: '12345', shipping: 'Ship A', returns: 'Ret A', payment: 'Pay A' } } };
ok(C.CHANNELS.every(c => c.rule && c.rule.text && c.rule.on && (c.rule.src || c.id === 'other') && c.steps.length), 'every channel states its rule for specimens, with a source and the date it was read');
const long = { ...good, name: 'An extraordinarily long name for a blue morpho butterfly specimen mounted beneath a hand-blown glass dome on a turned walnut base with preserved reindeer moss' };
ok(C.titleFor(long, ebay).length <= 80 && C.titleFor(long, etsy).length <= 140 && !/\s$/.test(C.titleFor(long, ebay)) && C.titleFor(good, etsy).includes('Morpho menelaus') && !C.titleFor(good, ebay).includes('Morpho menelaus'), 'titles are cut to each site\'s limit on a word, and the long ones carry the species');
ok(C.titleFor({ ...good, name: 'Sunset moth, framed', kind: 'frame' }, ebay) === 'Sunset moth, framed, Blue morpho' && /glass dome/.test(C.titleFor({ ...good, name: 'Blue morpho' }, ebay)), 'a title does not repeat the kind when the name already says it');
const tg = C.tagsFor(good, etsy); ok(tg.length <= 13 && tg.every(t => t.length <= 20) && tg[0] === 'blue morpho' && new Set(tg).size === tg.length, 'Etsy tags: 13 at most, 20 characters at most, yours first, none twice');
const de = C.descriptionFor(good, { care: 'Keep out of direct sun.' });
ok(/Blue morpho \(Morpho menelaus\), from Peru, farm raised/.test(de) && /Keep out of direct sun/.test(de) && /One of a kind/.test(de) && !de.includes(DASH), 'the description names the species, its origin and how it was sourced');
ok(!/farm|ranch|ethical|sustainab/i.test(C.descriptionFor({ ...good, species: [{ ...good.species[0], source: '' }] })) && !/wild/i.test(C.descriptionFor({ ...good, species: [{ ...good.species[0], source: 'wild' }] })), 'nothing about sourcing is claimed unless it was entered');
ok(C.eligible(good, etsy, set).ok && !C.eligible({ ...good, ready: false }, etsy, set).ok && !C.eligible({ ...good, stock: 0 }, etsy, set).ok, 'a piece must be ready and in stock to post');
ok(!C.eligible(good, ebay, {}).ok && C.eligible(good, ebay, set).ok && C.eligible({ ...good, species: [{ ...good.species[0], cites: 'II' }] }, ebay, set).warnings.some(x => /United States shipping only/.test(x)), 'eBay needs its category first, and Appendix II warns to ship inside the United States');
ok(C.eligible(good, faire, set).warnings.some(x => /One of a kind/.test(x)) && !C.eligible({ ...good, wholesale: '' }, faire, set).ok, 'Faire needs a wholesale price and warns on one of a kind pieces');
ok(C.eligible(good, C.channel('meta'), set).warnings.some(x => /not confirmed/.test(x)), 'a site whose rules were not confirmed says so on every real specimen');
const eb = C.fileFor('ebay', [good], set, 'https://x.test').text.split('\r\n');
ok(eb[0].startsWith('*Action(SiteID=US|Country=US|Currency=USD|Version=1193)') && /^Add,GCS-0001,12345,/.test(eb[1]) && eb[1].includes('https://x.test/img/aaaaaaaaaaaaaaaaaaaaaaaa.jpg|https://x.test/img/bbbbbbbbbbbbbbbbbbbbbbbb.jpg') && eb[1].includes('98.00') && eb[1].includes('Ship A'), 'the eBay file carries the action, the category, both photos, the price and the policy names');
const sh = C.fileFor('shopify', [good], set, 'https://x.test').text.trim().split('\r\n');
ok(sh.length === 3 && sh[0].split(',').length === 21 && sh[1].endsWith(',draft') && sh[2].split(',').length === 21 && sh[2].includes('bbbbbbbb'), 'the Shopify file has one row for the piece as a draft and one more for each extra photo');
const fa = C.fileFor('faire', [good], set, 'https://x.test').text; ok(/Wholesale Price,Retail Price,Case Quantity,Minimum Order Quantity/.test(fa) && /48\.00,98\.00,1,1/.test(fa), 'the Faire file carries wholesale, retail, case quantity and minimum');
ok(C.csv([['a,b', 'he said "hi"', 'two\nlines']]) === '"a,b","he said ""hi""","two\nlines"\r\n', 'spreadsheet cells with commas, quotes and line breaks are quoted');
ok(C.toPost([good, { ...good, id: 'p2', channels: { etsy: { status: 'listed' } } }, { ...good, id: 'p3', ready: false }], 'etsy', set).length === 1, 'the to-post list leaves out what is listed already and what is not ready');

// ---- stores, orders, runs
const st = { ...M.blankStore(), id: 's1', name: 'Made-up Shop', town: 'Bangor', region: 'Bangor area', stage: 'Terms agreed', next: 'Deliver first order', due: '2026-11-01' }, st2 = { ...M.blankStore(), id: 's2', name: 'Other Made-up Shop', town: 'Ellsworth', region: 'Downeast and Acadia' };
ok(!M.isAccount(st) && M.isAccount({ ...st, stage: 'Stocked' }), 'a store is an account only once it is stocked');
ok(M.storeNote(st, ' Called. ').notes[0].text === 'Called.' && M.storeNote(st, 'x').notes[0].on === M.today(), 'a note is dated and trimmed');
const o1 = { ...M.blankOrder('s1'), id: 'o1', lines: [{ productId: good.id, qty: 3, price: 48 }], deliverBy: '2026-11-20' };
ok(M.orderTotals(o1).placed === 144 && M.orderTotals(o1).owed === 0 && M.orderTotals({ ...o1, step: 'Delivered' }).owed === 144 && M.orderTotals({ ...o1, step: 'Paid' }).owed === 0, 'a wholesale order is owed in full once delivered and nothing once paid');
const oc = { ...M.blankOrder('s2', 'consignment'), id: 'o2', step: 'Delivered', split: 60, lines: [{ productId: good.id, qty: 4, price: 100, sold: 3 }], paid: 100 }, tc = M.orderTotals(oc);
ok(tc.soldValue === 300 && tc.owed === 80 && tc.onShelf === 1 && M.orderTotals({ ...oc, lines: [{ productId: good.id, qty: 4, price: 100, sold: 9 }] }).sold === 4, 'consignment owes our share of what sold, less what was paid, and cannot sell more than was placed');
ok(M.deliver(o1, [{ ...good, stock: 5 }])[0].stock === 2 && M.deliver(o1, [{ ...good, stock: 1 }])[0].stock === 0, 'delivering takes pieces out of stock and never below zero');
const rs = M.runs([o1, { ...oc, step: 'Draft', lines: [{ productId: good.id, qty: 2, price: 100 }] }, { ...o1, id: 'o3', method: 'ship' }, { ...o1, id: 'o4', step: 'Paid' }], [st, st2], [good]);
ok(rs.length === 2 && rs[0].region === 'Bangor area' && rs[0].units === 3 && rs[0].pack[0].sku === 'GCS-0001' && rs[1].stops[0].store.town === 'Ellsworth', 'delivery runs group open car orders by region with one packing list each');
const td = M.todayList({ products: [{ ...good, stock: 0, channels: { etsy: { status: 'listed' } } }, { ...good, id: 'p9', ready: false }], stores: [st], orders: [o1, { ...o1, id: 'o5', step: 'Delivered' }] }, C.CHANNELS, '2026-11-21');
ok(td[0].kind === 'takedown' && /still listed on Etsy/.test(td[0].text) && td.some(x => x.kind === 'store' && /due 2026-11-01/.test(x.text)) && td.some(x => /owes \$144\.00/.test(x.text)) && td.some(x => /still a draft/.test(x.text)), 'today puts a sold one-off that is still listed first, then late store steps, deliveries and money owed');

// ---- house rules across every file in the repo
const files = []; const walk = (d) => { for (const f of readdirSync(d)) { if (['node_modules', '.git', '.wrangler', 'fonts', 'package-lock.json'].includes(f)) continue; const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); } }; walk(new URL('..', import.meta.url).pathname);
const text = (f) => readFileSync(f, 'utf8');
ok(files.every(f => !text(f).includes(DASH)), 'no em dashes anywhere');
ok(files.filter(f => /\.(js|html)$/.test(f)).every(f => !/\bprompt\(|\balert\(|\bconfirm\(/.test(text(f))), 'no prompt, alert or confirm boxes');
ok(files.filter(f => /\.html$/.test(f)).every(f => !/<script(?![^>]*src=)[^>]*>|\sstyle="|\son[a-z]+="/.test(text(f))), 'no inline script, inline style or inline handlers (the security header forbids them)');
ok(files.filter(f => /public\/(index\.html|catalog\.js|site\.css)$/.test(f)).every(f => !/https?:\/\/(?!www\.w3\.org)/.test(text(f)) && !/\$\d/.test(text(f))), 'the public page loads nothing from another company and shows no prices');
ok(!/Keresey|Kerlogix|Tim Dunham/i.test(files.filter(f => !f.endsWith('smoke.mjs')).map(text).join('')), 'no owner name and no other brand anywhere in this repo');
const w = text(files.find(f => f.endsWith('worker/index.js')));
ok(/if \(!who\.ok\) return locked\(\)/.test(w) && /env\.DEV_USER && isLocal\(url\)/.test(w) && /!env\.ACCESS_TEAM \|\| !env\.ACCESS_AUD/.test(w), 'the desk fails closed, and the local test login only works on a local address');

console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
