import type { AiChatMessage } from "@taskmesh/ai-provider-contract";
import { redactSecrets } from "../aiMinimize.js";
import { wrapUntrusted } from "../untrustedContent.js";

export const ANSWER_HISTORY_LIMIT = 6;
export const ANSWER_TURN_MAX = 2_000;

export type AnswerTurn = {
  role: "user" | "assistant";
  content: string;
};

/** Last six turns, each cut to 2,000 characters. Older turns are dropped. */
export function selectAnswerHistory(history: readonly AnswerTurn[]): AnswerTurn[] {
  return history.slice(-ANSWER_HISTORY_LIMIT).map((turn) => ({
    role: turn.role,
    content: turn.content.slice(0, ANSWER_TURN_MAX),
  }));
}

export function answerMessages(args: {
  prompt: string;
  contextText: string;
  question: string;
  history: readonly AnswerTurn[];
}): AiChatMessage[] {
  const messages: AiChatMessage[] = [
    { role: "system", content: args.prompt },
    { role: "system", content: args.contextText },
  ];
  for (const turn of selectAnswerHistory(args.history)) {
    const content = redactSecrets(turn.content).trim();
    if (!content) continue;
    messages.push({
      role: turn.role,
      content: wrapUntrusted(content, "answer-history"),
    });
  }
  messages.push({
    role: "user",
    content: wrapUntrusted(redactSecrets(args.question.trim()), "answer"),
  });
  return messages;
}
