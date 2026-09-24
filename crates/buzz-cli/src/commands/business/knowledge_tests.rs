use super::*;

const CONTEXT: &str = "123e4567-e89b-12d3-a456-426614174000";

#[tokio::test]
async fn selective_reads_omit_bodies_until_requested_and_recheck_membership() {
    let (client, relay, pubkey, task) = start_test_relay().await;
    let mut document = sample_document();
    document.sources.push(BusinessSource {
        id: "brand".into(),
        title: "Brand guide".into(),
        kind: SourceKind::Note,
        content: "PRIVATE_BODY_SENTINEL: Skriv på dansk".into(),
        url: None,
        created_at: "2026-09-24T10:00:00Z".into(),
    });
    add_managed_workspace(&relay, CONTEXT, &pubkey, Some(&document.to_json().unwrap()));
    let index = knowledge::index(&client, CONTEXT, 0, 20, None)
        .await
        .unwrap();
    assert_eq!(index["context_id"], CONTEXT);
    assert_eq!(index["revision"], "a".repeat(64));
    assert_eq!(index["result"]["total"], 7);
    assert!(!index.to_string().contains("PRIVATE_BODY_SENTINEL"));
    let result = knowledge::read(&client, CONTEXT, "source:brand", 0, 4000, None)
        .await
        .unwrap();
    assert_eq!(result["result"]["text"], document.sources[0].content);
    let search = knowledge::search(&client, CONTEXT, "DANSK", 1)
        .await
        .unwrap();
    assert_eq!(search["result"]["hits"][0]["entry"]["id"], "source:brand");
    relay.data.lock().unwrap().memberships.clear();
    assert!(matches!(
        knowledge::read(&client, CONTEXT, "source:brand", 0, 4000, None).await,
        Err(CliError::Auth(_))
    ));
    assert!(relay.data.lock().unwrap().writes.is_empty());
    task.abort();
}

#[tokio::test]
async fn pagination_requires_and_checks_the_document_revision() {
    let (client, relay, pubkey, task) = start_test_relay().await;
    add_managed_workspace(
        &relay,
        CONTEXT,
        &pubkey,
        Some(&sample_document().to_json().unwrap()),
    );
    assert!(matches!(
        knowledge::index(&client, CONTEXT, 1, 1, None).await,
        Err(CliError::Usage(_))
    ));
    assert!(matches!(
        knowledge::read(&client, CONTEXT, "company:summary", 1, 10, None).await,
        Err(CliError::Usage(_))
    ));
    let revision = "a".repeat(64);
    assert!(knowledge::index(&client, CONTEXT, 1, 2, Some(&revision))
        .await
        .is_ok());
    relay.data.lock().unwrap().canvases[0]["id"] = json!("d".repeat(64));
    assert!(matches!(
        knowledge::read(&client, CONTEXT, "company:summary", 1, 10, Some(&revision)).await,
        Err(CliError::Conflict(_))
    ));
    task.abort();
}

#[tokio::test]
async fn adoption_is_explicit_idempotent_and_preserves_document_and_acl() {
    let (client, relay, pubkey, task) = start_test_relay().await;
    add_managed_workspace(
        &relay,
        CONTEXT,
        &pubkey,
        Some(&sample_document().to_json().unwrap()),
    );
    let original = {
        let data = relay.data.lock().unwrap();
        (data.canvases.clone(), data.memberships.clone())
    };
    assert!(registration::discover(&client).await.unwrap()["canonical_context_id"].is_null());
    let first = registration::adopt(&client, CONTEXT).await.unwrap();
    assert_eq!(first["registered"], true);
    assert_eq!(first["already_registered"], false);
    let retry = registration::adopt(&client, CONTEXT).await.unwrap();
    assert_eq!(retry["already_registered"], true);
    let found = registration::discover(&client).await.unwrap();
    assert_eq!(found["canonical_context_id"], CONTEXT);
    {
        let data = relay.data.lock().unwrap();
        assert_eq!(data.writes.len(), 1);
        assert_eq!(data.writes[0]["kind"], 9002);
        assert_eq!(data.canvases, original.0);
        assert_eq!(data.memberships, original.1);
    }
    // The typed reference stays authoritative if the human-facing description changes.
    relay.data.lock().unwrap().metadata[0]["tags"]
        .as_array_mut()
        .unwrap()
        .retain(|tag| tag[0] != "about");
    assert!(knowledge::index(&client, CONTEXT, 0, 20, None)
        .await
        .is_ok());
    task.abort();
}

#[tokio::test]
async fn denied_or_unverified_registration_does_not_claim_success() {
    let (client, relay, pubkey, task) = start_test_relay().await;
    add_managed_workspace(
        &relay,
        CONTEXT,
        &pubkey,
        Some(&sample_document().to_json().unwrap()),
    );
    relay.data.lock().unwrap().deny_registration = true;
    assert!(matches!(
        registration::adopt(&client, CONTEXT).await,
        Err(CliError::Relay { status: 403, .. })
    ));
    {
        let mut data = relay.data.lock().unwrap();
        data.deny_registration = false;
        data.skip_registration_metadata = true;
    }
    assert!(matches!(
        registration::adopt(&client, CONTEXT).await,
        Err(CliError::DeliveryUnknown(_))
    ));
    relay.data.lock().unwrap().skip_registration_metadata = false;
    assert_eq!(
        registration::adopt(&client, CONTEXT).await.unwrap()["registered"],
        true
    );
    task.abort();
}

#[tokio::test]
async fn a_future_resource_cannot_use_the_legacy_marker_to_become_business_context() {
    let (client, relay, pubkey, task) = start_test_relay().await;
    add_managed_workspace(
        &relay,
        CONTEXT,
        &pubkey,
        Some(&sample_document().to_json().unwrap()),
    );
    relay.data.lock().unwrap().metadata[0]["tags"]
        .as_array_mut()
        .unwrap()
        .push(json!(["resource", "future:v2"]));
    assert!(registration::discover(&client).await.unwrap()["contexts"]
        .as_array()
        .unwrap()
        .is_empty());
    assert!(matches!(
        knowledge::index(&client, CONTEXT, 0, 20, None).await,
        Err(CliError::Usage(_))
    ));
    assert!(relay.data.lock().unwrap().writes.is_empty());
    task.abort();
}

#[tokio::test]
async fn private_forum_or_ambiguous_type_cannot_become_company_knowledge() {
    let (client, relay, pubkey, task) = start_test_relay().await;
    add_managed_workspace(
        &relay,
        CONTEXT,
        &pubkey,
        Some(&sample_document().to_json().unwrap()),
    );
    relay.data.lock().unwrap().metadata[0]["tags"]
        .as_array_mut()
        .unwrap()
        .push(json!(["t", "forum"]));
    assert!(matches!(
        knowledge::index(&client, CONTEXT, 0, 10, None).await,
        Err(CliError::Usage(_))
    ));
    assert!(matches!(
        registration::adopt(&client, CONTEXT).await,
        Err(CliError::Usage(_))
    ));
    relay.data.lock().unwrap().metadata[0]["tags"]
        .as_array_mut()
        .unwrap()
        .push(json!(["t", "stream"]));
    assert!(matches!(
        registration::adopt(&client, CONTEXT).await,
        Err(CliError::Other(_))
    ));
    assert!(relay.data.lock().unwrap().writes.is_empty());
    task.abort();
}
