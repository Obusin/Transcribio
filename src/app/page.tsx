import { SiteFooter, SiteHeader } from "@/components/marketing/chrome";
import {
  CtaBand,
  FaqJsonLd,
  FaqSection,
  HowItWorks,
  FreeBetaSection,
  RelatedTools,
  TrustRow,
  UseCaseStrip,
  VersusCloud,
} from "@/components/marketing/sections";
import { ToolCard } from "@/components/marketing/tool-card";
import { Container, Display, Eyebrow } from "@/components/marketing/ui";
import { TOOLS } from "@/lib/marketing/funnel";

// The home page's own FAQ is the general set; the tool pages carry their own.
const HOME_FAQS = TOOLS[0].faqs;

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />

      <main className="flex-1">
        {/* Hero: the tool is the hero. Pitch on the left, drop zone on the right. */}
        <Container className="grid items-center gap-12 py-16 lg:grid-cols-[1.15fr_0.85fr] lg:py-24">
          <div>
            <div className="flex items-center gap-2.5">
              <span aria-hidden className="h-2 w-2 rounded-full bg-accent" />
              <span className="text-sm font-bold text-ink">Transcribio</span>
              <span aria-hidden className="text-label">—</span>
              <span className="text-sm text-muted">English · Filipino · Taglish</span>
            </div>

            <Display
              className="mt-6"
              head="Transcribe your videos"
              accent="without uploading them"
            />

            <p className="mt-7 max-w-xl text-lg leading-relaxed text-muted">
              Drop in a meeting, interview or video. Your computer does the transcription, so the recording
              never leaves it. Taglish stays Taglish — we write down what was actually said, not a translation.
            </p>
          </div>

          <div className="lg:justify-self-end lg:w-full lg:max-w-md">
            <ToolCard dropLabel="Audio / video file" formats="MP4, MOV, MKV, WEBM, MP3, M4A, WAV, AAC, OGG, OPUS — any length" />
          </div>
        </Container>

        {/* Kept out of the hero grid so the tool card stays above the fold on phones. */}
        <Container className="pb-4">
          <TrustRowLeft />
        </Container>

        <Container className="py-8">
          <TrustRow />
        </Container>

        <HowItWorks />
        <VersusCloud />
        <UseCaseStrip />

        {/* SEO prose — the "About" block every TurboScribe tool page carries. */}
        <Container className="py-20">
          <div className="mx-auto max-w-3xl">
            <Eyebrow>About Transcribio</Eyebrow>
            <div className="mt-6 space-y-5 text-base leading-relaxed text-muted">
              <p>
                Transcribio is a transcription tool that runs entirely in your browser. There is no upload
                step: the speech model is downloaded to your machine once, and from then on every recording you
                transcribe is read off your own disk and processed by your own hardware.
              </p>
              <p>
                It was built for Philippine audio first. Whisper has a well-known failure mode where Filipino
                speech decoded under an English setting comes back translated into English rather than
                transcribed — which is useless if you needed the actual words. Transcribio selects the Filipino
                decoder explicitly, so Tagalog stays Tagalog and code-switching survives into the transcript.
              </p>
              <p>
                Transcripts are timestamped. Click any line to jump to that moment in the recording, edit what
                needs editing, and export as PDF, Word, plain text, or SRT and VTT subtitles. The raw
                transcript is kept immutable underneath your edits, so the engine&rsquo;s original output is always
                recoverable. There is a separate{" "}
                <a className="text-accent underline decoration-line-strong underline-offset-4" href="/convert">
                  PDF to Word converter
                </a>{" "}
                that works the same way — locally, with nothing uploaded.
              </p>
              <p>
                It&rsquo;s free while we test it &mdash; no sign-up, no credit card and no daily limit. Because the
                work happens on your device rather than on rented GPUs, there&rsquo;s no server bill behind it. All
                we ask in return is feedback: tell us what broke and what you wish it did.
              </p>
            </div>
          </div>
        </Container>

        <FaqSection faqs={HOME_FAQS} n="04" />
        <FreeBetaSection n="05" />
        <RelatedTools slugs={TOOLS.slice(0, 4).map((t) => t.slug)} heading="Free tools" />
        <CtaBand />
      </main>

      <SiteFooter />
      <FaqJsonLd faqs={HOME_FAQS} />
    </div>
  );
}

/** Left-aligned variant of the trust chips for the hero column. */
function TrustRowLeft() {
  return (
    <dl className="grid gap-6 sm:grid-cols-3">
      {[
        ["Nothing uploaded", "Processed in your browser. Files stay on your device."],
        ["Built for how we talk", "English–Filipino code-switching kept exactly as spoken."],
        ["Timestamps & subtitles", "Jump to any line. Export TXT, SRT or VTT."],
      ].map(([t, d]) => (
        <div key={t}>
          <dt className="text-sm font-extrabold tracking-[-0.02em] text-ink">{t}</dt>
          <dd className="mt-1.5 text-sm leading-relaxed text-muted">{d}</dd>
        </div>
      ))}
    </dl>
  );
}
