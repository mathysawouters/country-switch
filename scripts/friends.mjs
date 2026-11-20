// Runs the real requests friends sent (name, exactly what they sent), one at a time.
import { startRun } from '../lib/agent.mjs';
import { rows } from '../lib/s2.mjs';
const list = [
  ['Zoë', 'https://www.anker.com/eu-en/products/a1289?variant=42109767549118'],
  ['Zoë', 'https://ai-eu.ugreen.com/en-be/products/ugreen-nasync-dxp4800-plus-nas-storage'],
  ['Steve', 'https://www.coolblue.be/nl/product/944413/anker-eufy-video-doorbell-e340-chime-homebase-3.html'],
  ['Steve', 'https://www.eufy.com/nl/products/bundle-t8214311-1-t80303d1-1?ref=navimenu_1_1_4_2_img&variant=40767103828029'],
  ['Shaun', 'https://www.eufy.com/eu-en/robot-vacuum-e25?utm_source=chatgpt.com'],
  ['Steven', 'shokz openswim pro'],
  ['Yang Fan', 'https://repetto.com/en/products/camille-ballerinas-pommard-purple-v080vlux-1450-en'],
  ['Arda', 'https://oordoppen.be/howard-leight-max-25-paar-oordopjes/'],
  ['Thibault', 'sonos arc ultra'],
  ['Luca', 'apple iphone pro max'],
  ['Ingo', 'ddr5 ram'],
  ['Leandro', 'ferrari 348tb'],
];
for (const [from, url] of list) {
  const { id, done } = await startRun(url, { sharedBy: from });
  await done;
  const [r] = await rows('SELECT status, product_title, source_store, source_price, chosen_store, best_price, saving, LEFT(verdict, 150) v FROM cs_runs WHERE id = ?', [id]);
  console.log(`${from.padEnd(9)} ${r.status.padEnd(12)} ${(r.product_title ?? url).slice(0, 44).padEnd(44)} ${r.source_store ?? ''} ${r.source_price ?? ''} -> ${r.chosen_store ?? '-'} ${r.best_price ?? ''} save ${r.saving ?? ''}${r.status === 'cannot_help' || r.status === 'error' ? ' | ' + r.v : ''}`);
}
