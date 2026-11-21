# CLAUDE.md: Granite Coast Supply

A pipeline for getting handmade curiosities (mounted butterflies, cloches, natural history pieces) onto as many selling sites as possible and into stores, starting in Maine. It is not a store: nothing is sold on this site. This repository is public, so no private fact ever goes in a file here.

## Commands
- `npm run dev`: local server at http://localhost:8799 with a local database and a test login.
- `npm test`: smoke suite for the record layer, the channel logic and the house rules. Run before calling any change done.
- `npm run test:flows`: starts its own local server with an empty local database, then drives the desk like a person on a desktop and a phone (a piece from empty to listed, a store, an order, a delivery run), the public catalog, and the locked door. Needs no internet. Run it before every push. When a bug is found by hand, add its flow to `tools/flows.cjs` in the same change as the fix.
- Pushing to `main` publishes through Cloudflare (Worker `gcsupply`, `npx wrangler deploy`). There is no build step.

## Map
- `worker/index.js`: the one server. Public: the catalog page, `/api/catalog` (published pieces, public fields only) and `/img/<id>.jpg`. Private: `/desk` and `/api/desk`, let through only with a valid Cloudflare Access login for an allowed email. Fails closed.
- `public/desk/lib/model.js`: the record layer. Makers, pieces, stores and orders as objects linked by id; what stops a piece (`checkProduct`); the money on a piece; orders and consignment; delivery runs; the Today list; `publicProduct`, the only shape that leaves the desk.
- `public/desk/lib/channels.js`: every selling site with its limits, its rule for real specimens (with the source and the date it was read), and the listing or file built for it. Add a site here.
- `worker/market.js`: posting straight to eBay (Inventory API: item, offer, publish, withdraw) and Etsy (draft listing, photos, then active). Sign-in with each site, the shop's own policies and profiles to choose from, post and take down. The app keys are Cloudflare secrets the owner enters (`EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_RUNAME`, `ETSY_KEYSTRING`, `ETSY_SECRET`). The tokens each site hands back live in the database table `vault` and are never sent to a page. An Etsy listing goes live only after its price reads back right, and only when "go live" is switched on, because Etsy charges a fee for each live listing.
- `tools/mock-markets.cjs`: stand-ins for both sites, used by the flow tests. The server honors stand-in addresses on a local address only.
- `public/desk/desk.js`, `desk.css`, `index.html`: the desk pages.
- `public/index.html`, `catalog.js`, `site.css`: the public catalog. `DESIGN.md` explains the look.
- Data lives in the Cloudflare D1 database `gcsupply` (one `objects` table, one `photos` table), never in this repository.
- Access settings (`ACCESS_TEAM`, `ACCESS_AUD`, `ALLOW_EMAILS`) are set on the Worker in Cloudflare, not in `wrangler.jsonc`.

## Rules that never bend
- Private stays private. Costs, wholesale prices, stock, suppliers, papers, store names and notes never appear in the public catalog, the public feed or this repository. Never weaken the login check to "make it work".
- No keys, tokens, passwords, emails or names of people in the repository.
- No em dashes anywhere. Plain voice. No owner name. One brand: Granite Coast Supply.
- The public catalog shows no prices and has no buttons. Contact is a mail link in the copy, shown only when an email is set on the desk.
- A real specimen needs its scientific name before it can be marked ready. A species listed under the Endangered Species Act or CITES Appendix I can never be marked ready.
- Listings say only what is on the record. Nothing about sourcing is claimed unless it was entered. No invented reviews, numbers or credentials.
- A marketplace rule is stated only with its source link and the date it was read. A site that was not checked says "not confirmed".
- Nothing sends email. Nothing is posted to a marketplace unless a person presses Post on the desk. One thing happens without a press: when an order is marked delivered and a one of a kind piece is gone, its listings posted from the desk are taken down.
- Nothing loads from another company: no outside fonts, scripts or trackers. No inline script or inline style; the security header forbids both.
- No `prompt()`, `alert()` or `confirm()`.
- The public site stays out of search (`INDEX_OK` is `no`) until the owner says to switch it on.
