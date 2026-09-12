import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in — Transcribio" };

function safeNext(next: string | string[] | undefined) {
  const n = Array.isArray(next) ? next[0] : next;
  // Only same-site paths — never redirect to another origin after sign-in.
  return n && n.startsWith("/") && !n.startsWith("//") ? n : "/transcribe";
}

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const next = safeNext((await searchParams).next);
  if (await currentUser()) redirect(next);
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center gap-2.5 px-6 py-5">
        <Link href="/" className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid h-7 w-7 place-items-center rounded-lg bg-deep text-[13px] font-extrabold text-white"
          >
            T
          </span>
          <span className="text-[17px] font-extrabold tracking-[-0.035em]">Transcribio</span>
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 pb-24">
        <SignInForm next={next} />
      </main>
    </div>
  );
}
