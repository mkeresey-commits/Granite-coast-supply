// Drives the site like a person: the desk on a desktop and a phone, the public catalog, and the locked door.
// It starts its own local server with an empty local database, so it needs no internet and touches nothing real.
const { chromium, devices } = require('playwright');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
let pass = 0, fail = 0; const ok = (c, name) => { if (c) pass++; else { fail++; console.log('  FAIL ' + name); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const until = async (page, fn, ms = 10000, arg) => { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch (e) { return false; } };
const MOCK = 8820, mockVars = ['EBAY_CLIENT_ID:made-up-id', 'EBAY_CLIENT_SECRET:made-up-secret', 'EBAY_RUNAME:made-up-runame', 'ETSY_KEYSTRING:made-up-key', 'ETSY_SECRET:made-up-secret', ...['EBAY_API', 'EBAY_AUTH', 'ETSY_API', 'ETSY_AUTH'].map(k => `${k}:http://localhost:${MOCK}`)];
const serve = (port, dir, open) => spawn('npx', ['wrangler', 'dev', '--local', '--port', String(port), '--persist-to', dir, '--inspector-port', String(port + 1000), ...(open ? ['DEV_USER:tester@example.com', ...mockVars].flatMap(v => ['--var', v]) : [])], { stdio: 'ignore', detached: true });
const mockLog = async () => (await fetch(`http://localhost:${MOCK}/_log`)).json();
const up = async (port) => { for (let i = 0; i < 80; i++) { try { const r = await fetch(`http://localhost:${port}/api/catalog`); if (r.ok) return true; } catch (e) { /* not up yet */ } await sleep(500); } return false; };

async function desk(browser, name, opts, port, photo, first) {
  console.log('\nDesk, ' + name);
  const ctx = await browser.newContext({ ...opts, acceptDownloads: true }), page = await ctx.newPage(), errs = [];
  page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  const saved = () => until(page, () => /^Saved/.test(document.querySelector('#status').textContent));
  const B = `http://localhost:${port}`, tag = name.replace(/\W/g, '');
  await page.goto(B + '/desk/'); ok(await until(page, () => !!window.__desk), `${name}: the desk loads behind the login`);
  ok(/Today/.test(await page.textContent('h1')) && /tester@example.com/.test(await page.textContent('#me')), `${name}: it opens on Today and shows who is signed in`);

  // a maker, then a piece
  await page.goto(B + '/desk/#makers'); await page.click('#mAdd'); await page.fill('#mList fieldset:last-of-type input[data-k="name"]', 'Made-up Maker ' + tag); await saved();
  await page.goto(B + '/desk/#piece/new'); ok(await until(page, () => !!document.querySelector('#pForm')), `${name}: a new piece opens`);
  const sku = (await page.textContent('#main p.quiet')).trim(); ok(/^GCS-\d{4}$/.test(sku), `${name}: it gets the next stock number (${sku})`);
  ok(await page.isDisabled('#pFlags input[data-k="ready"]') && /Add at least one photo/.test(await page.textContent('#pCheck')), `${name}: an empty piece cannot be marked ready and says why`);
  await page.fill('input[data-k="name"]', 'Made-up morpho dome ' + tag); await page.fill('textarea[data-k="blurb"]', 'A made-up piece for the test.'); await page.fill('input[data-k="materials"]', 'glass, walnut');
  await page.fill('input[data-k="h"]', '9'); await page.fill('input[data-k="cost"]', '22'); await page.fill('input[data-k="wholesale"]', '48'); await page.fill('input[data-k="retail"]', '98'); await page.fill('input[data-k="stock"]', '3');
  await page.setInputFiles('#pFile', { name: 'test.jpg', mimeType: 'image/jpeg', buffer: photo });
  ok(await until(page, () => document.querySelectorAll('#pPhotos img').length === 1 && document.querySelector('#pPhotos img').naturalWidth > 0), `${name}: a photo uploads and shows`);
  await page.click('#spAdd'); await page.fill('.sp input[data-k="common"]', 'Blue morpho');
  ok(/add the scientific name/.test(await page.textContent('#pCheck')), `${name}: a real specimen with no scientific name stops the piece`);
  await page.fill('.sp input[data-k="scientific"]', 'Morpho menelaus'); await page.fill('.sp input[data-k="origin"]', 'Peru'); await page.selectOption('.sp select[data-k="source"]', 'farmed'); await page.fill('.sp input[data-k="paper"]', 'Made-up invoice 1');
  await page.selectOption('.sp select[data-k="cites"]', 'I'); ok(/Appendix I\. It cannot be sold/.test(await page.textContent('#pCheck')) && await page.isDisabled('#pFlags input[data-k="ready"]'), `${name}: an Appendix I species can never be marked ready`);
  await page.selectOption('.sp select[data-k="cites"]', 'none');
  ok(await until(page, () => /Nothing stops this piece/.test(document.querySelector('#pCheck').textContent)) && /leaves \$26\.00 a piece/.test(await page.textContent('#pMoney')), `${name}: a complete piece is cleared and shows what it leaves`);
  await page.check('#pFlags input[data-k="ready"]'); await page.check('#pFlags input[data-k="public"]'); await saved(); await sleep(900);

  // the public catalog shows it, without money
  const pubPage = await ctx.newPage(); await pubPage.goto(B + '/');
  ok(await until(pubPage, (t) => document.querySelector('#list').textContent.includes(t), 8000, 'Made-up morpho dome ' + tag), `${name}: the published piece shows in the public catalog`);
  const pub = await pubPage.evaluate(() => ({ t: document.body.textContent, bi: [...document.querySelectorAll('.bi')].some(x => x.textContent === 'Morpho menelaus'), img: [...document.querySelectorAll('.dome img')].every(i => i.complete && i.naturalWidth > 0), wide: document.documentElement.scrollWidth <= innerWidth + 1 }));
  ok(pub.bi && pub.img && !/\$|48|98|Made-up invoice|wholesale price of/.test(pub.t.replace(/wholesale line sheet/g, '')) && pub.wide, `${name}: it names the species, loads the photo, shows no price or paper, and fits the screen`);
  const api = await (await fetch(B + '/api/catalog')).text(); ok(!/cost|"wholesale"|"retail"|paper|supplier|stock/.test(api), `${name}: the public feed carries no private field`);
  await pubPage.close();

  // posting
  await page.goto(B + '/desk/#post'); ok(await until(page, () => document.querySelectorAll('.card').length >= 6) && /Its rules/.test(await page.textContent('#main')), `${name}: every site shows with its rule for specimens and a link to the source`);
  await page.goto(B + '/desk/#post/etsy'); ok(await until(page, () => !!document.querySelector('.sheet')), `${name}: Etsy gives a paste sheet`);
  const sheet = await page.evaluate(() => { const s = [...document.querySelectorAll('.sheet')].pop(); return { t: s.textContent, copies: s.querySelectorAll('[data-copy]').length, title: s.querySelector('[data-copy]').dataset.copy }; });
  ok(sheet.copies >= 5 && sheet.title.length <= 140 && /Morpho menelaus/.test(sheet.title) && /of 140 characters/.test(sheet.t) && /from Peru, farm raised/.test(sheet.t), `${name}: the sheet has a title inside Etsy's limit, the species, and a copy button for each field`);
  await page.fill('.sheet:last-of-type .done input', 'https://www.etsy.com/listing/1/made-up'); await page.click('.sheet:last-of-type [data-listed]');
  ok(await until(page, (t) => [...document.querySelectorAll('#main li')].some(l => l.textContent.includes(t) && /Open the listing/.test(l.textContent)), 8000, tag), `${name}: marking it listed moves it to the listed pieces with its link`);
  if (first) { await page.goto(B + '/desk/#post/ebay'); ok(await until(page, () => /Set the eBay category number under Settings/.test(document.querySelector('#main').textContent)), `${name}: eBay holds the piece back until its category is set`); }
  await page.goto(B + '/desk/#settings'); await page.fill('fieldset[data-ch="ebay"] input[data-c="category"]', '12345'); await page.fill('input[data-k="publicEmail"]', 'shops@example.com'); await saved();
  await page.goto(B + '/desk/#post/ebay'); ok(await until(page, () => !!document.querySelector('#chFile')), `${name}: with the category set, eBay offers its file`);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#chFile')]), file = readFileSync(await dl.path(), 'utf8');
  ok(dl.suggestedFilename() === 'ebay-upload.csv' && file.startsWith('*Action(SiteID=US') && file.includes('Made-up morpho dome') && /\/img\/[a-f0-9]{24}\.jpg/.test(file) && file.includes('98.00'), `${name}: the eBay file downloads with the piece, a photo link and the price`);

  // a store, an order, a run
  await page.goto(B + '/desk/#store/new'); ok(await until(page, () => !!document.querySelector('#sForm')), `${name}: a new store opens`);
  await page.fill('#sForm input[data-k="name"]', 'Made-up Shop ' + tag); await page.fill('#sForm input[data-k="town"]', 'Bangor'); await page.selectOption('#sForm select[data-k="stage"]', 'Terms agreed'); await page.fill('#sForm input[data-k="next"]', 'Deliver the first order'); await page.fill('#sForm input[data-k="due"]', '2026-01-05');
  await page.fill('#nText', 'Made-up note from a call.'); await page.click('#nAdd'); ok(/Made-up note from a call/.test(await page.textContent('#nList')), `${name}: a note is kept on the store`);
  await saved(); await page.click('#oNew'); ok(await until(page, () => !!document.querySelector('#oAdd')), `${name}: an order opens for the store`);
  await page.selectOption('#oAdd', await page.evaluate((t) => window.__desk.D.product.find(p => p.name.includes(t)).id, tag)); ok(await until(page, () => document.querySelectorAll('#oLines tbody tr').length === 1) && /\$48\.00/.test(await page.textContent('#oLines')), `${name}: adding a piece prices the line at wholesale`);
  await page.fill('#oLines input[data-l="qty"]', '2'); await page.dispatchEvent('#oLines input[data-l="qty"]', 'change'); ok(await until(page, () => /\$96\.00/.test(document.querySelector('#oLines tfoot').textContent)), `${name}: the order totals`);
  await saved();
  await page.goto(B + '/desk/#runs'); ok(await until(page, (t) => document.querySelector('#main').textContent.includes('Made-up Shop ' + t), 8000, tag) && /Pack the car/.test(await page.textContent('#main')) && /Bangor area/.test(await page.textContent('#main')), `${name}: the open order shows on a delivery run with a packing list`);
  const oid = await page.evaluate((t) => { const D = window.__desk.D, s = D.store.find(x => x.name.includes(t)); return D.order.find(o => o.storeId === s.id).id; }, tag);
  await page.goto(B + '/desk/#orders'); ok(await until(page, (id) => !!document.querySelector(`#main table a[href="#order/${id}"]`), 8000, oid), `${name}: the order shows in the list of orders`);
  await page.click(`#main table a[href="#order/${oid}"]`); await until(page, () => !!document.querySelector('#oNext'));
  await page.click('#oNext'); await until(page, () => /Mark delivered/.test(document.querySelector('#oNext').textContent)); await page.click('#oNext'); await until(page, () => /Mark paid/.test(document.querySelector('#oNext').textContent)); await sleep(700);
  const after = await page.evaluate((t) => { const D = window.__desk.D; return { stock: D.product.find(p => p.name.includes(t)).stock, stage: D.store.find(s => s.name.includes(t)).stage }; }, tag);
  ok(after.stock === 1 && after.stage === 'Stocked', `${name}: delivering takes two out of stock and makes the store an account (${after.stock}, ${after.stage})`);
  await page.goto(B + '/desk/#today'); ok(await until(page, (t) => [...document.querySelectorAll('.todo li')].some(l => l.textContent.includes('Made-up Shop ' + t) && /owes \$96\.00/.test(l.textContent)), 8000, tag), `${name}: Today lists the money the store owes`);
  await page.goto(B + '/desk/#sheet'); ok(await until(page, () => !!document.querySelector('.line')) && /Not for the public/.test(await page.textContent('#main')) && /\$48\.00/.test(await page.textContent('.line')), `${name}: the line sheet shows wholesale prices and says it is not for the public`);

  // it all comes back after a reload
  await page.reload(); await until(page, () => !!window.__desk);
  const back = await page.evaluate((t) => { const D = window.__desk.D; return { p: D.product.filter(p => p.name.includes(t)).length, s: D.store.filter(s => s.name.includes(t)).length, o: D.order.length, listed: D.product.find(p => p.name.includes(t)).channels.etsy.status }; }, tag);
  ok(back.p === 1 && back.s === 1 && back.o >= 1 && back.listed === 'listed', `${name}: the piece, the store, the order and the Etsy status come back after a reload`);
  for (const v of ['today', 'pieces', 'post', 'stores', 'orders', 'makers', 'settings', 'runs', 'sheet']) { await page.goto(B + '/desk/#' + v); await sleep(120); ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: ${v} is no wider than the screen`); }
  ok(errs.length === 0, `${name}: no script errors (${errs.slice(0, 2).join(' | ')})`);
  await ctx.close();
}


// ---- straight to eBay and Etsy, against stand-ins for both
async function autopost(browser, port) {
  console.log('\nAutomatic posting');
  const B = `http://localhost:${port}`, ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }), page = await ctx.newPage(), errs = [];
  page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/409|422/.test(m.text())) errs.push(m.text()); });
  const saved = () => until(page, () => /^Saved/.test(document.querySelector('#status').textContent));
  await page.goto(B + '/desk/#settings'); await until(page, () => !!document.querySelector('[data-connect="ebay"]'));
  ok(!!(await page.$('[data-connect="ebay"]')) && !!(await page.$('[data-connect="etsy"]')), 'with the app keys in, Settings offers to connect eBay and Etsy');
  // two fresh pieces: one for the button, one that the Etsy stand-in will price wrongly
  await page.evaluate(async () => { const D = window.__desk.D, src = D.product[0], mk = (id, sku, name, blurb) => fetch('/api/desk/obj/product/' + id, { method: 'PUT', headers: { 'x-desk': '1', 'content-type': 'application/json' }, body: JSON.stringify({ ...src, id, sku, name, blurb, stock: 1, oneOff: true, ready: true, channels: {} }) });
    await mk('pauto', 'GCS-0900', 'Made-up auto piece', 'A made-up piece for the posting test.'); await mk('pwrong', 'GCS-0901', 'Made-up wrong price piece', 'WRONGPRICE made-up piece.'); });
  await page.click('[data-connect="ebay"]'); ok(await until(page, () => /eBay is connected/.test(document.querySelector('#status').textContent) && !!window.__desk), 'signing in to eBay comes back connected');
  ok(await until(page, () => !!document.querySelector('[data-site="ebay"] select[data-o="fulfillmentPolicyId"] option[value="F1"]')), 'the shop\'s own eBay policies and location load to choose from');
  for (const [k, v] of [['fulfillmentPolicyId', 'F1'], ['paymentPolicyId', 'P1'], ['returnPolicyId', 'R1'], ['merchantLocationKey', 'home']]) await page.selectOption(`[data-site="ebay"] select[data-o="${k}"]`, v);
  await page.fill('[data-site="ebay"] textarea[data-o="aspects"]', 'Brand: Unbranded'); await saved();
  await page.click('[data-connect="etsy"]'); ok(await until(page, () => /Etsy is connected/.test(document.querySelector('#status').textContent) && !!window.__desk), 'signing in to Etsy comes back connected');
  ok(await until(page, () => !!document.querySelector('[data-site="etsy"] select[data-o="shippingProfileId"] option[value="31"]')) && /Connected to MadeUpShop/.test(await page.textContent('[data-site="etsy"]')), 'the Etsy shop is named and its shipping and processing profiles load');
  await page.selectOption('[data-site="etsy"] select[data-o="shippingProfileId"]', '31'); await page.selectOption('[data-site="etsy"] select[data-o="readinessStateId"]', '41');
  await page.fill('#taxQ', 'taxidermy'); await page.click('#taxGo'); ok(await until(page, () => !!document.querySelector('#taxSel option[value="55"]')), 'an Etsy category is found by searching its name');
  await page.selectOption('#taxSel', '55'); await saved(); await page.waitForTimeout(900);

  await page.goto(B + '/desk/#post'); ok(await until(page, () => !!document.querySelector('#autoGo') && !document.querySelector('#autoGo').disabled), 'the Post page shows one button for everything waiting');
  ok(/saved as drafts for you to publish/.test(await page.textContent('#auto')), 'it says Etsy listings will be drafts while "go live" is off');
  const want = await page.evaluate(() => +document.querySelector('#auto b').textContent);
  await page.click('#autoGo'); ok(await until(page, (n) => document.querySelectorAll('#resList li').length === n && !document.querySelector('#autoGo').disabled, 30000, want), `one click posts all ${want} waiting listings`);
  const res = await page.evaluate(() => { const D = window.__desk.D, a = D.product.find(p => p.id === 'pauto'), w = D.product.find(p => p.id === 'pwrong'); return { ebay: a.channels.ebay, etsy: a.channels.etsy, wrong: w.channels.etsy, text: document.querySelector('#resList').textContent }; });
  ok(res.ebay.status === 'listed' && /^https:\/\/www\.ebay\.com\/itm\/1100/.test(res.ebay.url) && /^OFFER/.test(res.ebay.offerId), 'the piece is live on eBay with its listing link kept');
  ok(res.etsy.status === 'paused' && res.etsy.listingId && /etsy\.com\/listing/.test(res.etsy.url) && /saved as a draft/.test(res.text), 'the piece is on Etsy as a draft, with its link kept');
  ok(res.wrong.status === 'paused' && /Etsy shows the price as \$9800\.00, not \$98\.00/.test(res.text), 'a listing Etsy priced wrongly is left as a draft and says so');
  const L = await mockLog(), offer = L.log.find(x => x.m === 'POST' && /\/offer$/.test(x.p) && /GCS-0900/.test(x.body)), ob = JSON.parse(offer.body), item = JSON.parse(L.log.find(x => x.m === 'PUT' && /inventory_item\/GCS-0900/.test(x.p)).body), el = L.log.find(x => x.m === 'POST' && /\/shops\/777\/listings$/.test(x.p) && /auto\+piece/.test(x.body)), eb = new URLSearchParams(el.body);
  ok(ob.pricingSummary.price.value === '98.00' && ob.categoryId === '12345' && ob.listingPolicies.fulfillmentPolicyId === 'F1' && ob.merchantLocationKey === 'home' && ob.marketplaceId === 'EBAY_US' && item.product.aspects.Brand[0] === 'Unbranded' && item.product.aspects.Species[0] === 'Morpho menelaus' && /\/img\/[a-f0-9]{24}\.jpg/.test(item.product.imageUrls[0]) && item.condition === 'NEW', 'eBay got the price, category, policies, location, the species and a photo link');
  ok(eb.get('price') === '98.00' && eb.get('taxonomy_id') === '55' && eb.get('shipping_profile_id') === '31' && eb.get('readiness_state_id') === '41' && eb.get('who_made') === 'i_did' && el.key === 'made-up-key:made-up-secret' && Object.values(L.listings).every(x => x.images === 1 && x.state === 'draft'), 'Etsy got the price, category, both profiles, the key in its two-part form, and one photo for each listing');
  ok(!JSON.stringify(await (await fetch(B + '/api/desk/all')).json()).includes('ebay-refresh') && !(await page.content()).includes('etsy-refresh'), 'the sign-in tokens never reach a page');

  // going live on Etsy, then a sold one-off comes down
  await page.goto(B + '/desk/#settings'); await until(page, () => !!document.querySelector('[data-site="etsy"] input[data-o="live"]')); await page.check('[data-site="etsy"] input[data-o="live"]'); await saved(); await page.waitForTimeout(900);
  await page.evaluate(async () => { const src = window.__desk.D.product.find(p => p.id === 'pauto'); await fetch('/api/desk/obj/product/plive', { method: 'PUT', headers: { 'x-desk': '1', 'content-type': 'application/json' }, body: JSON.stringify({ ...src, id: 'plive', sku: 'GCS-0902', name: 'Made-up live piece', channels: {} }) }); });
  await page.reload(); await until(page, () => !!window.__desk); await page.goto(B + '/desk/#post/etsy'); ok(await until(page, () => !!document.querySelector('#chAuto')), 'the Etsy page has its own post button');
  await page.click('#chAuto'); ok(await until(page, () => window.__desk.D.product.find(p => p.id === 'plive').channels.etsy && window.__desk.D.product.find(p => p.id === 'plive').channels.etsy.status === 'listed', 20000), 'with "go live" on, the piece goes live on Etsy');
  ok(Object.values((await mockLog()).listings).some(x => x.state === 'active' && /live piece/.test(x.title)), 'Etsy was told to make it active only after the price read back right');
  await page.goto(B + '/desk/#piece/plive'); await until(page, () => !!document.querySelector('input[data-k="stock"]')); await page.fill('input[data-k="stock"]', '0'); await saved(); await page.waitForTimeout(800);
  await page.goto(B + '/desk/#today'); ok(await until(page, () => [...document.querySelectorAll('.todo li')].some(l => /Take down Made-up live piece/.test(l.textContent))), 'a sold one-off that is still up leads the Today list');
  await page.goto(B + '/desk/#piece/plive'); ok(await until(page, () => !!document.querySelector('#pDownGo')), 'the piece offers to take itself down');
  await page.click('#pDownGo'); ok(await until(page, () => window.__desk.D.product.find(p => p.id === 'plive').channels.etsy.status === 'sold', 15000), 'taking it down marks it sold there');
  ok(Object.values((await mockLog()).listings).some(x => x.state === 'inactive' && /live piece/.test(x.title)), 'Etsy was told to switch the listing off');
  const twice = await page.evaluate(async () => { const r = await fetch('/api/desk/market/post/ebay/pauto', { method: 'POST', headers: { 'x-desk': '1' } }); return { s: r.status, j: await r.json() }; }); ok(twice.s === 409 && /Already listed/.test(twice.j.error), 'a piece cannot be posted twice to the same site');
  ok(errs.length === 0, `no script errors (${errs.slice(0, 2).join(' | ')})`);
  await ctx.close();
}

(async () => {
  const mock = await require('./mock-markets.cjs')(MOCK, 'http://localhost:8811');
  const dir = mkdtempSync(join(tmpdir(), 'gcs-')), servers = [serve(8811, dir, true), serve(8812, dir + '-locked', false)]; let browser;
  try {
    ok(await up(8811) && await up(8812), 'both local servers start');
    browser = await chromium.launch();
    const p0 = await browser.newPage({ viewport: { width: 900, height: 700 } }); await p0.setContent('<body style="margin:0;background:linear-gradient(135deg,#1b56c9,#14282b)"><div style="height:700px"></div>'); const photo = await p0.screenshot({ type: 'jpeg', quality: 80 }); await p0.close();
    await desk(browser, 'desktop', { viewport: { width: 1440, height: 900 } }, 8811, photo, true);
    await desk(browser, 'phone', { ...devices['iPhone 13'] }, 8811, photo);

    await autopost(browser, 8811);

    console.log('\nThe locked door');
    for (const path of ['/api/desk/market/status', '/desk/connect/ebay?code=x&state=y']) { const r = await fetch('http://localhost:8812' + path, { redirect: 'manual' }); ok(r.status === 403, `without a login, ${path.split('?')[0]} answers Private`); }
    const noKeys = await fetch('http://localhost:8811/api/desk/market/connect/ebay', { method: 'POST' }); ok(noKeys.status === 403, 'connecting a site must come from the desk page');
    for (const path of ['/desk/', '/desk/desk.js', '/desk/lib/model.js', '/api/desk/all']) { const r = await fetch('http://localhost:8812' + path); ok(r.status === 403 && !/blankProduct|objects/.test(await r.text()), `without a login, ${path} answers Private`); }
    const w = await fetch('http://localhost:8812/api/desk/obj/store/x1', { method: 'PUT', headers: { 'x-desk': '1' }, body: '{}' }); ok(w.status === 403, 'without a login, nothing can be written');
    const bad = await fetch('http://localhost:8811/api/desk/obj/store/x1', { method: 'PUT', body: '{}' }); ok(bad.status === 403, 'a write that does not come from the desk page is refused, even when signed in');
    const post = await fetch('http://localhost:8811/api/catalog', { method: 'POST' }); ok(post.status === 405, 'the public side is read only');

    console.log('\nPublic catalog, empty and small');
    const c = await browser.newContext({ viewport: { width: 320, height: 640 }, isMobile: true, deviceScaleFactor: 2 }), pg = await c.newPage(), errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    const res = await pg.goto('http://localhost:8812/'); ok(await until(pg, () => !document.querySelector('#empty').hidden), 'with no pieces, the catalog says so plainly');
    ok(/noindex/.test(res.headers()['x-robots-tag'] || '') && /default-src 'self'/.test(res.headers()['content-security-policy'] || ''), 'the page is kept out of search until switched on, and carries the security header');
    ok(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1) && !(await pg.$('a[href^="mailto:"]')), 'at 320 wide it fits, and no contact link shows until an email is set');
    await pg.goto('http://localhost:8811/'); ok(await until(pg, () => !!document.querySelector('a[href^="mailto:shops@example.com"]')) && errs.length === 0, `once an email is set, the catalog shows it as a mail link, with no script errors (${errs.slice(0, 2).join(' | ')})`);
    await c.close();
  } catch (e) { fail++; console.log('  FAIL the run stopped: ' + e.message); }
  finally { if (browser) await browser.close(); mock.close(); for (const s of servers) { try { process.kill(-s.pid); } catch (e) { /* gone */ } } try { rmSync(dir, { recursive: true, force: true }); rmSync(dir + '-locked', { recursive: true, force: true }); } catch (e) { /* fine */ } }
  console.log(`\nflows: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
