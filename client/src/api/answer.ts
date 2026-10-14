import { apiJson } from "./client";
import type { EntityType } from "../lib/entityType";

export type ProjectAnswerCitation = {
  ref: string;
  page: number | null;
  entityType: EntityType;
  entityId: number;
};

export type ProjectAnswer = {
  answer: string;
  citations: ProjectAnswerCitation[];
  grounded: boolean;
  auditId: number | null;
};

export async function askProject(input: {
  projectId: number;
  question: string;
  history?: { role: "user" | "assistant"; content: string }[];
}): Promise<ProjectAnswer> {
  const res = await apiJson<{ data: ProjectAnswer }>("/api/v1/ai/answer", {
    method: "POST",
    body: JSON.stringify({
      projectId: input.projectId,
      question: input.question,
      ...(input.history && input.history.length > 0 ? { history: input.history } : {}),
    }),
  });
  return res.data;
}
