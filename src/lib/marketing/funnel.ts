/**
 * Funnel content model.
 *
 * The shape is copied from how TurboScribe runs its acquisition funnel: one
 * thin, keyword-targeted landing page per search intent, each of which puts the
 * tool itself above the fold and cross-links to its siblings. The copy is ours
 * and only claims things the engine actually does — everything here runs in the
 * browser, so there is no "uploaded / encrypted at rest" story to tell.
 *
 * Nothing here is fetched; it is a static module so every tool page prerenders.
 */

export const PRICING = {
  /** Free plan daily budget, in minutes. Matches plans.daily_transcription_seconds (1800) in docs/ARCHITECTURE.md §4. */
  freeDailyMinutes: 30,
  /**
   * Placeholder prices. Transcription runs on the visitor's own device, so the
   * marginal cost of a minute is zero — these are positioning numbers, not cost
   * recovery. Change them here and every funnel page follows.
   */
  proMonthly: "₱349",
  proYearly: "₱2,988",
  proYearlyMonthlyEquivalent: "₱249",
  yearlySavingPercent: 29,
} as const;

export type Faq = { q: string; a: string };

export type ToolPage = {
  slug: string;
  /** Footer / cross-link label. Keep it keyword-shaped. */
  linkLabel: string;
  /** Browser tab + <title>. */
  title: string;
  description: string;
  /** Two-tone hero headline: `head` in ink, `accent` in blue, then a period. */
  head: string;
  accent: string;
  sub: string;
  /** Label on the tool card's drop zone. */
  dropLabel: string;
  /** Accepted formats, shown under the drop zone. Must match the real accept attribute. */
  formats: string;
  /** SEO prose. Each string is a paragraph. */
  about: string[];
  faqs: Faq[];
  /** Slugs of sibling pages to surface in "related tools". */
  related: string[];
};

const SHARED_FAQS: Faq[] = [
  {
    q: "Is it really free?",
    a: `Yes. Transcription happens on your own computer, so there is no server bill to pass on. The free plan covers ${PRICING.freeDailyMinutes} minutes of audio a day. Pro lifts the daily limit for people who transcribe in bulk.`,
  },
  {
    q: "Where do my files go?",
    a: "Nowhere. The recording is read by your browser and processed on your device. It is never uploaded, so there is no copy of it on our servers to leak, subpoena or delete.",
  },
  {
    q: "What can I export?",
    a: "PDF, Word (.docx), plain text, and SRT or VTT subtitles. The Word export opens in Google Docs too.",
  },
  {
    q: "What do I need to run it?",
    a: "A recent desktop browser. It starts in Light mode, which uses only part of your computer and downloads a smaller speech model once (about 0.6 GB, cached after that). You can raise it to Balanced or Maximum for more speed — and even Maximum leaves headroom for everything else you're running.",
  },
];

const TAGLISH_FAQ: Faq = {
  q: "Does it handle Taglish?",
  a: "That is the reason it exists. Most transcription tools decode Filipino speech through an English setting, which quietly translates it into English. Transcribio picks the Filipino decoder explicitly, so code-switching is written down the way it was said.",
};

export const TOOLS: ToolPage[] = [
  {
    slug: "transcribe-video-to-text",
    linkLabel: "Transcribe Video to Text",
    title: "Transcribe Video to Text — Free, No Upload",
    description:
      "Turn video into text without uploading it. Free video to text converter for English, Filipino and Taglish. Exports PDF, Word, TXT, SRT and VTT.",
    head: "Transcribe video to text",
    accent: "without uploading it",
    sub: "Drop in an MP4, MOV or MKV and your computer writes out what was said. The file never leaves your device.",
    dropLabel: "Video file",
    formats: "MP4, MOV, MKV, WEBM, AVI, M4V and most audio formats",
    about: [
      "Transcribio turns video into text in your browser. Drag a recording in, pick the language, and the transcript is written on your own machine — there is no upload step, no queue, and no file sitting in someone else's storage bucket afterwards.",
      "It reads the formats a normal recording actually arrives in: MP4 and MOV from a phone or camera, MKV and WEBM from screen recorders like OBS, plus plain audio if you have already stripped the track. Long recordings are fine; the limit is your machine, not a plan.",
      "Every transcript is timestamped. Click a line to jump the video to that moment, fix what needs fixing, then export as PDF, Word, plain text, or SRT and VTT subtitles.",
    ],
    faqs: [
      {
        q: "How do I transcribe a video to text?",
        a: "Open the app, drop your video onto the drop zone, choose the audio language, and press Transcribe. The first run downloads the speech model; after that it starts immediately. When it finishes you get a timestamped transcript you can edit and export.",
      },
      TAGLISH_FAQ,
      {
        q: "Is there a file size limit?",
        a: "No server limit, because nothing is uploaded. Very long files are read in chunks rather than loaded whole, so length is limited by your computer's memory rather than by us. Long recordings are saved as they go, so if something interrupts a run you can continue from where it stopped.",
      },
      ...SHARED_FAQS,
    ],
    related: ["transcribe-audio-to-text", "video-to-text-converter", "generate-subtitles", "meeting-transcription"],
  },
  {
    slug: "transcribe-audio-to-text",
    linkLabel: "Transcribe Audio to Text",
    title: "Transcribe Audio to Text — Free, No Upload",
    description:
      "Convert audio recordings to text on your own device. MP3, M4A, WAV and more. English, Filipino and Taglish. Nothing is uploaded.",
    head: "Transcribe audio to text",
    accent: "on your own machine",
    sub: "Voice memos, interviews, podcasts, lectures. Drop the file in and read the transcript a few minutes later.",
    dropLabel: "Audio file",
    formats: "MP3, M4A, WAV, AAC, OGG, OPUS, FLAC, WMA and most video formats",
    about: [
      "Audio goes in, text comes out, and the recording stays on your computer. Transcribio runs a Whisper speech model directly in the browser, which means the usual privacy trade-off of online transcription simply does not apply.",
      "It handles the messy end of real recordings: phone voice memos, a laptop mic in a meeting room, a podcast with two people talking over each other. Speech is found first and the model only runs where there is something to hear, so silence and dead air do not cost you time.",
      "Transcripts are timestamped and editable. Export to PDF, Word, TXT, SRT or VTT when you are done.",
    ],
    faqs: [
      {
        q: "Which audio formats are supported?",
        a: "MP3, M4A, WAV, AAC, OGG, OPUS, FLAC and WMA, plus the audio track of any video file. If your browser can play it, it can be transcribed.",
      },
      TAGLISH_FAQ,
      ...SHARED_FAQS,
    ],
    related: ["transcribe-mp3-to-text", "transcribe-video-to-text", "interview-transcription", "tagalog-audio-to-text"],
  },
  {
    slug: "tagalog-audio-to-text",
    linkLabel: "Tagalog Audio to Text",
    title: "Tagalog Audio to Text — No Translation",
    description:
      "Transcribe Tagalog and Filipino audio to Filipino text, not English. Runs on your own device, free, no upload.",
    head: "Tagalog audio to text",
    accent: "in Tagalog",
    sub: "Most tools quietly translate Filipino speech into English. This one writes down what was actually said.",
    dropLabel: "Tagalog audio or video",
    formats: "MP3, M4A, WAV, MP4, MOV and most other formats",
    about: [
      "Whisper has a known failure mode on Filipino audio: if the decoder is pointed at English, it does not transcribe, it translates. You ask for a transcript and get an English paraphrase of a Filipino conversation, with the original wording gone.",
      "Transcribio never leaves that setting to chance. The Filipino decoder is selected explicitly, so Tagalog stays Tagalog. We benchmarked the alternatives on Filipino speech before settling on the model that ships today.",
      "This matters most for the recordings people actually have: barangay meetings, interviews, sermons, class recordings, client calls. The words are evidence. A translation is not.",
    ],
    faqs: [
      TAGLISH_FAQ,
      {
        q: "Will it translate my Filipino recording to English?",
        a: "Not unless you ask. Filipino / Taglish is the default for Filipino audio and it transcribes in the original language. English-only mode exists for recordings with no Filipino in them.",
      },
      {
        q: "What about regional languages like Cebuano or Ilocano?",
        a: "The model is strongest on Tagalog and Taglish, which is what it was tuned and benchmarked for here. Other Philippine languages will produce something, but we have not measured them and would not claim accuracy we have not tested.",
      },
      ...SHARED_FAQS,
    ],
    related: ["taglish-transcription", "transcribe-audio-to-text", "meeting-transcription", "interview-transcription"],
  },
  {
    slug: "taglish-transcription",
    linkLabel: "Taglish Transcription",
    title: "Taglish Transcription — Kept As Spoken",
    description:
      "Transcribe Taglish conversations without forcing them into one language. Private, on-device, free.",
    head: "Taglish, written down",
    accent: "the way you said it",
    sub: "Nobody in a Manila meeting speaks one language for a whole sentence. Your transcript shouldn't pretend otherwise.",
    dropLabel: "Taglish recording",
    formats: "MP3, M4A, WAV, MP4, MOV, MKV and more",
    about: [
      "Code-switching breaks most transcription tools. Forced into English they translate the Filipino away; forced into Filipino they mangle the English technical words that were never Filipino to begin with. Either way you lose the sentence that was actually spoken.",
      "Transcribio's default for Philippine audio keeps both. English words stay English, Filipino stays Filipino, and the mix survives into the transcript, timestamps and subtitles intact.",
      "It is the same engine behind the rest of the tools here — running on your device, exporting to PDF, Word, TXT, SRT and VTT.",
    ],
    faqs: [
      TAGLISH_FAQ,
      {
        q: "Do I have to mark which parts are English?",
        a: "No. Pick Filipino / Taglish once and the whole recording is decoded that way. There is nothing to segment or tag by hand.",
      },
      ...SHARED_FAQS,
    ],
    related: ["tagalog-audio-to-text", "transcribe-video-to-text", "meeting-transcription", "transcribe-audio-to-text"],
  },
  {
    slug: "transcribe-mp3-to-text",
    linkLabel: "MP3 to Text",
    title: "MP3 to Text — Free Transcription",
    description: "Convert MP3 files to text on your own device. No upload, no account limits on file size.",
    head: "MP3 to text",
    accent: "in your browser",
    sub: "The most common recording format there is, turned into a transcript without a round trip to anyone's server.",
    dropLabel: "MP3 file",
    formats: "MP3, plus M4A, WAV, AAC, OGG, OPUS, FLAC, WMA",
    about: [
      "MP3 is what most recorders, dictaphones and podcast exports produce, and it is the format people most often need turned into text. Drop one in and Transcribio decodes it locally.",
      "Long MP3s are read progressively rather than loaded into memory whole, so a multi-hour recording does not need a multi-hour file's worth of RAM.",
      "The output is a timestamped, editable transcript with PDF, Word, TXT, SRT and VTT export.",
    ],
    faqs: [
      {
        q: "How long can the MP3 be?",
        a: "There is no imposed limit. The practical ceiling is your own machine's memory, and the app reads long files in chunks specifically so that ceiling is high.",
      },
      ...SHARED_FAQS,
    ],
    related: ["transcribe-audio-to-text", "transcribe-video-to-text", "interview-transcription", "generate-subtitles"],
  },
  {
    slug: "video-to-text-converter",
    linkLabel: "Video to Text Converter",
    title: "Video to Text Converter — Free, Offline",
    description:
      "A video to text converter that runs on your device. Convert MP4, MOV, MKV and WEBM to editable text and subtitles.",
    head: "Video to text converter",
    accent: "that never uploads",
    sub: "Convert a recording into text, subtitles or a Word document without handing the footage to a stranger.",
    dropLabel: "Video file",
    formats: "MP4, MOV, MKV, WEBM, AVI, M4V",
    about: [
      "Online converters all work the same way: you upload the footage, it is processed on rented GPUs, and you trust the retention policy. For anything confidential — client calls, legal recordings, unreleased material — that trust is the whole problem.",
      "Transcribio converts locally. The audio track is pulled out of the container in the browser, transcribed there, and the result never travels.",
      "Convert once and export in whatever shape you need: PDF or Word for a document, TXT for a script, SRT or VTT to burn subtitles back onto the video.",
    ],
    faqs: [
      {
        q: "Does it convert the video file itself?",
        a: "It converts the speech in the video into text. The video is untouched; nothing is re-encoded and nothing is written back to your original file.",
      },
      {
        q: "Can I get subtitles out of it?",
        a: "Yes. Export SRT or VTT and load it into your editor or player as a subtitle track.",
      },
      ...SHARED_FAQS,
    ],
    related: ["transcribe-video-to-text", "generate-subtitles", "transcribe-audio-to-text", "meeting-transcription"],
  },
  {
    slug: "generate-subtitles",
    linkLabel: "Generate Subtitles (SRT / VTT)",
    title: "Generate Subtitles — Free SRT and VTT",
    description:
      "Create SRT and VTT subtitle files from your own footage, on your own device. English, Filipino and Taglish.",
    head: "Generate subtitles",
    accent: "from your own footage",
    sub: "Timestamped SRT and VTT, editable before you export, without sending the footage anywhere.",
    dropLabel: "Video or audio file",
    formats: "MP4, MOV, MKV, WEBM, MP3, M4A, WAV and more",
    about: [
      "Subtitles need two things most auto-captioning gets wrong: correct timing, and the actual words. Transcribio segments on speech boundaries rather than fixed intervals, so lines break where the speaker breaks.",
      "For Philippine content this is also where translation creep does the most damage — a subtitle track that silently renders Taglish dialogue as English is worse than no subtitles. The Filipino decoder is selected explicitly to prevent that.",
      "Edit any line in the transcript before exporting and the timings follow. Export SRT for most editors and players, VTT for the web.",
    ],
    faqs: [
      {
        q: "SRT or VTT — which one do I need?",
        a: "SRT for video editors, VLC, and most social platforms. VTT for HTML5 video on the web. Both are exported from the same transcript, so you can take either or both.",
      },
      {
        q: "Can I fix a line before exporting?",
        a: "Yes. The transcript is editable and the subtitle export reads your edited text, not the raw output.",
      },
      ...SHARED_FAQS,
    ],
    related: ["transcribe-video-to-text", "video-to-text-converter", "taglish-transcription", "transcribe-audio-to-text"],
  },
  {
    slug: "meeting-transcription",
    linkLabel: "Meeting Transcription",
    title: "Meeting Transcription — No Bot, No Upload",
    description:
      "Transcribe meetings on your own device. No bot joins the call, no recording is uploaded. English, Filipino and Taglish.",
    head: "Meeting transcription",
    accent: "with no bot in the call",
    sub: "Record the meeting however you already do. Drop the file in afterwards and get the minutes on your own machine.",
    dropLabel: "Meeting recording",
    formats: "MP4, MOV, MKV, MP3, M4A, WAV and more",
    about: [
      "Most meeting transcription works by inviting a third-party bot into the call, which means a vendor now holds a recording of every internal conversation you have. Plenty of teams cannot agree to that, and plenty more should not.",
      "Transcribio takes the recording you already made — Zoom, Meet, Teams, OBS, a phone on the table — and transcribes it locally afterwards. Nothing joins the call and nothing is uploaded.",
      "After transcription, the Reviewer organises the transcript into topics, key terms, lists and open questions, quoting the transcript rather than paraphrasing it. Export the result to Word or PDF and send it round.",
    ],
    faqs: [
      {
        q: "Does something join my meeting?",
        a: "No. There is no bot and no calendar integration. You record the meeting the way you already do and transcribe the file afterwards.",
      },
      {
        q: "Does it label who is speaking?",
        a: "Not yet. Segments are timestamped but not attributed to named speakers. Speaker labelling is on the roadmap and we would rather say so than imply it works today.",
      },
      TAGLISH_FAQ,
      ...SHARED_FAQS,
    ],
    related: ["interview-transcription", "taglish-transcription", "transcribe-video-to-text", "transcribe-audio-to-text"],
  },
  {
    slug: "interview-transcription",
    linkLabel: "Interview Transcription",
    title: "Interview Transcription — Confidential",
    description:
      "Transcribe interviews without uploading them. For journalists, researchers and legal work. Free, on-device.",
    head: "Interview transcription",
    accent: "that stays confidential",
    sub: "For work where the recording itself is the sensitive thing: sources, research participants, clients.",
    dropLabel: "Interview recording",
    formats: "MP3, M4A, WAV, MP4, MOV and more",
    about: [
      "If you have ever hesitated before dragging an interview into an online transcription service, that instinct was correct. Once a recording is uploaded, protecting it stops being your decision.",
      "Transcribio removes the upload from the process entirely. Source interviews, research participant recordings, and privileged client conversations are transcribed by your own machine and stay there.",
      "Transcripts are timestamped so you can jump straight to the moment behind a quote, and the raw transcript is kept immutable underneath your edits — the original output is always recoverable.",
    ],
    faqs: [
      {
        q: "Can I use this for privileged or confidential material?",
        a: "The recording never leaves your device, so nothing is disclosed to us in the first place. Check it against your own obligations, but the technical answer is that we never receive the file.",
      },
      {
        q: "Are my edits kept separate from the raw transcript?",
        a: "Yes. The raw transcript is immutable; your edits sit in a separate layer on top of it, so you can always see what the engine originally produced.",
      },
      ...SHARED_FAQS,
    ],
    related: ["meeting-transcription", "transcribe-audio-to-text", "tagalog-audio-to-text", "transcribe-mp3-to-text"],
  },
];

export const TOOL_SLUGS = TOOLS.map((t) => t.slug);

export function getTool(slug: string): ToolPage | undefined {
  return TOOLS.find((t) => t.slug === slug);
}

/** Trust chips shown under the tool card. Each is something the app actually does. */
export const TRUST_CHIPS = [
  "Nothing uploaded",
  "English · Filipino · Taglish",
  "PDF, Word, TXT, SRT, VTT",
  "Timestamped transcripts",
  `${PRICING.freeDailyMinutes} free minutes a day`,
  "No credit card",
] as const;

/** Cross-tool links for the footer farm, including the separate converter. */
export const FOOTER_TOOLS: { label: string; href: string }[] = [
  ...TOOLS.map((t) => ({ label: t.linkLabel, href: `/tools/${t.slug}` })),
  { label: "PDF to Word", href: "/convert" },
];
