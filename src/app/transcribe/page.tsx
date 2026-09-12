import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FeedbackWidget } from "@/components/feedback";
import { AppHeader, TranscribeApp } from "@/components/transcribe-app";
import { ACCOUNTS_ENABLED } from "@/lib/deployment";
import { currentUser } from "@/server/auth";

export const metadata: Metadata = { title: "Transcribe" };

/**
 * The app itself. On a deployment without accounts (the hosted one) this is
 * open: no sign-in, nothing to create, history stays in the browser.
 */
export default async function TranscribePage() {
  const user = ACCOUNTS_ENABLED ? await currentUser() : null;
  if (ACCOUNTS_ENABLED && !user) redirect("/sign-in?next=/transcribe");

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader email={user?.email ?? null} />
      <TranscribeApp userId={user?.id ?? null} />
      <FeedbackWidget />
    </div>
  );
}
