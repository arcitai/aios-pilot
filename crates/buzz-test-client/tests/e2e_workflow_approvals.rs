//! Relay-backed approval lifecycle coverage.
//!
//! Run this against a disposable local relay and database:
//!
//! ```text
//! RELAY_URL=ws://localhost:3030 DATABASE_URL=postgres://… cargo test \
//!   -p buzz-test-client --test e2e_workflow_approvals -- --ignored
//! ```

use std::time::{Duration, Instant};

use buzz_test_client::BuzzTestClient;
use nostr::{Event, EventBuilder, Keys, Kind, Tag};
use sqlx::PgPool;
use uuid::Uuid;

const KIND_WORKFLOW_DEFINITION: u16 = 30_620;
const KIND_WORKFLOW_TRIGGER: u16 = 46_020;
const KIND_APPROVAL_GRANT: u16 = 46_030;
const KIND_APPROVAL_DENY: u16 = 46_031;

fn relay_url() -> String {
    std::env::var("RELAY_URL").unwrap_or_else(|_| "ws://localhost:3000".to_string())
}

async fn database() -> PgPool {
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL is required");
    PgPool::connect(&url).await.expect("connect test database")
}

async fn create_channel(client: &mut BuzzTestClient, keys: &Keys, channel_id: &str) {
    let event = EventBuilder::new(Kind::Custom(9007), "")
        .tags([
            Tag::parse(["h", channel_id]).expect("channel id tag"),
            Tag::parse(["name", "workflow-approval-e2e"]).expect("channel name tag"),
            Tag::parse(["channel_type", "stream"]).expect("channel type tag"),
            Tag::parse(["visibility", "open"]).expect("channel visibility tag"),
        ])
        .sign_with_keys(keys)
        .expect("sign channel creation");
    let result = client.send_event(event).await.expect("create channel");
    assert!(
        result.accepted,
        "channel creation rejected: {}",
        result.message
    );
}

async fn add_member(client: &mut BuzzTestClient, owner: &Keys, channel_id: &str, member: &Keys) {
    let member_hex = member.public_key().to_hex();
    let event = EventBuilder::new(Kind::Custom(9000), "")
        .tags([
            Tag::parse(["h", channel_id]).expect("channel id tag"),
            Tag::parse(["p", member_hex.as_str()]).expect("member pubkey tag"),
            Tag::parse(["role", "member"]).expect("member role tag"),
        ])
        .sign_with_keys(owner)
        .expect("sign channel member addition");
    let result = client.send_event(event).await.expect("add approver member");
    assert!(
        result.accepted,
        "member addition rejected: {}",
        result.message
    );
}

async fn create_workflow(
    client: &mut BuzzTestClient,
    owner: &Keys,
    channel_id: &str,
    workflow_id: &str,
    approver_hex: &str,
    after_text: &str,
    timeout: &str,
) {
    let definition = format!(
        "name: approval-e2e\ntrigger:\n  on: message_posted\nsteps:\n  - id: review\n    action: request_approval\n    from: {approver_hex}\n    message: Review this local test run\n    timeout: {timeout}\n  - id: after_review\n    action: send_message\n    text: '{after_text}'\n"
    );
    let event = EventBuilder::new(Kind::Custom(KIND_WORKFLOW_DEFINITION), definition)
        .tags([
            Tag::parse(["d", workflow_id]).expect("workflow id tag"),
            Tag::parse(["h", channel_id]).expect("workflow channel tag"),
        ])
        .sign_with_keys(owner)
        .expect("sign workflow definition");
    let result = client.send_event(event).await.expect("create workflow");
    assert!(result.accepted, "workflow rejected: {}", result.message);
}

async fn trigger(client: &mut BuzzTestClient, owner: &Keys, workflow_id: &str) -> Uuid {
    let event = EventBuilder::new(Kind::Custom(KIND_WORKFLOW_TRIGGER), "")
        .tags([Tag::parse(["d", workflow_id]).expect("workflow id tag")])
        .sign_with_keys(owner)
        .expect("sign workflow trigger");
    let result = client.send_event(event).await.expect("trigger workflow");
    assert!(result.accepted, "trigger rejected: {}", result.message);
    let response = result
        .message
        .strip_prefix("response:")
        .expect("trigger response prefix");
    let response: serde_json::Value =
        serde_json::from_str(response).expect("trigger response JSON");
    Uuid::parse_str(response["run_id"].as_str().expect("run id string")).expect("valid run id")
}

async fn community_for_workflow(pool: &PgPool, workflow_id: Uuid) -> Uuid {
    sqlx::query_scalar("SELECT community_id FROM workflows WHERE id = $1")
        .bind(workflow_id)
        .fetch_one(pool)
        .await
        .expect("workflow community")
}

async fn wait_for_approval(pool: &PgPool, community_id: Uuid, run_id: Uuid) -> Vec<u8> {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if let Some(token) = sqlx::query_scalar::<_, Vec<u8>>(
            "SELECT token FROM workflow_approvals WHERE community_id = $1 AND run_id = $2",
        )
        .bind(community_id)
        .bind(run_id)
        .fetch_optional(pool)
        .await
        .expect("approval lookup")
        {
            return token;
        }
        assert!(
            Instant::now() < deadline,
            "workflow did not create an approval"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn wait_for_run_status(
    pool: &PgPool,
    community_id: Uuid,
    run_id: Uuid,
    expected: &str,
    timeout: Duration,
) -> (String, Option<String>) {
    let deadline = Instant::now() + timeout;
    loop {
        let run = sqlx::query_as::<_, (String, Option<String>)>(
            "SELECT status::text, error_code FROM workflow_runs WHERE community_id = $1 AND id = $2",
        )
        .bind(community_id)
        .bind(run_id)
        .fetch_one(pool)
        .await
        .expect("workflow run lookup");
        if run.0 == expected || matches!(run.0.as_str(), "failed" | "completed" | "cancelled") {
            return run;
        }
        assert!(
            Instant::now() < deadline,
            "workflow run stayed in status {}",
            run.0
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

fn approval_action(keys: &Keys, kind: u16, token_hash: &[u8]) -> Event {
    let reference = hex::encode(token_hash);
    EventBuilder::new(Kind::Custom(kind), "e2e approval decision")
        .tags([Tag::parse(["d", reference.as_str()]).expect("approval reference tag")])
        .sign_with_keys(keys)
        .expect("sign approval decision")
}

async fn emitted_count(pool: &PgPool, community_id: Uuid, text: &str) -> i64 {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM events WHERE community_id = $1 AND content = $2 AND deleted_at IS NULL",
    )
    .bind(community_id)
    .bind(text)
    .fetch_one(pool)
    .await
    .expect("count workflow output")
}

#[tokio::test]
#[ignore = "requires a disposable local relay and Postgres database"]
async fn approval_grant_deny_expiry_and_restart_recovery_are_durable() {
    let pool = database().await;
    let workflow_db = buzz_db::Db::new(&buzz_db::DbConfig {
        database_url: std::env::var("DATABASE_URL").expect("DATABASE_URL is required"),
        ..Default::default()
    })
    .await
    .expect("connect workflow store");
    let owner = Keys::generate();
    let approver = Keys::generate();
    let outsider = Keys::generate();
    let channel_id = Uuid::new_v4().to_string();
    let workflow_id = Uuid::new_v4();
    let workflow_id_text = workflow_id.to_string();
    let denied_workflow_id = Uuid::new_v4();
    let denied_workflow_id_text = denied_workflow_id.to_string();
    let recovery_workflow_id = Uuid::new_v4();
    let recovery_workflow_id_text = recovery_workflow_id.to_string();
    let expired_workflow_id = Uuid::new_v4();
    let expired_workflow_id_text = expired_workflow_id.to_string();
    let interrupted_workflow_id = Uuid::new_v4();
    let interrupted_workflow_id_text = interrupted_workflow_id.to_string();
    let approved_text = format!("approval-e2e-approved-{workflow_id}");
    let denied_text = format!("approval-e2e-denied-{workflow_id}");
    let recovery_text = format!("approval-e2e-recovered-{workflow_id}");
    let expired_text = format!("approval-e2e-expired-{workflow_id}");
    let interrupted_text = format!("approval-e2e-interrupted-{workflow_id}");
    let approver_hex = approver.public_key().to_hex();

    let mut owner_client = BuzzTestClient::connect(&relay_url(), &owner)
        .await
        .expect("connect workflow owner");
    let mut approver_client = BuzzTestClient::connect(&relay_url(), &approver)
        .await
        .expect("connect approver");
    let mut outsider_client = BuzzTestClient::connect(&relay_url(), &outsider)
        .await
        .expect("connect outsider");

    create_channel(&mut owner_client, &owner, &channel_id).await;
    add_member(&mut owner_client, &owner, &channel_id, &approver).await;
    create_workflow(
        &mut owner_client,
        &owner,
        &channel_id,
        &workflow_id_text,
        &approver_hex,
        &approved_text,
        "10m",
    )
    .await;
    let community_id = community_for_workflow(&pool, workflow_id).await;

    // An outsider cannot act on a valid community-local approval reference.
    let approved_run = trigger(&mut owner_client, &owner, &workflow_id_text).await;
    let approved_hash = wait_for_approval(&pool, community_id, approved_run).await;
    let rejected = outsider_client
        .send_event(approval_action(
            &outsider,
            KIND_APPROVAL_GRANT,
            &approved_hash,
        ))
        .await
        .expect("submit unauthorized approval");
    assert!(!rejected.accepted, "non-member was allowed to approve");

    let grant = approval_action(&approver, KIND_APPROVAL_GRANT, &approved_hash);
    let granted = approver_client
        .send_event(grant.clone())
        .await
        .expect("grant approval");
    assert!(granted.accepted, "grant rejected: {}", granted.message);
    let completed = wait_for_run_status(
        &pool,
        community_id,
        approved_run,
        "completed",
        Duration::from_secs(15),
    )
    .await;
    assert_eq!(completed.0, "completed");
    assert_eq!(emitted_count(&pool, community_id, &approved_text).await, 1);

    // The same signed command is idempotent; a different second decision loses.
    let duplicate = approver_client
        .send_event(grant)
        .await
        .expect("replay identical grant");
    assert!(
        duplicate.accepted,
        "identical command was not idempotent: {}",
        duplicate.message
    );
    let second_decision = approver_client
        .send_event(approval_action(
            &approver,
            KIND_APPROVAL_DENY,
            &approved_hash,
        ))
        .await
        .expect("submit conflicting denial");
    assert!(
        !second_decision.accepted,
        "second decision changed a granted approval"
    );
    assert_eq!(emitted_count(&pool, community_id, &approved_text).await, 1);

    // Denial synchronously fails the run and never executes the later message step.
    create_workflow(
        &mut owner_client,
        &owner,
        &channel_id,
        &denied_workflow_id_text,
        &approver_hex,
        &denied_text,
        "10m",
    )
    .await;
    let denied_run = trigger(&mut owner_client, &owner, &denied_workflow_id_text).await;
    let denied_hash = wait_for_approval(&pool, community_id, denied_run).await;
    let denied = approver_client
        .send_event(approval_action(&approver, KIND_APPROVAL_DENY, &denied_hash))
        .await
        .expect("deny approval");
    assert!(denied.accepted, "denial rejected: {}", denied.message);
    let failed = wait_for_run_status(
        &pool,
        community_id,
        denied_run,
        "failed",
        Duration::from_secs(10),
    )
    .await;
    assert_eq!(failed.0, "failed");
    assert_eq!(failed.1.as_deref(), Some("approval_denied"));
    assert_eq!(emitted_count(&pool, community_id, &denied_text).await, 0);
    let stale_completion = workflow_db
        .update_workflow_run(
            buzz_core::CommunityId::from_uuid(community_id),
            denied_run,
            buzz_db::workflow::RunStatus::Completed,
            2,
            &serde_json::json!([]),
            None,
        )
        .await;
    assert!(
        matches!(stale_completion, Err(buzz_db::DbError::InvalidData(_))),
        "a stale worker must not replace a terminal denial"
    );
    assert_eq!(
        wait_for_run_status(
            &pool,
            community_id,
            denied_run,
            "failed",
            Duration::from_secs(1),
        )
        .await
        .1
        .as_deref(),
        Some("approval_denied")
    );

    // Prepare a persisted grant that never got its post-commit worker, an
    // overdue gate, and a stale one-shot claim. The relay's durable sweeper
    // handles all three on its next approval-maintenance tick.
    create_workflow(
        &mut owner_client,
        &owner,
        &channel_id,
        &recovery_workflow_id_text,
        &approver_hex,
        &recovery_text,
        "10m",
    )
    .await;
    let recovery_run = trigger(&mut owner_client, &owner, &recovery_workflow_id_text).await;
    let recovery_hash = wait_for_approval(&pool, community_id, recovery_run).await;
    sqlx::query(
        "UPDATE workflow_approvals SET status = 'granted', approver_pubkey = $1 WHERE community_id = $2 AND token = $3",
    )
    .bind(approver.public_key().to_bytes().to_vec())
    .bind(community_id)
    .bind(&recovery_hash)
    .execute(&pool)
    .await
    .expect("simulate grant committed before worker dispatch");

    create_workflow(
        &mut owner_client,
        &owner,
        &channel_id,
        &expired_workflow_id_text,
        &approver_hex,
        &expired_text,
        "10m",
    )
    .await;
    let expired_run = trigger(&mut owner_client, &owner, &expired_workflow_id_text).await;
    let expired_hash = wait_for_approval(&pool, community_id, expired_run).await;
    sqlx::query(
        "UPDATE workflow_approvals SET expires_at = NOW() - INTERVAL '1 second' WHERE community_id = $1 AND token = $2",
    )
    .bind(community_id)
    .bind(&expired_hash)
    .execute(&pool)
    .await
    .expect("expire pending approval");

    create_workflow(
        &mut owner_client,
        &owner,
        &channel_id,
        &interrupted_workflow_id_text,
        &approver_hex,
        &interrupted_text,
        "10m",
    )
    .await;
    let interrupted_run = trigger(&mut owner_client, &owner, &interrupted_workflow_id_text).await;
    let interrupted_hash = wait_for_approval(&pool, community_id, interrupted_run).await;
    sqlx::query(
        "UPDATE workflow_approvals SET status = 'granted', approver_pubkey = $1, resume_claimed_at = NOW() - INTERVAL '5 minutes', resume_lease_until = NOW() - INTERVAL '1 minute' WHERE community_id = $2 AND token = $3",
    )
    .bind(approver.public_key().to_bytes().to_vec())
    .bind(community_id)
    .bind(&interrupted_hash)
    .execute(&pool)
    .await
    .expect("simulate interrupted resume claim");
    sqlx::query(
        "UPDATE workflow_runs SET status = 'running', current_step = 1 WHERE community_id = $1 AND id = $2",
    )
    .bind(community_id)
    .bind(interrupted_run)
    .execute(&pool)
    .await
    .expect("put interrupted run at its claimed resume boundary");

    let recovered = wait_for_run_status(
        &pool,
        community_id,
        recovery_run,
        "completed",
        Duration::from_secs(80),
    )
    .await;
    assert_eq!(recovered.0, "completed");
    let expired = wait_for_run_status(
        &pool,
        community_id,
        expired_run,
        "failed",
        Duration::from_secs(10),
    )
    .await;
    assert_eq!(expired.0, "failed");
    assert_eq!(expired.1.as_deref(), Some("approval_expired"));
    let interrupted = wait_for_run_status(
        &pool,
        community_id,
        interrupted_run,
        "failed",
        Duration::from_secs(10),
    )
    .await;
    assert_eq!(interrupted.0, "failed");
    assert_eq!(
        interrupted.1.as_deref(),
        Some("approval_resume_interrupted")
    );
    assert_eq!(emitted_count(&pool, community_id, &recovery_text).await, 1);
    assert_eq!(emitted_count(&pool, community_id, &expired_text).await, 0);
    assert_eq!(
        emitted_count(&pool, community_id, &interrupted_text).await,
        0
    );

    owner_client.disconnect().await.expect("disconnect owner");
    approver_client
        .disconnect()
        .await
        .expect("disconnect approver");
    outsider_client
        .disconnect()
        .await
        .expect("disconnect outsider");
}
