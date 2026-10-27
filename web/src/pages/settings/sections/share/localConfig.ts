// 快传本机设置（`ShareLocalConfigDto`）的纯解析与串行写回。
// `agent.share.setLocalConfig` 是整体替换：每次提交都以最新快照里的设置为底稿叠加补丁；连续编辑合并后串行发送，
// 上一次的规范化结果作为下一次的底稿，避免两次写互相覆盖。

import { rpc, rpcStore } from '../../../../lib/rpc'
import type { ShareLocalConfigDto } from '../../../../lib/rpc'
import { toast } from '../../../../ui'
import { t } from '../../../../i18n'
import { EMPTY_LOCAL_CONFIG } from '../../../share/state'
import { accountErrorKey } from '../account/errorText'

/** 端口输入：空 = 自动（`null`）；1..=65535 为端口；其余无效（`undefined`，调用方保持原值）。 */
export function parsePort(text: string): number | null | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return null
  if (!/^\d{1,5}$/.test(trimmed)) return undefined
  const port = Number.parseInt(trimmed, 10)
  return port >= 1 && port <= 65535 ? port : undefined
}

/** 额外公布地址：逗号 / 空白 / 换行分隔，去重去空。 */
export function parseAddrList(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).filter((part) => part !== ''))]
}

export function formatAddrList(addrs: readonly string[]): string {
  return addrs.join(', ')
}

const MIB = 1024 * 1024

/** 发送限速：界面用 MiB/s（0 = 不限），wire 用字节 / 秒（`null` = 不限）。 */
export function rateToWire(mibPerSec: number): number | null {
  return Number.isFinite(mibPerSec) && mibPerSec > 0 ? Math.round(mibPerSec * MIB) : null
}

export function rateFromWire(bytesPerSec: number | null): number {
  return bytesPerSec === null || bytesPerSec <= 0 ? 0 : bytesPerSec / MIB
}

/** portmapper 三态：`null` = 自动（跟随云端默认）。 */
export type PortmapperChoice = 'auto' | 'on' | 'off'

export function portmapperChoice(value: boolean | null): PortmapperChoice {
  return value === null ? 'auto' : value ? 'on' : 'off'
}

export function portmapperWire(choice: PortmapperChoice): boolean | null {
  return choice === 'auto' ? null : choice === 'on'
}

const currentConfig = (): ShareLocalConfigDto => rpcStore.peek().snapshot?.share?.localConfig ?? EMPTY_LOCAL_CONFIG

let pending: Partial<ShareLocalConfigDto> = {}
let running: Promise<void> | null = null

async function flush(): Promise<void> {
  let base = currentConfig()
  while (Object.keys(pending).length > 0) {
    const patch = pending
    pending = {}
    try {
      base = await rpc.agent.share.setLocalConfig({ ...base, ...patch })
    } catch (error) {
      pending = {}
      toast.error(t(accountErrorKey(error)))
      return
    }
  }
}

/** 提交本机设置补丁（按字段合并、串行写回）；失败 toast，后续补丁丢弃以免在旧底稿上继续写。 */
export function saveLocalConfig(patch: Partial<ShareLocalConfigDto>): Promise<void> {
  pending = { ...pending, ...patch }
  if (running) return running
  running = flush().finally(() => {
    running = null
  })
  return running
}
