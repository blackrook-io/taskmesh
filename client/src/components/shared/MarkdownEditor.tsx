import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import { uploadFile } from "../../api/client";

type Props = {
  value: string;
  onChange: (v: string) => void;
  onBlur?: (v: string) => void;
  height?: number;
  enableImageUpload?: boolean;
  placeholder?: string;
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
  label: string;
  title?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`btn small md-toolbar__btn${active ? " is-active" : ""}`}
      title={title ?? label}
      aria-label={title ?? label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function MarkdownEditor({
  value,
  onChange,
  onBlur,
  height = 280,
  enableImageUpload = true,
  placeholder = "Write Markdown…",
}: Props) {
  const [mode, setMode] = useState<Mode>("edit");
  const [focusMode, setFocusMode] = useState(false);
  const [uploading, setUploading] = useState(false);
  const lastEmitted = useRef(value);
  const editorRef = useRef<Editor | null>(null);
  const modeRef = useRef(mode);
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);
  modeRef.current = mode;
  onChangeRef.current = onChange;
  onBlurRef.current = onBlur;

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
      Image.configure({ allowBase64: false }),
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
    editable: mode === "edit",
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
    onBlur: ({ editor: ed }) => {
      onBlurRef.current?.(ed.getMarkdown());
    },
  });

  editorRef.current = editor;

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(mode === "edit");
  }, [editor, mode]);

  useEffect(() => {
    if (!editor) return;
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    editor.commands.setContent(value || "", { contentType: "markdown" });
  }, [editor, value]);

  async function pickAndUploadImage() {
    if (!editor || !enableImageUpload) return;
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

  const disabled = !editor || mode !== "edit";

  return (
    <div className={`md-editor${focusMode ? " md-editor--focus" : ""}`}>
      <div className="md-toolbar" role="toolbar" aria-label="Markdown formatting">
        <div className="md-toolbar__group">
          <ToolbarButton
            label="Edit"
            active={mode === "edit"}
            onClick={() => setMode("edit")}
          />
          <ToolbarButton
            label="Preview"
            active={mode === "preview"}
            onClick={() => setMode("preview")}
          />
          <ToolbarButton
            label={focusMode ? "Exit focus" : "Focus"}
            active={focusMode}
            onClick={() => setFocusMode((v) => !v)}
          />
        </div>
        <div className="md-toolbar__group">
          <ToolbarButton
            label="H1"
            title="Heading 1"
            disabled={disabled}
            active={editor?.isActive("heading", { level: 1 })}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
          />
          <ToolbarButton
            label="H2"
            title="Heading 2"
            disabled={disabled}
            active={editor?.isActive("heading", { level: 2 })}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          />
          <ToolbarButton
            label="H3"
            title="Heading 3"
            disabled={disabled}
            active={editor?.isActive("heading", { level: 3 })}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
          />
        </div>
        <div className="md-toolbar__group">
          <ToolbarButton
            label="B"
            title="Bold"
            disabled={disabled}
            active={editor?.isActive("bold")}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          />
          <ToolbarButton
            label="I"
            title="Italic"
            disabled={disabled}
            active={editor?.isActive("italic")}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          />
          <ToolbarButton
            label="U"
            title="Underline"
            disabled={disabled}
            active={editor?.isActive("underline")}
            onClick={() => editor?.chain().focus().toggleUnderline().run()}
          />
          <ToolbarButton label="Link" disabled={disabled} active={editor?.isActive("link")} onClick={setLink} />
        </div>
        <div className="md-toolbar__group">
          <ToolbarButton
            label="• List"
            title="Bullet list"
            disabled={disabled}
            active={editor?.isActive("bulletList")}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          />
          <ToolbarButton
            label="1. List"
            title="Ordered list"
            disabled={disabled}
            active={editor?.isActive("orderedList")}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          />
          <ToolbarButton
            label="☑"
            title="Checklist"
            disabled={disabled}
            active={editor?.isActive("taskList")}
            onClick={() => editor?.chain().focus().toggleTaskList().run()}
          />
          <ToolbarButton label="Table" disabled={disabled} onClick={insertTable} />
        </div>
        <div className="md-toolbar__group">
          <ToolbarButton
            label="⟸"
            title="Align left"
            disabled={disabled}
            active={editor?.isActive({ textAlign: "left" })}
            onClick={() => editor?.chain().focus().setTextAlign("left").run()}
          />
          <ToolbarButton
            label="⇔"
            title="Align center"
            disabled={disabled}
            active={editor?.isActive({ textAlign: "center" })}
            onClick={() => editor?.chain().focus().setTextAlign("center").run()}
          />
          <ToolbarButton
            label="⟹"
            title="Align right"
            disabled={disabled}
            active={editor?.isActive({ textAlign: "right" })}
            onClick={() => editor?.chain().focus().setTextAlign("right").run()}
          />
        </div>
        {enableImageUpload ? (
          <div className="md-toolbar__group">
            <ToolbarButton
              label={uploading ? "Uploading…" : "Image"}
              title="Upload image"
              disabled={disabled || uploading}
              onClick={() => void pickAndUploadImage()}
            />
            <span className="muted md-toolbar__hint">Paste image to upload</span>
          </div>
        ) : null}
      </div>
      <div className="md-editor__surface" style={{ minHeight: height }}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
