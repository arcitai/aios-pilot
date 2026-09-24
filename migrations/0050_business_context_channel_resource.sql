-- Mark the one explicitly selected private NIP-29 group that backs Business
-- context. Existing channels remain untyped and keep their current ACL/history.
ALTER TABLE channels
    ADD COLUMN resource_type TEXT,
    ADD CONSTRAINT chk_channels_resource_type_scope CHECK (
        resource_type IS NULL OR (
            resource_type = 'aios.business-context:v1'
            AND channel_type = 'stream'
            AND visibility = 'private'
        )
    );

CREATE UNIQUE INDEX idx_channels_one_business_context_per_community
    ON channels (community_id)
    WHERE resource_type = 'aios.business-context:v1';

CREATE FUNCTION preserve_channel_resource_type() RETURNS TRIGGER AS $$
BEGIN
    IF OLD.resource_type IS NOT NULL
        AND NEW.resource_type IS DISTINCT FROM OLD.resource_type THEN
        RAISE EXCEPTION 'channel resource type is immutable once registered'
            USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.resource_type IS NULL
        AND NEW.resource_type IS NOT NULL
        AND NEW.archived_at IS NOT NULL THEN
        RAISE EXCEPTION 'archived channels cannot be registered as resources'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_channels_resource_type_immutable
    BEFORE UPDATE ON channels
    FOR EACH ROW EXECUTE FUNCTION preserve_channel_resource_type();
