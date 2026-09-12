import { sessionCookie, verifyCode } from "@/server/auth";
import { accountsDisabled, handler, json } from "@/server/http";

/** POST { email, code } → signs in (creating the account on first use) and sets the session cookie. */
export const POST = handler(
  async (req) => {
    const off = accountsDisabled();
    if (off) return off;
    const { email, code } = (await req.json().catch(() => ({}))) as { email?: string; code?: string };
    const { user, token } = verifyCode(email, code);
    const res = json({ user });
    res.cookies.set(sessionCookie(token));
    return res;
  },
  { auth: false },
);
