// Stand-ins for eBay and Etsy, for the flow tests only. They answer the calls the desk makes and keep a log of them.
const http = require('node:http');
module.exports = function start(port, deskOrigin) {
  const log = [], listings = {}; let n = 100;
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'), chunks = [];
    req.on('data', c => chunks.push(c)); req.on('end', () => {
      const raw = Buffer.concat(chunks), text = raw.length < 20000 ? raw.toString() : '', p = u.pathname, m = req.method, J = (o, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (p === '/_log') return J({ log, listings });
      log.push({ m, p: p + u.search, auth: req.headers.authorization || '', key: req.headers['x-api-key'] || '', type: req.headers['content-type'] || '', body: text, bytes: raw.length });
      // ---- eBay
      if (p === '/oauth2/authorize') { res.writeHead(302, { location: `${deskOrigin}/desk/connect/ebay?code=made-up-code&state=${encodeURIComponent(u.searchParams.get('state'))}` }); return res.end(); }
      if (p === '/identity/v1/oauth2/token') return /^Basic /.test(req.headers.authorization || '') ? J({ access_token: 'ebay-access', expires_in: 7200, refresh_token: 'ebay-refresh', refresh_token_expires_in: 47304000 }) : J({ error: 'invalid_client' }, 401);
      if (p.startsWith('/sell/')) {
        if (req.headers.authorization !== 'Bearer ebay-access') return J({ errors: [{ message: 'Invalid access token' }] }, 401);
        if (/\/fulfillment_policy$/.test(p)) return J({ fulfillmentPolicies: [{ fulfillmentPolicyId: 'F1', name: 'Made-up shipping' }] });
        if (/\/payment_policy$/.test(p)) return J({ paymentPolicies: [{ paymentPolicyId: 'P1', name: 'Made-up payment' }] });
        if (/\/return_policy$/.test(p)) return J({ returnPolicies: [{ returnPolicyId: 'R1', name: 'Made-up returns' }] });
        if (/\/location$/.test(p)) return J({ locations: [{ merchantLocationKey: 'home', name: 'Made-up location' }] });
        if (/\/inventory_item\//.test(p) && m === 'PUT') { res.writeHead(204); return res.end(); }
        if (/\/offer$/.test(p) && m === 'GET') return J({ offers: [] });
        if (/\/offer$/.test(p) && m === 'POST') { const b = JSON.parse(text); if (!b.listingPolicies || !b.categoryId) return J({ errors: [{ message: 'Missing policy' }] }, 400); return J({ offerId: 'OFFER' + (++n) }, 201); }
        if (/\/publish$/.test(p)) return J({ listingId: '1100' + (++n) });
        if (/\/withdraw$/.test(p)) return J({ listingId: 'x' });
      }
      // ---- Etsy
      if (p === '/oauth/connect') { const ok = u.searchParams.get('code_challenge_method') === 'S256' && u.searchParams.get('code_challenge'); res.writeHead(302, { location: `${u.searchParams.get('redirect_uri')}?${ok ? 'code=made-up-etsy-code' : 'error=bad'}&state=${encodeURIComponent(u.searchParams.get('state'))}` }); return res.end(); }
      if (p === '/v3/public/oauth/token') return /code_verifier=|refresh_token=/.test(text) ? J({ access_token: '4242.etsy-access', expires_in: 3600, refresh_token: '4242.etsy-refresh' }) : J({ error: 'invalid_grant' }, 400);
      if (p.startsWith('/v3/application/')) {
        if (req.headers.authorization !== 'Bearer 4242.etsy-access' || req.headers['x-api-key'] !== 'made-up-key:made-up-secret') return J({ error: 'bad key or token' }, 401);
        const q = p.slice('/v3/application'.length);
        if (q === '/users/4242/shops') return J({ shop_id: 777, shop_name: 'MadeUpShop' });
        if (q === '/shops/777/shipping-profiles') return J({ results: [{ shipping_profile_id: 31, title: 'Made-up shipping profile' }] });
        if (q === '/shops/777/readiness-state-definitions') return J({ results: [{ readiness_state_id: 41, readiness_state: 'ready_to_ship', min_processing_time: 1, max_processing_time: 3, processing_time_unit: 'days' }] });
        if (q === '/shops/777/policies/return') return J({ results: [] });
        if (q === '/seller-taxonomy/nodes') return J({ results: [{ id: 1, name: 'Art & Collectibles', children: [{ id: 55, name: 'Taxidermy & Curiosities', children: [] }] }, { id: 2, name: 'Home & Living', children: [] }] });
        if (q === '/shops/777/listings' && m === 'POST') { const b = new URLSearchParams(text); for (const k of ['quantity', 'title', 'description', 'price', 'who_made', 'when_made', 'taxonomy_id', 'shipping_profile_id', 'readiness_state_id']) if (!b.get(k)) return J({ error: 'Missing ' + k }, 400);
          const id = ++n, wrong = /WRONGPRICE/.test(b.get('description')); listings[id] = { state: 'draft', images: 0, price: b.get('price'), title: b.get('title') }; return J({ listing_id: id, url: `https://www.etsy.com/listing/${id}/made-up`, state: 'draft', price: { amount: Math.round(+b.get('price') * 100) * (wrong ? 100 : 1), divisor: 100 } }, 201); }
        let x = /^\/shops\/777\/listings\/(\d+)\/images$/.exec(q); if (x && m === 'POST') { if (!/multipart\/form-data/.test(req.headers['content-type'] || '') || raw.length < 500) return J({ error: 'no image' }, 400); listings[x[1]].images++; return J({ listing_image_id: 1 }, 201); }
        x = /^\/shops\/777\/listings\/(\d+)$/.exec(q); if (x && m === 'PATCH') { listings[x[1]].state = new URLSearchParams(text).get('state'); return J({ listing_id: +x[1], state: listings[x[1]].state }); }
      }
      J({ error: 'the stand-in has no such call: ' + m + ' ' + p }, 404);
    });
  });
  return new Promise(r => srv.listen(port, () => r(srv)));
};
