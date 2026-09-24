-- Persist the user-facing request and the state needed to make approval
-- decisions and resumed execution durable across relay restarts.
ALTER TABLE workflow_approvals
    ADD COLUMN message TEXT NOT NULL DEFAULT '',
    ADD COLUMN channel_id UUID,
    ADD COLUMN workflow_definition JSONB,
    ADD COLUMN approver_pubkeys BYTEA[] NOT NULL DEFAULT ARRAY[]::BYTEA[],
    ADD COLUMN resume_claimed_at TIMESTAMPTZ,
    ADD COLUMN resume_lease_until TIMESTAMPTZ;

UPDATE workflow_approvals a
SET channel_id = w.channel_id,
    workflow_definition = w.definition
FROM workflows w
WHERE a.community_id = w.community_id AND a.workflow_id = w.id;

CREATE INDEX idx_workflow_approvals_pending_expiry
    ON workflow_approvals (expires_at)
    WHERE status = 'pending';

CREATE INDEX idx_workflow_approvals_granted_resume
    ON workflow_approvals (community_id, created_at)
    WHERE status = 'granted' AND resume_claimed_at IS NULL;
