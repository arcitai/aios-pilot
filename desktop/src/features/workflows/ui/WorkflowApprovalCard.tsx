import type { WorkflowApproval } from "@/shared/api/types";
import { useApprovalMutation } from "@/features/workflows/hooks";
import { Button } from "@/shared/ui/button";

type WorkflowApprovalCardProps = {
  approval: WorkflowApproval;
};

export function WorkflowApprovalCard({ approval }: WorkflowApprovalCardProps) {
  const mutation = useApprovalMutation();
  const isExpired = new Date(approval.expiresAt) < new Date();

  if (approval.status !== "pending" || isExpired) {
    return null;
  }

  return (
    <div
      className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3"
      data-testid="workflow-approval-card"
    >
      <p className="mb-2 text-sm font-medium">Approval Required</p>
      <p className="mb-2 text-xs text-muted-foreground">
        Approver: {approval.approverSpec}
      </p>
      {approval.message ? (
        <p className="mb-2 whitespace-pre-wrap text-sm">{approval.message}</p>
      ) : null}
      <p className="mb-2 text-xs text-muted-foreground">
        Expires: {new Date(approval.expiresAt).toLocaleString()}
      </p>
      {mutation.error instanceof Error ? (
        <p className="mb-2 text-xs text-destructive" role="alert">
          {mutation.error.message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={mutation.isPending}
          onClick={() =>
            mutation.mutate({ token: approval.approvalRef, action: "grant" })
          }
          size="sm"
          type="button"
        >
          Approve
        </Button>
        <Button
          disabled={mutation.isPending}
          onClick={() =>
            mutation.mutate({ token: approval.approvalRef, action: "deny" })
          }
          size="sm"
          type="button"
          variant="destructive"
        >
          Deny
        </Button>
      </div>
    </div>
  );
}
