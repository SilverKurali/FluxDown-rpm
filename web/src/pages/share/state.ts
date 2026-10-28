// FluxMesh状态选择器：全部从 `AgentSnapshot.share` 派生（`shareChanged` 整段替换、`shareProgress` 按会话刷新）。

import { CAPABILITY_AGENT_SHARE, useAgent, useRpcSelector } from '../../lib/rpc'
import type {
  ShareDto,
  ShareLocalConfigDto,
  ShareNetStatusDto,
  SharePolicySummaryDto,
  ShareReceiveRecordDto,
  ShareResolveDto,
  ShareStateDto,
  ShareTaskFactsDto,
} from '../../lib/rpc'
import type { RpcState } from '../../lib/rpc'

export const EMPTY_LOCAL_CONFIG: ShareLocalConfigDto = {
  udpPortV4: null,
  udpPortV6: null,
  portmapper: null,
  extraAddrs: [],
  mode: 'auto',
  pinnedRelay: null,
  sendRateLimitBytesPerSec: null,
  exitBehavior: 'prompt',
  irohLogLevel: 'warn',
  defaultTierId: null,
  defaultMaxClaims: 0,
  defaultNotifyOnClaim: true,
  defaultSwarm: null,
  autoProvide: null,
}

const EMPTY_POLICY: SharePolicySummaryDto = {
  enabled: false,
  guestReceive: false,
  guestBridge: false,
  guestShare: false,
  pickupCodeLength: 6,
  liveTiers: [],
  retentionTiers: [],
  cloudEnabled: false,
  relays: [],
  holePunchHintSecs: 0,
}

const EMPTY_NET: ShareNetStatusDto = {
  bound: false,
  online: false,
  endpointId: null,
  homeRelay: null,
  natType: 'unknown',
  isp: null,
  province: null,
  ipv6: false,
  relayLatencyMs: {},
}

/** 旧快照 / 未编入FluxMesh：`available = false`，全部入口隐藏。 */
export const EMPTY_SHARE: ShareStateDto = {
  enabled: false,
  available: false,
  canSend: false,
  localConfig: EMPTY_LOCAL_CONFIG,
  policySummary: EMPTY_POLICY,
  shares: [],
  netStatus: EMPTY_NET,
  taskFacts: {},
  receiveRecords: [],
  pendingReceive: null,
}

const selectShare = (snapshot: { share?: ShareStateDto }): ShareStateDto => snapshot.share ?? EMPTY_SHARE

/** FluxMesh分区完整状态。 */
export function useShareState(): ShareStateDto {
  return useAgent(selectShare, EMPTY_SHARE)
}

const selectCapability = (state: RpcState): boolean => state.hello?.capabilities.includes(CAPABILITY_AGENT_SHARE) ?? false

/** agent 编入FluxMesh（hello 带 `agent.share`）。 */
export function useShareCapability(): boolean {
  return useRpcSelector(selectCapability)
}

/** FluxMesh入口是否可见：能力存在且服务可用（`available`）。 */
export function useShareAvailable(): boolean {
  const capability = useShareCapability()
  const available = useAgent((snapshot) => snapshot.share?.available === true, false)
  return capability && available
}

/** 本机当前可发起分享（已登录或云端允许游客发起）。 */
export function useShareCanSend(): boolean {
  const available = useShareAvailable()
  const canSend = useAgent((snapshot) => snapshot.share?.canSend === true, false)
  return available && canSend
}

/** 本机已登录账号（转为云端暂存需要登录；游客不可）。 */
export function useShareSignedIn(): boolean {
  return useAgent((snapshot) => snapshot.session !== null, false)
}

const EMPTY_SHARES: readonly ShareDto[] = []
export function useShares(): readonly ShareDto[] {
  return useAgent((snapshot) => snapshot.share?.shares ?? EMPTY_SHARES, EMPTY_SHARES)
}

export function useShareById(id: string | null): ShareDto | undefined {
  return useAgent((snapshot) => (id === null ? undefined : snapshot.share?.shares.find((share) => share.id === id)), undefined)
}

export function useShareTaskFacts(taskId: string): ShareTaskFactsDto | undefined {
  return useAgent((snapshot) => snapshot.share?.taskFacts[taskId], undefined)
}

const EMPTY_RECORDS: readonly ShareReceiveRecordDto[] = []
export function useShareRecords(): readonly ShareReceiveRecordDto[] {
  return useAgent((snapshot) => snapshot.share?.receiveRecords ?? EMPTY_RECORDS, EMPTY_RECORDS)
}

/** 链接 / 深链打开后 agent 已解析、等待确认的接收预览。 */
export function usePendingReceive(): ShareResolveDto | null {
  return useAgent((snapshot) => snapshot.share?.pendingReceive ?? null, null)
}
