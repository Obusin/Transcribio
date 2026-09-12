"use client";

import { useState } from "react";

type Step = { name: "email" } | { name: "code"; devCode: string | null };

async function post(path: string, body: object) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Something went wrong. Try again.");
  return data;
}

export function SignInForm({ next }: { next: string }) {
  const [step, setStep] = useState<Step>({ name: "email" });
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await post("/api/auth/code", { email });
      setStep({ name: "code", devCode: data.devCode ?? null });
      setCode("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (value = code) => {
    setBusy(true);
    setError(null);
    try {
      await post("/api/auth/verify", { email, code: value });
      window.location.assign(next);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <section className="rounded-3xl border border-line bg-surface p-7">
      {step.name === "email" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendCode();
          }}
        >
          <h1 className="text-2xl font-semibold tracking-tight">Sign in to Transcribio</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            We&apos;ll send a 6-digit code to your email. New here? The same step creates your account.
          </p>
          <label className="mt-6 block text-sm font-medium" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="mt-1.5 h-11 w-full rounded-xl border border-line bg-paper px-3.5 outline-none focus:border-ink"
          />
          {error && <p className="mt-3 text-sm text-danger">{error}</p>}
          <button
            disabled={busy || !email}
            className="mt-5 h-11 w-full rounded-full bg-accent text-sm font-medium text-accent-ink transition hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "Sending…" : "Send code"}
          </button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
        >
          <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Enter the code we sent to <span className="font-medium text-ink">{email}</span>. It expires in 10 minutes.
          </p>
          {step.devCode && (
            <div className="mt-4 rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">
              <p>
                <b>Local mode:</b> no email service is connected, so your code is{" "}
                <span className="font-mono text-base font-semibold tracking-widest">{step.devCode}</span>.
              </p>
              <button
                type="button"
                onClick={() => {
                  setCode(step.devCode!);
                  void verify(step.devCode!);
                }}
                className="mt-2 text-xs font-medium underline underline-offset-2"
              >
                Use this code
              </button>
            </div>
          )}
          <label className="mt-6 block text-sm font-medium" htmlFor="code">
            6-digit code
          </label>
          <input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            autoFocus
            value={code}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 6);
              setCode(v);
              if (v.length === 6) void verify(v);
            }}
            className="mt-1.5 h-12 w-full rounded-xl border border-line bg-paper px-3.5 text-center font-mono text-xl tracking-[0.5em] outline-none focus:border-ink"
          />
          {error && <p className="mt-3 text-sm text-danger">{error}</p>}
          <button
            disabled={busy || code.length !== 6}
            className="mt-5 h-11 w-full rounded-full bg-accent text-sm font-medium text-accent-ink transition hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <div className="mt-4 flex justify-between text-xs text-muted">
            <button type="button" onClick={() => setStep({ name: "email" })} className="hover:text-ink">
              ← Use a different email
            </button>
            <button type="button" onClick={() => void sendCode()} disabled={busy} className="hover:text-ink disabled:opacity-40">
              Send a new code
            </button>
          </div>
        </form>
      )}
      <p className="mt-6 border-t border-line pt-4 text-xs leading-relaxed text-muted">
        Your recordings never leave your device. Transcripts stay in this browser unless you choose &ldquo;Save to my
        account&rdquo; for one.
      </p>
    </section>
  );
}
