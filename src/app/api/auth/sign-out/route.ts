import { endSession, SESSION_COOKIE } from "@/server/auth";
import { accountsDisabled, handler, json } from "@/server/http";

export const POST = handler(
  async (req) => {
    const off = accountsDisabled();
    if (off) return off;
    const token = req.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
    endSession(token ? decodeURIComponent(token) : undefined);
    const res = json({ signedOut: true });
    res.cookies.delete(SESSION_COOKIE);
    return res;
  },
  { auth: false },
);
