import { normalizeCountry } from '../../../lib/flags/flags'
import type { BtPeerDto, BtPeerTransport, BtTrackerDto, BtTrackerStatus } from '../../../lib/rpc'
import type { TaskState } from '../model/task'
import type { Translate } from '../table/text'

/** 轮询间隔（与「速度」标签一致）。 */
export const BT_STATUS_POLL_MS = 2000

/** 连接列表渲染上限（服务端已按活跃度排序，超出部分是最不活跃的）。 */
export const MAX_PEER_ROWS = 200

// ── 相对时间 ──

export type RelativeUnit = 's' | 'm' | 'h' | 'd'

/** 秒数 → 最大整单位（<60s 秒，<60m 分，<24h 时，其余天）；负值按 0。 */
export function relativeSpan(secs: number): { unit: RelativeUnit; n: number } {
  const s = Math.max(0, Math.floor(Number.isFinite(secs) ? secs : 0))
  if (s < 60) return { unit: 's', n: s }
  if (s < 3600) return { unit: 'm', n: Math.floor(s / 60) }
  if (s < 86_400) return { unit: 'h', n: Math.floor(s / 3600) }
  return { unit: 'd', n: Math.floor(s / 86_400) }
}

function spanText(t: Translate, secs: number): string {
  const { unit, n } = relativeSpan(secs)
  switch (unit) {
    case 's':
      return t('etaSeconds', { n })
    case 'm':
      return t('etaMinutes', { n })
    case 'h':
      return t('etaHours', { n })
    case 'd':
      return `${n} ${t('timeUnitDays')}`
  }
}

/** 下次 announce：未知（0 / 缺省）→ null；已过期（<=0）显示「in 0s」。 */
export function nextAnnounceText(t: Translate, at: number | undefined, nowSecs: number): string | null {
  if (!at || at <= 0) return null
  return t('btTrackerIn', { time: spanText(t, at - nowSecs) })
}

/** 最近成功：从未（0 / 缺省）→ 「Never」。时钟略有偏差时按 0 秒前。 */
export function lastOkText(t: Translate, at: number | undefined, nowSecs: number): string {
  if (!at || at <= 0) return t('btTrackerNever')
  return t('btTrackerAgo', { time: spanText(t, nowSecs - at) })
}

// ── Tracker ──

const STATUS_KEY: Record<BtTrackerStatus, string> = {
  working: 'btTrackerStatusWorking',
  updating: 'btTrackerStatusUpdating',
  notWorking: 'btTrackerStatusNotWorking',
  notContacted: 'btTrackerStatusNotContacted',
  unknown: 'btTrackerStatusUnknown',
}

export const trackerStatusKey = (status: BtTrackerStatus): string => STATUS_KEY[status]

/** 状态点底色 / 文字色（均为主题令牌）。 */
export const TRACKER_DOT: Record<BtTrackerStatus, string> = {
  working: 'bg-success',
  updating: 'bg-muted-foreground animate-pulse',
  notWorking: 'bg-destructive',
  notContacted: 'bg-text-tertiary',
  unknown: 'bg-text-tertiary',
}

export const TRACKER_TEXT: Record<BtTrackerStatus, string> = {
  working: 'text-success',
  updating: 'text-muted-foreground',
  notWorking: 'text-destructive',
  notContacted: 'text-text-tertiary',
  unknown: 'text-text-tertiary',
}

/**
 * 「没有任何 tracker 工作」提示（GPUI `none_working` 同条件）：至少一个 tracker 失败（`notWorking`），
 * 没有 `working`，也没有 `unknown`（引擎未上报）。全部 `updating` / `notContacted` 不提示，避免首次
 * announce 期间误报。
 */
export function showNoneWorking(trackers: readonly Pick<BtTrackerDto, 'status'>[]): boolean {
  const any = (status: BtTrackerStatus) => trackers.some((tr) => tr.status === status)
  return trackers.length > 0 && !any('unknown') && !any('working') && any('notWorking')
}

/** 渲染行：保持服务端顺序，仅归一化可选字段。 */
export interface TrackerRow {
  key: string
  url: string
  source: BtTrackerDto['source']
  status: BtTrackerStatus
  peers: number | null
  message: string
  lastOkAt: number
  nextAnnounceAt: number
}

export function mapTrackerRows(trackers: readonly BtTrackerDto[]): TrackerRow[] {
  const seen = new Map<string, number>()
  return trackers.map((tr) => {
    const nth = seen.get(tr.url) ?? 0
    seen.set(tr.url, nth + 1)
    return {
      key: nth === 0 ? tr.url : `${tr.url}#${nth}`,
      url: tr.url,
      source: tr.source,
      status: tr.status,
      peers: typeof tr.peers === 'number' ? tr.peers : null,
      message: (tr.message ?? '').trim(),
      lastOkAt: tr.lastOkAt ?? 0,
      nextAnnounceAt: tr.nextAnnounceAt ?? 0,
    }
  })
}

/** 中间省略：头部由 CSS 截断，尾部固定显示（保留域名后的路径末段 / 端口）。 */
export function splitMiddle(url: string, tailLen = 18): { head: string; tail: string } {
  if (url.length <= tailLen * 2) return { head: url, tail: '' }
  return { head: url.slice(0, url.length - tailLen), tail: url.slice(url.length - tailLen) }
}

export type TrackerLayout = 'card' | 'table' | 'wide'

/** 容器宽度 → Tracker 版式：<560 卡片式；<900 表格（消息在 URL 下方）；其余消息独立成列。 */
export function trackerLayout(width: number): TrackerLayout {
  if (width < 560) return 'card'
  if (width < 900) return 'table'
  return 'wide'
}

// ── Peers ──

export type PeerColumn = 'addr' | 'client' | 'transport' | 'downloaded' | 'uploaded' | 'downBps' | 'upBps'

export type PeerLayout = 'card' | 'compact' | 'full'

/** 容器宽度 → 连接版式：<480 卡片；<780 紧凑（隐藏客户端 / 上传量）；其余全列。 */
export function peerLayout(width: number): PeerLayout {
  if (width < 480) return 'card'
  if (width < 780) return 'compact'
  return 'full'
}

export function peerColumns(layout: PeerLayout): PeerColumn[] {
  switch (layout) {
    case 'card':
      return ['addr', 'transport', 'downBps', 'upBps']
    case 'compact':
      return ['addr', 'transport', 'downloaded', 'downBps', 'upBps']
    case 'full':
      return ['addr', 'client', 'transport', 'downloaded', 'uploaded', 'downBps', 'upBps']
  }
}

const TRANSPORT_LABEL: Record<BtPeerTransport, string> = { tcp: 'TCP', utp: 'uTP', socks: 'SOCKS' }

export const transportLabel = (transport: BtPeerTransport): string => TRANSPORT_LABEL[transport] ?? String(transport).toUpperCase()

export interface PeerRow {
  key: string
  addr: string
  client: string
  /** 大写国家码；未知 = `''`。 */
  country: string
  transport: BtPeerTransport
  downloaded: number
  uploaded: number
  downBps: number
  upBps: number
}

/** 取前 `MAX_PEER_ROWS` 条（服务端顺序）；`key` = 地址，重复地址追加序号保证唯一。 */
export function mapPeerRows(peers: readonly BtPeerDto[]): { rows: PeerRow[]; total: number } {
  const seen = new Map<string, number>()
  const rows = peers.slice(0, MAX_PEER_ROWS).map((p) => {
    const nth = seen.get(p.addr) ?? 0
    seen.set(p.addr, nth + 1)
    return {
      key: nth === 0 ? p.addr : `${p.addr}#${nth}`,
      addr: p.addr,
      client: (p.client ?? '').trim(),
      country: normalizeCountry(p.country),
      transport: p.transport,
      downloaded: p.downloaded,
      uploaded: p.uploaded,
      downBps: p.downBps,
      upBps: p.upBps,
    }
  })
  return { rows, total: peers.length }
}

/** 空态：运行中（下载 / 做种）= `btPeersEmpty`，否则 `btPeersIdleHint`。 */
export function peersEmptyKey(state: TaskState, seeding: boolean): 'btPeersEmpty' | 'btPeersIdleHint' {
  return state === 'downloading' || seeding ? 'btPeersEmpty' : 'btPeersIdleHint'
}
