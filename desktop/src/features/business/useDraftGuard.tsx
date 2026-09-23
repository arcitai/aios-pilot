import * as React from "react";
import { useBlocker } from "@tanstack/react-router";
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

/** Guard both router navigation and workspace tabs with the same draft state. */
export function useDraftGuard() {
  const [dirty, setDirty] = React.useState(false);
  const [pending, setPending] = React.useState<(() => void) | null>(null);
  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: dirty,
    withResolver: true,
  });
  const request = (transition: () => void) => {
    if (dirty) setPending(() => transition);
    else transition();
  };
  const cancel = () => {
    setPending(null);
    if (blocker.status === "blocked") blocker.reset();
  };
  const dialog = (
    <AlertDialog
      open={pending !== null || blocker.status === "blocked"}
      onOpenChange={(open) => {
        if (!open) cancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Leave your unsaved changes?</AlertDialogTitle>
          <AlertDialogDescription>
            Your saved work is safe. Stay here to save the changes you have just
            made, or discard this draft.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={cancel}>Keep editing</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              const transition = pending;
              setPending(null);
              setDirty(false);
              if (blocker.status === "blocked") blocker.proceed();
              else transition?.();
            }}
          >
            Discard draft
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return { setDirty, request, dialog };
}
