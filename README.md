# Country Switch

**Same shop, same product, cheaper next door.** A personal shopping agent with an audit trail, built at the Personal Agents Hackathon (20 Nov 2026).

Brands run one webshop per country and price the same item differently in each. On the day of the build one charger (same manufacturer SKU) cost €59.99 in the Spanish shop and €32.99 in the German one. Nobody checks seven country shops by hand.

You share a product link. There is no chat. The agent then, alone:

1. reads **your rules** from Senso (where you live, shipping, minimum saving, what "same item" means, your postal code). No rules, no action.
2. checks **Senso's decision memory**: has it decided on this exact item before?
3. recalls from **Cognee** what earlier runs learned about this brand's shops.
4. discovers the brand's sibling country shops and asks each one for the item through the **Shopify agent endpoints**, priced for a buyer in your country.
5. proves it is the **same single item**: identical SKU, or a verdict from small models on **Superlinked SIE** (bundles and look-alikes are thrown out, with the reason).
6. asks each shop's own cart for the **delivery cost to your postal code** and compares the total to your door, not shelf prices.
7. applies your rules cheapest first. Every refusal quotes the rule.
8. judges the **moment**: price history per shop lives in the same ledger, so it can say "34% under list and the lowest seen".
9. **fills a real cart** at the winning shop, or refuses and says why. You pay yourself; the agent never pays.
10. writes every step to **SingleStore** (the audit trail), mirrors it to **Amplitude**, writes the decision back to **Senso**, and stores what it learned in **Cognee**.

## Standing orders: a comparison site gives you a list, this takes an order

Add a target ("buy under €90, delivered") and the link becomes a standing order. The agent answers "Not yet" and a server-side timer keeps re-checking every country shop about once a minute, with no page open. When the total drops under the target (or you raise the target), it fills the cart on its own.

## Tested live on 20 Nov 2026

| Shared link | Result |
|---|---|
| UGREEN 100 W charger, Spanish shop | Cart at the German shop: €32.99 instead of €59.99. French shop refused (no delivery to Belgium) |
| eufy robot vacuum, German shop | Cart at the Dutch shop: €699 instead of €799 |
| soundcore earbuds, French shop | Cart at the EU shop: €99.99 instead of €129.99. UK shop refused (pounds) |
| UGREEN 100 W charger, Dutch shop | Refused: saves only €3, the rule says at least €5 |

## The loop (Statsig + Amplitude)

The Superlinked same-item check sits behind the Statsig feature gate `superlinked_same_item_check`.

- Gate **off**: the agent trusts the shop's search. It "saves" €28.31 by putting a 65 W bundle in the cart instead of the 100 W charger. Wrong item.
- Gate **on**: the bundle is rejected with a reason, the right charger is bought for €32.99.

Both arms are visible per run in Amplitude (`[Agent] Tool Call`, `[Agent] Run Completed` with `same_item_check` and `wrong_item`) and as one live SQL query on the SingleStore ledger on the home page. We kept the gate on.

## Sponsor tools and their job

| Tool | Job | Without it |
|---|---|---|
| Senso | Holds the shopper's rules; the agent reads and quotes them, checks them, and writes every decision back as a document it reads again next time | The agent has no authority to act |
| SingleStore | Ledger of runs, steps, offers, price history and standing orders; the trail page, the loop table and the counter are SQL on it | No audit trail, no price history |
| Superlinked SIE | `Qwen3.5-4B` + `GLiNER2.5-Decide` decide "same single item?" across languages | Wrong item in the cart |
| Statsig | Gate that switches the check on; outcome events | No controlled change |
| Amplitude | One session per run, one event per tool call, outcome per arm | No measurement |
| Cognee | Memory of what each shop did ("fr shop does not ship to BE"); the next run skips that lookup | Every run starts from zero |

## Run it

```bash
npm install
cp .env.example .env.local   # fill in the keys
node --env-file=.env.local scripts/setup.mjs   # tables + rules
npm run dev
```

Trigger a run without the page: `GET /api/run?url=<product link>` (share sheet, bookmarklet, webhook).
Command line: `node --env-file=.env.local scripts/run.mjs <product link> [on|off]`.

## Honest limits

- Works for brands whose country shops run on Shopify with the agent endpoint enabled.
- "Ships to you" is the Shop catalog's answer for a buyer in your country, and delivery cost is the shop cart's own quote; neither is a completed checkout. Some shops return no quote, and then the agent compares shelf prices and says so.
- Price history starts on the day of the build.
- The agent stops at a filled cart. Payment is yours.
