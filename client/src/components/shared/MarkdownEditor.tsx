import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { useNavigate } from "react-router-dom";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import {
  faAlignCenter,
  faAlignLeft,
  faAlignRight,
  faBold,
  faCompress,
  faExpand,
  faImage,
  faItalic,
  faLink,
  faListOl,
  faListUl,
  faSquareCheck,
  faTable,
  faUnderline,
} from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { uploadFile } from "../../api/client";
import { NavIcon } from "../shell/NavIcon";
import { MarkdownReferenceSuggest } from "./MarkdownReferenceSuggest";
import { ResizableMarkdownImage } from "./ResizableMarkdownImage";

const DEFAULT_MIN_HEIGHT = 120;
const DEFAULT_MAX_HEIGHT = 720;

function clampEditorHeight(value: number, minHeight: number, maxHeight: number): number {
  const viewportCap = typeof window !== "undefined" ? Math.floor(window.innerHeight * 0.75) : maxHeight;
  const max = Math.max(minHeight, Math.min(maxHeight, viewportCap));
  return Math.min(max, Math.max(minHeight, Math.round(value)));
}

type Props = {
  value: string;
  onChange: (v: string) => void;
  onBlur?: (v: string) => void;
  height?: number;
  /** Lower clamp for vertical resize (defaults to 120, or `height` when smaller). */
  minHeight?: number;
  /** Upper clamp for vertical resize (defaults to 720, also capped at 75vh). */
  maxHeight?: number;
  /** Grow to fill a flex parent instead of a fixed height (until the user resizes). */
  fill?: boolean;
  /**
   * Size the surface to content (no fixed height / resize handle).
   * Page/viewport scrolls when content is long. Focus mode still uses an inner scrollbar.
   */
  autoHeight?: boolean;
  enableImageUpload?: boolean;
  placeholder?: string;
  /** Preview-only: no toolbar, not editable. */
  readOnly?: boolean;
  className?: string;
};

type Mode = "edit" | "preview";

async function uploadClipboardImage(file: File): Promise<string> {
  return uploadFile(file);
}

function ToolbarButton({
  label,
  title,
  active,
  disabled,
  onClick,
}: {
  label: ReactNode;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`btn small md-toolbar__btn${active ? " is-active" : ""}`}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function IconBtn({
  icon,
  title,
  active,
  disabled,
  onClick,
}: {
  icon: IconDefinition;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <ToolbarButton
      label={<NavIcon icon={icon} size={13} />}
      title={title}
      active={active}
      disabled={disabled}
      onClick={onClick}
    />
  );
}

export function MarkdownEditor({
  value,
  onChange,
  onBlur,
  height = 280,
  minHeight: minHeightProp,
  maxHeight: maxHeightProp = DEFAULT_MAX_HEIGHT,
  fill = false,
  autoHeight = false,
  enableImageUpload = true,
  placeholder = "Write Markdown…",
  readOnly = false,
  className,
}: Props) {
  const navigate = useNavigate();
  const minHeight = Math.min(minHeightProp ?? DEFAULT_MIN_HEIGHT, height);
  const maxHeight = Math.max(maxHeightProp, height);
  const [mode, setMode] = useState<Mode>("preview");
  const [focusMode, setFocusMode] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [surfaceHeight, setSurfaceHeight] = useState(() =>
    clampEditorHeight(height, Math.min(minHeightProp ?? DEFAULT_MIN_HEIGHT, height), Math.max(maxHeightProp, height)),
  );
  /** After the user drags, prefer explicit height over flex `fill`. */
  const [heightLocked, setHeightLocked] = useState(false);
  const [dragging, setDragging] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef(value);
  const editorRef = useRef<Editor | null>(null);
  const modeRef = useRef(mode);
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);
  const navigateRef = useRef(navigate);
  modeRef.current = mode;
  onChangeRef.current = onChange;
  onBlurRef.current = onBlur;
  navigateRef.current = navigate;

  useEffect(() => {
    if (autoHeight || heightLocked) return;
    setSurfaceHeight(clampEditorHeight(height, minHeight, maxHeight));
  }, [autoHeight, height, heightLocked, maxHeight, minHeight]);

  const useFixedHeight = !autoHeight && !focusMode && (!fill || heightLocked);
  const canResize = !autoHeight && !focusMode;

  const activateEdit = () => {
    if (readOnly) return;
    setMode("edit");
    const ed = editorRef.current;
    if (ed) {
      ed.setEditable(true);
      requestAnimationFrame(() => {
        ed.commands.focus();
      });
    }
  };

  useEffect(() => {
    if (readOnly) {
      setMode("preview");
      setFocusMode(false);
    }
  }, [readOnly]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: "noopener noreferrer" },
        isAllowedUri: (url, ctx) => {
          if (!url) return false;
          if (url.startsWith("/") && !url.startsWith("//")) return true;
          return ctx.defaultValidate(url);
        },
      }),
      ResizableMarkdownImage,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder }),
      Markdown.configure({
        markedOptions: { gfm: true },
      }),
    ],
    content: value || "",
    contentType: "markdown",
    editable: !readOnly && mode === "edit",
    editorProps: {
      attributes: {
        class: "md-prose",
      },
      handleClick: (_view, _pos, event) => {
        const t = event.target;
        if (!(t instanceof Element)) return false;
        const a = t.closest("a");
        if (!a) return false;
        const href = a.getAttribute("href");
        if (!href) return false;
        event.preventDefault();
        if (href.startsWith("/") && !href.startsWith("//")) {
          navigateRef.current(href);
          return true;
        }
        window.open(href, "_blank", "noopener,noreferrer");
        return true;
      },
      handlePaste: (_view, event) => {
        if (!enableImageUpload || modeRef.current !== "edit") return false;
        const items = event.clipboardData?.items;
        if (!items) return false;
        const imageItem = Array.from(items).find((item) => item.type.startsWith("image/"));
        if (!imageItem) return false;
        const file = imageItem.getAsFile();
        if (!file) return false;
        event.preventDefault();
        void (async () => {
          setUploading(true);
          try {
            const url = await uploadClipboardImage(file);
            editorRef.current?.chain().focus().setImage({ src: url, alt: file.name }).run();
          } catch (err) {
            console.error(err);
            window.alert(err instanceof Error ? err.message : "Image upload failed");
          } finally {
            setUploading(false);
          }
        })();
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => {
      const md = ed.getMarkdown();
      lastEmitted.current = md;
      onChangeRef.current(md);
    },
    onFocus: () => {
      if (readOnly) return;
      setMode("edit");
    },
    onBlur: ({ editor: ed, event }) => {
      const md = ed.getMarkdown();
      onBlurRef.current?.(md);
      if (readOnly) return;
      const next = event?.relatedTarget;
      if (next instanceof Node && rootRef.current?.contains(next)) {
        return;
      }
      // Defer so toolbar mousedown-preventDefault focus retention wins when applicable.
      requestAnimationFrame(() => {
        if (!rootRef.current?.contains(document.activeElement)) {
          setMode("preview");
        }
      });
    },
  });

  editorRef.current = editor;

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!readOnly && mode === "edit");
  }, [editor, mode, readOnly]);

  useEffect(() => {
    if (!editor) return;
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    editor.commands.setContent(value || "", { contentType: "markdown" });
  }, [editor, value]);

  async function pickAndUploadImage() {
    if (!editor || !enableImageUpload || readOnly) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/gif,image/webp";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setUploading(true);
      try {
        const url = await uploadFile(file);
        editor.chain().focus().setImage({ src: url, alt: file.name }).run();
      } catch (err) {
        window.alert(err instanceof Error ? err.message : "Image upload failed");
      } finally {
        setUploading(false);
      }
    };
    input.click();
  }

  function setLink() {
    if (!editor) return;
    const prev = editor.getAttributes("link").href as string | undefined;
    const next = window.prompt("Link URL", prev ?? "https://");
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: trimmed }).run();
  }

  function insertTable() {
    editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  }

  function onResizePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!canResize) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    const startY = e.clientY;
    const startHeight = surfaceRef.current?.offsetHeight ?? surfaceHeight;
    setHeightLocked(true);
    setDragging(true);
    handle.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      setSurfaceHeight(clampEditorHeight(startHeight + (ev.clientY - startY), minHeight, maxHeight));
    };
    const onUp = (ev: PointerEvent) => {
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      setDragging(false);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }

  const disabled = readOnly || !editor || mode !== "edit";

  return (
    <div
      ref={rootRef}
      className={[
        "md-editor",
        focusMode ? "md-editor--focus" : null,
        readOnly ? "md-editor--readonly" : null,
        autoHeight ? "md-editor--auto-height" : null,
        fill && !heightLocked && !autoHeight ? "md-editor--fill" : null,
        heightLocked && !autoHeight ? "md-editor--height-locked" : null,
        dragging ? "md-editor--resizing" : null,
        mode === "edit" ? "md-editor--editing" : null,
        mode === "preview" && !readOnly ? "md-editor--previewing" : null,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div
        ref={surfaceRef}
        className="md-editor__surface"
        style={useFixedHeight ? { height: surfaceHeight } : undefined}
        tabIndex={readOnly || mode === "edit" ? undefined : 0}
        onFocus={(e) => {
          if (readOnly || mode === "edit") return;
          if (e.target !== e.currentTarget) return;
          activateEdit();
        }}
        onMouseDown={() => {
          if (!readOnly && mode !== "edit") activateEdit();
        }}
      >
        <EditorContent editor={editor} />
        <MarkdownReferenceSuggest editor={editor} enabled={!readOnly && mode === "edit"} />
      </div>
      {canResize ? (
        <div
          className="md-editor__resize"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize editor"
          aria-valuenow={surfaceHeight}
          aria-valuemin={minHeight}
          aria-valuemax={maxHeight}
          tabIndex={0}
          onPointerDown={onResizePointerDown}
          onKeyDown={(e) => {
            if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
            e.preventDefault();
            const delta = e.key === "ArrowUp" ? -24 : 24;
            const base = surfaceRef.current?.offsetHeight ?? surfaceHeight;
            setHeightLocked(true);
            setSurfaceHeight(clampEditorHeight(base + delta, minHeight, maxHeight));
          }}
        />
      ) : null}
      {!readOnly ? (
        <div className="md-toolbar" role="toolbar" aria-label="Markdown formatting">
          <div className="md-toolbar__group">
            <IconBtn
              icon={focusMode ? faCompress : faExpand}
              title={focusMode ? "Exit focus" : "Focus"}
              active={focusMode}
              onClick={() => setFocusMode((v) => !v)}
            />
          </div>
          <div className="md-toolbar__group">
            <ToolbarButton
              label={<span className="md-toolbar__heading">H1</span>}
              title="Heading 1"
              disabled={disabled}
              active={editor?.isActive("heading", { level: 1 })}
              onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
            />
            <ToolbarButton
              label={<span className="md-toolbar__heading">H2</span>}
              title="Heading 2"
              disabled={disabled}
              active={editor?.isActive("heading", { level: 2 })}
              onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
            />
            <ToolbarButton
              label={<span className="md-toolbar__heading">H3</span>}
              title="Heading 3"
              disabled={disabled}
              active={editor?.isActive("heading", { level: 3 })}
              onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
            />
          </div>
          <div className="md-toolbar__group">
            <IconBtn
              icon={faBold}
              title="Bold"
              disabled={disabled}
              active={editor?.isActive("bold")}
              onClick={() => editor?.chain().focus().toggleBold().run()}
            />
            <IconBtn
              icon={faItalic}
              title="Italic"
              disabled={disabled}
              active={editor?.isActive("italic")}
              onClick={() => editor?.chain().focus().toggleItalic().run()}
            />
            <IconBtn
              icon={faUnderline}
              title="Underline"
              disabled={disabled}
              active={editor?.isActive("underline")}
              onClick={() => editor?.chain().focus().toggleUnderline().run()}
            />
            <IconBtn
              icon={faLink}
              title="Link"
              disabled={disabled}
              active={editor?.isActive("link")}
              onClick={setLink}
            />
          </div>
          <div className="md-toolbar__group">
            <IconBtn
              icon={faListUl}
              title="Bullet list"
              disabled={disabled}
              active={editor?.isActive("bulletList")}
              onClick={() => editor?.chain().focus().toggleBulletList().run()}
            />
            <IconBtn
              icon={faListOl}
              title="Ordered list"
              disabled={disabled}
              active={editor?.isActive("orderedList")}
              onClick={() => editor?.chain().focus().toggleOrderedList().run()}
            />
            <IconBtn
              icon={faSquareCheck}
              title="Checklist"
              disabled={disabled}
              active={editor?.isActive("taskList")}
              onClick={() => editor?.chain().focus().toggleTaskList().run()}
            />
            <IconBtn
              icon={faTable}
              title="Insert table"
              disabled={disabled}
              onClick={insertTable}
            />
          </div>
          <div className="md-toolbar__group">
            <IconBtn
              icon={faAlignLeft}
              title="Align left"
              disabled={disabled}
              active={editor?.isActive({ textAlign: "left" })}
              onClick={() => editor?.chain().focus().setTextAlign("left").run()}
            />
            <IconBtn
              icon={faAlignCenter}
              title="Align center"
              disabled={disabled}
              active={editor?.isActive({ textAlign: "center" })}
              onClick={() => editor?.chain().focus().setTextAlign("center").run()}
            />
            <IconBtn
              icon={faAlignRight}
              title="Align right"
              disabled={disabled}
              active={editor?.isActive({ textAlign: "right" })}
              onClick={() => editor?.chain().focus().setTextAlign("right").run()}
            />
          </div>
          {enableImageUpload ? (
            <div className="md-toolbar__group">
              <IconBtn
                icon={faImage}
                title={uploading ? "Uploading…" : "Upload image"}
                disabled={disabled || uploading}
                onClick={() => void pickAndUploadImage()}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
