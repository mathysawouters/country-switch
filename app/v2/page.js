'use client';
import { useEffect, useState, useCallback } from 'react';
import './v2.css';

const eur = (n) => (n == null ? '' : '€' + Number(n).toFixed(2));
const LABEL = { cart_filled: 'cart filled', refused: 'refused', running: 'running', error: 'error', waiting: 'waiting for price', cannot_help: 'cannot help' };
const CLS = { cart_filled: 'ok', refused: 'no', running: 'run', error: 'no', waiting: 'run', cannot_help: 'run' };
const DEC = { chosen: 'chosen', refused: 'refused by your rule', not_same_item: 'not the same item', source: 'where you were', not_needed: 'not needed', not_cheaper: 'not cheaper' };

const COLORS = ['#f2f5f3', '#2dd4bf', '#8b938f', '#b7f36b', '#5f6763', '#c9cfcc'];
function PriceChart({ t }) {
  const h = (t.history ?? []).map((x) => ({ ...x, price: Number(x.price), ms: Date.parse(x.seen.replace(' ', 'T') + 'Z') })).filter((x) => x.price < 1000);
  if (h.length < 2) return null;
  const stores = [...new Set(h.map((x) => x.store))];
  const W = 640, H = 190, L = 48, R = 130, T = 12, B = 24;
  const t0 = Math.min(...h.map((x) => x.ms)), t1 = Math.max(...h.map((x) => x.ms));
  const lo = Math.min(...h.map((x) => x.price)) * 0.95, hi = Math.max(...h.map((x) => x.price)) * 1.03;
  const X = (ms) => L + ((ms - t0) / Math.max(1, t1 - t0)) * (W - L - R), Y = (p) => T + (1 - (p - lo) / Math.max(0.01, hi - lo)) * (H - T - B);
  const day = (ms) => new Date(ms).toISOString().slice(5, 16).replace('T', ' ');
  const G = '#2fe07a', M = '#8b938f';
  return (
    <svg className="s-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Price history per country shop">
      {[lo / 0.95, hi / 1.03].map((p, i) => <g key={i}><line x1={L} x2={W - R} y1={Y(p)} y2={Y(p)} stroke="#262b28" /><text x={L - 6} y={Y(p) + 4} textAnchor="end" fontSize="12" fill={M}>€{p.toFixed(0)}</text></g>)}
      <text x={L} y={H - 6} fontSize="12" fill={M}>{day(t0)} UTC</text><text x={W - R} y={H - 6} textAnchor="end" fontSize="12" fill={M}>{day(t1)} UTC</text>
      {stores.map((s, i) => { const pts = h.filter((x) => x.store === s); const c = s === t.store ? G : COLORS[i % COLORS.length];
        return <g key={s}><polyline fill="none" stroke={c} strokeWidth={s === t.store ? 3 : 1.3} points={pts.map((x) => `${X(x.ms)},${Y(x.price)}`).join(' ')} />{pts.map((x, j) => <circle key={j} cx={X(x.ms)} cy={Y(x.price)} r={s === t.store ? 3.5 : 2} fill={c} />)}</g>; })}
      {Object.entries(stores.reduce((m, s) => { const p = h.filter((x) => x.store === s).pop().price.toFixed(2); (m[p] ||= []).push(s.split('.')[0]); return m; }, {})).map(([p, names]) => <text key={p} x={W - R + 6} y={Y(Number(p)) + 4} fontSize="12" fill={names.includes(t.store.split('.')[0]) ? G : M} fontWeight={names.includes(t.store.split('.')[0]) ? 700 : 400}>{names.join(', ')} €{p}</text>)}
    </svg>
  );
}

const flag = (cc) => { const c = String(cc || '').toUpperCase().replace('UK', 'GB'); return /^[A-Z]{2}$/.test(c) ? String.fromCodePoint(...[...c].map((ch) => 127397 + ch.charCodeAt(0))) : '🌐'; };
const money = (n, cur) => (n == null ? '' : cur && cur !== 'EUR' ? `${Number(n).toFixed(2)} ${cur}` : eur(n));
const delivery = (o) => (o.shipping == null ? '' : Number(o.shipping) === 0 ? 'free' : eur(o.shipping));
const shortReason = (r) => { const t = String(r ?? '').split(' · ')[0]; return t.length > 70 ? t.slice(0, 68) + '…' : t; };
const TILE = { chosen: 'chosen', refused: 'refused', source: 'where you were', not_cheaper: 'not cheaper', not_needed: 'not needed' };
const ORDER = { chosen: 0, source: 1, refused: 2, not_cheaper: 3, not_needed: 4 };
const TOOLS = ['senso', 'shopify', 'superlinked', 'statsig', 'singlestore', 'cognee', 'amazon', 'agent', 'naive'];
const HEAD = {
  running: { tone: 'run', kicker: 'Working', title: 'Checking the brand shops in other countries…' },
  refused: { tone: 'no', kicker: 'Refused', title: 'No switch. Buy it where you were.' },
  waiting: { tone: 'wait', kicker: 'Standing order' },
  cannot_help: { tone: 'mute', kicker: 'Cannot help', title: 'This one is outside what the agent can do.' },
  error: { tone: 'no', kicker: 'Error', title: 'The run failed.' },
};
function parseRule(r) { const m = /^Rule (\d+) \(([^)]+)\):\s*([\s\S]*)$/.exec(r); return m ? { n: m[1], name: m[2], text: m[3] } : { n: '', name: '', text: r }; }

function Hero({ run, flagOf }) {
  const st = run.status; const saved = Number(run.saving) > 0; const filled = st === 'cart_filled';
  const h = filled ? { tone: 'ok', kicker: 'Cart filled' } : HEAD[st] ?? { tone: 'mute', kicker: st };
  const img = run.summary?.image; const via = run.summary?.via;
  return (
    <section className={'s-hero t-' + h.tone}>
      <div className="s-hero-top">
        {img && <img className="s-pimg" src={img} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
        <div className="s-hero-body">
          <div className="s-kicker"><span className="s-dot" />{h.kicker}</div>
          <div className="s-ptitle">{nice(run)}</div>
          {(run.sku || run.source_store) && <div className="s-pmeta">{run.sku ? `SKU ${run.sku}` : ''}{run.sku && run.source_store ? ' · ' : ''}{run.source_store ? `shared from ${flagOf(run.source_store)} ${run.source_store}` : ''}{run.shared_by ? ` · for ${run.shared_by}` : ''}</div>}
          {filled && saved && (
            <div className="s-cmp">
              <div><small>Where you were</small><b className="was">{eur(run.source_price)}</b><span>{flagOf(run.source_store)} {run.source_store}</span></div>
              <div><small>Where the agent filled the cart</small><b>{eur(run.best_price)}</b><span>{flagOf(run.chosen_store)} {run.chosen_store}, delivered</span></div>
              <div><small>You save</small><b className="go">{eur(run.saving)}</b><span>{Number(run.source_price) > 0 ? Math.round((Number(run.saving) / Number(run.source_price)) * 100) + '% less, same item' : 'same item'}</span></div>
            </div>)}
          {filled && !saved && (
            <div className="s-cmp">
              <div><small>Where the agent filled the cart</small><b>{eur(run.best_price)}</b><span>{flagOf(run.chosen_store)} {run.chosen_store}, delivered</span></div>
              <div><small>Why there</small><span style={{ marginTop: 8 }}>Best total among the brand's own shops that pass your rules</span></div>
            </div>)}
          {st === 'refused' && (<><div className="s-headline">{h.title}</div>
            {run.source_price && <div className="s-story"><div className="s-leg"><span className="s-now plain">{eur(run.source_price)}</span><small>{flagOf(run.source_store)} {run.source_store} is already the best deal</small></div></div>}</>)}
          {st === 'waiting' && (<><div className="s-headline">Not yet. Watching for a price under {eur(run.target)}.</div>
            {run.best_price && <div className="s-story"><div className="s-leg"><span className="s-now plain">{eur(run.best_price)}</span><small>best price right now</small></div><span className="s-arrow" aria-hidden="true">→</span><div className="s-leg"><span className="s-now plain">{eur(run.target)}</span><small>your target</small></div></div>}</>)}
          {(st === 'running' || st === 'cannot_help' || st === 'error' || !(filled || HEAD[st])) && <div className="s-headline">{h.title ?? st}</div>}
          {st === 'running' && <div className="s-bar"><i /></div>}
        </div>
      </div>
      {st !== 'running' && run.verdict && <p className="s-verdict">{run.verdict}</p>}
      {via?.amazon && <p className="s-via">Amazon item {via.amazon.asin}{via.amazon.price ? `, shown at ${eur(via.amazon.price)} on ${via.amazon.host.replace('www.', '')}` : ''}. Amazon gives an agent no way to act, so the cart is at the brand's own shop. The same item on Amazon in other countries: {via.amazon.sites.map((x, k) => <span key={x.site}>{k ? ' · ' : ''}<a href={x.url} target="_blank" rel="noreferrer">{x.site.replace('amazon.', '')}</a></span>)}</p>}
      {via && <p className="s-via">You shared {via.shared === 'product name' ? `the name “${via.query}”` : `a ${via.shared} link`}. The agent traced it to the brand's own shop, {via.brand_shop}, and ignored {via.ignored?.length ?? 0} other sellers (rule 8).</p>}
      <div className="s-actions">
        {run.cart_url && <a className="s-btn go" href={run.cart_url} target="_blank" rel="noreferrer">Open the filled cart · {eur(run.best_price)}</a>}
        <span className="s-chip">same-item check: {run.gate_same_item ? 'Superlinked (gate ON)' : 'naive (gate OFF)'}</span>
        <span className="s-chip">{flag(run.buyer_country)} buyer country {run.buyer_country}</span>
      </div>
      
    </section>
  );
}

// A ready-to-send answer for the person who shared the link (Dutch, for friends back home).
function replyText(run) {
  const hi = run.shared_by ? `Hey ${run.shared_by}! ` : 'Hey! ';
  const item = run.product_title ?? 'je product';
  if (run.status === 'cart_filled' && !(Number(run.saving) > 0)) return `${hi}Mijn agent heeft alle landenwinkels van het merk zelf nagekeken voor "${item}". Beste plek om te kopen: ${run.chosen_store}, ${eur(run.best_price)} geleverd in België. Winkelmandje staat al klaar, je moet enkel nog betalen: ${run.cart_url}`;
  if (run.status === 'cart_filled') return `${hi}Mijn agent heeft je link nagekeken. "${item}" kost ${eur(run.source_price)} bij ${run.source_store}, maar bij ${run.chosen_store} (zelfde merk, zelfde product) is het ${eur(run.best_price)} geleverd in België. Dat scheelt ${eur(run.saving)}. Winkelmandje staat al klaar, je moet enkel nog betalen: ${run.cart_url}`;
  if (run.status === 'refused') return `${hi}Mijn agent heeft je link nagekeken in alle landenwinkels van het merk. "${item}" voor ${eur(run.source_price)} bij ${run.source_store} is al de beste keuze: nergens anders is het minstens 5 euro goedkoper mét levering naar België. Gewoon daar kopen dus.`;
  if (run.status === 'waiting') return `${hi}Mijn agent houdt "${item}" voor je in de gaten. Beste prijs nu is ${eur(run.best_price)}, hij vult zelf een winkelmandje zodra het onder ${eur(run.target)} zakt.`;
  if (run.status === 'cannot_help') return `${hi}Deze link kan mijn agent (nog) niet aan: hij werkt voor merken met een eigen webshop per land (UGREEN, Anker, eufy, soundcore, Shokz, xTool...), niet voor winkels zoals bol.com of Coolblue. Heb je iets van zo'n merk op het oog? Stuur maar door!`;
  return null;
}

// A readable title when the agent could not name the product: the words from the link, not the raw address.
function nice(r) {
  if (r.product_title) return r.product_title;
  const u = String(r.source_url ?? '');
  if (!/^https?:/i.test(u)) return u;
  try { const x = new URL(u); const seg = x.pathname.split('/').filter((p) => /[a-z]{3}/i.test(p)).sort((a, b) => b.length - a.length)[0] ?? ''; const words = decodeURIComponent(seg).replace(/\.html?$/, '').replace(/[-_+]/g, ' ').split(' ').slice(0, 7).join(' '); return `${words || 'Link'} (${x.hostname.replace('www.', '')})`; } catch { return u.slice(0, 70); }
}

export default function Stage() {
  const [rail, setRail] = useState(null);
  const [url, setUrl] = useState('');
  const [target, setTarget] = useState('');
  const [from, setFrom] = useState('');
  const [edit, setEdit] = useState({});
  const [ruleDoc, setRuleDoc] = useState(null);
  const [ruleText, setRuleText] = useState(null);
  const [ruleMsg, setRuleMsg] = useState('');
  const openRules = async () => { setRuleMsg('Reading from Senso…'); const d = await fetch('/api/rules').then((r) => r.json()).catch(() => null); if (d?.text) { setRuleDoc(d); setRuleText(d.text); setRuleMsg(''); } else setRuleMsg(d?.error ?? 'Could not read the rules'); };
  const saveRules = async () => { setRuleMsg('Saving to Senso and waiting for the new version…'); const d = await fetch('/api/rules', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: ruleText }) }).then((r) => r.json()).catch(() => null); if (d?.ok) { setRuleDoc(d); setRuleMsg(d.unchanged ? 'Nothing changed.' : `Saved. Senso now holds version ${d.version}. The next run reads it.`); } else setRuleMsg(d?.error ?? 'Saving failed'); };
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState({ runs: [], stats: [], watches: [], totals: null });
  const [sel, setSel] = useState(null);
  const [detail, setDetail] = useState(null);
  const [open, setOpen] = useState(null);

  const loadRuns = useCallback(async () => { const d = await fetch('/api/runs').then((r) => r.json()).catch(() => null); if (d?.runs) setData(d); return d; }, []);
  useEffect(() => { const q = new URLSearchParams(location.search).get('run'); if (q) setSel(q); loadRuns().then((d) => { if (!q && d?.runs?.[0]) setSel(d.runs[0].id); }); const t = setInterval(loadRuns, 4000); return () => clearInterval(t); }, [loadRuns]);
  useEffect(() => {
    if (!sel) return; let stop = false;
    const tick = async () => { const d = await fetch('/api/runs/' + sel).then((r) => r.json()).catch(() => null); if (stop) return; if (d?.run) setDetail(d); if (!d?.run || d.run.status === 'running') setTimeout(tick, 1200); };
    setDetail(null); setOpen(null); tick(); return () => { stop = true; };
  }, [sel]);

  const share = async (gate) => {
    if (!url) return; setBusy(true);
    const r = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, gate, target, from }) }).then((x) => x.json());
    setBusy(false); if (r.id) { setSel(r.id); setUrl(''); setTarget(''); loadRuns(); } else alert(r.error);
  };

  const watch = async (body) => { await fetch('/api/watch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); loadRuns(); };
  // Follow a standing order: when the agent starts a new check for the run on screen, show it.
  useEffect(() => { const cur = data.runs.find((r) => r.id === sel); if (!cur?.watch_id) return; const newest = data.runs.find((r) => r.watch_id === cur.watch_id); if (newest && newest.id !== sel) setSel(newest.id); }, [data.runs, sel]);
  const tot = data.totals;
  const run = detail?.run; const rules = run?.summary?.rules; const chunks = run?.summary?.senso_chunks ?? [];
  const offers = detail?.offers ?? []; const steps = detail?.steps ?? [];
  const countryOf = Object.fromEntries(offers.map((o) => [o.store, o.store_country]));
  const flagOf = (store) => flag(countryOf[store] ?? (/^([a-z]{2})\./.exec(store ?? '')?.[1]));
  const oflag = (o) => flag(o.store_country ?? (/^([a-z]{2})\./.exec(o.store ?? '')?.[1]));
  const same = offers.filter((o) => o.same_item).sort((a, b) => (ORDER[a.decision] ?? 9) - (ORDER[b.decision] ?? 9) || Number(a.landed ?? a.price) - Number(b.landed ?? b.price));
  const others = offers.filter((o) => !o.same_item);
  const reply = run ? replyText(run) : null;
  const usedTools = [...new Set(steps.map((s) => s.tool))];
  // On a phone the drawer closes once a run is picked.
  useEffect(() => { setRail((r) => (r === true && !window.matchMedia('(min-width: 1000px)').matches ? false : r)); }, [sel]);
  const railCls = rail == null ? '' : rail ? ' rail-open' : ' rail-closed';
  return (
    <div className={'v2' + railCls}>
      <nav className="s-switch" aria-label="Design versions"><a href="/">Classic</a><a href="/v2" className="on">Stage</a><a href="/v3">V3</a></nav>
      <header className="s-top">
        <button className="s-railbtn" onClick={() => setRail(rail == null ? !window.matchMedia('(min-width: 1000px)').matches : !rail)} aria-label="Show or hide runs and standing orders"><span aria-hidden="true">☰</span> Runs <b>{data.runs.length}</b></button>
        <div className="s-brand"><span className="s-logo" aria-hidden="true">⇄</span><h1>Country Switch</h1></div>
        <p className="s-tag">Same brand, same product, cheaper next door. Share a link and the agent fills the cart or refuses, and shows why.</p>
      </header>
      {tot && <div className="s-stats">
        <div className="s-stat"><b>{tot.links}</b><span>links checked</span></div>
        {Number(tot.people) > 0 && <><div className="s-stat"><b>{tot.friends_asked}</b><span>friends asked</span></div><div className="s-stat"><b>{tot.requests}</b><span>requests</span></div></>}
        <div className="s-stat"><b>{tot.helped}</b><span>cheaper next door</span></div>
        <div className="s-stat good"><b>{eur(tot.saved)}</b><span>found</span></div>
      </div>}
      <div className="s-layout">
        <aside className="s-rail">
          <div className="s-rail-head"><span>Runs and standing orders</span><button className="s-x" onClick={() => setRail(false)} aria-label="Close">×</button></div>
          {data.watches?.length > 0 && (<section className="s-side">
            <h3>Standing orders</h3><div className="s-sub">The agent keeps watching</div>
            <ul className="s-runs">{data.watches.map((w) => (
              <li key={w.id} className={w.last_run_id === sel ? 'on' : ''} onClick={() => w.last_run_id && setSel(w.last_run_id)}>
                <div className="t">{nice(w)}</div>
                <div className="s"><span>buy under {eur(w.target)}{w.last_best ? ` · now ${eur(w.last_best)} at ${w.last_store}` : ''}</span><span className={'s-badge ' + (w.status === 'triggered' ? 'ok' : 'run')}><i />{w.status === 'triggered' ? 'cart filled' : 'watching'}</span></div>
                <div className="s wrap" onClick={(e) => e.stopPropagation()}><span>{w.checks} checks{w.shared_by ? ` · for ${w.shared_by}` : ''}</span>
                  <span className="s-mini"><input value={edit[w.id] ?? ''} onChange={(e) => setEdit({ ...edit, [w.id]: e.target.value })} placeholder="new €" /><button onClick={() => edit[w.id] && watch({ id: w.id, target: edit[w.id] }).then(() => setEdit({ ...edit, [w.id]: '' }))}>set</button><button onClick={() => watch({ id: w.id, stop: true })}>stop</button></span></div>
              </li>))}</ul>
          </section>)}
          <section className="s-side">
            <h3>Runs</h3>
            <ul className="s-runs scrolly">
              {data.runs.map((r) => (
                <li key={r.id} className={(r.id === sel ? 'on ' : '') + 'st-' + CLS[r.status]} onClick={() => setSel(r.id)}>
                  <div className="t">{nice(r)}</div>
                  <div className="s"><span>{r.shared_by ? r.shared_by + ' · ' : ''}{r.source_store} {r.status === 'cart_filled' ? `→ ${r.chosen_store}` : ''}</span><span className={'s-badge ' + CLS[r.status] + (r.status === 'running' ? ' live' : '')}><i />{LABEL[r.status] ?? r.status}{r.status === 'cart_filled' ? ' −' + eur(r.saving) : ''}</span></div>
                </li>
              ))}
            </ul>
          </section>
          <section className="s-side">
            <h3>The loop</h3><div className="s-sub">Same-item check on or off</div>
            <table className="s-loop"><thead><tr><th>Check</th><th>Runs</th><th>Carts</th><th>Wrong item</th><th>Saved</th></tr></thead>
              <tbody>{data.stats.map((s) => <tr key={s.check_mode}><td><span className={'s-tool ' + (TOOLS.includes(s.check_mode) ? s.check_mode : 'agent')}>{s.check_mode}</span></td><td className="num">{s.runs}</td><td className="num">{s.carts}</td><td className={'num' + (Number(s.wrong_item) ? ' bad' : '')}>{s.wrong_item}</td><td className="num">{eur(s.honest_saving)}</td></tr>)}</tbody></table>
            <div className="s-hint">Live SQL on the SingleStore ledger. The check sits behind a Statsig gate; each run is a session in Amplitude.</div>
          </section>
        </aside>
        <div className="s-scrim" onClick={() => setRail(false)} />
        <main className="s-stage">
          <div className="s-share">
            <input className="main" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a product link from any shop, or just name the product" onKeyDown={(e) => e.key === 'Enter' && share()} />
            <input className="small" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="buy under € (optional)" inputMode="decimal" />
            <input className="small" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="from (optional)" />
            <button className="s-btn go" disabled={busy} onClick={() => share()}>{busy ? 'Starting…' : target ? 'Place standing order' : 'Share link'}</button>
          </div>
          <details className="s-fold slim">
            <summary>Share without this page: share sheet or bookmarklet</summary>
            <div className="s-hint">Also works without this page: any share sheet or bookmarklet can call <code>/api/run?url=…</code>. The agent runs alone and reports back here.</div>
            <p className="s-bm" dangerouslySetInnerHTML={{ __html: `On Amazon or any other shop: drag this button to your bookmarks bar and click it on a product page. Your own browser sends the page, the product name and the price you see. <a class="s-bmbtn" href="javascript:(()=>{const q=s=>document.querySelector(s);const t=((q('#productTitle')||q('h1')||{}).textContent||document.title).trim().slice(0,200);const az=/amazon\\./.test(location.hostname);const p=q('#corePrice_feature_div .a-offscreen')||q('#corePriceDisplay_desktop_feature_div .a-offscreen')||q('#apex_desktop .a-offscreen')||(az?null:(q('[itemprop=price]')||q('[data-test=price]')||q('.price')))||{};const pv=(p.textContent||p.content||'').trim();window.open('http://localhost:3311/api/run?url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(t)+'&price='+encodeURIComponent(pv))})()">Send to Country Switch</a>` }} />
          </details>

          {!run && <div className="s-empty">{sel ? 'Loading the run…' : 'Share a product link to start a run.'}</div>}
          {run && (<>
            <Hero run={run} flagOf={flagOf} />

            {same.length > 0 && (<section className="s-block">
              <h2>Border crossing <span>the same item, country by country</span></h2>
              <div className="s-strip">{same.map((o, i) => (
                <a key={i} className={'s-tile d-' + o.decision} href={o.url} target="_blank" rel="noreferrer" title={o.reason ?? ''}>
                  <div className="s-tile-head"><span className="s-flag">{oflag(o)}</span><span className="s-status">{TILE[o.decision] ?? DEC[o.decision] ?? o.decision}</span></div>
                  <div className="s-host">{o.store}</div>
                  <div className="s-total">{money(o.landed ?? o.price, o.currency)}</div>
                  <div className="s-lines"><span>price {money(o.price, o.currency)}</span><span>{delivery(o) ? `delivery ${delivery(o)}` : o.ships_to_buyer === 0 ? 'no delivery to you' : ''}</span></div>
                  {o.reason && <div className="s-why">{shortReason(o.reason)}</div>}
                </a>))}</div>
            </section>)}

            <section className="s-term">
              <div className="s-term-head"><span className="s-lights" aria-hidden="true"><i /><i /><i /></span><h3>audit trail: every step, in order</h3><span className="s-toolrow">{TOOLS.filter((t) => usedTools.includes(t)).map((t) => <span key={t} className={'s-tool ' + t}>{t}</span>)}</span></div>
              <ul className="s-log">{steps.map((s, si) => (
                <li key={si} className={s.status + (open === si ? ' open' : '')} onClick={() => setOpen(open === si ? null : si)}>
                  <div className="s-line">
                    <span className="n">{String(s.seq).padStart(2, '0')}</span>
                    <span className={'s-tool ' + s.tool}>{s.tool}</span>
                    <span className="act">{s.action}</span>
                    <span className="sum">{s.summary}</span>
                    <span className="ms">{s.ms} ms</span>
                  </div>
                  {open === si && <pre onClick={(e) => e.stopPropagation()}>{JSON.stringify(s.detail, null, 2)}</pre>}
                </li>))}
                {steps.length === 0 && <li className="none"><div className="s-line"><span className="sum">No steps recorded yet.</span></div></li>}</ul>
              <div className="s-hint pad">Click a line to see the raw data behind it. Stored in SingleStore, mirrored to Amplitude; lessons go to Cognee.</div>
            </section>

            <div className="s-lower">
              {reply && (<section className="s-card">
                <div className="s-card-head"><h3>Reply for {run.shared_by || 'the person who shared this'}</h3>
                  <button className="s-btn go small" onClick={(e) => { navigator.clipboard?.writeText(reply); e.currentTarget.textContent = 'Copied'; }}>Copy</button></div>
                <div className="s-bubble">{reply}</div>
              </section>)}

              {run.summary?.timing && (<section className={'s-card s-timing ' + run.summary.timing.moment}>
                <div className="s-card-head"><h3>Is this a good moment to buy?</h3><span className="s-tool singlestore">singlestore</span></div>
                <div className="s-big2">{run.summary.timing.moment === 'good' ? 'Yes, good moment.' : run.summary.timing.moment === 'wait' ? 'Not the best moment.' : 'Fair moment.'}</div>
                <div>{run.summary.timing.why}</div>
                <PriceChart t={run.summary.timing} />
                <div className="s-hint">Price history comes from the agent's own ledger in SingleStore: every run adds an observation per shop. Tracking started on {run.summary.timing.since}.</div>
              </section>)}

              {rules && (<section className="s-card wide">
                <div className="s-card-head"><h3>Your rules, read from Senso before acting</h3><span className="s-tool senso">senso</span></div>
                <ol className="s-rules">{Object.values(rules).filter(Boolean).sort().map((r) => { const x = parseRule(r); const used = x.n && String(run.verdict ?? '').includes(`Rule ${x.n} `);
                  return <li key={r} className={used ? 'used' : ''}>{x.n && <span className="num">{x.n}</span>}<div>{x.name && <b>{x.name}{used ? ' · applied in this decision' : ''}</b>}<span>{x.text}</span></div></li>; })}</ol>
                {chunks[0] && <div className="s-hint">Source: “{chunks[0].title}”, content {chunks[0].content_id?.slice(0, 8)}, version {chunks[0].version_id?.slice(0, 8)}</div>}
                <div className="s-ruleedit">
                  {ruleText == null ? <button className="s-ghost" onClick={openRules}>Edit my rules in Senso</button> : (<>
                    <textarea value={ruleText} onChange={(e) => setRuleText(e.target.value)} rows={9} spellCheck={false} />
                    <div className="s-rulebar"><button className="s-ghost" onClick={saveRules}>Save as a new version in Senso</button><button className="s-ghost" onClick={() => { setRuleText(null); setRuleMsg(''); }}>Close</button>{ruleDoc && <small>Document “{ruleDoc.title}”, version {ruleDoc.version}</small>}</div></>)}
                  {ruleMsg && <div className="s-hint">{ruleMsg}</div>}
                </div>
              </section>)}

              {run.summary?.past_decisions?.length > 0 && (<section className="s-card wide">
                <div className="s-card-head"><h3>Decision memory in Senso: this item came up before</h3><span className="s-tool senso">senso</span></div>
                {run.summary.past_decisions.slice(0, 3).map((d) => <div className="s-memo" key={d.content_id}>{d.text}<small>{d.title} · Senso document {String(d.content_id).slice(0, 8)}</small></div>)}
              </section>)}
            </div>

            {others.length > 0 && (<details className="s-fold">
              <summary><b>{others.length}</b>&nbsp;other {others.length === 1 ? 'listing was' : 'listings were'} not the same item (bundles, other models)</summary>
              <ul className="s-others">{others.map((o, i) => (
                <li key={i}><span className="s-flag">{oflag(o)}</span><div><a href={o.url} target="_blank" rel="noreferrer">{o.title}</a><small>{o.store} · {money(o.price, o.currency)}{o.same_item_score != null ? ` · match ${Number(o.same_item_score).toFixed(2)}` : ''}</small><small>{o.reason}</small></div></li>))}</ul>
            </details>)}
            {offers.length > 0 && (<details className="s-fold">
              <summary>Show all {offers.length} offers as a table</summary>
              <div className="s-scroll"><table className="s-table"><thead><tr><th>Shop</th><th>Listing</th><th>SKU</th><th>Price</th><th>Delivery</th><th>Total</th><th>Same item</th><th>Ships to you</th><th>Decision</th></tr></thead>
                <tbody>{offers.map((o, i) => (
                  <tr key={i} className={o.decision === 'chosen' ? 'chosen' : o.decision === 'refused' ? 'refused' : o.decision === 'not_same_item' || o.decision === 'not_needed' || o.decision === 'not_cheaper' ? 'dim' : ''}>
                    <td>{o.store}</td><td><a href={o.url} target="_blank" rel="noreferrer">{o.title}</a></td><td className="num">{o.sku}</td><td className="num">{eur(o.price)}</td><td className="num" title={o.ship_method ?? ''}>{delivery(o)}</td><td className="num">{o.landed == null ? '' : eur(o.landed)}</td>
                    <td>{o.same_item ? 'yes' : 'no'}{o.same_item_score != null ? ` (${Number(o.same_item_score).toFixed(2)})` : ''}</td><td>{o.ships_to_buyer == null ? '' : o.ships_to_buyer ? 'yes' : 'no'}</td>
                    <td><b>{DEC[o.decision] ?? o.decision}</b><br /><span className="why">{o.reason}</span></td>
                  </tr>))}</tbody></table></div>
            </details>)}
          </>)}
        </main>
      </div>
    </div>
  );
}
