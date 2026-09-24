import { Button } from "@/shared/ui/button";
import { AgentCreationPreview } from "./AgentCreationPreview";

/** Shared avatar identity and the explicit path to edit its definition. */
export function EditAgentIdentity({
  avatarUrl,
  disabled,
  label,
  onAvatarChange,
  onEditDefinition,
  onUploadPendingChange,
}: {
  avatarUrl: string | null;
  disabled: boolean;
  label: string;
  onAvatarChange: (value: string) => void;
  onEditDefinition?: () => void;
  onUploadPendingChange: (pending: boolean) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <AgentCreationPreview
        avatarUrl={avatarUrl}
        hideEditControl
        label={label}
        onClearAvatar={() => onAvatarChange("")}
        onUploadPendingChange={onUploadPendingChange}
        onSelectAvatar={onAvatarChange}
      />
      {onEditDefinition ? (
        <Button
          className="w-full"
          disabled={disabled}
          onClick={onEditDefinition}
          size="sm"
          type="button"
          variant="outline"
        >
          Edit avatar
        </Button>
      ) : (
        <p className="text-center text-xs text-muted-foreground">
          Avatar is shared identity
        </p>
      )}
    </div>
  );
}
