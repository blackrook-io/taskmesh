export type ImageBoardCamera = { x: number; y: number; zoom: number };

export type ImageBoardItemBase = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
};

export type ImageBoardImage = ImageBoardItemBase & {
  type: "image";
  src: string;
};

export type ImageBoardText = ImageBoardItemBase & {
  type: "text";
  html: string;
  fontSize: number;
  color: string;
  align: "left" | "center" | "right";
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  list?: "ul" | "ol" | null;
};

export type ImageBoardBox = ImageBoardItemBase & {
  type: "box";
  title?: string;
  color: string;
  childIds: string[];
};

export type ImageBoardItem = ImageBoardImage | ImageBoardText | ImageBoardBox;

export type ImageBoardDocument = {
  camera: ImageBoardCamera;
  gridVisible: boolean;
  items: ImageBoardItem[];
};

export function emptyImageBoardDocument(): ImageBoardDocument {
  return {
    camera: { x: 0, y: 0, zoom: 1 },
    gridVisible: false,
    items: [],
  };
}

function asNumber(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function asString(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function newId(): string {
  return crypto.randomUUID();
}

export function createItemId(): string {
  return newId();
}

export function normalizeDocument(raw: unknown): ImageBoardDocument {
  const base = emptyImageBoardDocument();
  if (!raw || typeof raw !== "object") return base;
  const obj = raw as Record<string, unknown>;
  const cam = (obj.camera && typeof obj.camera === "object" ? obj.camera : {}) as Record<
    string,
    unknown
  >;
  const camera: ImageBoardCamera = {
    x: asNumber(cam.x, 0),
    y: asNumber(cam.y, 0),
    zoom: Math.min(5, Math.max(0.1, asNumber(cam.zoom, 1))),
  };
  const itemsRaw = Array.isArray(obj.items) ? obj.items : [];
  const items: ImageBoardItem[] = [];
  for (const entry of itemsRaw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const type = e.type;
    const id = asString(e.id, newId());
    const x = asNumber(e.x, 0);
    const y = asNumber(e.y, 0);
    const w = Math.max(8, asNumber(e.w, 100));
    const h = Math.max(8, asNumber(e.h, 100));
    const z = asNumber(e.z, 0);
    if (type === "image") {
      items.push({ id, type: "image", src: asString(e.src, ""), x, y, w, h, z });
    } else if (type === "text") {
      const alignRaw = asString(e.align, "left");
      const align = alignRaw === "center" || alignRaw === "right" ? alignRaw : "left";
      const listRaw = e.list;
      const list = listRaw === "ul" || listRaw === "ol" ? listRaw : null;
      items.push({
        id,
        type: "text",
        html: asString(e.html, ""),
        fontSize: Math.max(8, asNumber(e.fontSize, 16)),
        color: asString(e.color, "#d4e8d4"),
        align,
        bold: Boolean(e.bold),
        italic: Boolean(e.italic),
        underline: Boolean(e.underline),
        list,
        x,
        y,
        w,
        h,
        z,
      });
    } else if (type === "box") {
      const childIds = Array.isArray(e.childIds)
        ? e.childIds.filter((c): c is string => typeof c === "string")
        : [];
      items.push({
        id,
        type: "box",
        title: typeof e.title === "string" ? e.title : undefined,
        color: asString(e.color, "rgba(80, 120, 90, 0.35)"),
        childIds,
        x,
        y,
        w,
        h,
        z,
      });
    }
  }
  return {
    camera,
    gridVisible: Boolean(obj.gridVisible),
    items: ensureBoxesAtBottom(items),
  };
}

export function documentToRecord(doc: ImageBoardDocument): Record<string, unknown> {
  return {
    camera: doc.camera,
    gridVisible: doc.gridVisible,
    items: doc.items,
  };
}

const BOX_PAD = 16;
const BOX_TITLE_H = 28;

/** Resize box to fit its children (with padding / title room). */
export function fitBoxToChildren(
  box: ImageBoardBox,
  items: ImageBoardItem[],
): ImageBoardBox {
  const children = items.filter((i) => box.childIds.includes(i.id));
  if (children.length === 0) return box;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of children) {
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x + c.w);
    maxY = Math.max(maxY, c.y + c.h);
  }
  const top = BOX_PAD + (box.title ? BOX_TITLE_H : 0);
  return {
    ...box,
    x: minX - BOX_PAD,
    y: minY - top,
    w: Math.max(80, maxX - minX + BOX_PAD * 2),
    h: Math.max(60, maxY - minY + top + BOX_PAD),
  };
}

/** Keep all boxes beneath every non-box item; preserve relative order within each group. */
export function ensureBoxesAtBottom(items: ImageBoardItem[]): ImageBoardItem[] {
  if (items.length === 0) return items;
  const boxes = items.filter((i) => i.type === "box").sort((a, b) => a.z - b.z || a.id.localeCompare(b.id));
  const rest = items.filter((i) => i.type !== "box").sort((a, b) => a.z - b.z || a.id.localeCompare(b.id));
  let z = 0;
  const remapped = new Map<string, ImageBoardItem>();
  for (const box of boxes) {
    remapped.set(box.id, { ...box, z: z++ });
  }
  for (const item of rest) {
    remapped.set(item.id, { ...item, z: z++ });
  }
  return items.map((i) => remapped.get(i.id) ?? i);
}

export function cycleZForward(items: ImageBoardItem[], selectedId: string): ImageBoardItem[] {
  const selected = items.find((i) => i.id === selectedId);
  if (!selected || selected.type === "box") return ensureBoxesAtBottom(items);
  const peers = items.filter((i) => i.type !== "box");
  if (peers.length < 2) return ensureBoxesAtBottom(items);
  const zs = peers.map((i) => i.z);
  const maxZ = Math.max(...zs);
  const minZ = Math.min(...zs);
  const next =
    selected.z >= maxZ
      ? items.map((i) => (i.id === selectedId ? { ...i, z: minZ - 1 } : i))
      : items.map((i) => (i.id === selectedId ? { ...i, z: maxZ + 1 } : i));
  return ensureBoxesAtBottom(next);
}

export function findBoxAtPoint(
  items: ImageBoardItem[],
  wx: number,
  wy: number,
  excludeId?: string,
): ImageBoardBox | null {
  const boxes = items
    .filter((i): i is ImageBoardBox => i.type === "box" && i.id !== excludeId)
    .sort((a, b) => b.z - a.z);
  for (const box of boxes) {
    if (wx >= box.x && wx <= box.x + box.w && wy >= box.y && wy <= box.y + box.h) {
      return box;
    }
  }
  return null;
}

export function gridStepForZoom(zoom: number): number {
  if (zoom < 0.5) return 200;
  if (zoom < 1.25) return 100;
  return 50;
}

export async function naturalImageSize(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const max = 480;
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      resolve({
        w: Math.max(40, Math.round(img.naturalWidth * scale)),
        h: Math.max(40, Math.round(img.naturalHeight * scale)),
      });
    };
    img.onerror = () => resolve({ w: 320, h: 240 });
    img.src = src;
  });
}
