import { startRun } from '@/lib/agent.mjs';
import { rows } from '@/lib/s2.mjs';
// One message in, one answer out. This is the door a simulated shopper (Firedrill) uses: it says what it wants and where it lives,
// the agent does a full real run, and the reply states what it did. The cart link and the run id are in the reply so they can be checked.
const COUNTRIES = { belgium: ['BE', '3500'], 'the netherlands': ['NL', '1011'], netherlands: ['NL', '1011'], germany: ['DE', '10115'], france: ['FR', '75001'], spain: ['ES', '28001'], italy: ['IT', '00100'] };
export async function POST(req) {
  const b = await req.json().catch(() => ({}));
  const msg = String(b.message ?? '').trim();
  if (msg.length < 3) return Response.json({ reply: 'Tell me which product you want: a link or a name.' });
  const url = (msg.match(/https?:\/\/[^\s)>"']+/) ?? [])[0];
  const low = msg.toLowerCase();
  const where = Object.keys(COUNTRIES).find((k) => low.includes(k));
  const [country, postal] = where ? COUNTRIES[where] : [undefined, undefined];
  const name = msg.replace(/https?:\/\/\S+/g, ' ').replace(/^[\s\S]*?\b(?:buy|buying|looking for|want|need|find|order)\b\s*(?:to buy\s*)?(?:an?\s+|the\s+|some\s+)?/i, '').split(/[.?!,]|\b(?:and i|i live|i am|for my|deliver)/i)[0].trim();
  const input = url ?? name;
  if (!input || input.length < 3) return Response.json({ reply: 'I could not tell which product you mean. Send a product link or its name.' });
  const { id, done } = await startRun(input, { country, postal, sharedBy: b.session ? `sim:${String(b.session).slice(0, 40)}` : undefined });
  await done;
  const [r] = await rows('SELECT status, verdict, cart_url, chosen_store, best_price, saving, buyer_country FROM cs_runs WHERE id = ?', [id]);
  const head = r.status === 'cart_filled' ? `I filled a cart for you at ${r.chosen_store}.` : r.status === 'refused' ? 'I did not fill a cart.' : r.status === 'cannot_help' ? 'I cannot help with this one.' : 'Something went wrong.';
  return Response.json({ reply: `${head} ${r.verdict ?? ''}${r.cart_url ? ` Cart: ${r.cart_url}` : ''} (run ${id}, buyer country ${r.buyer_country ?? 'unknown'})`, run_id: id, status: r.status, cart_url: r.cart_url, saving: r.saving, buyer_country: r.buyer_country });
}
