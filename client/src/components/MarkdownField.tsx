import "@uiw/react-md-editor/markdown-editor.css";
import MDEditor from "@uiw/react-md-editor";
import { uploadFile } from "../api/client";

type Props = {
  value: string;
  onChange: (v: string) => void;
  height?: number;
  enableImageUpload?: boolean;
};

export function MarkdownField({ value, onChange, height = 280, enableImageUpload = true }: Props) {
  async function handlePickImage() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/gif,image/webp";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const url = await uploadFile(file);
      const insert = `\n![](${url})\n`;
      onChange(`${value}${insert}`);
    };
    input.click();
  }

  return (
    <div data-color-mode="dark" className="md-field">
      {enableImageUpload ? (
        <div className="btn-row" style={{ marginBottom: "0.5rem" }}>
          <button type="button" className="btn small" onClick={() => void handlePickImage()}>
            Upload image
          </button>
          <span className="muted">Inserts a Markdown image link after upload.</span>
        </div>
      ) : null}
      <MDEditor value={value} onChange={(v) => onChange(v ?? "")} height={height} visibleDragbar={false} />
    </div>
  );
}
