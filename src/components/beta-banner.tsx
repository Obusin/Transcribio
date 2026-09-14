import Link from "next/link";

/**
 * The testing notice across the top of every page. Pricing is off while the
 * app is in testing, so this is where people learn it's free and that feedback
 * is the ask. Not sticky: it scrolls away and the header stays.
 */
export function BetaBanner({ inApp }: { inApp?: boolean }) {
  return (
    <div className="bg-deep px-4 py-2 text-center text-[13px] leading-snug text-inverse">
      <span className="mr-1.5 inline-block rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold tracking-wider text-white uppercase">
        Free beta
      </span>
      Free while we&apos;re testing — no sign-up, no limits.{" "}
      {inApp ? (
        <span className="text-inverse-soft">Something off? Use Give feedback at the bottom right.</span>
      ) : (
        <>
          <span className="text-inverse-soft">Try it and tell us what to fix.</span>{" "}
          <Link href="/transcribe" className="font-semibold underline underline-offset-2 hover:text-white">
            Start transcribing
          </Link>
        </>
      )}
    </div>
  );
}
