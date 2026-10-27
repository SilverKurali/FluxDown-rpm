//! 测试公共设施：确定性数据、端点对、票据签发、上报收集。

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use fluxdown_share::ticket::{encode_public_key, sign_ticket};
use fluxdown_share::{
    EndpointAddr, KeyEntry, KeyRing, LocalAdapter, LocalEndpointConfig, NetSnapshot, NetworkPolicy,
    Observers, ReceiveParams, ReceiveSession, SecretKey, SessionEvent, SessionReport,
    ShareEndpoint, ShareEndpointParams, ShareEntry, ShareManifest, ShareRegistry, ShareState,
    ShareTelemetrySink, TicketPayload, hash_file,
};
use tempfile::TempDir;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

/// 确定性伪随机字节（xorshift64*），避免测试依赖 rand。
pub fn pseudo_random(len: usize, seed: u64) -> Vec<u8> {
    let mut state = seed | 1;
    let mut out = Vec::with_capacity(len);
    while out.len() < len {
        state ^= state >> 12;
        state ^= state << 25;
        state ^= state >> 27;
        let word = state.wrapping_mul(0x2545_F491_4F6C_DD1D);
        out.extend_from_slice(&word.to_le_bytes());
    }
    out.truncate(len);
    out
}

/// 不接任何外部服务的策略：无中继、无 pkarr、无 DNS。
pub fn offline_policy(report_interval_secs: u64) -> NetworkPolicy {
    NetworkPolicy {
        relays: vec![],
        dns_origin: String::new(),
        pkarr_url: String::new(),
        nameservers: vec![],
        doh_url: None,
        pkarr_ttl_secs: 30,
        republish_secs: 300,
        publish_direct_addrs: false,
        portmapper: false,
        hole_punch_hint_secs: 8,
        report_interval_secs,
    }
}

/// 收集上报的测试出口。
#[derive(Default)]
pub struct CollectSink {
    pub nets: Mutex<Vec<NetSnapshot>>,
    pub sessions: Mutex<Vec<SessionReport>>,
}

impl ShareTelemetrySink for CollectSink {
    fn net_snapshot(&self, snapshot: &NetSnapshot) {
        self.nets.lock().unwrap().push(snapshot.clone());
    }
    fn session_report(&self, report: &SessionReport) {
        self.sessions.lock().unwrap().push(report.clone());
    }
}

/// 一个测试端点及其宿主侧句柄。
pub struct Peer {
    pub ep: ShareEndpoint,
    pub registry: ShareRegistry,
    pub events: mpsc::UnboundedReceiver<SessionEvent>,
    pub sink: Arc<CollectSink>,
}

/// 签发密钥：kid 固定 `k1`。
pub struct Signer {
    pub secret: SecretKey,
    pub ring: KeyRing,
}

pub fn signer() -> Signer {
    let secret = SecretKey::generate();
    let ring = KeyRing::new();
    ring.replace(&[KeyEntry {
        kid: "k1".into(),
        public_key: encode_public_key(&secret.public()),
        not_after: None,
    }])
    .unwrap();
    Signer { secret, ring }
}

pub fn payload(sid: &str, rep: &str, exp: u64) -> TicketPayload {
    TicketPayload {
        v: 1,
        kid: "k1".into(),
        sid: sid.into(),
        rep: rep.into(),
        exp,
        scope: "recv".into(),
    }
}

pub fn ticket_for(signer: &Signer, sid: &str, receiver: &ShareEndpoint, exp: u64) -> String {
    sign_ticket(&signer.secret, &payload(sid, &receiver.id_z32(), exp)).unwrap()
}

pub fn far_future() -> u64 {
    fluxdown_share::timefmt::now_unix_secs() + 3600
}

pub fn peer_with(keys: KeyRing, report_secs: u64, local: LocalEndpointConfig) -> Peer {
    let registry = ShareRegistry::new();
    let (tx, rx) = mpsc::unbounded_channel();
    let sink = Arc::new(CollectSink::default());
    let ep = ShareEndpoint::new(ShareEndpointParams {
        secret_key: SecretKey::generate(),
        policy: offline_policy(report_secs),
        local,
        client_version: "0.0.0-test".into(),
        keys: keys.clone(),
        registry: registry.clone(),
        observers: Observers {
            events: Some(tx),
            telemetry: Some(sink.clone()),
        },
    })
    .unwrap();
    Peer {
        ep,
        registry,
        events: rx,
        sink,
    }
}

pub fn peer(keys: KeyRing) -> Peer {
    peer_with(keys, 1, LocalEndpointConfig::default())
}

/// 回环地址提示：不依赖任何地址发现。
pub async fn loopback_hint(ep: &ShareEndpoint) -> EndpointAddr {
    let endpoint = ep.ensure_bound().await.unwrap();
    let port = endpoint
        .bound_sockets()
        .iter()
        .find(|a| a.is_ipv4())
        .map(SocketAddr::port)
        .unwrap();
    EndpointAddr::new(ep.id()).with_ip_addr(SocketAddr::from(([127, 0, 0, 1], port)))
}

/// 磁盘上的分享文件。
pub struct SharedFile {
    pub _dir: TempDir,
    pub path: PathBuf,
    pub data: Vec<u8>,
    pub manifest: ShareManifest,
}

pub async fn shared_file(share_id: &str, len: usize, seed: u64) -> SharedFile {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("payload.bin");
    let data = pseudo_random(len, seed);
    std::fs::write(&path, &data).unwrap();
    let file = hash_file(path.clone(), None, |_| {}, CancellationToken::new())
        .await
        .unwrap();
    SharedFile {
        _dir: dir,
        path,
        data,
        manifest: ShareManifest {
            share_id: share_id.into(),
            files: vec![file],
        },
    }
}

pub fn register(peer: &Peer, file: &SharedFile) {
    peer.registry
        .insert(ShareEntry {
            manifest: file.manifest.clone(),
            paths: vec![file.path.clone()],
            state: ShareState::Active,
            expires_at: None,
            rate_limit_bytes_per_sec: None,
        })
        .unwrap();
}

/// 完整的“分享方 + 接收方 + 适配器”装置。
pub struct Rig {
    pub sender: Peer,
    pub receiver: Peer,
    pub session: ReceiveSession,
    pub adapter: LocalAdapter,
    pub token: String,
    pub file: SharedFile,
    pub signer: Signer,
}

impl Rig {
    pub fn url(&self) -> String {
        self.adapter.url(&self.token, 0)
    }
}

pub async fn rig(share_id: &str, len: usize) -> Rig {
    rig_with(share_id, len, |_| {}).await
}

/// `tweak` 可在启动前改动接收参数（如缩短连接超时）。
pub async fn rig_with(share_id: &str, len: usize, tweak: impl FnOnce(&mut ReceiveParams)) -> Rig {
    let signer = signer();
    let sender = peer(signer.ring.clone());
    let receiver = peer(signer.ring.clone());
    let file = shared_file(share_id, len, 0xC0FFEE).await;
    register(&sender, &file);
    let hint = loopback_hint(&sender.ep).await;
    let ticket = ticket_for(&signer, share_id, &receiver.ep, far_future());
    let mut params = ReceiveParams::new(file.manifest.clone(), ticket, sender.ep.id());
    params.addr_hint = Some(hint);
    tweak(&mut params);
    let session = ReceiveSession::new(receiver.ep.clone(), params);
    let adapter = LocalAdapter::start().await.unwrap();
    let token = adapter.register(session.clone());
    Rig {
        sender,
        receiver,
        session,
        adapter,
        token,
        file,
        signer,
    }
}

/// 不走任何系统代理的 HTTP 客户端（回环必须直连）。
pub fn http() -> reqwest::Client {
    reqwest::Client::builder().no_proxy().build().unwrap()
}
