import { startRun } from '../lib/agent.mjs';
import { rows } from '../lib/s2.mjs';
const list = [
  ['Michiel', 'https://www.bol.com/be/nl/p/philips-series-7000-multigroom-baardtrimmer-17-in-1-neushaartrimmer-precisietrimmer-lichaamstrimmer-wenkbrauwtrimmer-face-hair-body-scheersensor-opbergzakje-staal-mg7951-15/9300000232759360/'],
  ['Michiel', 'https://www.lighting.philips.be/fr/consumer/p/plafonniers-plafonnier-mauve-16-w/8719514431843'],
  ['Camille', 'casio piano keyboard'], ['Camille', 'yamaha piano keyboard'], ['Camille', 'pioneer dj decks'], ['Camille', 'smartphones'], ['Camille', 'headphones'], ['Camille', 'eames stoel'],
  ['Camille', 'parfum'], ['Camille', 'printerinkt'], ['Camille', 'elektrische grasmaaier'], ['Camille', 'la marzocco koffiemachine'], ['Camille', 'elektrische fiets'], ['Camille', 'garmin sporthorloge'],
];
for (const [from, url] of list) {
  const { id, done } = await startRun(url, { sharedBy: from });
  await done;
  const [r] = await rows('SELECT status, product_title, source_store, source_price, chosen_store, best_price, saving, LEFT(verdict, 120) v FROM cs_runs WHERE id = ?', [id]);
  console.log(`${from.padEnd(8)} ${r.status.padEnd(12)} ${(r.product_title ?? url).slice(0, 40).padEnd(40)} ${r.source_store ?? ''} ${r.source_price ?? ''} -> ${r.chosen_store ?? '-'} ${r.best_price ?? ''} save ${r.saving ?? ''}${r.status === 'cannot_help' || r.status === 'error' ? ' | ' + r.v : ''}`);
}
