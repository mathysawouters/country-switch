import { sensoRuleDoc, sensoSaveRules } from '@/lib/sponsors.mjs';
// The shopper's rules live in Senso. This reads the document and saves an edit as a new version.
export async function GET() { try { return Response.json(await sensoRuleDoc()); } catch (e) { return Response.json({ error: e.message }, { status: 500 }); } }
export async function PUT(req) {
  const b = await req.json().catch(() => ({}));
  if (!b.text || b.text.length < 40 || !/Rule 1 \(/.test(b.text)) return Response.json({ error: 'The rules text must keep its "Rule N (name): ..." lines' }, { status: 400 });
  try { return Response.json(await sensoSaveRules(b.text)); } catch (e) { return Response.json({ error: e.message }, { status: 500 }); }
}
