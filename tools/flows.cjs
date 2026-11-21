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
const serve = (port, dir, open) => spawn('npx', ['wrangler', 'dev', '--local', '--port', String(port), '--persist-to', dir, '--inspector-port', String(port + 1000), ...(open ? ['--var', 'DEV_USER:tester@example.com'] : [])], { stdio: 'ignore', detached: true });
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

(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gcs-')), servers = [serve(8811, dir, true), serve(8812, dir + '-locked', false)]; let browser;
  try {
    ok(await up(8811) && await up(8812), 'both local servers start');
    browser = await chromium.launch();
    const p0 = await browser.newPage({ viewport: { width: 900, height: 700 } }); await p0.setContent('<body style="margin:0;background:linear-gradient(135deg,#1b56c9,#14282b)"><div style="height:700px"></div>'); const photo = await p0.screenshot({ type: 'jpeg', quality: 80 }); await p0.close();
    await desk(browser, 'desktop', { viewport: { width: 1440, height: 900 } }, 8811, photo, true);
    await desk(browser, 'phone', { ...devices['iPhone 13'] }, 8811, photo);

    console.log('\nThe locked door');
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
  finally { if (browser) await browser.close(); for (const s of servers) { try { process.kill(-s.pid); } catch (e) { /* gone */ } } try { rmSync(dir, { recursive: true, force: true }); rmSync(dir + '-locked', { recursive: true, force: true }); } catch (e) { /* fine */ } }
  console.log(`\nflows: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
