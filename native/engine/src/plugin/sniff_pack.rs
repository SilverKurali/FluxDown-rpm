//! 浏览器扩展嗅探规则的 plugin 层聚合。
//!
//! 只在被查询时计算：聚合所有「启用、已加载、已授权」且声明了 `contributes.sniffRules`
//! 的插件规则文件，改写 id / tier 后得到一个 pack。`sequence` 持久化在配置键
//! `plugin.sniff_rules.sequence`，规则内容哈希存 `plugin.sniff_rules.hash`；仅当哈希变化时
//! 写配置并让 sequence 加一（空闲静默、严格递增、永不回退）。

use std::collections::BTreeMap;
use std::path::Path;

use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::sync::Mutex;

use super::manager::PluginInfo;
use super::manifest::validate_sniff_pack;
use super::runtime::PluginError;
use crate::db::Db;

pub const SEQUENCE_KEY: &str = "plugin.sniff_rules.sequence";
pub const HASH_KEY: &str = "plugin.sniff_rules.hash";
const MAX_RULE_ID_LEN: usize = 64;

/// 串行化「读哈希 → 比较 → 写配置」，避免并发查询重复递增。
static QUERY_LOCK: Mutex<()> = Mutex::const_new(());

/// 查询当前 plugin 层规则包：`(sequence, pack)`。从未有过插件规则时为 `(0, None)`。
pub async fn query(plugins: &[PluginInfo], db: &Db) -> Result<(u64, Option<Value>), PluginError> {
    let rules = collect_rules(plugins).await;
    let hash = rules_hash(&rules)?;

    let _guard = QUERY_LOCK.lock().await;
    let stored_seq = read_config(db, SEQUENCE_KEY)
        .await?
        .and_then(|raw| raw.trim().parse::<u64>().ok())
        .unwrap_or(0);
    let stored_hash = read_config(db, HASH_KEY).await?;

    let sequence = if stored_hash.as_deref() == Some(hash.as_str()) && stored_seq > 0 {
        stored_seq
    } else if stored_seq == 0 && stored_hash.is_none() && rules.is_empty() {
        return Ok((0, None));
    } else {
        let next = stored_seq.saturating_add(1);
        let values = BTreeMap::from([
            (SEQUENCE_KEY.to_string(), next.to_string()),
            (HASH_KEY.to_string(), hash),
        ]);
        db.set_config_batch_atomic(&values)
            .await
            .map_err(|e| PluginError::Runtime(format!("{e:#}")))?;
        next
    };

    let pack = json!({
        "format": "fluxdown-sniff-pack",
        "packId": "plugin",
        "sequence": sequence,
        "engine": 1,
        "issuedAt": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        "rules": rules,
    });
    Ok((sequence, Some(pack)))
}

async fn read_config(db: &Db, key: &str) -> Result<Option<String>, PluginError> {
    db.get_config(key)
        .await
        .map_err(|e| PluginError::Runtime(format!("{e:#}")))
}

fn rules_hash(rules: &[Value]) -> Result<String, PluginError> {
    let bytes = serde_json::to_vec(rules)
        .map_err(|e| PluginError::Runtime(format!("序列化 plugin 规则失败: {e}")))?;
    let digest = Sha256::digest(&bytes);
    Ok(digest.iter().map(|b| format!("{b:02x}")).collect())
}

async fn collect_rules(plugins: &[PluginInfo]) -> Vec<Value> {
    let mut sorted: Vec<&PluginInfo> = plugins.iter().collect();
    sorted.sort_by(|a, b| a.identity.cmp(&b.identity));
    let mut out = Vec::new();
    for info in sorted {
        let Some(file) = info.contributions.sniff_rules.as_deref() else {
            continue;
        };
        if !info.enabled
            || info.load_status != "Loaded"
            || !info.consent_pending.is_empty()
            || !info.consent_pending_hosts.is_empty()
        {
            continue;
        }
        let Some(dir) = info.package_dir.as_deref() else {
            continue;
        };
        match load_plugin_rules(&info.identity, Path::new(dir), file).await {
            Ok(rules) => out.extend(rules),
            Err(error) => {
                crate::log_warn!("[plugin-sniff] {} 规则读取失败: {error}", info.identity)
            }
        }
    }
    out
}

async fn load_plugin_rules(
    identity: &str,
    dir: &Path,
    file: &str,
) -> Result<Vec<Value>, PluginError> {
    let bytes = tokio::fs::read(dir.join(file))
        .await
        .map_err(|e| PluginError::Runtime(format!("读取 {file} 失败: {e}")))?;
    validate_sniff_pack(&bytes)?;
    let pack: Value = serde_json::from_slice(&bytes)
        .map_err(|e| PluginError::Runtime(format!("解析 {file} 失败: {e}")))?;
    let Some(rules) = pack.get("rules").and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    let prefix = format!("plugin.{}.", identity.replace('@', "."));
    let mut out = Vec::with_capacity(rules.len());
    for rule in rules {
        let Some(mut object) = rule.as_object().cloned() else {
            crate::log_warn!("[plugin-sniff] {identity} 丢弃非对象规则");
            continue;
        };
        let Some(original) = object.get("id").and_then(Value::as_str) else {
            crate::log_warn!("[plugin-sniff] {identity} 丢弃缺少 id 的规则");
            continue;
        };
        let id = format!("{prefix}{original}");
        if id.len() > MAX_RULE_ID_LEN {
            crate::log_warn!(
                "[plugin-sniff] {identity} 规则 id 改写后超过 {MAX_RULE_ID_LEN} 字符，已丢弃: {id}"
            );
            continue;
        }
        object.insert("id".to_string(), Value::String(id));
        object.insert("tier".to_string(), Value::String("plugin".to_string()));
        out.push(Value::Object(object));
    }
    Ok(out)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use crate::plugin::manifest::{ContributesDecl, PluginRisk};

    async fn open_db() -> (Db, std::path::PathBuf) {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "fluxdown_sniff_pack_{}_{nanos}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).expect("create dir");
        let db = Db::open(&dir).await.expect("open db");
        (db, dir)
    }

    fn info(identity: &str, dir: &Path, rules: Option<&str>) -> PluginInfo {
        PluginInfo {
            identity: identity.into(),
            name: identity.into(),
            version: "1.0.0".into(),
            description: String::new(),
            homepage: String::new(),
            enabled: true,
            dev_mode: false,
            disabled_reason: String::new(),
            settings: Vec::new(),
            settings_values: Vec::new(),
            permissions: vec!["browserRules".into()],
            auth_supported: false,
            subscription_provider_ids: Vec::new(),
            resolver_urls: Vec::new(),
            load_status: "Loaded".into(),
            load_error: String::new(),
            contributions: ContributesDecl {
                sniff_rules: rules.map(str::to_string),
                ..ContributesDecl::default()
            },
            has_main: false,
            risk: PluginRisk::Elevated,
            network_hosts: Vec::new(),
            consent_pending: Vec::new(),
            consent_pending_hosts: Vec::new(),
            package_dir: Some(dir.to_string_lossy().into_owned()),
        }
    }

    fn write_pack(dir: &Path, ids: &[&str]) {
        std::fs::create_dir_all(dir).expect("mkdir");
        let rules: Vec<Value> = ids
            .iter()
            .map(|id| json!({"id": id, "tier": "local", "x": 1}))
            .collect();
        let pack = json!({"format": "fluxdown-sniff-pack", "rules": rules});
        std::fs::write(dir.join("rules.json"), pack.to_string()).expect("write");
    }

    #[tokio::test]
    async fn no_rules_ever_returns_zero_and_null() {
        let (db, dir) = open_db().await;
        let (seq, pack) = query(&[], &db).await.unwrap();
        assert_eq!(seq, 0);
        assert!(pack.is_none());
        assert!(db.get_config(SEQUENCE_KEY).await.unwrap().is_none());
        std::fs::remove_dir_all(dir).expect("cleanup");
    }

    #[tokio::test]
    async fn aggregates_rewrites_and_tracks_sequence() {
        let (db, root) = open_db().await;
        let a = root.join("a");
        let b = root.join("b");
        let long_id = "x".repeat(60);
        write_pack(&a, &["one", &long_id]);
        write_pack(&b, &["two"]);
        let mut plugins = vec![
            info("a@acme", &a, Some("rules.json")),
            info("b@acme", &b, Some("rules.json")),
        ];

        let (seq, pack) = query(&plugins, &db).await.unwrap();
        assert_eq!(seq, 1);
        let pack = pack.unwrap();
        assert_eq!(pack["packId"], "plugin");
        assert_eq!(pack["sequence"], 1);
        let ids: Vec<&str> = pack["rules"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids, ["plugin.a.acme.one", "plugin.b.acme.two"]);
        assert!(
            pack["rules"]
                .as_array()
                .unwrap()
                .iter()
                .all(|r| r["tier"] == "plugin")
        );

        // 内容不变：序号不变。
        assert_eq!(query(&plugins, &db).await.unwrap().0, 1);

        // 变化：+1。
        plugins[1].enabled = false;
        assert_eq!(query(&plugins, &db).await.unwrap().0, 2);

        // 授权撤销到清空：产生空包新序号，随后稳定。
        plugins[0].consent_pending = vec!["browserRules".into()];
        let (seq, pack) = query(&plugins, &db).await.unwrap();
        assert_eq!(seq, 3);
        assert!(pack.unwrap()["rules"].as_array().unwrap().is_empty());
        let (seq, pack) = query(&plugins, &db).await.unwrap();
        assert_eq!(seq, 3);
        assert!(pack.is_some());

        // 重新出现规则：继续递增。
        plugins[0].consent_pending.clear();
        assert_eq!(query(&plugins, &db).await.unwrap().0, 4);
        std::fs::remove_dir_all(root).expect("cleanup");
    }
}
