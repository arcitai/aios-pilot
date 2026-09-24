type BrowserAccessFieldProps = {
  available: boolean;
  disabled: boolean;
  id: string;
  value: boolean;
  onChange: (value: boolean) => void;
};

/** Per-instance opt-in; deliberately not part of the shared persona definition. */
export function BrowserAccessField({
  available,
  disabled,
  id,
  value,
  onChange,
}: BrowserAccessFieldProps) {
  const canEnable = available || value;
  const helpId = `${id}-help`;

  return (
    <section className="space-y-2 rounded-lg border border-border/70 p-3">
      <label className="flex items-start gap-2.5" htmlFor={id}>
        <input
          aria-describedby={helpId}
          checked={value}
          className="mt-1 h-4 w-4 shrink-0 accent-primary"
          disabled={disabled || !canEnable}
          id={id}
          onChange={(event) => onChange(event.currentTarget.checked)}
          type="checkbox"
        />
        <span className="space-y-1">
          <span className="block text-sm font-medium text-foreground">
            Browser access
          </span>
          <span className="block text-xs text-muted-foreground">
            Start a local Playwright browser for this agent.
          </span>
        </span>
      </label>
      <div
        className="space-y-1 pl-[26px] text-xs text-muted-foreground"
        id={helpId}
      >
        {available ? (
          <>
            <p>
              For localhost development. The browser can reach any site this
              computer can access. First start downloads Playwright MCP and
              Chromium, so network access is required. If setup fails, check the
              runtime log and restart the agent to retry.
            </p>
            <p>
              Buzz strips agent credentials from browser processes. Treat pages
              as untrusted: the browser runs as your user and is not an
              operating-system sandbox. Storage is temporary; stopping the agent
              also stops its browser.
            </p>
          </>
        ) : value ? (
          <p>
            Browser access is available only with a local Buzz ACP agent. Turn
            it off to save these run settings.
          </p>
        ) : (
          <p>Available for local agents using Buzz ACP.</p>
        )}
      </div>
    </section>
  );
}
