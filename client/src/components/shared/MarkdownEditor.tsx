import { useEffect, useRef, useState, type ReactNode } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
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
import { ResizableMarkdownImage } from "./ResizableMarkdownImage";

type Props = {
  value: string;
  onChange: (v: string) => void;
  onBlur?: (v: string) => void;
  height?: number;
  /** Grow to fill a flex parent instead of a fixed min-height. */
  fill?: boolean;
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
  fill = false,
  enableImageUpload = true,
  placeholder = "Write Markdown…",
  readOnly = false,
  className,
}: Props) {
  const [mode, setMode] = useState<Mode>("preview");
  const [focusMode, setFocusMode] = useState(false);
  const [uploading, setUploading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef(value);
  const editorRef = useRef<Editor | null>(null);
  const modeRef = useRef(mode);
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);
  modeRef.current = mode;
  onChangeRef.current = onChange;
  onBlurRef.current = onBlur;

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
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
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

  const disabled = readOnly || !editor || mode !== "edit";

  return (
    <div
      ref={rootRef}
      className={[
        "md-editor",
        focusMode ? "md-editor--focus" : null,
        readOnly ? "md-editor--readonly" : null,
        fill ? "md-editor--fill" : null,
        mode === "preview" && !readOnly ? "md-editor--previewing" : null,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div
        className="md-editor__surface"
        style={fill ? undefined : { minHeight: height }}
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
      </div>
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
