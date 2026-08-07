import { and, asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";

type Db = NodePgDatabase<typeof schema>;

export const BOARD_CARD_ENTITY_TYPES = ["task", "idea", "todo_list"] as const;
export type BoardCardEntityType = (typeof BOARD_CARD_ENTITY_TYPES)[number];

const DEFAULT_COLUMNS = [
  { name: "To Do", sortOrder: 0 },
  { name: "Doing", sortOrder: 1 },
  { name: "Done", sortOrder: 2 },
];

export async function seedDefaultColumns(db: Db, boardId: number): Promise<void> {
  const existing = await db
    .select({ id: schema.boardColumns.id })
    .from(schema.boardColumns)
    .where(eq(schema.boardColumns.boardId, boardId))
    .limit(1);
  if (existing[0]) return;

  for (const col of DEFAULT_COLUMNS) {
    await db.insert(schema.boardColumns).values({
      boardId,
      name: col.name,
      sortOrder: col.sortOrder,
    });
  }
}

export async function loadBoardDetail(db: Db, boardId: number) {
  const [board] = await db.select().from(schema.boards).where(eq(schema.boards.id, boardId));
  if (!board) return null;

  const columns = await db
    .select()
    .from(schema.boardColumns)
    .where(eq(schema.boardColumns.boardId, boardId))
    .orderBy(asc(schema.boardColumns.sortOrder), asc(schema.boardColumns.id));

  const lanes = await db
    .select()
    .from(schema.boardLanes)
    .where(eq(schema.boardLanes.boardId, boardId))
    .orderBy(asc(schema.boardLanes.sortOrder), asc(schema.boardLanes.id));

  const cards = await db
    .select()
    .from(schema.boardCards)
    .where(eq(schema.boardCards.boardId, boardId))
    .orderBy(asc(schema.boardCards.sortOrder), asc(schema.boardCards.id));

  const hydrated = [];
  for (const card of cards) {
    let title = `${card.entityType} #${card.entityId}`;
    let color: string | null = null;
    let dueAt: string | null = null;
    if (card.entityType === "task") {
      const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, card.entityId));
      if (task) {
        title = task.title;
        color = task.color;
        dueAt = task.dueDate ?? (task.dueAt ? task.dueAt.toISOString().slice(0, 10) : null);
      }
    } else if (card.entityType === "idea") {
      const [idea] = await db.select().from(schema.ideas).where(eq(schema.ideas.id, card.entityId));
      if (idea) {
        title = idea.title;
      }
    } else if (card.entityType === "todo_list") {
      const [list] = await db
        .select()
        .from(schema.todoLists)
        .where(eq(schema.todoLists.id, card.entityId));
      if (list) {
        title = list.title;
      }
    }
    hydrated.push({
      ...card,
      title,
      color,
      dueAt,
    });
  }

  return { ...board, columns, lanes, cards: hydrated };
}

export async function nextCardSort(
  db: Db,
  boardId: number,
  columnId: number,
  laneId: number | null = null,
): Promise<number> {
  const rows = await db
    .select({
      m: schema.boardCards.sortOrder,
      laneId: schema.boardCards.laneId,
    })
    .from(schema.boardCards)
    .where(
      and(eq(schema.boardCards.boardId, boardId), eq(schema.boardCards.columnId, columnId)),
    );
  const inCell = rows.filter((r) => (r.laneId ?? null) === laneId);
  return inCell.length ? Math.max(...inCell.map((r) => r.m)) + 1 : 0;
}

export function cellKey(columnId: number, laneId: number | null): string {
  return `${columnId}:${laneId ?? "null"}`;
}
