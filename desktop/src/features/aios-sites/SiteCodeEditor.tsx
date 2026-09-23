import * as React from "react";
import { Code2, FileCode2, FileText } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { Textarea } from "@/shared/ui/textarea";
import type { SiteFiles } from "./document";

type SiteFile = keyof SiteFiles;

const files: Array<{ id: SiteFile; label: string; icon: typeof FileText }> = [
  { id: "indexHtml", label: "HTML", icon: FileText },
  { id: "styleCss", label: "CSS", icon: FileCode2 },
  { id: "appJs", label: "JS", icon: Code2 },
];

export function SiteCodeEditor({
  value,
  disabled,
  onChange,
}: {
  value: SiteFiles;
  disabled: boolean;
  onChange: (file: SiteFile, content: string) => void;
}) {
  const [activeFile, setActiveFile] = React.useState<SiteFile>("indexHtml");

  return (
    <section
      aria-label="Site code editor"
      className="flex min-h-[30rem] min-w-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-card"
    >
      <header className="flex items-center justify-between gap-3 border-b border-border/50 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Source files</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            HTML markup, CSS, and JavaScript are saved together in this site’s
            canvas.
          </p>
        </div>
        <span className="rounded-md bg-muted/60 px-2 py-1 font-mono text-2xs text-muted-foreground">
          {activeFile === "indexHtml"
            ? "index.html"
            : activeFile === "styleCss"
              ? "style.css"
              : "app.js"}
        </span>
      </header>
      <Tabs
        className="flex min-h-0 flex-1 flex-col"
        onValueChange={(file) => setActiveFile(file as SiteFile)}
        value={activeFile}
      >
        <TabsList
          aria-label="Site source file"
          className="mx-3 mt-3 w-fit justify-start bg-muted/55"
        >
          {files.map(({ id, label, icon: Icon }) => (
            <TabsTrigger className="gap-1.5" key={id} value={id}>
              <Icon className="size-3.5" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        {files.map(({ id, label }) => (
          <TabsContent className="mt-0 min-h-0 flex-1 p-3" key={id} value={id}>
            <label className="sr-only" htmlFor={`site-source-${id}`}>
              {label} source
            </label>
            <Textarea
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              className="h-full min-h-[24rem] resize-none border-0 bg-muted/20 font-mono text-xs leading-relaxed shadow-none focus-visible:ring-0"
              disabled={disabled}
              id={`site-source-${id}`}
              maxLength={id === "indexHtml" ? 120_000 : 80_000}
              onChange={(event) => onChange(id, event.target.value)}
              spellCheck={false}
              value={value[id]}
              wrap="off"
            />
          </TabsContent>
        ))}
      </Tabs>
      <p className="border-t border-border/40 px-4 py-2 text-2xs text-muted-foreground">
        HTML is body markup. Put page behavior in <code>app.js</code> and styles
        in <code>style.css</code>.
      </p>
    </section>
  );
}
