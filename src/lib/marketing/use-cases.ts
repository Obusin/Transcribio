/**
 * Use-case (persona) pages — the second funnel layer.
 *
 * The tool pages in funnel.ts catch search intent ("how do I transcribe an
 * MP4"). These catch situation intent ("I run a law office and I record client
 * calls"), which is how Fireflies covers ten industries off one product.
 *
 * Rules for this file, learned from writing the tool pages:
 * - No invented statistics. Fireflies leads each page with numbers like "40%
 *   faster hiring cycles". We have measured none of that, so there are none here.
 * - No claim the product cannot back today. No speaker labels, no team sharing,
 *   no integrations, no regulatory compliance claims — only the fact that the
 *   recording is never transmitted, which is verifiable.
 */

import { PRICING, type Faq } from "./funnel";

export type UseCase = {
  slug: string;
  navLabel: string;
  title: string;
  description: string;
  /** Two-tone hero headline. */
  head: string;
  accent: string;
  sub: string;
  /** Who on the team this is for — rendered as chips, Fireflies' role tabs flattened. */
  roles: string[];
  /** Why the generic cloud tool is the wrong shape for this vertical. */
  problem: { head: string; accent: string; body: string[] };
  /** Persona-framed outcomes. Every one maps to something that exists today. */
  outcomes: { t: string; d: string }[];
  /** The actual workflow for this persona, start to finish. */
  workflow: string[];
  faqs: Faq[];
  /** Tool pages that serve this persona. */
  relatedTools: string[];
  /** Sibling use cases. */
  related: string[];
};

const PRIVACY_FAQ: Faq = {
  q: "How do you know the recording is not uploaded?",
  a: "Because there is nowhere for it to go. The speech model runs in your browser and the file is read off your own disk. You can watch it yourself: open your browser's network tab while a transcription runs and you will see no upload.",
};

const COST_FAQ: Faq = {
  q: "What does it cost?",
  a: `The free plan covers ${PRICING.freeDailyMinutes} minutes of audio a day with every feature included and no credit card. Your own computer does the processing, so the free tier is the real product rather than a trial.`,
};

export const USE_CASES: UseCase[] = [
  {
    slug: "legal",
    navLabel: "Law offices",
    title: "Transcription for Law Offices",
    description:
      "Transcribe client consultations, hearings and interviews without the recording ever leaving your office. English, Filipino and Taglish.",
    head: "Client recordings that never",
    accent: "leave the office",
    sub: "Consultations, witness interviews, hearing notes. Transcribed on your own machine, in the language they were actually spoken.",
    roles: ["Partners", "Associates", "Paralegals", "Legal secretaries"],
    problem: {
      head: "Uploading a privileged recording is",
      accent: "a decision you can't undo",
      body: [
        "Every online transcription service works the same way: the audio goes to their servers. For a client consultation, that means a third party now holds a copy of a privileged conversation, and your control over it is reduced to their retention policy.",
        "The second problem is language. Philippine legal conversations are Taglish, and most engines decode Filipino audio through an English setting, which translates rather than transcribes. A translated transcript of a client statement is not a record of what the client said.",
      ],
    },
    outcomes: [
      {
        t: "Nothing is transmitted",
        d: "The recording is processed by your own computer. No vendor receives the file, so there is no third-party copy to account for.",
      },
      {
        t: "Taglish stays Taglish",
        d: "The Filipino decoder is selected explicitly, so a client's actual words survive into the transcript instead of being rendered into English.",
      },
      {
        t: "Timestamped to the line",
        d: "Click any line to jump to that second of the recording, which makes checking a quoted passage a two-second job.",
      },
      {
        t: "The raw record is immutable",
        d: "Your edits sit in a separate layer above the original output, so the engine's unedited transcript is always recoverable.",
      },
      {
        t: "Exports to Word",
        d: "PDF, Word, TXT, SRT and VTT. The Word file opens in Google Docs if that is where your drafting happens.",
      },
      {
        t: "Also converts PDFs",
        d: "The separate PDF to Word tool turns a filed document into editable text, also on your own machine.",
      },
    ],
    workflow: [
      "Record the consultation however you already do — phone, laptop, recorder.",
      "Drop the file into Transcribio and choose Filipino / Taglish.",
      "Read the timestamped transcript, correcting anything the engine misheard.",
      "Run the Reviewer to pull out topics, key terms and open questions, quoted verbatim.",
      "Export to Word for the file, or PDF for the client.",
    ],
    faqs: [
      {
        q: "Can I use this for privileged material?",
        a: "The recording is never transmitted to us, so nothing is disclosed to a third party in the first place. Your own professional obligations still apply and you should check the workflow against them, but the technical position is that we never receive the file.",
      },
      {
        q: "Does it label who is speaking?",
        a: "Not yet. Segments are timestamped but not attributed to named speakers, so a two-party interview needs you to mark the turns. Speaker labelling is on the roadmap and we would rather say so than imply it works.",
      },
      PRIVACY_FAQ,
      {
        q: "Is it accurate enough for a legal record?",
        a: "Treat it as a first draft, not a certified transcript. It is fast and timestamped so you can verify any line against the audio in seconds, which is the point — checking is cheap, so correcting is cheap.",
      },
      COST_FAQ,
    ],
    relatedTools: ["interview-transcription", "meeting-transcription", "tagalog-audio-to-text"],
    related: ["healthcare", "research", "recruiting"],
  },
  {
    slug: "healthcare",
    navLabel: "Clinics",
    title: "Transcription for Clinics and Healthcare",
    description:
      "Turn consultation recordings into notes on your own device. Patient audio is never uploaded. English, Filipino and Taglish.",
    head: "Consultation notes without",
    accent: "sending patient audio anywhere",
    sub: "For clinics where the recording is the sensitive thing, and where the consultation happens in Taglish.",
    roles: ["Doctors", "Clinic staff", "Allied health", "Practice managers"],
    problem: {
      head: "Patient audio is the one file",
      accent: "you can't put in a queue",
      body: [
        "Dictation and scribe services are useful right up to the moment you notice they involve sending a recording of a patient consultation to a company you have never met, to sit on infrastructure you cannot inspect.",
        "And the consultation itself is rarely in one language. A patient describing symptoms switches between Filipino and English mid-sentence, and a tool that flattens that into English loses the specific words the patient used.",
      ],
    },
    outcomes: [
      {
        t: "The audio never leaves the clinic",
        d: "Transcription runs on the clinic's own computer. There is no upload, so there is no processor agreement to negotiate for the audio itself.",
      },
      {
        t: "Written the way it was said",
        d: "Filipino and Taglish are decoded in the original language, so a patient's own description survives rather than being paraphrased into English.",
      },
      {
        t: "Organised, not summarised",
        d: "The Reviewer groups a transcript into topics, key terms and open questions by quoting it verbatim. No model rewrites or invents anything.",
      },
      {
        t: "Jump to any moment",
        d: "Every line is timestamped, so re-checking what was actually said takes a click.",
      },
      {
        t: "Word and PDF out",
        d: "Export the result into whatever your records system accepts.",
      },
      {
        t: "Free at clinic scale",
        d: `${PRICING.freeDailyMinutes} minutes a day at no cost, because your own machine does the work.`,
      },
    ],
    workflow: [
      "Record the consultation with consent, the way your practice already documents.",
      "Drop the recording into Transcribio on the clinic machine.",
      "Choose Filipino / Taglish so the patient's own wording is preserved.",
      "Correct anything misheard, then run the Reviewer to group it by topic.",
      "Export to Word or PDF for the patient record.",
    ],
    faqs: [
      {
        q: "Is this compliant with the Data Privacy Act?",
        a: "We cannot certify your workflow, and any tool that tells you it makes you compliant is overselling. What we can state factually is that the recording is never transmitted to us, so Transcribio is not a third-party processor of that audio. Consent, storage and retention on your side are still yours to handle.",
      },
      PRIVACY_FAQ,
      {
        q: "Does it understand medical terminology?",
        a: "It handles common clinical vocabulary reasonably, but it is a general speech model, not a medical one. Drug names and rarer terms are the most likely things to need correcting, which is why every line is timestamped for checking.",
      },
      {
        q: "Can several staff use it?",
        a: "Anyone with a browser can, since there is nothing to provision. There is no shared team workspace yet — each person's transcripts live on their own machine.",
      },
      COST_FAQ,
    ],
    relatedTools: ["transcribe-audio-to-text", "tagalog-audio-to-text", "interview-transcription"],
    related: ["legal", "research", "education"],
  },
  {
    slug: "education",
    navLabel: "Teachers & students",
    title: "Transcription for Teachers and Students",
    description:
      "Turn lectures and class recordings into notes and reviewers. Taglish supported. Free, and nothing is uploaded.",
    head: "Turn a lecture into",
    accent: "something you can study",
    sub: "Class recordings, thesis interviews, defence panels. Transcribed and organised into a reviewer, on a student budget of zero.",
    roles: ["Students", "Teachers", "Thesis advisers", "Researchers"],
    problem: {
      head: "Lectures are Taglish and",
      accent: "transcription tools are not",
      body: [
        "A Philippine classroom does not run in one language. The lecture is Taglish, the slides are English, the examples are Filipino, and any tool that forces the recording into a single language throws away half of what was said.",
        "The other problem is cost. Per-minute pricing is designed for companies, not for a student with forty hours of recorded lectures and no budget.",
      ],
    },
    outcomes: [
      {
        t: "Free for the volume students have",
        d: `${PRICING.freeDailyMinutes} minutes a day, no credit card, no trial that expires. The transcription runs on your own laptop.`,
      },
      {
        t: "Taglish lectures stay Taglish",
        d: "Code-switching is written down as spoken, so the Filipino explanation of an English term survives.",
      },
      {
        t: "A reviewer, not just a wall of text",
        d: "The Reviewer organises the transcript into topics, key terms, lists and review questions — quoted from the lecture, never invented.",
      },
      {
        t: "Jump back to any point",
        d: "Timestamped lines mean you can find the thirty seconds where the professor explained the thing you missed.",
      },
      {
        t: "Export for your notes",
        d: "Word, PDF or plain text, plus SRT and VTT if you are subtitling a recording.",
      },
      {
        t: "Works offline after setup",
        d: "The model downloads once. After that, transcription needs no connection at all.",
      },
    ],
    workflow: [
      "Record the lecture, or use a recording the class was given.",
      "Drop it in and pick Filipino / Taglish.",
      "Read the transcript and fix anything misheard.",
      "Run the Reviewer to get topics, key terms and review questions.",
      "Export to Word or PDF and study from that.",
    ],
    faqs: [
      {
        q: "Is it really free for students?",
        a: `Yes. ${PRICING.freeDailyMinutes} minutes a day with everything included. Your laptop does the processing, so there is no cost for us to pass on.`,
      },
      {
        q: "Will it work on a school laptop?",
        a: "Probably, but the model needs memory. There is a Light resource profile for smaller machines, and the first run downloads about 1.6 GB which is then cached. Older or low-RAM laptops will be slow rather than broken.",
      },
      {
        q: "Does the Reviewer write my notes for me?",
        a: "No, and deliberately. It organises and quotes the transcript — it never generates new sentences, so nothing in your notes is something the lecturer did not say.",
      },
      PRIVACY_FAQ,
      COST_FAQ,
    ],
    relatedTools: ["transcribe-video-to-text", "taglish-transcription", "transcribe-audio-to-text"],
    related: ["research", "ministry", "healthcare"],
  },
  {
    slug: "recruiting",
    navLabel: "Recruiting & HR",
    title: "Transcription for Recruiting and HR",
    description:
      "Transcribe interviews and HR conversations on your own device. Candidate recordings are never uploaded.",
    head: "Interview notes without",
    accent: "handing over candidate data",
    sub: "Screening calls, panel interviews, disciplinary meetings. Transcribed locally, so candidate audio stays in your building.",
    roles: ["Recruiters", "Hiring managers", "HR officers", "Business owners"],
    problem: {
      head: "Candidate recordings are",
      accent: "personal data you now hold",
      body: [
        "The moment you upload an interview, a vendor is processing a named person's voice and answers on your behalf. That is a relationship you have to document, justify and eventually unwind, for every candidate you did not hire.",
        "There is also the practical problem of what interviews sound like here. Screening calls run in Taglish, and a transcript that renders a candidate's answer into English is a paraphrase you cannot fairly score against.",
      ],
    },
    outcomes: [
      {
        t: "No candidate audio leaves your machine",
        d: "Nothing is uploaded, so there is no vendor holding interview recordings of people you did not hire.",
      },
      {
        t: "Answers in the candidate's own words",
        d: "Taglish is kept as spoken, so what you score is what they actually said.",
      },
      {
        t: "Structured for comparison",
        d: "The Reviewer pulls topics, key terms and open questions out of each interview by quoting it, which makes two candidates easier to read side by side.",
      },
      {
        t: "Check any quote instantly",
        d: "Timestamps mean a disputed line can be verified against the audio in seconds.",
      },
      {
        t: "Export into your process",
        d: "Word or PDF for the hiring file, plain text for pasting into a scorecard.",
      },
      {
        t: "Nothing to provision",
        d: "Anyone on the team can use it in a browser. No seats to buy before you find out whether it helps.",
      },
    ],
    workflow: [
      "Record the interview with the candidate's consent.",
      "Drop the file in and choose the language mode that matches the call.",
      "Correct anything misheard while the conversation is still fresh.",
      "Run the Reviewer to get topics and open questions per candidate.",
      "Export to Word or PDF for the hiring file.",
    ],
    faqs: [
      {
        q: "Does it sync with our ATS?",
        a: "No. There are no integrations today — you export a Word, PDF or text file and put it wherever your process lives. Anything else would require sending transcripts to a server, which is the thing this tool exists to avoid.",
      },
      {
        q: "Can it tell the interviewer from the candidate?",
        a: "Not automatically. Segments are timestamped but unlabelled, so you mark the turns yourself on a two-party call. Speaker labelling is on the roadmap.",
      },
      {
        q: "Does it score or rank candidates?",
        a: "No, and that is on purpose. The Reviewer organises and quotes what was said; it does not judge people. Scoring stays with the humans doing the hiring.",
      },
      PRIVACY_FAQ,
      COST_FAQ,
    ],
    relatedTools: ["interview-transcription", "meeting-transcription", "transcribe-audio-to-text"],
    related: ["legal", "research", "healthcare"],
  },
  {
    slug: "research",
    navLabel: "Journalists & researchers",
    title: "Transcription for Journalists and Researchers",
    description:
      "Transcribe source interviews and fieldwork without uploading them. Filipino and Taglish kept as spoken.",
    head: "Source interviews that stay",
    accent: "between you and the source",
    sub: "Fieldwork, FGDs, source calls. Transcribed on your own laptop, in the language the interview actually happened in.",
    roles: ["Journalists", "Academics", "NGO researchers", "Documentarians"],
    problem: {
      head: "You promised confidentiality,",
      accent: "then you uploaded the tape",
      body: [
        "If you have ever hesitated before dragging a source interview into an online transcription service, the instinct was right. Once the recording is uploaded, protecting your source stops being entirely your decision.",
        "For fieldwork in the Philippines there is a second loss. Interviews happen in Filipino, in Taglish, in whatever the room speaks — and an engine that translates as it transcribes quietly destroys the quotes you came for.",
      ],
    },
    outcomes: [
      {
        t: "The recording never travels",
        d: "Transcription happens on your machine. There is no service holding your fieldwork, and nothing to subpoena from us because we never had it.",
      },
      {
        t: "Quotes survive intact",
        d: "Filipino and Taglish are decoded in the original language, so what you print is what was said.",
      },
      {
        t: "Find the quote fast",
        d: "Every line is timestamped, so going from a transcript line back to the audio for verification is one click.",
      },
      {
        t: "The original is preserved",
        d: "Your edits are a separate layer; the engine's raw output remains recoverable, which matters when accuracy is challenged.",
      },
      {
        t: "Organised for coding",
        d: "The Reviewer groups a transcript into topics and key terms by quoting it, a reasonable starting point before formal coding.",
      },
      {
        t: "No per-minute bill",
        d: "Long fieldwork does not get more expensive, because the compute is yours.",
      },
    ],
    workflow: [
      "Record the interview in the field.",
      "Back at your laptop, drop the file in and select the language.",
      "Work through the transcript, correcting names and places.",
      "Use timestamps to verify every quote you plan to publish.",
      "Export to Word for writing, or plain text for your analysis tool.",
    ],
    faqs: [
      {
        q: "Could you be compelled to hand over my interviews?",
        a: "We never receive them, so there is nothing to hand over. The file is read by your browser from your disk and the transcript stays in that browser unless you explicitly save it to your account.",
      },
      {
        q: "Does it work for group discussions?",
        a: "It transcribes them, but it does not yet label who spoke, so an FGD gives you the words without the attribution. For small groups people usually mark turns during the correction pass.",
      },
      {
        q: "How accurate is it on field recordings?",
        a: "Accuracy tracks audio quality, as with any engine. Noisy rooms and distant mics are harder. Everything is timestamped precisely so that checking and fixing is quick rather than painful.",
      },
      PRIVACY_FAQ,
      COST_FAQ,
    ],
    relatedTools: ["interview-transcription", "tagalog-audio-to-text", "transcribe-mp3-to-text"],
    related: ["legal", "education", "recruiting"],
  },
  {
    slug: "ministry",
    navLabel: "Churches",
    title: "Transcription for Churches and Ministries",
    description:
      "Turn sermons and services into transcripts, notes and subtitles. Taglish preserved. Free and fully on-device.",
    head: "Sermons turned into",
    accent: "text, notes and subtitles",
    sub: "Preaching in Taglish, transcribed as Taglish. For churches putting services online without a media budget.",
    roles: ["Pastors", "Media teams", "Volunteers", "Small group leaders"],
    problem: {
      head: "Preaching is Taglish and",
      accent: "auto-captions translate it away",
      body: [
        "Filipino preaching moves between Filipino and English constantly, often within a single verse of exposition. Automatic captioning on video platforms handles this badly, usually by deciding the whole thing is English and translating the Filipino into an approximation.",
        "Most church media teams are volunteers with no budget, which rules out per-minute transcription for a weekly service that runs over an hour.",
      ],
    },
    outcomes: [
      {
        t: "Taglish preaching, written as preached",
        d: "The Filipino decoder is selected explicitly, so the Filipino half of a sermon does not come back as English.",
      },
      {
        t: "Subtitles for the stream",
        d: "Export SRT or VTT and load them onto the uploaded service video.",
      },
      {
        t: "Sermon notes from the transcript",
        d: "The Reviewer pulls topics, key terms and lists out of the message, quoted verbatim, as a base for a handout.",
      },
      {
        t: "Free at weekly volume",
        d: "A volunteer on a normal laptop can do this every week at no cost.",
      },
      {
        t: "Nothing uploaded",
        d: "Recordings of a congregation stay on the church's own machine.",
      },
      {
        t: "Any recording format",
        d: "Whatever the stream or camera produced — MP4, MOV, MP3, M4A and the rest.",
      },
    ],
    workflow: [
      "Take the recording from the stream, camera or sound desk.",
      "Drop it in and choose Filipino / Taglish.",
      "Correct names, places and scripture references.",
      "Export SRT or VTT for the video, or Word for a handout.",
      "Run the Reviewer if you want a topic outline of the message.",
    ],
    faqs: [
      {
        q: "Will it get scripture references right?",
        a: "Usually the book and numbers come through, but references and proper names are the most common thing to correct. Timestamps make that pass quick.",
      },
      {
        q: "Can a volunteer run this?",
        a: "Yes. It is drag, choose a language, wait, export. The only technical requirement is a reasonably modern computer and the one-time model download.",
      },
      {
        q: "Can we subtitle a service that already went out?",
        a: "Yes. Transcribe the uploaded recording, correct it, export SRT or VTT, and add it to the video as a subtitle track.",
      },
      PRIVACY_FAQ,
      COST_FAQ,
    ],
    relatedTools: ["generate-subtitles", "taglish-transcription", "transcribe-video-to-text"],
    related: ["education", "media", "research"],
  },
  {
    slug: "media",
    navLabel: "Podcasts & content",
    title: "Transcription for Podcasters and Content Teams",
    description:
      "Transcripts, show notes and subtitles from your own footage. Nothing uploaded, no per-minute cost.",
    head: "Every episode becomes",
    accent: "text you can actually use",
    sub: "Show notes, subtitles, pull quotes and clips. From footage that never leaves your edit machine.",
    roles: ["Podcasters", "Video editors", "Social media managers", "Content writers"],
    problem: {
      head: "Unreleased footage on",
      accent: "someone else's servers",
      body: [
        "Uploading an unreleased episode to a transcription service means an embargoed interview now exists somewhere outside your control, before it has been cut, cleared or scheduled.",
        "And for Philippine content the captioning problem is worse than most people notice: a Taglish episode auto-captioned into English reads as a translation of the conversation rather than a record of it, which makes the clips useless.",
      ],
    },
    outcomes: [
      {
        t: "Footage stays on your machine",
        d: "Transcription is local, so unreleased material never leaves the edit suite.",
      },
      {
        t: "SRT and VTT for every cut",
        d: "Subtitles export straight from the corrected transcript, with timings that follow your edits.",
      },
      {
        t: "Show notes from the transcript",
        d: "The Reviewer groups an episode into topics and key terms, quoted verbatim, which is most of a show-notes draft.",
      },
      {
        t: "Find the clip",
        d: "Timestamps make locating the exact moment of a good line a matter of clicking the line.",
      },
      {
        t: "Taglish captions that read right",
        d: "Code-switching is preserved, so the captions match the conversation your audience heard.",
      },
      {
        t: "No length pricing",
        d: "A three-hour episode costs the same as a ten-minute one, which is nothing.",
      },
    ],
    workflow: [
      "Export the audio or drop the video file in directly.",
      "Choose the language mode that matches the episode.",
      "Correct names, brands and in-jokes the model will not know.",
      "Export SRT or VTT for the upload, and text for the show notes.",
      "Use the Reviewer output as the skeleton of the episode description.",
    ],
    faqs: [
      {
        q: "Can it separate the host from the guest?",
        a: "Not yet. Transcripts are timestamped but not attributed, so a two-person episode needs the turns marked during correction. Speaker labelling is on the roadmap.",
      },
      {
        q: "How long can an episode be?",
        a: "There is no imposed limit. Long files are read in chunks rather than loaded whole, so the practical ceiling is your own machine.",
      },
      {
        q: "Do the subtitles follow my edits?",
        a: "Yes. The export reads the corrected transcript, not the raw output, so fixing a line fixes the subtitle.",
      },
      PRIVACY_FAQ,
      COST_FAQ,
    ],
    relatedTools: ["generate-subtitles", "video-to-text-converter", "transcribe-video-to-text"],
    related: ["ministry", "research", "education"],
  },
];

export function getUseCase(slug: string): UseCase | undefined {
  return USE_CASES.find((u) => u.slug === slug);
}

export const FOOTER_USE_CASES = USE_CASES.map((u) => ({
  label: u.navLabel,
  href: `/use-cases/${u.slug}`,
}));
