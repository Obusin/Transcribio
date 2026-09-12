import type { Metadata } from "next";
import { Geist_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { SITE_URL } from "@/lib/marketing/site";
import "./globals.css";

// Plus Jakarta Sans is the obustudio.com face; 800 is the display weight.
const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Transcribio — private transcription for English, Filipino and Taglish",
    template: "%s — Transcribio",
  },
  description:
    "Transcribe video and audio on your own device. Your recordings never leave your computer. English, Filipino and Taglish.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${jakarta.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
