// The public catalog: the published pieces, nothing else. No prices, no stock, no suppliers.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const list = document.getElementById('list'), empty = document.getElementById('empty');
(async () => {
  let j; try { const r = await fetch('/api/catalog'); if (!r.ok) throw 0; j = await r.json(); } catch (e) { empty.hidden = false; empty.textContent = 'The pieces did not load. Try again in a moment.'; return; }
  if (j.intro) document.getElementById('intro').textContent = j.intro;
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(j.email || '')) {
    const body = encodeURIComponent('Store name:\nTown and state:\nWhat you sell now:\nWhich pieces caught your eye:\n'), a = `<a href="mailto:${esc(j.email)}?subject=${encodeURIComponent('Wholesale line sheet')}&body=${body}">${esc(j.email)}</a>`;
    document.getElementById('contact').innerHTML = `Shops can ask for the wholesale line sheet, with prices, case packs and minimums, by writing to ${a}.`;
    document.getElementById('foot').innerHTML = a;
  }
  if (!j.pieces.length) { empty.hidden = false; return; }
  list.innerHTML = j.pieces.map((p, i) => {
    const s = p.species[0], where = [...new Set(p.species.map(x => x.origin).filter(Boolean))].join(', ');
    return `<li class="piece"><div class="dome">${p.photos[0] ? `<img src="/img/${esc(p.photos[0])}.jpg" alt="${esc(p.name)}" width="800" height="1000" ${i > 3 ? 'loading="lazy"' : ''}>` : ''}</div><div class="base"></div>
      <div class="tag"><h3>${esc(p.name)}</h3>${s && s.scientific ? `<span class="bi">${esc(p.species.map(x => x.scientific).filter(Boolean).join(', '))}</span>` : ''}
      <span class="meta">${esc([p.kind, where, p.oneOff ? 'One of a kind' : ''].filter(Boolean).join(' · '))}</span>${p.size ? `<span class="meta">${esc(p.size)}</span>` : ''}${!p.real && p.made && p.made.length ? `<span class="meta">${esc(p.made.map(m => [m.common, m.madeOf && 'made of ' + m.madeOf].filter(Boolean).join(', ')).join('; '))}. No real specimen.</span>` : ''}${p.maker ? `<span class="meta">Made by ${esc(p.maker)}</span>` : ''}
      ${p.blurb ? `<p class="more">${esc(p.blurb)}</p>` : ''}</div></li>`;
  }).join('');
})();
