import * as React from "react";
import { UsersRound } from "lucide-react";
import type { CanvasScope } from "@/shared/api/canvasTypes";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog";
import { useBusinessAccess } from "./useBusinessAccess";

type Choice = { pubkey: string; name: string; action: "grant" | "remove" };

function displayName(pubkey: string, name: string | null) {
  return name?.trim() || `${pubkey.slice(0, 8)}…${pubkey.slice(-6)}`;
}

/** A focused access dialog, separate from channel and agent setup. */
export function BusinessAccess({
  contextId,
  companyName,
  scope,
}: {
  contextId: string;
  companyName: string;
  scope: CanvasScope;
}) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <UsersRound className="size-3.5" aria-hidden="true" /> Access
        </Button>
      </DialogTrigger>
      {open ? (
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Business access</DialogTitle>
            <DialogDescription>
              Who can use the company knowledge for {companyName}.
            </DialogDescription>
          </DialogHeader>
          <AccessContent
            key={`${scope.expectedRelayUrl}:${scope.expectedSignerPubkey}:${contextId}`}
            contextId={contextId}
            scope={scope}
            onBusyChange={setBusy}
          />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function AccessContent({
  contextId,
  scope,
  onBusyChange,
}: {
  contextId: string;
  scope: CanvasScope;
  onBusyChange: (busy: boolean) => void;
}) {
  const access = useBusinessAccess(contextId, scope);
  const [choice, setChoice] = React.useState<Choice | null>(null);
  React.useEffect(() => {
    onBusyChange(access.pending);
    return () => onBusyChange(false);
  }, [access.pending, onBusyChange]);
  const error = access.error ?? access.members.error?.message;
  const disabled =
    access.pending || access.members.isFetching || access.verificationPending;

  return (
    <div className="space-y-5">
      {error ? (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={access.pending || access.members.isFetching}
            onClick={async () => {
              if (await access.refresh()) setChoice(null);
            }}
          >
            Refresh access
          </Button>
        </div>
      ) : null}
      {access.notice ? (
        <p role="status" className="text-sm">
          {access.notice}
        </p>
      ) : null}
      {access.members.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading access…
        </p>
      ) : !access.members.isError ? (
        <ul
          className="divide-y divide-border/50"
          aria-label="People and agents with business access"
        >
          {access.members.data?.map((member) => {
            const name = displayName(member.pubkey, member.displayName);
            const self = member.pubkey === scope.expectedSignerPubkey;
            return (
              <li
                className="flex items-center justify-between gap-3 py-3"
                key={member.pubkey}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {name}
                    {self ? " (you)" : ""}
                  </p>
                  <p className="text-xs capitalize text-muted-foreground">
                    {member.isAgent ? "Agent" : member.role}
                  </p>
                </div>
                {access.canManage && !self && member.role !== "owner" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    aria-label={`Remove ${name}'s business access`}
                    onClick={() =>
                      setChoice({
                        pubkey: member.pubkey,
                        name,
                        action: "remove",
                      })
                    }
                  >
                    Remove
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {choice && access.canManage ? (
        <section
          className="space-y-3 rounded-lg border border-border p-4"
          aria-label="Confirm access change"
        >
          <p className="text-sm font-medium">
            {choice.action === "grant"
              ? `Give ${choice.name} access?`
              : `Remove ${choice.name}'s access?`}
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {choice.action === "grant"
              ? "They can read and edit company details and sources, and see saved versions and any earlier conversations stored with this context."
              : "This stops future access to this context. It does not remove copies already exported or change their other channel memberships."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={disabled}
              onClick={async () => {
                if (await access.changeAccess(choice.pubkey, choice.action))
                  setChoice(null);
              }}
            >
              {access.pending
                ? "Saving…"
                : choice.action === "grant"
                  ? "Grant access"
                  : "Remove access"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={access.pending}
              onClick={() => setChoice(null)}
            >
              Cancel
            </Button>
          </div>
        </section>
      ) : access.canManage ? (
        <div className="space-y-3">
          <label
            htmlFor="business-access-search"
            className="text-sm font-medium"
          >
            Add a teammate
          </label>
          <Input
            id="business-access-search"
            placeholder="Search people in your workspace"
            value={access.query}
            maxLength={200}
            disabled={disabled}
            onChange={(event) => access.setQuery(event.target.value)}
          />
          {access.query.trim().length >= 2 ? (
            access.people.isError ? (
              <div className="space-y-2">
                <p role="alert" className="text-sm text-destructive">
                  {access.people.error.message}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void access.people.refetch()}
                >
                  Retry search
                </Button>
              </div>
            ) : access.people.isFetching ||
              access.search !== access.query.trim() ? (
              <p role="status" className="text-sm text-muted-foreground">
                Searching people…
              </p>
            ) : access.candidates.length ? (
              <ul className="space-y-1" aria-label="People you can add">
                {access.candidates.map((person) => {
                  const name = displayName(person.pubkey, person.displayName);
                  return (
                    <li key={person.pubkey}>
                      <Button
                        className="h-auto w-full justify-start py-3"
                        variant="ghost"
                        disabled={disabled}
                        onClick={() =>
                          setChoice({
                            pubkey: person.pubkey,
                            name,
                            action: "grant",
                          })
                        }
                      >
                        <span className="min-w-0 text-left">
                          <span className="block truncate">{name}</span>
                          {person.nip05Handle ? (
                            <span className="block truncate text-xs font-normal text-muted-foreground">
                              {person.nip05Handle}
                            </span>
                          ) : null}
                        </span>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p role="status" className="text-sm text-muted-foreground">
                No new teammates found. People already listed above have access.
              </p>
            )
          ) : null}
        </div>
      ) : !access.members.isPending && !access.members.isError ? (
        <p className="text-sm text-muted-foreground">
          A context owner or admin can change access.
        </p>
      ) : null}
    </div>
  );
}
