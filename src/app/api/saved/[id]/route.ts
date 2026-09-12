import { fail, handler, json } from "@/server/http";
import { deleteSaved, getSaved, MAX_RECORD_BYTES, upsertSaved } from "@/server/saved-transcripts";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler<Ctx>(async (_req, { params }, user) => {
  const record = getSaved(user!.id, (await params).id);
  return record ? json({ record }) : fail("This transcript isn't saved to your account.", 404);
});

/** PUT the full transcript record to save (or update) it in the account. */
export const PUT = handler<Ctx>(async (req, { params }, user) => {
  const { id } = await params;
  const text = await req.text();
  if (text.length > MAX_RECORD_BYTES) return fail("This transcript is too large to save to your account.", 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
    upsertSaved(user!.id, id, body, text);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Invalid transcript.", 400);
  }
  return json({ saved: true });
});

export const DELETE = handler<Ctx>(async (_req, { params }, user) => {
  deleteSaved(user!.id, (await params).id);
  return json({ removed: true });
});
