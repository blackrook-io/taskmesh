export type Idea = {
  id: number;
  title: string;
  body: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Project = {
  id: number;
  name: string;
  description: string | null;
  status: string;
  sourceIdeaId: number | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectPhase = {
  id: number;
  projectId: number;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type Task = {
  id: number;
  projectId: number;
  phaseId: number | null;
  title: string;
  notes: string | null;
  dueAt: string | null;
  color: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type ProjectDocument = {
  id: number;
  projectId: number;
  title: string;
  body: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
};

export type ApiErrorBody = { error: { code: string; message: string } };

export type { EntityType } from "./lib/entityType";
export { ENTITY_TYPES, isEntityType } from "./lib/entityType";

