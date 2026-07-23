import { and, asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";

type Db = NodePgDatabase<typeof schema>;

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
        dueAt = task.dueAt ? task.dueAt.toISOString() : null;
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
): Promise<number> {
  const rows = await db
    .select({ m: schema.boardCards.sortOrder })
    .from(schema.boardCards)
    .where(
      and(eq(schema.boardCards.boardId, boardId), eq(schema.boardCards.columnId, columnId)),
    );
  return rows.length ? Math.max(...rows.map((r) => r.m)) + 1 : 0;
}
