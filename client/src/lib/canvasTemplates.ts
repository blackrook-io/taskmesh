import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

export type CanvasTemplateId = "architecture" | "erd";

export type CanvasTemplate = {
  id: CanvasTemplateId;
  label: string;
  description: string;
};

export const CANVAS_TEMPLATES: CanvasTemplate[] = [
  {
    id: "architecture",
    label: "Architecture",
    description: "Client → API → services with a shared data store",
  },
  {
    id: "erd",
    label: "ERD",
    description: "Starter entity boxes and relationships",
  },
];

function architectureSkeleton() {
  return [
    {
      type: "frame" as const,
      id: "arch-frame",
      name: "System architecture",
      children: ["client", "api", "svc-a", "svc-b", "db"],
      x: 40,
      y: 40,
      width: 920,
      height: 420,
    },
    {
      type: "rectangle" as const,
      id: "client",
      x: 80,
      y: 120,
      width: 160,
      height: 80,
      backgroundColor: "#3b82f6",
      label: { text: "Client\n(SPA)", textAlign: "center" as const },
    },
    {
      type: "rectangle" as const,
      id: "api",
      x: 340,
      y: 120,
      width: 160,
      height: 80,
      backgroundColor: "#7dd87d",
      label: { text: "API\nGateway", textAlign: "center" as const },
    },
    {
      type: "rectangle" as const,
      id: "svc-a",
      x: 600,
      y: 80,
      width: 150,
      height: 70,
      backgroundColor: "#a78bfa",
      label: { text: "Service A", textAlign: "center" as const },
    },
    {
      type: "rectangle" as const,
      id: "svc-b",
      x: 600,
      y: 180,
      width: 150,
      height: 70,
      backgroundColor: "#a78bfa",
      label: { text: "Service B", textAlign: "center" as const },
    },
    {
      type: "rectangle" as const,
      id: "db",
      x: 820,
      y: 120,
      width: 120,
      height: 90,
      backgroundColor: "#fb923c",
      label: { text: "Database", textAlign: "center" as const },
    },
    {
      type: "arrow" as const,
      x: 240,
      y: 160,
      start: { id: "client" },
      end: { id: "api" },
      label: { text: "HTTPS" },
    },
    {
      type: "arrow" as const,
      x: 500,
      y: 140,
      start: { id: "api" },
      end: { id: "svc-a" },
    },
    {
      type: "arrow" as const,
      x: 500,
      y: 180,
      start: { id: "api" },
      end: { id: "svc-b" },
    },
    {
      type: "arrow" as const,
      x: 750,
      y: 140,
      start: { id: "svc-a" },
      end: { id: "db" },
    },
    {
      type: "arrow" as const,
      x: 750,
      y: 200,
      start: { id: "svc-b" },
      end: { id: "db" },
    },
  ];
}

function erdSkeleton() {
  return [
    {
      type: "frame" as const,
      id: "erd-frame",
      name: "Entity relationship",
      children: ["users", "projects", "tasks", "tags"],
      x: 40,
      y: 40,
      width: 860,
      height: 380,
    },
    {
      type: "rectangle" as const,
      id: "users",
      x: 80,
      y: 100,
      width: 180,
      height: 120,
      backgroundColor: "#5ec8d8",
      label: {
        text: "users\n───\nid\nemail",
        textAlign: "left" as const,
      },
    },
    {
      type: "rectangle" as const,
      id: "projects",
      x: 360,
      y: 100,
      width: 180,
      height: 120,
      backgroundColor: "#7dd87d",
      label: {
        text: "projects\n───\nid\nname\nowner_id",
        textAlign: "left" as const,
      },
    },
    {
      type: "rectangle" as const,
      id: "tasks",
      x: 640,
      y: 100,
      width: 180,
      height: 140,
      backgroundColor: "#a78bfa",
      label: {
        text: "tasks\n───\nid\nproject_id\ntitle\nstate",
        textAlign: "left" as const,
      },
    },
    {
      type: "rectangle" as const,
      id: "tags",
      x: 360,
      y: 280,
      width: 180,
      height: 100,
      backgroundColor: "#fbbf24",
      label: {
        text: "tags\n───\nid\nname\ncolor",
        textAlign: "left" as const,
      },
    },
    {
      type: "arrow" as const,
      x: 260,
      y: 160,
      start: { id: "users" },
      end: { id: "projects" },
      label: { text: "1:N" },
    },
    {
      type: "arrow" as const,
      x: 540,
      y: 160,
      start: { id: "projects" },
      end: { id: "tasks" },
      label: { text: "1:N" },
    },
    {
      type: "arrow" as const,
      x: 450,
      y: 220,
      start: { id: "projects" },
      end: { id: "tags" },
      label: { text: "M:N" },
    },
  ];
}

/** Build Excalidraw elements for a starter diagram template (new ids). */
export function buildCanvasTemplateElements(id: CanvasTemplateId): ExcalidrawElement[] {
  const skeleton = id === "architecture" ? architectureSkeleton() : erdSkeleton();
  return convertToExcalidrawElements(skeleton, { regenerateIds: true });
}
