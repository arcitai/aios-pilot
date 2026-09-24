//! Durable typing and adoption for channel-backed resources.

use chrono::{DateTime, Utc};
use nostr::Event;
use sqlx::{PgPool, Row};
use uuid::Uuid;

use buzz_core::kind::{KIND_CANVAS, KIND_NIP29_EDIT_METADATA};
use buzz_core::{CommunityId, StoredEvent};
use buzz_datastore_tracing::datastore_span;

use crate::error::{DbError, Result};
use crate::store::event::insert_event_with_thread_metadata_tx;
use crate::Db;

/// Atomically register a typed channel resource and store the signed NIP-29
/// metadata event that requested it. The unique index fences the one-canonical
/// context rule across concurrent registrations.
pub async fn insert_channel_resource_registration_event(
    pool: &PgPool,
    community_id: CommunityId,
    event: &Event,
    channel_id: Uuid,
    resource_type: &str,
    expected_canvas_head: Option<&[u8]>,
) -> Result<(StoredEvent, bool)> {
    const BUSINESS_CONTEXT: &str = "aios.business-context:v1";
    use crate::store::replaceable::event_replacement_lock_key;

    if resource_type != BUSINESS_CONTEXT
        || u32::from(event.kind.as_u16()) != KIND_NIP29_EDIT_METADATA
    {
        return Err(DbError::InvalidData(
            "invalid channel resource registration event".into(),
        ));
    }
    let resource_tags: Vec<_> = event
        .tags
        .iter()
        .map(nostr::Tag::as_slice)
        .filter(|parts| parts.first().map(String::as_str) == Some("resource"))
        .collect();
    if resource_tags.len() != 1
        || resource_tags[0].len() != 2
        || resource_tags[0][1] != resource_type
    {
        return Err(DbError::InvalidData(
            "resource registration must include exactly one matching resource tag".into(),
        ));
    }
    let channel_id_text = channel_id.to_string();
    let channel_tags: Vec<_> = event
        .tags
        .iter()
        .map(nostr::Tag::as_slice)
        .filter(|parts| parts.first().map(String::as_str) == Some("h"))
        .collect();
    if channel_tags.len() != 1
        || channel_tags[0].len() != 2
        || channel_tags[0][1] != channel_id_text
    {
        return Err(DbError::InvalidData(
            "resource registration channel does not match its h tag".into(),
        ));
    }

    let connection = crate::observability::acquire_writer(
        pool,
        crate::observability::WriterOperation::EventWrite,
    )
    .await?;
    let mut tx = sqlx::Transaction::begin(connection, None).await?;

    // Registration and every Canvas write serialize on this exact coordinate.
    let lock_key = event_replacement_lock_key(
        community_id,
        KIND_CANVAS as i32,
        &[],
        Some(channel_id.as_bytes().as_slice()),
    );
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(lock_key)
        .execute(&mut *tx)
        .await?;

    let actor_pubkey_bytes = event.pubkey.to_bytes();
    let channel_actor_role: Option<String> = sqlx::query_scalar(
        "SELECT role::text FROM channel_members WHERE community_id = $1 AND channel_id = $2 AND pubkey = $3 AND removed_at IS NULL FOR UPDATE",
    )
    .bind(community_id.as_uuid())
    .bind(channel_id)
    .bind(actor_pubkey_bytes.as_slice())
    .fetch_optional(&mut *tx)
    .await?;
    let community_actor_role: Option<String> = sqlx::query_scalar(
        "SELECT role FROM relay_members WHERE community_id = $1 AND pubkey = $2 FOR UPDATE",
    )
    .bind(community_id.as_uuid())
    .bind(event.pubkey.to_hex())
    .fetch_optional(&mut *tx)
    .await?;
    let group_admin = matches!(channel_actor_role.as_deref(), Some("owner" | "admin"));
    let community_admin = matches!(community_actor_role.as_deref(), Some("owner" | "admin"));
    if !group_admin || !community_admin {
        return Err(DbError::AccessDenied(
            "context registration requires channel owner/admin and community owner/admin authority"
                .into(),
        ));
    }

    let row = sqlx::query(
        r#"
        SELECT channel_type::text AS channel_type,
               visibility::text AS visibility,
               archived_at,
               resource_type
        FROM channels
        WHERE community_id = $1 AND id = $2 AND deleted_at IS NULL
        FOR UPDATE
        "#,
    )
    .bind(community_id.as_uuid())
    .bind(channel_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(DbError::ChannelNotFound(channel_id))?;
    let channel_type: String = row.try_get("channel_type")?;
    let visibility: String = row.try_get("visibility")?;
    let archived_at: Option<DateTime<Utc>> = row.try_get("archived_at")?;
    let registered_type: Option<String> = row.try_get("resource_type")?;
    if channel_type != "stream" || visibility != "private" || archived_at.is_some() {
        return Err(DbError::InvalidData(
            "Business context must be an unarchived private stream channel".into(),
        ));
    }

    // The relay validated this head's document before calling us. Rechecking
    // the exact head here closes the race with an untyped Canvas write admitted
    // immediately before adoption.
    let current_canvas_head: Option<Vec<u8>> = sqlx::query_scalar(
        "SELECT id FROM events WHERE community_id = $1 AND kind = $2 AND channel_id = $3 AND deleted_at IS NULL ORDER BY created_at DESC, id ASC LIMIT 1",
    )
    .bind(community_id.as_uuid())
    .bind(KIND_CANVAS as i32)
    .bind(channel_id)
    .fetch_optional(&mut *tx)
    .await?;
    if current_canvas_head.as_deref() != expected_canvas_head {
        return Err(DbError::InvalidData(
            "Business context canvas changed while registration was being validated".into(),
        ));
    }
    if registered_type
        .as_deref()
        .is_some_and(|registered| registered != resource_type)
    {
        return Err(DbError::InvalidData(
            "channel is already registered as a different resource type".into(),
        ));
    }
    if registered_type.is_none() {
        if let Err(error) = sqlx::query(
            "UPDATE channels SET resource_type = $1, updated_at = NOW() WHERE community_id = $2 AND id = $3",
        )
        .bind(resource_type)
        .bind(community_id.as_uuid())
        .bind(channel_id)
        .execute(&mut *tx)
        .await
        {
            let is_context_conflict = matches!(
                &error,
                sqlx::Error::Database(database_error)
                    if database_error.code().as_deref() == Some("23505")
            );
            if is_context_conflict {
                return Err(DbError::InvalidData(
                    "a Business context is already registered for this community".into(),
                ));
            }
            return Err(error.into());
        }
    }

    let result =
        insert_event_with_thread_metadata_tx(&mut tx, community_id, event, Some(channel_id), None)
            .await?;
    if result.1 {
        crate::insert_mentions_in_transaction(&mut tx, community_id, event, Some(channel_id))
            .await?;
    }
    tx.commit().await?;
    Ok(result)
}

impl Db {
    /// Atomically register a typed channel resource and store its signed
    /// metadata event.
    #[datastore_span(
        name = "insert_channel_resource_registration_event",
        system = "postgresql"
    )]
    pub async fn insert_channel_resource_registration_event(
        &self,
        community_id: CommunityId,
        event: &nostr::Event,
        channel_id: Uuid,
        resource_type: &str,
        expected_canvas_head: Option<&[u8]>,
    ) -> Result<(StoredEvent, bool)> {
        insert_channel_resource_registration_event(
            &self.pool,
            community_id,
            event,
            channel_id,
            resource_type,
            expected_canvas_head,
        )
        .await
    }
}

#[cfg(test)]
mod postgres_tests {
    use super::*;
    use crate::store::event::{
        insert_channel_head_checked, insert_channel_head_checked_for_resource,
        ChannelHeadPrecondition, ChannelHeadWriteStatus,
    };
    use nostr::{EventBuilder, Keys, Kind, Tag, Timestamp};

    const BUSINESS_CONTEXT: &str = "aios.business-context:v1";

    async fn setup_pool() -> PgPool {
        PgPool::connect(&crate::test_support::database_url())
            .await
            .expect("connect to isolated test database")
    }

    async fn insert_channel(
        pool: &PgPool,
        keys: &Keys,
        visibility: &str,
        community_role: &str,
    ) -> (Uuid, Uuid) {
        let community_id = Uuid::new_v4();
        sqlx::query("INSERT INTO communities (id, host) VALUES ($1, $2)")
            .bind(community_id)
            .bind(format!(
                "channel-resource-{}.example",
                community_id.simple()
            ))
            .execute(pool)
            .await
            .expect("insert isolated community");

        let channel_id = Uuid::new_v4();
        let pubkey = keys.public_key().to_bytes().to_vec();
        sqlx::query(
            "INSERT INTO channels (id, community_id, name, channel_type, visibility, created_by) VALUES ($1, $2, $3, 'stream', $4::channel_visibility, $5)",
        )
        .bind(channel_id)
        .bind(community_id)
        .bind("business-context-test")
        .bind(visibility)
        .bind(&pubkey)
        .execute(pool)
        .await
        .expect("insert test channel");
        sqlx::query(
            "INSERT INTO channel_members (community_id, channel_id, pubkey, role) VALUES ($1, $2, $3, 'owner')",
        )
        .bind(community_id)
        .bind(channel_id)
        .bind(pubkey)
        .execute(pool)
        .await
        .expect("insert test group owner");
        sqlx::query("INSERT INTO relay_members (community_id, pubkey, role) VALUES ($1, $2, $3)")
            .bind(community_id)
            .bind(keys.public_key().to_hex())
            .bind(community_role)
            .execute(pool)
            .await
            .expect("insert community role");
        (community_id, channel_id)
    }

    fn registration_event(keys: &Keys, channel_id: Uuid, created_at: u64) -> Event {
        let channel = channel_id.to_string();
        EventBuilder::new(Kind::Custom(KIND_NIP29_EDIT_METADATA as u16), "")
            .tags([
                Tag::parse(["h", &channel]).expect("channel tag"),
                Tag::parse(["resource", BUSINESS_CONTEXT]).expect("resource tag"),
            ])
            .custom_created_at(Timestamp::from(created_at))
            .sign_with_keys(keys)
            .expect("sign registration event")
    }

    fn canvas_event(
        keys: &Keys,
        channel_id: Uuid,
        content: &str,
        expected_revision: Option<&str>,
        created_at: u64,
    ) -> Event {
        let channel = channel_id.to_string();
        let mut tags = vec![Tag::parse(["h", &channel]).expect("channel tag")];
        if let Some(revision) = expected_revision {
            tags.push(Tag::parse(["expected-revision", revision]).expect("revision tag"));
        }
        EventBuilder::new(Kind::Custom(KIND_CANVAS as u16), content)
            .tags(tags)
            .custom_created_at(Timestamp::from(created_at))
            .sign_with_keys(keys)
            .expect("sign canvas event")
    }

    #[tokio::test]
    #[ignore = "requires isolated Postgres"]
    async fn registration_is_idempotent_unique_and_keeps_typed_canvas_fenced() {
        let pool = setup_pool().await;
        let keys = Keys::generate();
        let (community, channel) = insert_channel(&pool, &keys, "private", "owner").await;
        let registration = registration_event(&keys, channel, Timestamp::now().as_secs());

        let (_, inserted) = insert_channel_resource_registration_event(
            &pool,
            CommunityId::from_uuid(community),
            &registration,
            channel,
            BUSINESS_CONTEXT,
            None,
        )
        .await
        .expect("register context");
        assert!(inserted);
        let (_, inserted_again) = insert_channel_resource_registration_event(
            &pool,
            CommunityId::from_uuid(community),
            &registration,
            channel,
            BUSINESS_CONTEXT,
            None,
        )
        .await
        .expect("idempotent registration replay");
        assert!(!inserted_again);

        sqlx::query(
            "UPDATE relay_members SET role = 'member', updated_at = NOW() WHERE community_id = $1 AND pubkey = $2",
        )
        .bind(community)
        .bind(keys.public_key().to_hex())
        .execute(&pool)
        .await
        .expect("demote community owner");
        let denied_replay = insert_channel_resource_registration_event(
            &pool,
            CommunityId::from_uuid(community),
            &registration,
            channel,
            BUSINESS_CONTEXT,
            None,
        )
        .await
        .expect_err("same-group replay still requires community authority");
        assert!(matches!(denied_replay, DbError::AccessDenied(_)));
        sqlx::query(
            "UPDATE relay_members SET role = 'owner', updated_at = NOW() WHERE community_id = $1 AND pubkey = $2",
        )
        .bind(community)
        .bind(keys.public_key().to_hex())
        .execute(&pool)
        .await
        .expect("restore community owner");

        let second = Uuid::new_v4();
        let created_by = keys.public_key().to_bytes().to_vec();
        sqlx::query(
            "INSERT INTO channels (id, community_id, name, channel_type, visibility, created_by) VALUES ($1, $2, 'second-context', 'stream', 'private', $3)",
        )
        .bind(second)
        .bind(community)
        .bind(&created_by)
        .execute(&pool)
        .await
        .expect("insert second private group");
        sqlx::query(
            "INSERT INTO channel_members (community_id, channel_id, pubkey, role) VALUES ($1, $2, $3, 'owner')",
        )
        .bind(community)
        .bind(second)
        .bind(&created_by)
        .execute(&pool)
        .await
        .expect("insert second group owner");
        let competing = registration_event(&keys, second, Timestamp::now().as_secs() + 1);
        let conflict = insert_channel_resource_registration_event(
            &pool,
            CommunityId::from_uuid(community),
            &competing,
            second,
            BUSINESS_CONTEXT,
            None,
        )
        .await
        .expect_err("only one context may be canonical");
        assert!(conflict.to_string().contains("already registered"));

        let generic = canvas_event(
            &keys,
            channel,
            "{}",
            Some("none"),
            Timestamp::now().as_secs() + 2,
        );
        assert!(insert_channel_head_checked(
            &pool,
            CommunityId::from_uuid(community),
            &generic,
            channel,
            ChannelHeadPrecondition::ExpectNoHead,
        )
        .await
        .is_err());

        let typed = canvas_event(
            &keys,
            channel,
            r#"{"schemaVersion":1,"kind":"aios.business-workspace","company":{"name":"","website":"","summary":"","audience":"","offers":"","goals":""},"sources":[],"connections":[]}"#,
            Some("none"),
            Timestamp::now().as_secs() + 3,
        );
        let (_, status) = insert_channel_head_checked_for_resource(
            &pool,
            CommunityId::from_uuid(community),
            &typed,
            channel,
            ChannelHeadPrecondition::ExpectNoHead,
            BUSINESS_CONTEXT,
        )
        .await
        .expect("typed CAS write");
        assert_eq!(status, ChannelHeadWriteStatus::Inserted);

        assert!(sqlx::query(
            "UPDATE channels SET visibility = 'open' WHERE community_id = $1 AND id = $2"
        )
        .bind(community)
        .bind(channel)
        .execute(&pool)
        .await
        .is_err());
        assert!(sqlx::query(
            "UPDATE channels SET resource_type = NULL WHERE community_id = $1 AND id = $2",
        )
        .bind(community)
        .bind(channel)
        .execute(&pool)
        .await
        .is_err());

        sqlx::query("UPDATE channels SET deleted_at = NOW() WHERE community_id = $1 AND id = $2")
            .bind(community)
            .bind(channel)
            .execute(&pool)
            .await
            .expect("soft-delete typed group without releasing canonical slot");
        let conflict_after_delete = insert_channel_resource_registration_event(
            &pool,
            CommunityId::from_uuid(community),
            &competing,
            second,
            BUSINESS_CONTEXT,
            None,
        )
        .await
        .expect_err("soft deletion does not unregister the canonical context");
        assert!(conflict_after_delete
            .to_string()
            .contains("already registered"));
    }

    #[tokio::test]
    #[ignore = "requires isolated Postgres"]
    async fn registration_rolls_back_when_mention_indexing_fails() {
        let pool = setup_pool().await;
        let keys = Keys::generate();
        let (community, channel) = insert_channel(&pool, &keys, "private", "owner").await;
        let channel_text = channel.to_string();
        let mentioned_pubkey = Keys::generate().public_key().to_hex();
        let registration = EventBuilder::new(Kind::Custom(KIND_NIP29_EDIT_METADATA as u16), "")
            .tags([
                Tag::parse(["h", &channel_text]).expect("channel tag"),
                Tag::parse(["resource", BUSINESS_CONTEXT]).expect("resource tag"),
                Tag::parse(["p", &mentioned_pubkey]).expect("mention tag"),
            ])
            .custom_created_at(Timestamp::now())
            .sign_with_keys(&keys)
            .expect("sign registration event");

        sqlx::query(
            "CREATE FUNCTION reject_context_mention() RETURNS TRIGGER AS $$ \
             BEGIN RAISE EXCEPTION 'injected context mention failure'; END; \
             $$ LANGUAGE plpgsql",
        )
        .execute(&pool)
        .await
        .expect("create failure function");
        sqlx::query(
            "CREATE TRIGGER reject_context_mention BEFORE INSERT ON event_mentions \
             FOR EACH ROW EXECUTE FUNCTION reject_context_mention()",
        )
        .execute(&pool)
        .await
        .expect("install failure injection");

        let error = insert_channel_resource_registration_event(
            &pool,
            CommunityId::from_uuid(community),
            &registration,
            channel,
            BUSINESS_CONTEXT,
            None,
        )
        .await
        .expect_err("mention failure must fail resource registration");
        assert!(error
            .to_string()
            .contains("injected context mention failure"));

        let resource_type: Option<String> = sqlx::query_scalar(
            "SELECT resource_type FROM channels WHERE community_id = $1 AND id = $2",
        )
        .bind(community)
        .bind(channel)
        .fetch_one(&pool)
        .await
        .expect("read rolled-back resource type");
        assert_eq!(resource_type, None);
        let event_count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM events WHERE community_id = $1 AND id = $2")
                .bind(community)
                .bind(registration.id.as_bytes().as_slice())
                .fetch_one(&pool)
                .await
                .expect("count rolled-back registration event");
        assert_eq!(event_count, 0);
    }

    #[tokio::test]
    #[ignore = "requires isolated Postgres"]
    async fn untyped_canvas_write_racing_adoption_cannot_commit_after_registration() {
        let pool = setup_pool().await;
        let keys = Keys::generate();
        let (community, channel) = insert_channel(&pool, &keys, "private", "owner").await;
        let community_id = CommunityId::from_uuid(community);
        let registration = registration_event(&keys, channel, Timestamp::now().as_secs());
        let malformed_legacy_canvas = canvas_event(
            &keys,
            channel,
            "not a Business document",
            None,
            Timestamp::now().as_secs() + 1,
        );

        let (registration_result, canvas_result) = tokio::join!(
            insert_channel_resource_registration_event(
                &pool,
                community_id,
                &registration,
                channel,
                BUSINESS_CONTEXT,
                None,
            ),
            crate::store::event::insert_event_with_thread_metadata(
                &pool,
                community_id,
                &malformed_legacy_canvas,
                Some(channel),
                None,
            ),
        );

        let resource_type: Option<String> = sqlx::query_scalar(
            "SELECT resource_type FROM channels WHERE community_id = $1 AND id = $2",
        )
        .bind(community)
        .bind(channel)
        .fetch_one(&pool)
        .await
        .expect("read resource type");
        let canvas_count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM events WHERE community_id = $1 AND channel_id = $2 AND kind = $3 AND deleted_at IS NULL",
        )
        .bind(community)
        .bind(channel)
        .bind(KIND_CANVAS as i32)
        .fetch_one(&pool)
        .await
        .expect("count Canvas events");

        match resource_type.as_deref() {
            Some(BUSINESS_CONTEXT) => {
                assert!(registration_result.is_ok());
                assert!(canvas_result.is_err());
                assert_eq!(canvas_count, 0);
            }
            None => {
                assert!(registration_result.is_err());
                assert!(canvas_result.is_ok());
                assert_eq!(canvas_count, 1);
            }
            other => panic!("unexpected resource type after race: {other:?}"),
        }
    }

    #[tokio::test]
    #[ignore = "requires isolated Postgres"]
    async fn community_member_who_owns_private_group_cannot_claim_canonical_context() {
        let pool = setup_pool().await;
        let keys = Keys::generate();
        let (community, channel) = insert_channel(&pool, &keys, "private", "member").await;
        let registration = registration_event(&keys, channel, Timestamp::now().as_secs());

        let error = insert_channel_resource_registration_event(
            &pool,
            CommunityId::from_uuid(community),
            &registration,
            channel,
            BUSINESS_CONTEXT,
            None,
        )
        .await
        .expect_err("ordinary community member cannot claim the canonical slot");
        assert!(matches!(error, DbError::AccessDenied(_)));

        let resource_type: Option<String> = sqlx::query_scalar(
            "SELECT resource_type FROM channels WHERE community_id = $1 AND id = $2",
        )
        .bind(community)
        .bind(channel)
        .fetch_one(&pool)
        .await
        .expect("read unchanged channel");
        assert_eq!(resource_type, None);
    }
}
