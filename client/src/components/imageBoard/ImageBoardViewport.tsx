import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { uploadFile } from "../../api/client";
import {
  createItemId,
  cycleZForward,
  ensureBoxesAtBottom,
  findBoxAtPoint,
  fitBoxToChildren,
  gridStepForZoom,
  naturalImageSize,
  type ImageBoardBox,
  type ImageBoardDocument,
  type ImageBoardImage,
  type ImageBoardItem,
  type ImageBoardText,
} from "../../lib/imageBoardDocument";
import { BoxContextMenu, TextToolbar } from "./ImageBoardChrome";

type Tool = "select" | "text" | "box";

type Props = {
  document: ImageBoardDocument;
  onChange: (next: ImageBoardDocument) => void;
  readOnly?: boolean;
};

type DragState =
  | { kind: "pan"; sx: number; sy: number; camX: number; camY: number }
  | {
      kind: "move";
      id: string;
      sx: number;
      sy: number;
      ox: number;
      oy: number;
      childOrigins?: Record<string, { x: number; y: number }>;
    }
  | {
      kind: "resize";
      id: string;
      corner: "nw" | "ne" | "sw" | "se";
      sx: number;
      sy: number;
      ox: number;
      oy: number;
      ow: number;
      oh: number;
      aspect: number;
    }
  | { kind: "draw-box"; sx: number; sy: number; wx: number; wy: number };

const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export function ImageBoardViewport({ document: doc, onChange, readOnly = false }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [boxMenu, setBoxMenu] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const [renamingBoxId, setRenamingBoxId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const lastPointerWorld = useRef({ x: 0, y: 0 });
  const docRef = useRef(doc);
  docRef.current = doc;

  const selected = doc.items.find((i) => i.id === selectedId) ?? null;
  const selectedText = selected?.type === "text" ? selected : null;

  const updateDoc = useCallback(
    (updater: (prev: ImageBoardDocument) => ImageBoardDocument) => {
      if (readOnly) return;
      const next = updater(docRef.current);
      onChange({ ...next, items: ensureBoxesAtBottom(next.items) });
    },
    [onChange, readOnly],
  );

  const commitBoxRename = useCallback(
    (boxId: string, title: string) => {
      const trimmed = title.trim();
      updateDoc((prev) => ({
        ...prev,
        items: prev.items.map((i) =>
          i.id === boxId && i.type === "box"
            ? fitBoxToChildren({ ...i, title: trimmed || undefined }, prev.items)
            : i,
        ),
      }));
      setRenamingBoxId(null);
      setRenameDraft("");
    },
    [updateDoc],
  );

  const screenToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const root = rootRef.current;
      if (!root) return { x: 0, y: 0 };
      const rect = root.getBoundingClientRect();
      const sx = clientX - rect.left;
      const sy = clientY - rect.top;
      return {
        x: (sx - doc.camera.x) / doc.camera.zoom,
        y: (sy - doc.camera.y) / doc.camera.zoom,
      };
    },
    [doc.camera.x, doc.camera.y, doc.camera.zoom],
  );

  const placeImage = useCallback(
    async (file: File, at?: { x: number; y: number }) => {
      if (!IMAGE_MIME.has(file.type)) {
        setUploadError("Only jpeg, png, gif, and webp images are supported");
        return;
      }
      setUploadError(null);
      try {
        const src = await uploadFile(file);
        const size = await naturalImageSize(src);
        const pos = at ?? lastPointerWorld.current;
        const id = createItemId();
        updateDoc((prev) => {
          const maxZ = prev.items.reduce((m, i) => Math.max(m, i.z), 0);
          let items: ImageBoardItem[] = [
            ...prev.items,
            {
              id,
              type: "image",
              src,
              x: pos.x - size.w / 2,
              y: pos.y - size.h / 2,
              w: size.w,
              h: size.h,
              z: maxZ + 1,
            },
          ];
          const box = findBoxAtPoint(items, pos.x, pos.y, id);
          if (box) {
            items = items.map((i) => {
              if (i.id !== box.id || i.type !== "box") return i;
              const nextBox: ImageBoardBox = {
                ...i,
                childIds: [...i.childIds, id],
              };
              return fitBoxToChildren(nextBox, items);
            });
          }
          return { ...prev, items };
        });
        setSelectedId(id);
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "Upload failed");
      }
    },
    [updateDoc],
  );

  const onWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const root = rootRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      updateDoc((prev) => {
        const oldZ = prev.camera.zoom;
        const zoom = Math.min(5, Math.max(0.1, oldZ * factor));
        const wx = (sx - prev.camera.x) / oldZ;
        const wy = (sy - prev.camera.y) / oldZ;
        return {
          ...prev,
          camera: {
            zoom,
            x: sx - wx * zoom,
            y: sy - wy * zoom,
          },
        };
      });
    },
    [updateDoc],
  );

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onWheel]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || readOnly) return;

    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            void placeImage(file, lastPointerWorld.current);
          }
          return;
        }
      }
    };

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [placeImage, readOnly]);

  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable ||
          target.tagName === "SELECT")
      ) {
        if (e.key.toLowerCase() !== "escape") return;
      }
      const key = e.key.toLowerCase();
      if (key === "t") {
        e.preventDefault();
        setTool("text");
      } else if (key === "b") {
        e.preventDefault();
        setTool("box");
      } else if (key === "g") {
        e.preventDefault();
        updateDoc((prev) => ({ ...prev, gridVisible: !prev.gridVisible }));
      } else if (key === "z" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (selectedId) {
          updateDoc((prev) => ({
            ...prev,
            items: cycleZForward(prev.items, selectedId),
          }));
        }
      } else if (key === "escape") {
        setTool("select");
        setSelectedId(null);
        setBoxMenu(null);
      } else if ((key === "delete" || key === "backspace") && selectedId) {
        e.preventDefault();
        updateDoc((prev) => ({
          ...prev,
          items: prev.items
            .filter((i) => i.id !== selectedId)
            .map((i) =>
              i.type === "box"
                ? { ...i, childIds: i.childIds.filter((c) => c !== selectedId) }
                : i,
            ),
        }));
        setSelectedId(null);
      } else if (key === "v" || key === "s") {
        setTool("select");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readOnly, selectedId, updateDoc]);

  const hitTest = (wx: number, wy: number): ImageBoardItem | null => {
    const sorted = [...doc.items].sort((a, b) => b.z - a.z);
    for (const item of sorted) {
      if (wx >= item.x && wx <= item.x + item.w && wy >= item.y && wy <= item.y + item.h) {
        return item;
      }
    }
    return null;
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (readOnly || e.button !== 0) return;
    rootRef.current?.focus();
    const world = screenToWorld(e.clientX, e.clientY);
    lastPointerWorld.current = world;

    if (tool === "text") {
      const maxZ = doc.items.reduce((m, i) => Math.max(m, i.z), 0);
      const id = createItemId();
      const text: ImageBoardText = {
        id,
        type: "text",
        html: "",
        fontSize: 18,
        color: "#d4e8d4",
        align: "left",
        x: world.x,
        y: world.y,
        w: 220,
        h: 80,
        z: maxZ + 1,
      };
      updateDoc((prev) => ({ ...prev, items: [...prev.items, text] }));
      setSelectedId(id);
      setTool("select");
      return;
    }

    if (tool === "box") {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      setDrag({ kind: "draw-box", sx: e.clientX, sy: e.clientY, wx: world.x, wy: world.y });
      return;
    }

    const hit = hitTest(world.x, world.y);
    if (!hit) {
      setSelectedId(null);
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      setDrag({
        kind: "pan",
        sx: e.clientX,
        sy: e.clientY,
        camX: doc.camera.x,
        camY: doc.camera.y,
      });
      return;
    }

    setSelectedId(hit.id);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);

    if (hit.type === "box") {
      const childOrigins: Record<string, { x: number; y: number }> = {};
      for (const cid of hit.childIds) {
        const child = doc.items.find((i) => i.id === cid);
        if (child) childOrigins[cid] = { x: child.x, y: child.y };
      }
      setDrag({
        kind: "move",
        id: hit.id,
        sx: e.clientX,
        sy: e.clientY,
        ox: hit.x,
        oy: hit.y,
        childOrigins,
      });
      return;
    }

    setDrag({
      kind: "move",
      id: hit.id,
      sx: e.clientX,
      sy: e.clientY,
      ox: hit.x,
      oy: hit.y,
    });
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const world = screenToWorld(e.clientX, e.clientY);
    lastPointerWorld.current = world;
    if (!drag) return;

    if (drag.kind === "pan") {
      const dx = e.clientX - drag.sx;
      const dy = e.clientY - drag.sy;
      updateDoc((prev) => ({
        ...prev,
        camera: { ...prev.camera, x: drag.camX + dx, y: drag.camY + dy },
      }));
      return;
    }

    if (drag.kind === "draw-box") {
      // preview via temporary item id __drawing__
      const x1 = Math.min(drag.wx, world.x);
      const y1 = Math.min(drag.wy, world.y);
      const w = Math.abs(world.x - drag.wx);
      const h = Math.abs(world.y - drag.wy);
      updateDoc((prev) => {
        const without = prev.items.filter((i) => i.id !== "__drawing__");
        const maxZ = without.reduce((m, i) => Math.max(m, i.z), 0);
        return {
          ...prev,
          items: [
            ...without,
            {
              id: "__drawing__",
              type: "box",
              color: "rgba(80, 120, 90, 0.35)",
              childIds: [],
              x: x1,
              y: y1,
              w: Math.max(8, w),
              h: Math.max(8, h),
              z: maxZ + 1,
            },
          ],
        };
      });
      return;
    }

    const zoom = doc.camera.zoom;
    const dx = (e.clientX - drag.sx) / zoom;
    const dy = (e.clientY - drag.sy) / zoom;

    if (drag.kind === "move") {
      updateDoc((prev) => {
        let items = prev.items.map((i) => {
          if (i.id === drag.id) return { ...i, x: drag.ox + dx, y: drag.oy + dy };
          if (drag.childOrigins?.[i.id]) {
            const o = drag.childOrigins[i.id]!;
            return { ...i, x: o.x + dx, y: o.y + dy };
          }
          return i;
        });
        const moved = items.find((i) => i.id === drag.id);
        if (moved && moved.type !== "box") {
          // remove from old boxes
          items = items.map((i) =>
            i.type === "box"
              ? { ...i, childIds: i.childIds.filter((c) => c !== drag.id) }
              : i,
          );
          const box = findBoxAtPoint(items, moved.x + moved.w / 2, moved.y + moved.h / 2, drag.id);
          if (box) {
            items = items.map((i) => {
              if (i.id !== box.id || i.type !== "box") return i;
              const next: ImageBoardBox = {
                ...i,
                childIds: i.childIds.includes(drag.id) ? i.childIds : [...i.childIds, drag.id],
              };
              return fitBoxToChildren(next, items);
            });
          }
        }
        return { ...prev, items };
      });
      return;
    }

    if (drag.kind === "resize") {
      const { corner, ox, oy, ow, oh, aspect } = drag;
      let nx = ox;
      let ny = oy;
      let nw = ow;
      let nh = oh;
      if (corner === "se") {
        nw = Math.max(24, ow + dx);
        nh = nw / aspect;
      } else if (corner === "sw") {
        nw = Math.max(24, ow - dx);
        nh = nw / aspect;
        nx = ox + ow - nw;
      } else if (corner === "ne") {
        nw = Math.max(24, ow + dx);
        nh = nw / aspect;
        ny = oy + oh - nh;
      } else {
        nw = Math.max(24, ow - dx);
        nh = nw / aspect;
        nx = ox + ow - nw;
        ny = oy + oh - nh;
      }
      updateDoc((prev) => ({
        ...prev,
        items: prev.items.map((i) =>
          i.id === drag.id ? { ...i, x: nx, y: ny, w: nw, h: nh } : i,
        ),
      }));
    }
  };

  const onPointerUp = () => {
    if (drag?.kind === "draw-box") {
      updateDoc((prev) => {
        const drawing = prev.items.find((i) => i.id === "__drawing__");
        if (!drawing || drawing.w < 16 || drawing.h < 16) {
          return { ...prev, items: prev.items.filter((i) => i.id !== "__drawing__") };
        }
        const id = createItemId();
        setSelectedId(id);
        return {
          ...prev,
          items: prev.items.map((i) =>
            i.id === "__drawing__" ? { ...i, id, title: "Box" } : i,
          ),
        };
      });
      setTool("select");
    }
    setDrag(null);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (readOnly) return;
    const world = screenToWorld(e.clientX, e.clientY);
    const hit = hitTest(world.x, world.y);
    if (hit?.type === "box") {
      e.preventDefault();
      setSelectedId(hit.id);
      setRenamingBoxId(hit.id);
      setRenameDraft(hit.title ?? "");
      setBoxMenu(null);
      return;
    }
    if (hit) return;
    fileInputRef.current?.click();
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (readOnly) return;
    const world = screenToWorld(e.clientX, e.clientY);
    const files = [...e.dataTransfer.files].filter((f) => IMAGE_MIME.has(f.type));
    for (const file of files) {
      void placeImage(file, world);
    }
  };

  const startResize = (
    e: ReactPointerEvent,
    item: ImageBoardImage,
    corner: "nw" | "ne" | "sw" | "se",
  ) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setSelectedId(item.id);
    setDrag({
      kind: "resize",
      id: item.id,
      corner,
      sx: e.clientX,
      sy: e.clientY,
      ox: item.x,
      oy: item.y,
      ow: item.w,
      oh: item.h,
      aspect: item.w / item.h,
    });
  };

  const gridStep = gridStepForZoom(doc.camera.zoom);
  const sortedItems = [...doc.items].sort((a, b) => a.z - b.z);

  return (
    <div className="ib-viewport-wrap">
      <div className="ib-toolbar" role="toolbar" aria-label="Image board tools">
        <button
          type="button"
          className={`btn small ${tool === "select" ? "primary" : "ghost"}`}
          onClick={() => setTool("select")}
          title="Select / pan (V)"
        >
          Select
        </button>
        <button
          type="button"
          className={`btn small ${tool === "text" ? "primary" : "ghost"}`}
          onClick={() => setTool("text")}
          title="Text (T)"
        >
          T Text
        </button>
        <button
          type="button"
          className={`btn small ${tool === "box" ? "primary" : "ghost"}`}
          onClick={() => setTool("box")}
          title="Box (B)"
        >
          B Box
        </button>
        <button
          type="button"
          className={`btn small ${doc.gridVisible ? "primary" : "ghost"}`}
          onClick={() => updateDoc((prev) => ({ ...prev, gridVisible: !prev.gridVisible }))}
          title="Grid (G)"
        >
          G Grid
        </button>
        <button
          type="button"
          className="btn small ghost"
          disabled={!selected || selected.type !== "image"}
          onClick={() => {
            if (!selectedId) return;
            updateDoc((prev) => ({
              ...prev,
              items: cycleZForward(prev.items, selectedId),
            }));
          }}
          title="Cycle Z-order (Z)"
        >
          Z Order
        </button>
        <span className="ib-toolbar__hint muted">
          Drag empty space to pan · scroll to zoom · paste / drop images
        </span>
      </div>

      {selectedText ? (
        <TextToolbar
          text={selectedText}
          onChange={(patch) => {
            updateDoc((prev) => ({
              ...prev,
              items: prev.items.map((i) =>
                i.id === selectedText.id && i.type === "text" ? { ...i, ...patch } : i,
              ),
            }));
          }}
        />
      ) : null}

      {uploadError ? (
        <p className="ib-upload-error" role="alert">
          {uploadError}
        </p>
      ) : null}

      <div
        ref={rootRef}
        className={`ib-viewport ${tool === "box" ? "ib-viewport--box" : ""} ${tool === "text" ? "ib-viewport--text" : ""}`}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <div
          className="ib-world"
          style={{
            transform: `translate(${doc.camera.x}px, ${doc.camera.y}px) scale(${doc.camera.zoom})`,
          }}
        >
          {doc.gridVisible ? (
            <div
              className="ib-grid"
              style={
                {
                  "--ib-grid": `${gridStep}px`,
                } as CSSProperties
              }
            />
          ) : null}

          {sortedItems.map((item) => {
            const selectedCls = item.id === selectedId ? " ib-item--selected" : "";
            if (item.type === "box") {
              const isRenaming = renamingBoxId === item.id;
              return (
                <div
                  key={item.id}
                  className={`ib-item ib-box${selectedCls}`}
                  style={{
                    left: item.x,
                    top: item.y,
                    width: item.w,
                    height: item.h,
                    zIndex: item.z,
                    background: item.color,
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSelectedId(item.id);
                    setBoxMenu({ id: item.id, x: e.clientX, y: e.clientY });
                  }}
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSelectedId(item.id);
                    setRenamingBoxId(item.id);
                    setRenameDraft(item.title ?? "");
                    setBoxMenu(null);
                  }}
                >
                  {isRenaming ? (
                    <input
                      className="ib-box__rename"
                      value={renameDraft}
                      autoFocus
                      aria-label="Box title"
                      onPointerDown={(e) => e.stopPropagation()}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={() => commitBoxRename(item.id, renameDraft)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitBoxRename(item.id, renameDraft);
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          setRenamingBoxId(null);
                          setRenameDraft("");
                        }
                      }}
                    />
                  ) : item.title ? (
                    <div className="ib-box__title">{item.title}</div>
                  ) : null}
                </div>
              );
            }
            if (item.type === "text") {
              return (
                <TextItem
                  key={item.id}
                  item={item}
                  selected={item.id === selectedId}
                  onFocus={() => setSelectedId(item.id)}
                  onCommit={(html, size) => {
                    updateDoc((prev) => ({
                      ...prev,
                      items: prev.items.map((i) =>
                        i.id === item.id && i.type === "text"
                          ? {
                              ...i,
                              html,
                              ...(size ? { w: size.w, h: size.h } : {}),
                            }
                          : i,
                      ),
                    }));
                  }}
                />
              );
            }
            return (
              <div
                key={item.id}
                className={`ib-item ib-image${selectedCls}`}
                style={{
                  left: item.x,
                  top: item.y,
                  width: item.w,
                  height: item.h,
                  zIndex: item.z,
                }}
              >
                <img src={item.src} alt="" draggable={false} />
                {item.id === selectedId ? (
                  <>
                    {(["nw", "ne", "sw", "se"] as const).map((corner) => (
                      <span
                        key={corner}
                        className={`ib-handle ib-handle--${corner}`}
                        onPointerDown={(ev) => startResize(ev, item, corner)}
                      />
                    ))}
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        hidden
        multiple
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          for (const file of files) {
            void placeImage(file, lastPointerWorld.current);
          }
        }}
      />

      {boxMenu ? (
        <BoxContextMenu
          x={boxMenu.x}
          y={boxMenu.y}
          title={(doc.items.find((i) => i.id === boxMenu.id) as ImageBoardBox | undefined)?.title ?? ""}
          color={
            (doc.items.find((i) => i.id === boxMenu.id) as ImageBoardBox | undefined)?.color ??
            "rgba(80, 120, 90, 0.35)"
          }
          onClose={() => setBoxMenu(null)}
          onSave={(title, color) => {
            updateDoc((prev) => ({
              ...prev,
              items: prev.items.map((i) =>
                i.id === boxMenu.id && i.type === "box"
                  ? fitBoxToChildren({ ...i, title: title || undefined, color }, prev.items)
                  : i,
              ),
            }));
            setBoxMenu(null);
          }}
        />
      ) : null}
    </div>
  );
}

function measureTextBounds(el: HTMLElement): { w: number; h: number } {
  const prev = {
    width: el.style.width,
    height: el.style.height,
    whiteSpace: el.style.whiteSpace,
    overflow: el.style.overflow,
  };
  el.style.width = "max-content";
  el.style.height = "auto";
  el.style.whiteSpace = "pre-wrap";
  el.style.overflow = "visible";
  const w = Math.max(40, Math.ceil(el.scrollWidth) + 2);
  const h = Math.max(24, Math.ceil(el.scrollHeight) + 2);
  el.style.width = prev.width;
  el.style.height = prev.height;
  el.style.whiteSpace = prev.whiteSpace;
  el.style.overflow = prev.overflow;
  return { w, h };
}

function TextItem({
  item,
  selected,
  onFocus,
  onCommit,
}: {
  item: ImageBoardText;
  selected: boolean;
  onFocus: () => void;
  onCommit: (html: string, size?: { w: number; h: number }) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    if (document.activeElement === ref.current) return;
    const next = item.html || "";
    if (ref.current.innerText !== next) {
      ref.current.innerText = next || (selected ? "" : "Text");
    }
  }, [item.html, item.id, selected]);

  const readText = (el: HTMLElement) => {
    const text = el.innerText.replace(/\n$/, "");
    return text === "Text" ? "" : text;
  };

  const listStyle: CSSProperties =
    item.list === "ul"
      ? { listStyleType: "disc", paddingLeft: "1.2rem", display: "list-item" }
      : item.list === "ol"
        ? { listStyleType: "decimal", paddingLeft: "1.2rem", display: "list-item" }
        : {};

  return (
    <div
      ref={ref}
      className={`ib-item ib-text${selected ? " ib-item--selected" : ""}`}
      style={{
        left: item.x,
        top: item.y,
        width: item.w,
        height: item.h,
        zIndex: item.z,
        fontSize: item.fontSize,
        color: item.color,
        textAlign: item.align,
        fontWeight: item.bold ? 700 : 400,
        fontStyle: item.italic ? "italic" : "normal",
        textDecoration: item.underline ? "underline" : "none",
        background: "transparent",
        ...listStyle,
      }}
      contentEditable={selected}
      suppressContentEditableWarning
      onFocus={onFocus}
      onPointerDown={(e) => {
        onFocus();
        // Let the viewport handle drag when not yet editing this text.
        if (selected) e.stopPropagation();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        // After the newline is inserted, fit box to text bounds.
        requestAnimationFrame(() => {
          const el = ref.current;
          if (!el) return;
          const size = measureTextBounds(el);
          onCommit(readText(el), size);
        });
      }}
      onBlur={(e) => {
        onCommit(readText(e.currentTarget));
      }}
    />
  );
}
