//! 状态派生：本机网络健康度与摘要行、路径 / NAT / 分享状态的文案键、分享列表排序。

use fluxdown_protocol::{
    ShareDto, ShareNatType, ShareNetStatusDto, SharePathKind, ShareReceiveStatus, ShareStatus,
};

/// 本机作为分享方「别人此刻能否找到并直连」的粗分级，驱动状态点颜色与文案。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NetHealth {
    /// 端点未绑定（空闲静默，按需启动）。
    Idle,
    /// 已绑定但未连上 home relay / 没有公网映射：别人暂时找不到本机。
    Offline,
    /// 在线，但对称 NAT：直连成功率低，多半走中继。
    RelayOnly,
    /// 在线且具备直连条件。
    Direct,
}

/// 由端点状态推出健康度。
#[must_use]
pub fn net_health(net: &ShareNetStatusDto) -> NetHealth {
    if !net.bound {
        NetHealth::Idle
    } else if !net.online {
        NetHealth::Offline
    } else if net.nat_type == ShareNatType::Symmetric {
        NetHealth::RelayOnly
    } else {
        NetHealth::Direct
    }
}

impl NetHealth {
    /// 状态行文案键。
    #[must_use]
    pub const fn key(self) -> &'static str {
        match self {
            Self::Idle => "shareNetHealthIdle",
            Self::Offline => "shareNetHealthOffline",
            Self::RelayOnly => "shareNetHealthRelayOnly",
            Self::Direct => "shareNetHealthDirect",
        }
    }
}

/// 本机网络摘要行的一段。
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NetSegment {
    Nat(ShareNatType),
    /// 运营商 / 省份（已拼好，如 `中国联通 · 北京`）。
    Carrier(String),
    Ipv6(bool),
    /// home relay 延迟（毫秒）。
    RelayLatency(u64),
}

/// 比较中继 URL：忽略末尾 `/`。
fn same_relay(a: &str, b: &str) -> bool {
    a.trim_end_matches('/') == b.trim_end_matches('/')
}

/// home relay 的延迟（毫秒）；home relay 未知或没有该中继的测量值为 `None`。
#[must_use]
pub fn home_relay_latency(net: &ShareNetStatusDto) -> Option<u64> {
    let home = net.home_relay.as_ref()?;
    net.relay_latency_ms
        .iter()
        .find(|(url, _)| same_relay(url, &home.url))
        .map(|(_, ms)| *ms)
}

/// 「NAT 类型 · 运营商 / 省份 · IPv6 · 首选中继延迟」摘要行的分段；端点未绑定时为空。
#[must_use]
pub fn net_segments(net: &ShareNetStatusDto) -> Vec<NetSegment> {
    if !net.bound {
        return Vec::new();
    }
    let mut segments = vec![NetSegment::Nat(net.nat_type)];
    let isp = net.isp.as_deref().filter(|text| !text.is_empty());
    let province = net.province.as_deref().filter(|text| !text.is_empty());
    let carrier = match (isp, province) {
        (Some(isp), Some(province)) => Some(format!("{isp} · {province}")),
        (Some(text), None) | (None, Some(text)) => Some(text.to_owned()),
        (None, None) => None,
    };
    if let Some(carrier) = carrier {
        segments.push(NetSegment::Carrier(carrier));
    }
    segments.push(NetSegment::Ipv6(net.ipv6));
    if let Some(ms) = home_relay_latency(net) {
        segments.push(NetSegment::RelayLatency(ms));
    }
    segments
}

/// NAT 类型文案键。
#[must_use]
pub const fn nat_key(nat: ShareNatType) -> &'static str {
    match nat {
        ShareNatType::Cone => "shareNatCone",
        ShareNatType::Symmetric => "shareNatSymmetric",
        ShareNatType::Unknown => "shareNatUnknown",
    }
}

/// 传输路径文案键（接收方行、任务来源徽标共用同一套文案）。
#[must_use]
pub const fn path_kind_key(kind: SharePathKind) -> &'static str {
    match kind {
        SharePathKind::DirectLan => "sharePathDirectLan",
        SharePathKind::DirectWan => "sharePathDirectWan",
        SharePathKind::Relay => "sharePathRelay",
        SharePathKind::Cdn => "shareBadgeCloud",
        SharePathKind::Bridge => "shareBadgeBridge",
        SharePathKind::Unknown => "sharePathUnknown",
    }
}

/// 分享状态文案键。
#[must_use]
pub const fn share_status_key(status: ShareStatus) -> &'static str {
    match status {
        ShareStatus::Active => "shareStatusActive",
        ShareStatus::Expired => "shareStatusExpired",
        ShareStatus::Stopped => "shareStatusStopped",
        ShareStatus::Unknown => "shareStatusUnknown",
    }
}

/// 接收记录状态文案键。
#[must_use]
pub const fn receive_status_key(status: ShareReceiveStatus) -> &'static str {
    match status {
        ShareReceiveStatus::Active => "shareReceiveStatusActive",
        ShareReceiveStatus::Completed => "shareReceiveStatusCompleted",
        ShareReceiveStatus::Failed => "shareReceiveStatusFailed",
    }
}

/// 「我的分享」列表顺序：有效的在前，其余（已过期 / 已停止 / 未知）在后；同组保持 agent 给出的顺序。
#[must_use]
pub fn ordered_shares(shares: &[ShareDto]) -> Vec<&ShareDto> {
    let mut ordered: Vec<&ShareDto> = shares.iter().collect();
    ordered.sort_by_key(|share| share.status != ShareStatus::Active);
    ordered
}

/// 只有仍有效的分享可以「停止」与就地改设置。
#[must_use]
pub fn is_editable(share: &ShareDto) -> bool {
    share.status == ShareStatus::Active
}

/// 分享标题行的主文案：只有一个文件时显示该文件名，否则用分享标题。
#[must_use]
pub fn share_headline(share: &ShareDto) -> &str {
    if !share.title.is_empty() {
        &share.title
    } else {
        share.files.first().map_or("", |file| file.name.as_str())
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use fluxdown_protocol::{
        ShareDto, ShareFileDto, ShareHomeRelayDto, ShareNatType, ShareNetStatusDto, ShareStatus,
    };

    use super::{
        NetHealth, NetSegment, home_relay_latency, is_editable, net_health, net_segments,
        ordered_shares, share_headline,
    };

    fn net() -> ShareNetStatusDto {
        ShareNetStatusDto {
            bound: true,
            online: true,
            nat_type: ShareNatType::Cone,
            ipv6: true,
            isp: Some("China Unicom".into()),
            province: Some("Beijing".into()),
            home_relay: Some(ShareHomeRelayDto {
                url: "https://relay.example/".into(),
                connected: true,
            }),
            relay_latency_ms: BTreeMap::from([("https://relay.example".to_owned(), 18)]),
            ..ShareNetStatusDto::default()
        }
    }

    #[test]
    fn health_follows_binding_reachability_and_nat() {
        let mut status = net();
        assert_eq!(net_health(&status), NetHealth::Direct);
        status.nat_type = ShareNatType::Unknown;
        assert_eq!(net_health(&status), NetHealth::Direct);
        status.nat_type = ShareNatType::Symmetric;
        assert_eq!(net_health(&status), NetHealth::RelayOnly);
        status.online = false;
        assert_eq!(net_health(&status), NetHealth::Offline);
        status.bound = false;
        assert_eq!(net_health(&status), NetHealth::Idle);
    }

    #[test]
    fn summary_line_lists_nat_carrier_ipv6_and_home_relay_latency() {
        assert_eq!(
            net_segments(&net()),
            vec![
                NetSegment::Nat(ShareNatType::Cone),
                NetSegment::Carrier("China Unicom · Beijing".into()),
                NetSegment::Ipv6(true),
                NetSegment::RelayLatency(18),
            ]
        );
    }

    #[test]
    fn summary_line_omits_unknown_parts_and_is_empty_when_unbound() {
        let mut status = net();
        status.isp = None;
        status.province = Some(String::new());
        status.home_relay = None;
        assert_eq!(
            net_segments(&status),
            vec![NetSegment::Nat(ShareNatType::Cone), NetSegment::Ipv6(true)]
        );
        status.bound = false;
        assert!(net_segments(&status).is_empty());
        assert_eq!(home_relay_latency(&status), None);
    }

    #[test]
    fn active_shares_sort_first_and_keep_relative_order() {
        let make = |id: &str, status| ShareDto {
            id: id.into(),
            status,
            ..ShareDto::default()
        };
        let shares = vec![
            make("a", ShareStatus::Stopped),
            make("b", ShareStatus::Active),
            make("c", ShareStatus::Expired),
            make("d", ShareStatus::Active),
        ];
        let order: Vec<&str> = ordered_shares(&shares)
            .iter()
            .map(|share| share.id.as_str())
            .collect();
        assert_eq!(order, ["b", "d", "a", "c"]);
        assert!(is_editable(&shares[1]));
        assert!(!is_editable(&shares[0]));
    }

    #[test]
    fn headline_prefers_title_then_first_file() {
        let mut share = ShareDto {
            title: "Holiday".into(),
            files: vec![ShareFileDto {
                name: "a.zip".into(),
                size: 1,
            }],
            ..ShareDto::default()
        };
        assert_eq!(share_headline(&share), "Holiday");
        share.title.clear();
        assert_eq!(share_headline(&share), "a.zip");
        share.files.clear();
        assert_eq!(share_headline(&share), "");
    }
}
