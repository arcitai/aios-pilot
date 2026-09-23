import * as React from "react";

export function useSitesDraftGuard({
  isDirty,
  isCreating,
  isSaving,
  onDirtyChange,
}: {
  isDirty: boolean;
  isCreating: boolean;
  isSaving: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [pendingAction, setPendingAction] = React.useState<(() => void) | null>(
    null,
  );
  const operationInFlightRef = React.useRef(false);
  const dirtyRef = React.useRef(isDirty);
  const dirtyCallbackRef = React.useRef(onDirtyChange);
  dirtyCallbackRef.current = onDirtyChange;
  dirtyRef.current = isDirty || operationInFlightRef.current;

  React.useEffect(() => {
    dirtyCallbackRef.current?.(isDirty || isCreating || isSaving);
  }, [isDirty, isCreating, isSaving]);

  React.useEffect(() => {
    const guardReload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guardReload);
    return () => window.removeEventListener("beforeunload", guardReload);
  }, []);

  React.useEffect(() => () => dirtyCallbackRef.current?.(false), []);

  function runAfterDraftDecision(action: () => void) {
    if (dirtyRef.current) {
      setPendingAction(() => action);
      return;
    }
    action();
  }

  function confirmPendingAction() {
    const action = pendingAction;
    setPendingAction(null);
    action?.();
  }

  return {
    pendingAction,
    setPendingAction,
    dirtyRef,
    operationInFlightRef,
    runAfterDraftDecision,
    confirmPendingAction,
  };
}
