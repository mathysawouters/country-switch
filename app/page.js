'use client';
import { useEffect, useState, useCallback } from 'react';

const eur = (n) => (n == null ? '' : '€' + Number(n).toFixed(2));
const LABEL = { cart_filled: 'cart filled', refused: 'refused', running: 'running', error: 'error', waiting: 'waiting for price', cannot_help: 'cannot help' };
const CLS = { cart_filled: 'ok', refused: 'no', running: 'run', error: 'no', waiting: 'run', cannot_help: 'run' };
const DEC = { chosen: 'chosen', refused: 'refused by your rule', not_same_item: 'not the same item', source: 'where you were', not_needed: 'not needed', not_cheaper: 'not cheaper' };

const COLORS = ['#0a0a0a', '#0a7a3d', '#b42318', '#6b6b6b', '#8a5a00', '#3b3b9a', '#00707a'];
function PriceChart({ t }) {
  const h = (t.history ?? []).map((x) => ({ ...x, price: Number(x.price), ms: Date.parse(x.seen.replace(' ', 'T') + 'Z') })).filter((x) => x.price < 1000);
  if (h.length < 2) return null;
  const stores = [...new Set(h.map((x) => x.store))];
  const W = 640, H = 170, L = 44, R = 110, T = 10, B = 22;
  const t0 = Math.min(...h.map((x) => x.ms)), t1 = Math.max(...h.map((x) => x.ms));
  const lo = Math.min(...h.map((x) => x.price)) * 0.95, hi = Math.max(...h.map((x) => x.price)) * 1.03;
  const X = (ms) => L + ((ms - t0) / Math.max(1, t1 - t0)) * (W - L - R), Y = (p) => T + (1 - (p - lo) / Math.max(0.01, hi - lo)) * (H - T - B);
  const day = (ms) => new Date(ms).toISOString().slice(5, 16).replace('T', ' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: 640, marginTop: 10 }} role="img" aria-label="Price history per country shop">
      {[lo / 0.95, hi / 1.03].map((p) => <g key={p}><line x1={L} x2={W - R} y1={Y(p)} y2={Y(p)} stroke="#e4e4e4" /><text x={L - 6} y={Y(p) + 4} textAnchor="end" fontSize="11" fill="#6b6b6b">€{p.toFixed(0)}</text></g>)}
      <text x={L} y={H - 6} fontSize="11" fill="#6b6b6b">{day(t0)} UTC</text><text x={W - R} y={H - 6} textAnchor="end" fontSize="11" fill="#6b6b6b">{day(t1)} UTC</text>
      {stores.map((s, i) => { const pts = h.filter((x) => x.store === s); const c = s === t.store ? '#0a7a3d' : COLORS[(i % (COLORS.length - 1)) + 2] ?? '#6b6b6b';
        return <g key={s}><polyline fill="none" stroke={c} strokeWidth={s === t.store ? 2.5 : 1.2} points={pts.map((x) => `${X(x.ms)},${Y(x.price)}`).join(' ')} />{pts.map((x, j) => <circle key={j} cx={X(x.ms)} cy={Y(x.price)} r={s === t.store ? 3 : 2} fill={c} />)}</g>; })}
      {Object.entries(stores.reduce((m, s) => { const p = h.filter((x) => x.store === s).pop().price.toFixed(2); (m[p] ||= []).push(s.split('.')[0]); return m; }, {})).map(([p, names]) => <text key={p} x={W - R + 6} y={Y(Number(p)) + 4} fontSize="11" fill={names.includes(t.store.split('.')[0]) ? '#0a7a3d' : '#6b6b6b'} fontWeight={names.includes(t.store.split('.')[0]) ? 700 : 400}>{names.join(', ')} €{p}</text>)}
    </svg>
  );
}

// A ready-to-send answer for the person who shared the link (Dutch, for friends back home).
function replyText(run) {
  const hi = run.shared_by ? `Hey ${run.shared_by}! ` : 'Hey! ';
  const item = run.product_title ?? 'je product';
  if (run.status === 'cart_filled') return `${hi}Mijn agent heeft je link nagekeken. "${item}" kost ${eur(run.source_price)} bij ${run.source_store}, maar bij ${run.chosen_store} (zelfde merk, zelfde product) is het ${eur(run.best_price)} geleverd in België. Dat scheelt ${eur(run.saving)}. Winkelmandje staat al klaar, je moet enkel nog betalen: ${run.cart_url}`;
  if (run.status === 'refused') return `${hi}Mijn agent heeft je link nagekeken in alle landenwinkels van het merk. "${item}" voor ${eur(run.source_price)} bij ${run.source_store} is al de beste keuze: nergens anders is het minstens 5 euro goedkoper mét levering naar België. Gewoon daar kopen dus.`;
  if (run.status === 'waiting') return `${hi}Mijn agent houdt "${item}" voor je in de gaten. Beste prijs nu is ${eur(run.best_price)}, hij vult zelf een winkelmandje zodra het onder ${eur(run.target)} zakt.`;
  if (run.status === 'cannot_help') return `${hi}Deze link kan mijn agent (nog) niet aan: hij werkt voor merken met een eigen webshop per land (UGREEN, Anker, eufy, soundcore, Shokz, xTool...), niet voor winkels zoals bol.com of Coolblue. Heb je iets van zo'n merk op het oog? Stuur maar door!`;
  return null;
}

export default function Home() {
  const [url, setUrl] = useState('');
  const [target, setTarget] = useState('');
  const [from, setFrom] = useState('');
  const [edit, setEdit] = useState({});
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
  return (
    <div className="wrap">
      {tot && <div className="counter"><b>{tot.links}</b> links checked{Number(tot.people) > 0 && <> for <b>{tot.people}</b> people</>} · cheaper next door on <b>{tot.helped}</b> of them · <b>{eur(tot.saved)}</b> found</div>}
      <header><h1>Country Switch</h1><span className="tag">Same shop, same product, cheaper next door. It fills the cart or refuses, and shows why.</span></header>
      <div className="share">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Share a product link (no chat, the agent does the rest)" onKeyDown={(e) => e.key === 'Enter' && share()} />
        <input className="small" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="buy under € (optional)" inputMode="decimal" />
        <input className="small" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="from (optional)" />
        <button disabled={busy} onClick={() => share()}>{busy ? 'Starting…' : target ? 'Place standing order' : 'Share link'}</button>
      </div>
      <div className="hint">Also works without this page: any share sheet or bookmarklet can call <code>/api/run?url=…</code>. The agent runs alone and reports back here.</div>
      <div className="grid">
        <aside>
          {data.watches?.length > 0 && (<><h2>Standing orders: the agent keeps watching</h2>
            <ul className="runs">{data.watches.map((w) => (
              <li key={w.id} className={w.last_run_id === sel ? 'on' : ''} onClick={() => w.last_run_id && setSel(w.last_run_id)}>
                <div className="t">{w.product_title ?? w.source_url}</div>
                <div className="s"><span>buy under {eur(w.target)}{w.last_best ? ` · now ${eur(w.last_best)} at ${w.last_store}` : ''}</span><span className={'pill ' + (w.status === 'triggered' ? 'ok' : 'run')}>{w.status === 'triggered' ? 'cart filled' : 'watching'}</span></div>
                <div className="s" onClick={(e) => e.stopPropagation()}><span>{w.checks} checks{w.shared_by ? ` · for ${w.shared_by}` : ''}</span>
                  <span className="mini"><input value={edit[w.id] ?? ''} onChange={(e) => setEdit({ ...edit, [w.id]: e.target.value })} placeholder="new €" /><button className="ghost" onClick={() => edit[w.id] && watch({ id: w.id, target: edit[w.id] }).then(() => setEdit({ ...edit, [w.id]: '' }))}>set</button><button className="ghost" onClick={() => watch({ id: w.id, stop: true })}>stop</button></span></div>
              </li>))}</ul></>)}
          <h2>Runs</h2>
          <ul className="runs">
            {data.runs.map((r) => (
              <li key={r.id} className={r.id === sel ? 'on' : ''} onClick={() => setSel(r.id)}>
                <div className="t">{r.product_title ?? r.source_url}</div>
                <div className="s"><span>{r.shared_by ? r.shared_by + ' · ' : ''}{r.source_store} {r.status === 'cart_filled' ? `→ ${r.chosen_store}` : ''}</span><span className={'pill ' + CLS[r.status]}>{LABEL[r.status] ?? r.status}{r.status === 'cart_filled' ? ' −' + eur(r.saving) : ''}</span></div>
              </li>
            ))}
          </ul>
          <h2>The loop: same-item check on or off</h2>
          <table className="stats"><thead><tr><th>Check</th><th>Runs</th><th>Carts</th><th>Wrong item</th><th>Saved</th></tr></thead>
            <tbody>{data.stats.map((s) => <tr key={s.check_mode}><td>{s.check_mode}</td><td className="num">{s.runs}</td><td className="num">{s.carts}</td><td className="num" style={{ color: Number(s.wrong_item) ? 'var(--no)' : undefined }}>{s.wrong_item}</td><td className="num">{eur(s.honest_saving)}</td></tr>)}</tbody></table>
          <div className="hint">Live SQL on the SingleStore ledger. The check sits behind a Statsig gate; each run is a session in Amplitude.</div>
        </aside>
        <main>
          {!run && <div className="empty">Share a product link to start a run.</div>}
          {run && (<>
            <div className={'verdict ' + (CLS[run.status] ?? '')}>
              <div className="big">{run.status === 'running' ? 'Working on it…' : run.status === 'cart_filled' ? `Cart filled at ${run.chosen_store}. You save ${eur(run.saving)}.` : run.status === 'refused' ? 'Refused: no switch.' : run.status === 'waiting' ? `Not yet. Watching for under ${eur(run.target)}.` : run.status === 'cannot_help' ? 'Cannot help with this link.' : 'Run failed'}</div>
              <div>{run.product_title} {run.sku ? `· SKU ${run.sku}` : ''} {run.source_price ? `· ${eur(run.source_price)} at ${run.source_store}` : ''}</div>
              {run.status !== 'running' && <div style={{ marginTop: 8 }}>{run.verdict}</div>}
              <div className="row">
                {run.cart_url && <a className="btn" href={run.cart_url} target="_blank" rel="noreferrer">Open the filled cart · {eur(run.best_price)}</a>}
                <span className="pill run">same-item check: {run.gate_same_item ? 'Superlinked (gate ON)' : 'naive (gate OFF)'}</span>
                <span className="pill run">buyer country {run.buyer_country}</span>
              </div>
            </div>
            {replyText(run) && (<><h2>Reply for {run.shared_by || 'the person who shared this'}</h2>
              <div className="quote">{replyText(run)}<small><button className="ghost" style={{ padding: '4px 10px', marginTop: 6 }} onClick={(e) => { navigator.clipboard?.writeText(replyText(run)); e.target.textContent = 'Copied'; }}>Copy</button></small></div></>)}
            {rules && (<><h2>Your rules, read from Senso before acting</h2>
              {Object.values(rules).filter(Boolean).sort().map((r) => <div className="quote" key={r}>{r}</div>)}
              {chunks[0] && <div className="hint">Source: “{chunks[0].title}”, content {chunks[0].content_id?.slice(0, 8)}, version {chunks[0].version_id?.slice(0, 8)}</div>}</>)}
            {run.summary?.timing && (<><h2>Is this a good moment to buy?</h2>
              <div className={'timing ' + run.summary.timing.moment}>
                <div className="big2">{run.summary.timing.moment === 'good' ? 'Yes, good moment.' : run.summary.timing.moment === 'wait' ? 'Not the best moment.' : 'Fair moment.'}</div>
                <div>{run.summary.timing.why}</div>
                <PriceChart t={run.summary.timing} />
                <div className="hint">Price history comes from the agent's own ledger in SingleStore: every run adds an observation per shop. Tracking started on {run.summary.timing.since}.</div>
              </div></>)}
            {run.summary?.past_decisions?.length > 0 && (<><h2>Decision memory in Senso: this item came up before</h2>
              {run.summary.past_decisions.slice(0, 3).map((d) => <div className="quote" key={d.content_id}>{d.text}<small>{d.title} · Senso document {String(d.content_id).slice(0, 8)}</small></div>)}</>)}
            <h2>Every offer the agent looked at</h2>
            <div className="scroll"><table><thead><tr><th>Shop</th><th>Listing</th><th>SKU</th><th>Price</th><th>Delivery</th><th>Total</th><th>Same item</th><th>Ships to you</th><th>Decision</th></tr></thead>
              <tbody>{(detail.offers ?? []).map((o, i) => (
                <tr key={i} className={o.decision === 'chosen' ? 'chosen' : o.decision === 'refused' ? 'refused' : o.decision === 'not_same_item' || o.decision === 'not_needed' || o.decision === 'not_cheaper' ? 'dim' : ''}>
                  <td>{o.store}</td><td><a href={o.url} target="_blank" rel="noreferrer">{o.title}</a></td><td className="num">{o.sku}</td><td className="num">{eur(o.price)}</td><td className="num" title={o.ship_method ?? ''}>{o.shipping == null ? '' : Number(o.shipping) === 0 ? 'free' : eur(o.shipping)}</td><td className="num">{o.landed == null ? '' : eur(o.landed)}</td>
                  <td>{o.same_item ? 'yes' : 'no'}{o.same_item_score != null ? ` (${Number(o.same_item_score).toFixed(2)})` : ''}</td><td>{o.ships_to_buyer == null ? '' : o.ships_to_buyer ? 'yes' : 'no'}</td>
                  <td><b>{DEC[o.decision] ?? o.decision}</b><br /><span style={{ fontWeight: 400 }}>{o.reason}</span></td>
                </tr>))}</tbody></table></div>
            <h2>Audit trail: every step, in order</h2>
            <ul className="steps">{(detail.steps ?? []).map((s) => (
              <li key={s.seq} className={s.status} onClick={() => setOpen(open === s.seq ? null : s.seq)}>
                <span className="n">{String(s.seq).padStart(2, '0')}</span><span className="tool"><b>{s.tool}</b> {s.action}</span><span>{s.summary}</span><span className="ms">{s.ms} ms</span>
                {open === s.seq && <pre>{JSON.stringify(s.detail, null, 2)}</pre>}
              </li>))}</ul>
            <div className="hint">Click a step to see the raw data behind it. Stored in SingleStore, mirrored to Amplitude; lessons go to Cognee.</div>
          </>)}
        </main>
      </div>
    </div>
  );
}
