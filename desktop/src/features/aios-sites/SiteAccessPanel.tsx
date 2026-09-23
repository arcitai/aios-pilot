import * as React from "react";
import { LockKeyhole, UserPlus } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import type { CanvasScope } from "@/shared/api/canvasTypes";
import { addSiteMember } from "./repository";

export function SiteAccessPanel({
  channelId,
  channelName,
  memberCount,
  scope,
  disabled,
  onMembershipChanged,
}: {
  channelId: string;
  channelName: string;
  memberCount: number;
  scope: CanvasScope;
  disabled: boolean;
  onMembershipChanged: () => void;
}) {
  const [pubkey, setPubkey] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<string | null>(null);

  async function handleAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setStatus(null);
    try {
      const result = await addSiteMember(channelId, pubkey, scope);
      if (result.errors.length > 0) {
        setError(
          result.errors
            .map((item) => `${item.pubkey}: ${item.error}`)
            .join(" "),
        );
      }
      if (result.added.length > 0) {
        setStatus(`Added ${result.added.length} person to #${channelName}.`);
        setPubkey("");
        onMembershipChanged();
      } else if (result.errors.length === 0) {
        setStatus("This person already has access to the site channel.");
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not update site access.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-xl border border-border/60 bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">
          <LockKeyhole className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="text-sm font-semibold">Private access</h2>
            <span className="rounded-full bg-muted/60 px-2 py-0.5 text-2xs text-muted-foreground">
              {memberCount} {memberCount === 1 ? "member" : "members"}
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Site drafts are stored in{" "}
            <span className="font-medium text-foreground">#{channelName}</span>.
            Only this private channel’s members can read or edit its canvas.
            Creating the site did not add people from the business workspace.
          </p>
          <form
            className="mt-3 flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => void handleAdd(event)}
          >
            <label className="sr-only" htmlFor={`site-member-${channelId}`}>
              Public key of one person to add
            </label>
            <Input
              autoComplete="off"
              className="font-mono text-xs"
              disabled={disabled || pending}
              id={`site-member-${channelId}`}
              maxLength={64}
              minLength={64}
              onChange={(event) => setPubkey(event.target.value)}
              pattern="[A-Fa-f0-9]{64}"
              placeholder="Add one person by 64-character public key"
              required
              value={pubkey}
            />
            <Button
              className="shrink-0"
              disabled={disabled || pending}
              size="sm"
              type="submit"
              variant="outline"
            >
              <UserPlus />
              {pending ? "Adding…" : "Add person"}
            </Button>
          </form>
          {error ? (
            <p className="mt-2 text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {status ? (
            <p className="mt-2 text-xs text-muted-foreground" role="status">
              {status}
            </p>
          ) : null}
          <p className="mt-2 text-2xs text-muted-foreground">
            Access changes are explicit and apply to the channel document and
            its revision history.
          </p>
        </div>
      </div>
    </section>
  );
}
