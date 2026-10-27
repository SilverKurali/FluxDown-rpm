//! 快传（`agent.share.*`）的 wire 契约：方法名、事件、DTO 往返、错误 reason 字面量、版本。

use std::collections::HashSet;

use fluxdown_protocol::method::{
    AGENT_CAPABILITIES, AGENT_SHARE_CONFIG, AGENT_SHARE_CONVERT_TO_CLOUD, AGENT_SHARE_CREATE,
    AGENT_SHARE_DELETE_CLOUD_COPY, AGENT_SHARE_DIAGNOSTICS, AGENT_SHARE_DISMISS_PENDING,
    AGENT_SHARE_LIST, AGENT_SHARE_LOGS, AGENT_SHARE_RECEIVE, AGENT_SHARE_RECEIVE_RECORDS,
    AGENT_SHARE_RESOLVE, AGENT_SHARE_SESSION_KILL, AGENT_SHARE_SET_LOCAL_CONFIG, AGENT_SHARE_STOP,
    AGENT_SHARE_SWITCH_TO_BRIDGE, AGENT_SHARE_UPDATE, ALL_METHODS, CAPABILITY_AGENT_SHARE,
};
use fluxdown_protocol::{
    AgentEvent, AgentSnapshot, ErrorReason, MIN_PROTOCOL_VERSION, PROTOCOL_VERSION, ServiceEvent,
    ShareCloudState, ShareConfigDto, ShareConnectionMode, ShareConvertToCloudParams,
    ShareCreateParams, ShareDiagnosticsDto, ShareDismissPendingParams, ShareDto, ShareExitBehavior,
    ShareHashingDto, ShareLocalConfigDto, ShareLogLevel, ShareLogsParams, ShareMode, ShareNatType,
    ShareNetSnapshotDto, SharePathKind, SharePolicySummaryDto, ShareProgressDto,
    ShareReceiveParams, ShareReceiveRecordsPage, ShareReceiverDto, ShareResolveDto,
    ShareSessionBytesDto, ShareStateDto, ShareStatus, ShareTaskFactsDto, ShareUploadDto,
    ShareUploadStatus, apply_agent_event,
};
use serde_json::{Value, json};

#[test]
fn every_share_method_is_canonical_unique_and_literal() {
    let expected = [
        (AGENT_SHARE_CONFIG, "agent.share.config"),
        (AGENT_SHARE_SET_LOCAL_CONFIG, "agent.share.setLocalConfig"),
        (AGENT_SHARE_CREATE, "agent.share.create"),
        (AGENT_SHARE_LIST, "agent.share.list"),
        (AGENT_SHARE_UPDATE, "agent.share.update"),
        (AGENT_SHARE_STOP, "agent.share.stop"),
        (AGENT_SHARE_RESOLVE, "agent.share.resolve"),
        (AGENT_SHARE_RECEIVE, "agent.share.receive"),
        (AGENT_SHARE_DISMISS_PENDING, "agent.share.dismissPending"),
        (AGENT_SHARE_RECEIVE_RECORDS, "agent.share.receiveRecords"),
        (AGENT_SHARE_SWITCH_TO_BRIDGE, "agent.share.switchToBridge"),
        (AGENT_SHARE_DIAGNOSTICS, "agent.share.diagnostics"),
        (AGENT_SHARE_LOGS, "agent.share.logs"),
        (AGENT_SHARE_SESSION_KILL, "agent.share.sessionKill"),
        (AGENT_SHARE_CONVERT_TO_CLOUD, "agent.share.convertToCloud"),
        (AGENT_SHARE_DELETE_CLOUD_COPY, "agent.share.deleteCloudCopy"),
    ];
    for (constant, literal) in expected {
        assert_eq!(constant, literal);
        assert_eq!(
            ALL_METHODS.iter().filter(|name| **name == literal).count(),
            1,
            "{literal} must appear exactly once in ALL_METHODS"
        );
    }
    let share_methods = ALL_METHODS
        .iter()
        .filter(|name| name.starts_with("agent.share."))
        .count();
    assert_eq!(share_methods, expected.len(), "no undeclared agent.share.*");
    let unique = ALL_METHODS.iter().collect::<HashSet<_>>();
    assert_eq!(unique.len(), ALL_METHODS.len());
    assert_eq!(CAPABILITY_AGENT_SHARE, "agent.share");
    assert!(AGENT_CAPABILITIES.contains(&CAPABILITY_AGENT_SHARE));
}

#[test]
fn protocol_version_covers_the_share_events() {
    assert_eq!(PROTOCOL_VERSION, 19);
    assert_eq!(MIN_PROTOCOL_VERSION, 19);
}

#[test]
fn share_error_reason_literals_are_exact() -> Result<(), serde_json::Error> {
    let cases = [
        (ErrorReason::ShareUnavailable, "shareUnavailable"),
        (ErrorReason::ShareNotFound, "shareNotFound"),
        (ErrorReason::ShareExpired, "shareExpired"),
        (ErrorReason::ShareStopped, "shareStopped"),
        (ErrorReason::ShareCodeInvalid, "shareCodeInvalid"),
        (ErrorReason::ShareRateLimited, "shareRateLimited"),
        (
            ErrorReason::ShareTurnstileRequired,
            "shareTurnstileRequired",
        ),
        (ErrorReason::ShareFileChanged, "shareFileChanged"),
        (ErrorReason::ShareSenderOffline, "shareSenderOffline"),
        (ErrorReason::ShareTaskNotShareable, "shareTaskNotShareable"),
        (
            ErrorReason::ShareBridgeUnavailable,
            "shareBridgeUnavailable",
        ),
        (ErrorReason::ShareQuotaExceeded, "shareQuotaExceeded"),
        (ErrorReason::ShareCloudNotReady, "shareCloudNotReady"),
        (ErrorReason::ShareTrafficExhausted, "shareTrafficExhausted"),
        (ErrorReason::ShareCloudUnavailable, "shareCloudUnavailable"),
    ];
    for (reason, literal) in cases {
        assert_eq!(serde_json::to_value(reason)?, json!(literal));
        assert_eq!(
            serde_json::from_value::<ErrorReason>(json!(literal))?,
            reason
        );
    }
    Ok(())
}

fn sample_state() -> ShareStateDto {
    let mut state = ShareStateDto {
        enabled: true,
        available: true,
        can_send: true,
        ..Default::default()
    };
    state.local_config = ShareLocalConfigDto {
        udp_port_v4: Some(41000),
        mode: ShareConnectionMode::RelayOnly,
        exit_behavior: ShareExitBehavior::Quit,
        iroh_log_level: ShareLogLevel::Debug,
        default_max_claims: 3,
        default_notify_on_claim: true,
        ..Default::default()
    };
    state.shares.push(ShareDto {
        id: "s1".to_owned(),
        slug: "abc".to_owned(),
        url: "https://fluxdown.com/s/abc".to_owned(),
        pickup_code: "123456".to_owned(),
        title: "a.zip".to_owned(),
        total_bytes: 9,
        mode: ShareMode::Live,
        tier_id: "24h".to_owned(),
        expires_at: "2026-10-28T00:00:00Z".to_owned(),
        status: ShareStatus::Active,
        active_receivers: vec![ShareReceiverDto {
            session_id: "sess".to_owned(),
            device_name: "Laptop".to_owned(),
            ..Default::default()
        }],
        ..Default::default()
    });
    state.task_facts.insert(
        "task-1".to_owned(),
        ShareTaskFactsDto {
            is_share_receive: true,
            session_id: Some("sess".to_owned()),
            peer_nat_type: ShareNatType::Symmetric,
            relay_stuck: true,
            ..Default::default()
        },
    );
    state
}

#[test]
fn pending_receive_round_trips_and_defaults_to_none() -> Result<(), serde_json::Error> {
    let mut state = sample_state();
    state.hashing.push(ShareHashingDto {
        id: "t1".to_owned(),
        title: "a.zip".to_owned(),
        done_bytes: 1,
        total_bytes: 9,
    });
    assert_eq!(
        serde_json::to_value(&state)?["hashing"][0]["doneBytes"],
        json!(1)
    );
    assert!(state.pending_receive.is_none());
    state.pending_receive = Some(ShareResolveDto {
        resolve_id: "r1".to_owned(),
        title: "a.zip".to_owned(),
        ..Default::default()
    });
    let wire = serde_json::to_value(&state)?;
    assert_eq!(wire["pendingReceive"]["resolveId"], json!("r1"));
    assert_eq!(
        serde_json::from_value::<ShareStateDto>(wire.clone())?,
        state
    );

    let mut old = wire;
    let Some(object) = old.as_object_mut() else {
        panic!("ShareStateDto serializes as an object");
    };
    assert!(object.remove("pendingReceive").is_some());
    assert!(
        serde_json::from_value::<ShareStateDto>(old)?
            .pending_receive
            .is_none()
    );

    let params: ShareDismissPendingParams = serde_json::from_value(json!({ "resolveId": "r1" }))?;
    assert_eq!(params.resolve_id, "r1");
    Ok(())
}

#[test]
fn share_state_wire_is_camel_case_and_round_trips() -> Result<(), serde_json::Error> {
    let state = sample_state();
    let wire = serde_json::to_value(&state)?;
    assert_eq!(wire["canSend"], json!(true));
    assert_eq!(wire["localConfig"]["udpPortV4"], json!(41000));
    assert_eq!(wire["localConfig"]["mode"], json!("relayOnly"));
    assert_eq!(wire["localConfig"]["exitBehavior"], json!("quit"));
    assert_eq!(wire["localConfig"]["irohLogLevel"], json!("debug"));
    assert_eq!(wire["shares"][0]["pickupCode"], json!("123456"));
    assert_eq!(
        wire["shares"][0]["activeReceivers"][0]["sessionId"],
        json!("sess")
    );
    assert_eq!(wire["taskFacts"]["task-1"]["isShareReceive"], json!(true));
    assert_eq!(
        wire["taskFacts"]["task-1"]["peerNatType"],
        json!("symmetric")
    );
    assert_eq!(wire["taskFacts"]["task-1"]["pathKind"], json!("unknown"));
    assert_eq!(serde_json::from_value::<ShareStateDto>(wire)?, state);
    Ok(())
}

#[test]
fn share_state_tolerates_a_bare_default_section() -> Result<(), serde_json::Error> {
    let bare: ShareStateDto = serde_json::from_value(json!({}))?;
    assert!(!bare.available);
    assert!(bare.shares.is_empty());
    let mut legacy = serde_json::to_value(AgentSnapshot::default())?;
    let Some(object) = legacy.as_object_mut() else {
        panic!("AgentSnapshot serializes as an object");
    };
    assert!(object.remove("share").is_some(), "新快照携带 share 字段");
    let snapshot: AgentSnapshot = serde_json::from_value(legacy)?;
    assert!(!snapshot.share.available, "旧快照没有 share 字段时取默认");
    Ok(())
}

#[test]
fn unknown_enum_values_decode_to_their_unknown_variant() -> Result<(), serde_json::Error> {
    assert_eq!(
        serde_json::from_value::<SharePathKind>(json!("quantum"))?,
        SharePathKind::Unknown
    );
    assert_eq!(
        serde_json::from_value::<ShareNatType>(json!("???"))?,
        ShareNatType::Unknown
    );
    assert_eq!(
        serde_json::from_value::<ShareStatus>(json!("archived"))?,
        ShareStatus::Unknown
    );
    assert_eq!(
        serde_json::from_value::<ShareCloudState>(json!("vaporized"))?,
        ShareCloudState::Unknown
    );
    Ok(())
}

#[test]
fn cloud_fields_round_trip_and_default_for_older_payloads() -> Result<(), serde_json::Error> {
    assert_eq!(serde_json::to_value(ShareCloudState::Idle)?, json!("none"));
    assert_eq!(
        serde_json::from_value::<ShareCloudState>(json!("none"))?,
        ShareCloudState::Idle
    );
    assert_eq!(
        serde_json::to_value(ShareCloudState::Uploading)?,
        json!("uploading")
    );
    assert_eq!(
        serde_json::to_value(ShareCloudState::Ready)?,
        json!("ready")
    );
    assert_eq!(
        serde_json::to_value(ShareCloudState::Deleted)?,
        json!("deleted")
    );
    assert_eq!(
        serde_json::to_value(ShareUploadStatus::Paused)?,
        json!("paused")
    );
    assert_eq!(serde_json::to_value(SharePathKind::Cdn)?, json!("cdn"));
    assert_eq!(
        serde_json::to_value(SharePathKind::Bridge)?,
        json!("bridge")
    );

    let share = ShareDto {
        id: "s1".to_owned(),
        mode: ShareMode::Cloud,
        cloud_state: ShareCloudState::Uploading,
        cloud_bytes: 7,
        upload: Some(ShareUploadDto {
            status: ShareUploadStatus::Failed,
            done_bytes: 3,
            total_bytes: 9,
            rate_bps: 0,
            reason: Some(ErrorReason::ShareCloudUnavailable),
        }),
        ..Default::default()
    };
    let wire = serde_json::to_value(&share)?;
    assert_eq!(wire["cloudState"], json!("uploading"));
    assert_eq!(wire["cloudBytes"], json!(7));
    assert_eq!(wire["upload"]["status"], json!("failed"));
    assert_eq!(wire["upload"]["doneBytes"], json!(3));
    assert_eq!(wire["upload"]["totalBytes"], json!(9));
    assert_eq!(wire["upload"]["rateBps"], json!(0));
    assert_eq!(wire["upload"]["reason"], json!("shareCloudUnavailable"));
    assert_eq!(serde_json::from_value::<ShareDto>(wire)?, share);

    let mut bare = serde_json::to_value(ShareDto::default())?;
    let Some(object) = bare.as_object_mut() else {
        panic!("ShareDto serializes as an object");
    };
    assert!(!object.contains_key("upload"), "没有上传时不下发 upload");
    for key in ["cloudState", "cloudBytes"] {
        assert!(object.remove(key).is_some());
    }
    let old = serde_json::from_value::<ShareDto>(bare)?;
    assert_eq!(old.cloud_state, ShareCloudState::Idle);
    assert_eq!(old.cloud_bytes, 0);
    assert!(old.upload.is_none());

    let policy: SharePolicySummaryDto = serde_json::from_value(json!({
        "retentionTiers": [{ "id": "cloud-24h", "hours": 24 }, { "id": "cloud-14d", "hours": 336 }],
        "cloudEnabled": true
    }))?;
    assert_eq!(policy.retention_tiers.len(), 2);
    assert_eq!(policy.retention_tiers[1].hours, 336);
    assert!(policy.cloud_enabled);
    let legacy: SharePolicySummaryDto = serde_json::from_value(json!({}))?;
    assert!(legacy.retention_tiers.is_empty());
    assert!(!legacy.cloud_enabled);

    let bytes: ShareSessionBytesDto = serde_json::from_value(json!({ "direct": 1, "relay": 2 }))?;
    assert_eq!((bytes.cdn, bytes.bridge), (0, 0));
    let wire = serde_json::to_value(ShareSessionBytesDto {
        cdn: 5,
        bridge: 6,
        ..bytes
    })?;
    assert_eq!(wire["cdn"], json!(5));
    assert_eq!(wire["bridge"], json!(6));

    let params = serde_json::to_value(ShareConvertToCloudParams {
        id: "s1".to_owned(),
        tier_id: None,
    })?;
    assert_eq!(params, json!({ "id": "s1" }));
    let params: ShareConvertToCloudParams =
        serde_json::from_value(json!({ "id": "s1", "tierId": "cloud-72h" }))?;
    assert_eq!(params.tier_id.as_deref(), Some("cloud-72h"));
    Ok(())
}

#[test]
fn share_events_use_the_agent_event_envelope_and_apply_to_the_snapshot()
-> Result<(), serde_json::Error> {
    let changed = AgentEvent::ShareChanged(sample_state());
    let wire = serde_json::to_value(ServiceEvent::Agent(changed.clone()))?;
    assert_eq!(wire["service"], json!("agent"));
    assert_eq!(wire["event"]["type"], json!("shareChanged"));
    assert_eq!(wire["event"]["data"]["shares"][0]["slug"], json!("abc"));
    let back: ServiceEvent = serde_json::from_value(wire)?;
    let ServiceEvent::Agent(AgentEvent::ShareChanged(state)) = back else {
        panic!("shareChanged must round-trip as ShareChanged");
    };
    assert_eq!(state, sample_state());

    let progress = AgentEvent::ShareProgress(ShareProgressDto {
        session_id: "sess".to_owned(),
        path_kind: SharePathKind::DirectLan,
        rate_bps: 1_000,
        bytes: 4,
        progress: 0.5,
    });
    let wire = serde_json::to_value(ServiceEvent::Agent(progress.clone()))?;
    assert_eq!(
        wire["event"],
        json!({
            "type": "shareProgress",
            "data": {
                "sessionId": "sess", "pathKind": "directLan",
                "rateBps": 1000, "bytes": 4, "progress": 0.5
            }
        })
    );

    let mut snapshot = AgentSnapshot::default();
    apply_agent_event(&mut snapshot, &progress);
    assert_eq!(
        snapshot.share,
        ShareStateDto::default(),
        "未知会话 / 空分区：无变化"
    );
    apply_agent_event(&mut snapshot, &changed);
    apply_agent_event(&mut snapshot, &progress);
    let receiver = &snapshot.share.shares[0].active_receivers[0];
    assert_eq!(
        (
            receiver.path_kind,
            receiver.rate_bps,
            receiver.bytes,
            receiver.progress
        ),
        (SharePathKind::DirectLan, 1_000, 4, 0.5)
    );
    assert_eq!(
        snapshot.share.task_facts["task-1"].path_kind,
        SharePathKind::DirectLan
    );
    Ok(())
}

#[test]
fn share_params_omit_absent_options_and_round_trip() -> Result<(), serde_json::Error> {
    let create = ShareCreateParams {
        task_ids: vec!["a".to_owned(), "b".to_owned()],
        max_claims: Some(0),
        ..Default::default()
    };
    let wire = serde_json::to_value(&create)?;
    assert_eq!(wire, json!({ "taskIds": ["a", "b"], "maxClaims": 0 }));
    assert_eq!(serde_json::from_value::<ShareCreateParams>(wire)?, create);

    let receive: ShareReceiveParams = serde_json::from_value(json!({
        "resolveId": "r1", "saveDir": "/tmp", "fileIndexes": [0, 2]
    }))?;
    assert_eq!(receive.resolve_id.as_deref(), Some("r1"));
    assert_eq!(receive.code_or_link, None);
    assert_eq!(receive.file_indexes, Some(vec![0, 2]));

    let logs: ShareLogsParams =
        serde_json::from_value(json!({ "level": "warn", "regex": "relay" }))?;
    assert_eq!(logs.level, Some(ShareLogLevel::Warn));
    assert_eq!(logs.limit, None);
    Ok(())
}

#[test]
fn share_results_round_trip() -> Result<(), serde_json::Error> {
    let config = ShareConfigDto::default();
    assert_eq!(
        serde_json::from_value::<ShareConfigDto>(serde_json::to_value(&config)?)?,
        config
    );
    let page: ShareReceiveRecordsPage =
        serde_json::from_value(json!({ "records": [], "nextCursor": null }))?;
    assert_eq!(page.next_cursor, None);

    let resolve: ShareResolveDto = serde_json::from_value(json!({
        "resolveId": "r", "shareId": "s", "title": "t", "senderDeviceName": "pc",
        "files": [{ "name": "a", "size": 1 }], "totalBytes": 1, "expiresAt": "2026-10-28T00:00:00Z"
    }))?;
    assert_eq!(resolve.sources.sender_online, None);
    assert!(!resolve.sources.cloud_copy && !resolve.sources.bridge);

    let diagnostics = ShareDiagnosticsDto {
        snapshot: Some(ShareNetSnapshotDto {
            endpoint_id: "e".to_owned(),
            metrics: [("socket.send_ipv4".to_owned(), json!(7))].into(),
            ..Default::default()
        }),
        snapshot_json: "{}".to_owned(),
        sessions: Vec::new(),
    };
    let wire: Value = serde_json::to_value(&diagnostics)?;
    assert_eq!(wire["snapshot"]["metrics"]["socket.send_ipv4"], json!(7));
    assert_eq!(wire["snapshotJson"], json!("{}"));
    assert_eq!(
        serde_json::from_value::<ShareDiagnosticsDto>(wire)?,
        diagnostics
    );
    Ok(())
}
