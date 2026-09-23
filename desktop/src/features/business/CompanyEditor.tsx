import * as React from "react";
import { Check, Save } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import type { BusinessDocument } from "./document";

const fields = [
  ["name", "Company name", "What do people call your business?"],
  ["website", "Website", "https://your-company.com"],
  ["summary", "What you do", "Who do you help, and what changes for them?"],
  ["audience", "Your customers", "Who are your ideal customers?"],
  ["offers", "Products & services", "What do you offer, and how do you work?"],
  [
    "goals",
    "Current priorities",
    "What would you like your agents to help you achieve?",
  ],
] as const;

export function CompanyEditor({
  document,
  busy,
  onSave,
  onDirtyChange,
}: {
  document: BusinessDocument;
  busy: boolean;
  onSave: (document: BusinessDocument) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [company, setCompany] = React.useState(document.company);
  const [saved, setSaved] = React.useState(false);
  const changed = JSON.stringify(company) !== JSON.stringify(document.company);
  React.useEffect(() => {
    onDirtyChange(changed);
    return () => onDirtyChange(false);
  }, [changed, onDirtyChange]);
  return (
    <form
      className="mx-auto max-w-2xl space-y-6 p-6"
      onSubmit={async (event) => {
        event.preventDefault();
        setSaved(false);
        try {
          await onSave({ ...document, company });
          setSaved(true);
        } catch {
          /* Parent preserves draft and presents the error. */
        }
      }}
    >
      <div>
        <h2 className="text-lg font-semibold">Your company, in your words</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A shared reference for your main agent. You can correct it whenever
          your business changes.
        </p>
      </div>
      {fields.map(([field, label, placeholder]) => (
        <div className="space-y-2" key={field}>
          <label className="text-sm font-medium" htmlFor={`company-${field}`}>
            {label}
          </label>
          {field === "name" || field === "website" ? (
            <Input
              disabled={busy}
              id={`company-${field}`}
              maxLength={field === "name" ? 300 : 2000}
              onChange={(event) => {
                setSaved(false);
                setCompany({ ...company, [field]: event.target.value });
              }}
              placeholder={placeholder}
              value={company[field]}
            />
          ) : (
            <Textarea
              disabled={busy}
              className="min-h-24 resize-y"
              id={`company-${field}`}
              maxLength={12_000}
              onChange={(event) => {
                setSaved(false);
                setCompany({ ...company, [field]: event.target.value });
              }}
              placeholder={placeholder}
              value={company[field]}
            />
          )}
        </div>
      ))}
      <div className="flex items-center gap-3">
        <Button disabled={busy || !changed} type="submit">
          <Save />
          {busy ? "Saving…" : "Save company context"}
        </Button>
        {saved ? (
          <span
            className="flex items-center gap-1 text-sm text-muted-foreground"
            role="status"
          >
            <Check className="size-4" />
            Saved
          </span>
        ) : null}
      </div>
    </form>
  );
}
