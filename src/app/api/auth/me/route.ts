import { handler, json } from "@/server/http";

export const GET = handler(async (_req, _ctx, user) => json({ user }), { auth: false });
