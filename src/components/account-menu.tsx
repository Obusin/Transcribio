"use client";

import { useState } from "react";
import { account } from "@/lib/transcript/account-sync";
import { clearAccountCache } from "@/lib/transcript/store";

export function AccountMenu({ email }: { email: string }) {
  const [busy, setBusy] = useState(false);

  const signOut = async (clearDevice: boolean) => {
    if (clearDevice && !confirm("Remove this account's history from this browser? Transcripts you saved to your account stay there.")) return;
    setBusy(true);
    if (clearDevice) await clearAccountCache();
    await account.signOut().catch(() => {});
    // A full page load on purpose: it tears down the transcription worker and
    // every bit of in-memory state from this account before the next person signs in.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/sign-in");
  };

  return (
    <details className="relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium hover:border-ink [&::-webkit-details-marker]:hidden">
        <span className="grid h-5 w-5 place-items-center rounded-full bg-accent text-[10px] font-semibold uppercase text-accent-ink" aria-hidden>
          {email[0]}
        </span>
        <span className="max-w-[160px] truncate">{email}</span>
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-64 rounded-2xl border border-line bg-surface p-2 text-sm shadow-lg">
        <p className="px-3 pb-2 pt-1 text-xs text-muted">Signed in as {email}</p>
        <button
          disabled={busy}
          onClick={() => void signOut(false)}
          className="w-full rounded-xl px-3 py-2 text-left hover:bg-paper disabled:opacity-50"
        >
          Sign out
        </button>
        <button
          disabled={busy}
          onClick={() => void signOut(true)}
          className="w-full rounded-xl px-3 py-2 text-left text-danger hover:bg-paper disabled:opacity-50"
        >
          Sign out and remove history from this browser
        </button>
      </div>
    </details>
  );
}
