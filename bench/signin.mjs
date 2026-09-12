// Shared test helper: make sure the browser context is signed in (local-mode codes),
// and tell tests which IndexedDB database holds this account's history.

export async function signIn(page, base, email = "tester@transcribio.local") {
  // Start from the landing page: it never redirects, so nothing navigates under the test.
  if (!page.url().startsWith(base)) await page.goto(`${base}/`);
  const me = await page.evaluate(async () => (await (await fetch("/api/auth/me")).json()).user);
  if (me) return me;
  return page.evaluate(async (email) => {
    const post = (p, b) => fetch(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
    const sent = await post("/api/auth/code", { email });
    if (!sent.devCode) throw new Error(`No local-mode code: ${JSON.stringify(sent)}`);
    return (await post("/api/auth/verify", { email, code: sent.devCode })).user;
  }, email);
}

export const cacheDb = (user) => `transcribio-${user.id}`;
