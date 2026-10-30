import { describe, expect, test } from 'bun:test'
import {
  lastOkText,
  mapPeerRows,
  mapTrackerRows,
  MAX_PEER_ROWS,
  nextAnnounceText,
  peerColumns,
  peerLayout,
  peersEmptyKey,
  relativeSpan,
  showNoneWorking,
  splitMiddle,
  trackerLayout,
  transportLabel,
} from './btStatus'
import type { BtPeerDto, BtTrackerDto } from '../../../lib/rpc'

/** 回显键与参数，便于断言选了哪个文案。 */
const t = (key: string, params?: Record<string, string | number>) => (params ? `${key}:${Object.values(params).join(',')}` : key)

const tracker = (over: Partial<BtTrackerDto>): BtTrackerDto => ({ url: 'udp://a/announce', source: 'torrent', status: 'working', ...over })
const peer = (over: Partial<BtPeerDto>): BtPeerDto => ({ addr: '1.2.3.4:5', transport: 'tcp', downloaded: 0, uploaded: 0, downBps: 0, upBps: 0, ...over })

describe('relative time', () => {
  test('单位阈值', () => {
    expect(relativeSpan(0)).toEqual({ unit: 's', n: 0 })
    expect(relativeSpan(59)).toEqual({ unit: 's', n: 59 })
    expect(relativeSpan(60)).toEqual({ unit: 'm', n: 1 })
    expect(relativeSpan(28 * 60 + 30)).toEqual({ unit: 'm', n: 28 })
    expect(relativeSpan(3600)).toEqual({ unit: 'h', n: 1 })
    expect(relativeSpan(86_400 * 3)).toEqual({ unit: 'd', n: 3 })
  })
  test('负值与非有限值按 0', () => {
    expect(relativeSpan(-5)).toEqual({ unit: 's', n: 0 })
    expect(relativeSpan(Number.NaN)).toEqual({ unit: 's', n: 0 })
  })
  test('下次 announce：未知为 null，已过期为 0 秒', () => {
    expect(nextAnnounceText(t, undefined, 1000)).toBeNull()
    expect(nextAnnounceText(t, 0, 1000)).toBeNull()
    expect(nextAnnounceText(t, 1000 + 28 * 60, 1000)).toBe('btTrackerIn:etaMinutes:28')
    expect(nextAnnounceText(t, 900, 1000)).toBe('btTrackerIn:etaSeconds:0')
  })
  test('最近成功：从未 / 多久前 / 时钟回拨', () => {
    expect(lastOkText(t, undefined, 1000)).toBe('btTrackerNever')
    expect(lastOkText(t, 0, 1000)).toBe('btTrackerNever')
    expect(lastOkText(t, 1000 - 300, 1000)).toBe('btTrackerAgo:etaMinutes:5')
    expect(lastOkText(t, 1100, 1000)).toBe('btTrackerAgo:etaSeconds:0')
  })
})

describe('tracker banner', () => {
  test('无 tracker 不提示', () => {
    expect(showNoneWorking([])).toBe(false)
  })
  test('有一个工作就不提示', () => {
    expect(showNoneWorking([{ status: 'notWorking' }, { status: 'working' }])).toBe(false)
  })
  test('含 unknown 不提示', () => {
    expect(showNoneWorking([{ status: 'unknown' }])).toBe(false)
    expect(showNoneWorking([{ status: 'notWorking' }, { status: 'unknown' }])).toBe(false)
  })
  test('全部 updating / notContacted 不提示（首次 announce 期间不误报）', () => {
    expect(showNoneWorking([{ status: 'updating' }, { status: 'notContacted' }])).toBe(false)
  })
  test('至少一个失败且没有工作 → 提示', () => {
    expect(showNoneWorking([{ status: 'notWorking' }])).toBe(true)
    expect(showNoneWorking([{ status: 'notContacted' }, { status: 'notWorking' }])).toBe(true)
  })
})

describe('row mapping', () => {
  test('tracker：保持顺序、归一化可选字段、重复 URL 键唯一', () => {
    const rows = mapTrackerRows([
      tracker({ url: 'a', peers: 3, message: ' boom ', lastOkAt: 10, nextAnnounceAt: 20 }),
      tracker({ url: 'b' }),
      tracker({ url: 'a' }),
    ])
    expect(rows.map((r) => r.key)).toEqual(['a', 'b', 'a#1'])
    expect(rows[0]).toMatchObject({ peers: 3, message: 'boom', lastOkAt: 10, nextAnnounceAt: 20 })
    expect(rows[1]).toMatchObject({ peers: null, message: '', lastOkAt: 0, nextAnnounceAt: 0 })
  })
  test('peer：封顶 200，返回总数，重复地址键唯一', () => {
    const many = Array.from({ length: MAX_PEER_ROWS + 50 }, (_, i) => peer({ addr: `10.0.0.${i}:1` }))
    const mapped = mapPeerRows(many)
    expect(mapped.rows).toHaveLength(MAX_PEER_ROWS)
    expect(mapped.total).toBe(MAX_PEER_ROWS + 50)
    const dup = mapPeerRows([peer({}), peer({ client: ' qB ' })])
    expect(dup.rows.map((r) => r.key)).toEqual(['1.2.3.4:5', '1.2.3.4:5#1'])
    expect(dup.rows[1]?.client).toBe('qB')
    expect(dup.rows.map((r) => r.country)).toEqual(['', ''])
    expect(mapPeerRows([peer({ country: 'cn' }), peer({ addr: 'b:1', country: 'bogus' }), peer({ addr: 'c:1', country: 'US' })]).rows.map((r) => r.country)).toEqual(['CN', '', 'US'])
  })
  test('传输标签', () => {
    expect(transportLabel('tcp')).toBe('TCP')
    expect(transportLabel('utp')).toBe('uTP')
    expect(transportLabel('socks')).toBe('SOCKS')
  })
})

describe('layout', () => {
  test('tracker 版式阈值', () => {
    expect(trackerLayout(0)).toBe('card')
    expect(trackerLayout(559)).toBe('card')
    expect(trackerLayout(560)).toBe('table')
    expect(trackerLayout(899)).toBe('table')
    expect(trackerLayout(900)).toBe('wide')
  })
  test('peer 窄屏收起客户端 / 上传量，宽屏全列', () => {
    expect(peerLayout(320)).toBe('card')
    expect(peerLayout(600)).toBe('compact')
    expect(peerLayout(1000)).toBe('full')
    expect(peerColumns('card').includes('client')).toBe(false)
    expect(peerColumns('compact').includes('uploaded')).toBe(false)
    expect(peerColumns('compact').includes('client')).toBe(false)
    expect(peerColumns('full')).toEqual(['addr', 'client', 'transport', 'downloaded', 'uploaded', 'downBps', 'upBps'])
  })
  test('URL 中间省略拆分', () => {
    expect(splitMiddle('udp://short/announce')).toEqual({ head: 'udp://short/announce', tail: '' })
    const url = `https://tracker.example.com/${'x'.repeat(80)}?passkey=abcdef`
    const { head, tail } = splitMiddle(url)
    expect(head + tail).toBe(url)
    expect(tail).toHaveLength(18)
  })
})

describe('peers empty state', () => {
  test('运行中 / 做种 → 空；其余 → 闲置提示', () => {
    expect(peersEmptyKey('downloading', false)).toBe('btPeersEmpty')
    expect(peersEmptyKey('completed', true)).toBe('btPeersEmpty')
    expect(peersEmptyKey('paused', false)).toBe('btPeersIdleHint')
    expect(peersEmptyKey('pending', false)).toBe('btPeersIdleHint')
    expect(peersEmptyKey('failed', false)).toBe('btPeersIdleHint')
  })
})
