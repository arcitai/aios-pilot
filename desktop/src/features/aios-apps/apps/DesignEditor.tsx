import { useMemo, useState } from "react";
import { Download, Monitor, Smartphone } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import {
  createSandboxedPreviewDocument,
  downloadTextFile,
} from "../htmlPreview";
import { MAX_DESIGN_HTML_LENGTH, type DesignDocument } from "../types";

type DesignEditorProps = {
  document: DesignDocument;
  onChange: (document: DesignDocument) => void;
};

function fileStem(title: string): string {
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "design"
  );
}

export function DesignEditor({ document, onChange }: DesignEditorProps) {
  const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop");
  const [exported, setExported] = useState(false);
  const preview = useMemo(
    () => createSandboxedPreviewDocument(document.html),
    [document.html],
  );

  function update(patch: Partial<DesignDocument>) {
    onChange({ ...document, ...patch, updatedAt: new Date().toISOString() });
  }

  function exportHtml() {
    downloadTextFile(
      `${fileStem(document.title)}.html`,
      document.html,
      "text/html;charset=utf-8",
    );
    setExported(true);
    window.setTimeout(() => setExported(false), 2_000);
  }

  return (
    <div className="aios-app-editor aios-design-editor">
      <div className="aios-editor-toolbar">
        <div className="aios-editor-title-group">
          <label className="aios-eyebrow" htmlFor="aios-design-title">
            Prototype name
          </label>
          <Input
            id="aios-design-title"
            className="aios-deck-title-input"
            maxLength={200}
            value={document.title}
            onChange={(event) => update({ title: event.currentTarget.value })}
          />
          <p className="aios-muted-copy">
            The editor and preview use this same HTML document.
          </p>
        </div>
        <Button type="button" onClick={exportHtml}>
          <Download aria-hidden="true" />
          {exported ? "Exported" : "Export HTML"}
        </Button>
      </div>

      <div className="aios-design-workbench">
        <section
          className="aios-design-code-panel"
          aria-labelledby="aios-design-code-heading"
        >
          <div className="aios-design-panel-heading">
            <div>
              <p className="aios-eyebrow">Source</p>
              <h2 id="aios-design-code-heading">Edit HTML</h2>
            </div>
            <span className="aios-code-language">HTML</span>
          </div>
          <Textarea
            aria-label="Design HTML source"
            className="aios-design-code"
            maxLength={MAX_DESIGN_HTML_LENGTH}
            spellCheck={false}
            value={document.html}
            onChange={(event) => update({ html: event.currentTarget.value })}
          />
          <div className="aios-code-footer">
            <span>
              Scripts, forms, links, and remote assets are disabled in preview.
            </span>
            <span>
              {document.html.length.toLocaleString()}/
              {MAX_DESIGN_HTML_LENGTH.toLocaleString()}
            </span>
          </div>
        </section>

        <section
          className="aios-design-preview-panel"
          aria-labelledby="aios-design-preview-heading"
        >
          <div className="aios-design-panel-heading">
            <div>
              <p className="aios-eyebrow">Preview</p>
              <h2 id="aios-design-preview-heading">See the page</h2>
            </div>
            <fieldset
              className="aios-viewport-toggle"
              aria-label="Preview size"
            >
              <Button
                type="button"
                variant={viewport === "desktop" ? "secondary" : "ghost"}
                size="icon"
                aria-label="Desktop preview"
                aria-pressed={viewport === "desktop"}
                onClick={() => setViewport("desktop")}
              >
                <Monitor aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant={viewport === "mobile" ? "secondary" : "ghost"}
                size="icon"
                aria-label="Mobile preview"
                aria-pressed={viewport === "mobile"}
                onClick={() => setViewport("mobile")}
              >
                <Smartphone aria-hidden="true" />
              </Button>
            </fieldset>
          </div>
          <div className={`aios-preview-frame-wrap is-${viewport}`}>
            <iframe
              title="Sandboxed design preview"
              className="aios-design-preview-frame"
              sandbox=""
              referrerPolicy="no-referrer"
              srcDoc={preview}
            />
          </div>
          <p className="aios-preview-footnote">
            Isolated, non-scripted preview. Export saves an HTML file; it does
            not publish a site.
          </p>
        </section>
      </div>
    </div>
  );
}
