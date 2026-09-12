import type { Segment, Transcript } from "../engine/types";
import type { StoredTranscript } from "../transcript/store";

/**
 * Excerpts from the two real IO Psychology lecture recordings (2026-09-10),
 * kept verbatim — Taglish, filler words, ASR slips and all. The reviewer is
 * tested against this rather than tidy invented text.
 */
const line = (start: number, text: string): [number, string] => [start, text];

const LESSON_ONE: [number, string][] = [
  line(0, "It's a company or it's an organization that produces or publishes psychological tests."),
  line(8, "So now they are considered as the largest publisher of psychological tests."),
  line(19, "So the goal of a psychological corporation is to promote the usefulness of psych testing in the industry."),
  line(30, "Okay, next we have the Western Electric Company."),
  line(33, "So in 1924, Harvard University and Western Electric Company conducted their research."),
  line(41, "They studied about the relationship between the lighting conditions in workplaces and how it helps workers become efficient with their jobs."),
  line(66, "However, productivity seemed to have no relationship to the level of illumination."),
  line(83, "So this led them to pointing the term Hawthorne Effect."),
  line(89, "So yung Hawthorne Effect is a phenomenon wherein after introducing a novel treatment doon sa isang tao, nagbabago yung kanyang productivity."),
  line(103, "Nag-e-increase yung kanyang productivity. However, over time, nag-wear off yun."),
  line(108, "And it will go back to the earlier level of productivity."),
  line(115, "When you are being observed by your instructor while you're doing something, at first, you will try to perform well."),
  line(154, "But as the teacher stays there while they are observing, unti-unti yung quality na ginagawa mo ay babalik din dun sa nauna."),
  line(189, "So next we have Elton Mayo."),
  line(199, "Kasi isa siya sa mga well-known figures in industrial organizational psych."),
  line(215, "So he's an Australian psychologist and he's also a Harvard professor."),
  line(222, "So he's known to be the founder of human relations movement in organizational theory."),
  line(225, "Sinasabi niya na ang productivity sa workplace ay nag-improve because of social factors and emotional well-being rather than the physical conditions or financial incentives alone."),
  line(258, "Very important that the workplace fosters friendliness and conducivity in terms of the dynamics of the team."),
  line(309, "So next, Walter Bingham ulit tayo."),
  line(321, "So he again focused on military personnel classification."),
  line(333, "And one way to organize such is to classify them according to their capabilities or their ability."),
  line(346, "Alam naman natin that being in the military, it's not an easy job. And it requires intelligence."),
  line(372, "Okay, so he is known also to author the Army General Classification Test, which is a benchmark in the history of group testing."),
  line(386, "Now let's go to the specialization from 1946 to 1963."),
  line(395, "During this time of industrial psychology, it has become a legitimate field of scientific inquiry."),
  line(430, "In fact, it was integrated in the American Psychological Association in 1946 when they established the Division of Industrial Psych."),
  line(447, "In the Philippines, sa PAP, Psychological Association of the Philippines, meron na ding Industrial Psychology Division."),
  line(664, "Okay, now let's go to the information age from 1994 to present."),
  line(672, "So this is when communication has revolutionized business and customer-oriented service."),
  line(681, "So, ang internet ay naintroduce sa atin in the 1990s."),
  line(780, "Okay, ngayon masasabi natin na more opportunities open for people kasi may mga trabaho na hindi mo kailangan pumunta sa office everyday because of hybrid setup."),
  line(2172, "Now, let's go to human resources."),
  line(2212, "When we say human resources, this pertains to both people who work for the company and also the organization where they are working."),
  line(2242, "Tandaan natin na isang organisasyon at isang kumpanya ay hindi tatakbo kung walang empleyado."),
  line(2271, "So HR is the division of a business that is charged with finding, recruiting, screening, and training job applicants and employees."),
  line(2311, "Okay. Sa BPO, merong training period, usually one month training period before they can officially take calls."),
  line(4688, "This is because of a law called the peso act, the Republic Act 8759."),
  line(4705, "Okay, so again, that's Republic Act 8759 or also called as Peso Act."),
];

const LESSON_TWO: [number, string][] = [
  line(29, "Okay? So may dalawa klase ng interview. May structured and unstructured."),
  line(35, "Pag structured, usually, well not usually, scored siya."),
  line(40, "Tapos, same set of questions will be asked on the applicants."),
  line(121, "Pag unstructured naman, ito yung mas common. This is more natural in a way na yung takbo ng interview would depend sometimes on the answer of the applicant."),
  line(181, "Kaya siya unstructured kasi kahit saan pwedeng panggalingan yung tanong ng employer."),
  line(193, "So, let's talk about the style of interview."),
  line(199, "One-on-one for sure, alam niyo yan."),
  line(209, "Pag serial is isang aplikante, after niyang ma-interview ng isang interviewer, pupunta siya sa susunod na interviewer and so on."),
  line(237, "Return, this is when you were asked to go back for another interview, but this time you will be interviewed by someone in a higher position."),
  line(269, "Panel, pag panel parang sa defense, isa ka lang, but you will be interviewed by more than one person at the same time."),
  line(295, "Group baligtad. Isang interviewer, more than one interviewees."),
  line(462, "Okay, ano po ang advantage ng structured interview? Definitely questions targeted."),
  line(485, "Aside from that, standardized ang scoring, meaning more objective yan."),
  line(512, "From a legal standpoint, this is viewed more favorably by the courts than an unstructured interview."),
  line(626, "Primacy effect, isa din yan sa problema ng unstructured. So kung ano yung first impression mo, maaaring yun ang maging basis mo."),
  line(692, "Contrast effect. So this happens when the interview performance of one applicant affects the interview score given to the next applicant."),
  line(760, "Next, Negative Information Bias. Okay, ito yung parang sa isang hindi magandang aspeto tungkol sa iyo, na-disregard lahat ng magaganda about you."),
  line(1275, "Okay, how? Let's go to the employee screening."),
  line(1279, "So employee screening is the process of reviewing information about applicants used to select workers."),
  line(1290, "So this includes resumes, job applications, letters of recommendation, and employment tests."),
  line(1320, "Pag resume, this is targeted for a specific job. Dapat one to two pages lang siya."),
  line(1401, "Pag CV kasi, it could be used anywhere. Pero dapat nag-average siya around 3 to 10 pages."),
  line(1479, "Selection. After na masala, pipiliin na. Sa pagpili, hindi lang natin pipiliin kung sino yung ma-hire, but also who will be put in specific positions."),
  line(2888, "So placement. Process of assigning workers to appropriate jobs."),
  line(2942, "Same method used in selection, KSAOs, knowledge, skills, abilities and other characteristics."),
];

function record(id: string, title: string, lines: [number, string][], durationSeconds: number): StoredTranscript {
  const segments: Segment[] = lines.map(([start, text], i) => ({ id: i, start, end: start + 6, text, language: "tl" }));
  const raw: Transcript = {
    segments,
    durationSeconds,
    modelId: "whisper-large-v3-turbo",
    engine: "browser-webgpu",
    language: "auto",
    detectedLanguages: ["tl"],
    createdAt: "2026-09-10T10:45:48.000Z",
    stats: { processingSeconds: 900, realtimeFactor: 5.6 },
  };
  return {
    id,
    title,
    fileName: `${title}.mp4`,
    fileSize: 1_000_000,
    hasVideo: true,
    createdAt: "2026-09-10T10:45:48.000Z",
    updatedAt: "2026-09-10T10:45:48.000Z",
    raw,
    edits: {},
  };
}

export const lessonOne = record("fixture-lesson-1", "2026-09-10 10-45-48", LESSON_ONE, 5093);
export const lessonTwo = record("fixture-lesson-2", "2026-09-10 12-11-38", LESSON_TWO, 3030);
