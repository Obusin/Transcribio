import { handler, json } from "@/server/http";
import { listSaved } from "@/server/saved-transcripts";

/** GET → summaries of the transcripts this account chose to save. */
export const GET = handler(async (_req, _ctx, user) => json({ items: listSaved(user!.id) }));
