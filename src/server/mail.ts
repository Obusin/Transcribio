import "server-only";

/**
 * Delivers sign-in codes. With RESEND_API_KEY set, codes go out by email.
 * Without it — local development — the code is printed in the terminal and
 * returned to the sign-in screen, so the app works with zero configuration.
 * In production without a key, sending fails loudly instead of silently.
 */
export type Delivery = { via: "email" } | { via: "dev"; code: string };

export function devDeliveryAllowed(): boolean {
  return !process.env.RESEND_API_KEY && process.env.NODE_ENV !== "production";
}

export async function sendLoginCode(email: string, code: string): Promise<Delivery> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (!devDeliveryAllowed()) throw new Error("Email sending isn't configured (set RESEND_API_KEY).");
    console.log(`\n┌─ Transcribio sign-in code ─────────────\n│ ${email}\n│ ${code}   (valid 10 minutes)\n└────────────────────────────────────────\n`);
    return { via: "dev", code };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.MAIL_FROM ?? "Transcribio <onboarding@resend.dev>",
      to: email,
      subject: `${code} is your Transcribio sign-in code`,
      text: `Your Transcribio sign-in code is ${code}.\n\nIt expires in 10 minutes. If you didn't try to sign in, you can ignore this email.`,
    }),
  });
  if (!res.ok) throw new Error(`Couldn't send the email (${res.status}).`);
  return { via: "email" };
}
