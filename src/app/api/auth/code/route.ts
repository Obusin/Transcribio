import { requestCode } from "@/server/auth";
import { accountsDisabled, handler, json } from "@/server/http";

/** POST { email } → sends a 6-digit sign-in code. In local dev the code is also returned. */
export const POST = handler(
  async (req) => {
    const off = accountsDisabled();
    if (off) return off;
    const { email } = (await req.json().catch(() => ({}))) as { email?: string };
    const delivery = await requestCode(email);
    return json(delivery.via === "dev" ? { sent: true, devCode: delivery.code } : { sent: true });
  },
  { auth: false },
);
