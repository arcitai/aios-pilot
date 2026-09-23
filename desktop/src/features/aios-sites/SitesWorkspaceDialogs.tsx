import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { Button } from "@/shared/ui/button";

export function SitesWorkspaceDialogs({
  pendingAction,
  onCancelPending,
  onDownloadDraft,
  onConfirmPending,
  showConflictOverwrite,
  onConflictDialogChange,
  onSaveOverLatest,
}: {
  pendingAction: (() => void) | null;
  onCancelPending: () => void;
  onDownloadDraft: () => void;
  onConfirmPending: () => void;
  showConflictOverwrite: boolean;
  onConflictDialogChange: (open: boolean) => void;
  onSaveOverLatest: () => void;
}) {
  return (
    <>
      <AlertDialog
        open={pendingAction !== null}
        onOpenChange={(open) => !open && onCancelPending()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Keep this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved site changes. Download a copy first, or discard
              them and continue. Saved canvas revisions remain in Buzz history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <Button onClick={onDownloadDraft} size="sm" variant="outline">
              Download draft JSON
            </Button>
            <AlertDialogAction onClick={onConfirmPending}>
              Discard and continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={showConflictOverwrite}
        onOpenChange={onConflictDialogChange}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Save your draft over the latest version?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This creates a new Buzz canvas revision containing your draft. The
              incoming version stays in history. If another edit arrives before
              the save, Buzz will reject this attempt and keep both drafts
              available.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction onClick={onSaveOverLatest}>
              Save as new revision
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
