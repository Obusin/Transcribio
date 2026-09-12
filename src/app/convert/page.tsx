import type { Metadata } from "next";
import { PdfToWord } from "@/components/pdf-to-word";
import { SiteFooter, SiteHeader } from "@/components/marketing/chrome";
import { CtaBand, RelatedTools } from "@/components/marketing/sections";
import { TOOLS } from "@/lib/marketing/funnel";

export const metadata: Metadata = {
  title: "PDF to Word",
  description: "Turn a PDF into an editable Word document on your own device. Nothing is uploaded.",
  alternates: { canonical: "/convert" },
};

export default function ConvertPage() {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <main className="flex-1">
        <PdfToWord />
        <RelatedTools slugs={TOOLS.slice(0, 4).map((t) => t.slug)} heading="Also free, also on-device" />
        <CtaBand />
      </main>
      <SiteFooter />
    </div>
  );
}
