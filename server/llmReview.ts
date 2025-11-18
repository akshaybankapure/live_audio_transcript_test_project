import type { TranscriptSegment, InsertFlaggedContent } from "@shared/schema";

export interface LlmReviewConfig {
  topicPrompt?: string;
  topicKeywords?: string[];
  allowedLanguage?: string;
  model?: string;
}

export interface LlmReviewedFlags {
  profanity: InsertFlaggedContent[];
  languagePolicy: InsertFlaggedContent[];
  offTopic: InsertFlaggedContent[];
}

const DEFAULT_MODEL = "llama-3.1-70b-versatile";

function buildSystemPrompt(config: LlmReviewConfig): string {
  const keywords = (config.topicKeywords || []).join(", ");
  const topicLine = config.topicPrompt
    ? `Primary topic/prompt: "${config.topicPrompt}".`
    : (keywords ? `Primary topic keywords: ${keywords}.` : "No explicit topic provided.");
  const allowedLang = config.allowedLanguage || "en";
  return [
    "You are an assistant that validates content moderation signals for live classroom/group discussions.",
    topicLine,
    `Allowed language code: ${allowedLang}.`,
    "Your job: decide whether proposed flags (profanity, language policy, off_topic) are correct, given the segment text and context.",
    "Rules:",
    "- Profanity: only flag explicit offensive words or slurs. Ignore markup like <end>.",
    "- Language policy: flag only if the spoken language is clearly not the allowed language; minor loanwords are OK.",
    "- Off-topic: flag only if the utterance clearly diverges from the given topic; short greetings or transitions are not off-topic.",
    "Return a strict JSON with fields: profanity[], languagePolicy[], offTopic[] of items to keep.",
    "Each item must include: transcriptId, flaggedWord, context, timestampMs, speaker, flagType.",
    "IMPORTANT: The 'context' field should include a clear explanation of WHY the content was flagged.",
    "For profanity: explain which word is offensive and why (e.g., 'Contains profanity: [word] is an inappropriate term').",
    "For language policy: explain what language was detected and why it violates policy (e.g., 'Detected [language] instead of required [allowed language]').",
    "For off-topic: explain how the content diverges from the topic (e.g., 'Content about [topic] is not related to the discussion topic: [actual topic]').",
  ].join(" ");
}

function makeRequestBody(messages: any[], model: string) {
  return {
    model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages,
  };
}

export async function reviewFlagsWithGroq(
  transcriptId: string,
  segment: TranscriptSegment,
  proposed: LlmReviewedFlags,
  config: LlmReviewConfig = {}
): Promise<LlmReviewedFlags> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    // No LLM available; return proposed flags as-is
    return proposed;
  }

  const model = config.model || DEFAULT_MODEL;
  const system = buildSystemPrompt(config);

  const userPayload = {
    transcriptId,
    segment,
    proposedFlags: proposed,
  };

  const messages = [
    { role: "system", content: system },
    { role: "user", content: JSON.stringify(userPayload) },
  ];

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(makeRequestBody(messages, model)),
    });

    if (!res.ok) {
      // On API failure, fall back to proposed to avoid blocking ingestion
      return proposed;
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      return proposed;
    }

    const parsed = JSON.parse(content);
    const profanity: InsertFlaggedContent[] = Array.isArray(parsed.profanity) ? parsed.profanity : [];
    const languagePolicy: InsertFlaggedContent[] = Array.isArray(parsed.languagePolicy) ? parsed.languagePolicy : [];
    const offTopic: InsertFlaggedContent[] = Array.isArray(parsed.offTopic) ? parsed.offTopic : [];

    return { profanity, languagePolicy, offTopic };
  } catch {
    // Network or parsing issue; do not block flow
    return proposed;
  }
}


