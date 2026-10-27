// 云端暂存（分享面板 / 我的分享共用）：转换（保留期档位选择）、上传进度行、云端状态、删除云端副本。
// 上传在 agent 内进行；进度经全量 `shareChanged` 下发（约 2 次 / 秒），这里只读 `share.upload`。

import { CloudOff, CloudUpload, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { useT } from '../../i18n'
import type { TFunction } from '../../i18n'
import { rpc } from '../../lib/rpc'
import type { ShareDto, ShareTierDto } from '../../lib/rpc'
import { ActionMenu, Badge, Button, ProgressBar, Tooltip, confirmDialog, toast } from '../../ui'
import type { MenuEntry } from '../../ui'
import { accountErrorKey } from '../settings/sections/account/errorText'
import { formatBytes } from '../downloads/dialogs/utils'
import {
  CLOUD_STATE_KEYS,
  canDeleteCloudCopy,
  cloudConvertAvailability,
  cloudRetryTierId,
  reasonTextKey,
  retentionTiers,
  shareDisplayStatus,
  tierLabel,
  uploadPercent,
  uploadProgressText,
} from './model'
import { useShareSignedIn, useShareState } from './state'

/** 转换 / 删除；错误按类型化 reason 以 toast 呈现。 */
function useCloudActions(share: ShareDto) {
  const t = useT()
  const [busy, setBusy] = useState(false)

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await action()
    } catch (error) {
      toast.error(t(accountErrorKey(error)))
    } finally {
      setBusy(false)
    }
  }

  return {
    busy,
    convert: (tierId?: string) => run(() => rpc.agent.share.convertToCloud({ id: share.id, tierId })),
    remove: async () => {
      if (share.cloudState === 'ready') {
        const ok = await confirmDialog({
          title: t('shareCloudDelete'),
          description: t('shareCloudDeleteConfirm'),
          okLabel: t('shareCloudDelete'),
          intent: 'destructive',
        })
        if (!ok) return
      }
      await run(() => rpc.agent.share.deleteCloudCopy(share.id))
    },
  }
}

/** 云端状态角标（上传中 / 云端就绪 / 已删除）；没有云端副本不渲染。 */
export function CloudStateBadge({ share }: { share: Pick<ShareDto, 'cloudState' | 'upload'> }) {
  const t = useT()
  const key = CLOUD_STATE_KEYS[share.cloudState]
  if (key === null) return null
  const text = share.cloudState === 'uploading' && share.upload ? `${t(key)} ${uploadPercent(share.upload)}%` : t(key)
  return <Badge tone={share.cloudState === 'ready' ? 'success' : share.cloudState === 'uploading' ? 'accent' : 'neutral'}>{text}</Badge>
}

/** 「转为云端暂存」入口的菜单条目：每个保留期档位一项。 */
function convertEntries(t: TFunction, tiers: readonly ShareTierDto[], convert: (tierId?: string) => Promise<void>): MenuEntry[] {
  return tiers.map((tier) => ({
    type: 'item' as const,
    key: tier.id,
    label: tierLabel(t, tier),
    onSelect: () => void convert(tier.id),
  }))
}

/** 行内操作（我的分享）：转为云端暂存（选档位）/ 删除云端副本。 */
export function CloudRowActions({ share, nowMs }: { share: ShareDto; nowMs: number }) {
  const t = useT()
  const { policySummary } = useShareState()
  const signedIn = useShareSignedIn()
  const { busy, convert, remove } = useCloudActions(share)
  const availability = cloudConvertAvailability({ share, displayStatus: shareDisplayStatus(share, nowMs), policy: policySummary, signedIn })
  const tiers = retentionTiers(policySummary)

  return (
    <>
      {availability.kind === 'enabled' ? (
        <ActionMenu
          title={t('shareCloudConvert')}
          entries={convertEntries(t, tiers, convert)}
          trigger={
            <Button variant="ghost" iconOnly aria-label={t('shareCloudConvert')} title={t('shareCloudConvert')} disabled={busy} loading={busy}>
              <CloudUpload className="size-4" />
            </Button>
          }
        />
      ) : availability.kind === 'disabled' ? (
        <Tooltip content={t(availability.reasonKey)}>
          <span>
            <Button variant="ghost" iconOnly aria-label={t('shareCloudConvert')} disabled>
              <CloudUpload className="size-4" />
            </Button>
          </span>
        </Tooltip>
      ) : null}
      {canDeleteCloudCopy(share) ? (
        <Tooltip content={t(share.cloudState === 'uploading' ? 'shareCloudCancelUpload' : 'shareCloudDelete')}>
          <Button
            variant="ghost"
            iconOnly
            aria-label={t(share.cloudState === 'uploading' ? 'shareCloudCancelUpload' : 'shareCloudDelete')}
            className="text-destructive"
            loading={busy}
            onClick={() => void remove()}
          >
            <CloudOff className="size-4" />
          </Button>
        </Tooltip>
      ) : null}
    </>
  )
}

/** 分享面板里的云端暂存区块：状态、上传进度行（暂停 / 失败带原因与重试）、转换 / 删除按钮。 */
export function CloudSection({ share, nowMs }: { share: ShareDto; nowMs: number }) {
  const t = useT()
  const { policySummary } = useShareState()
  const signedIn = useShareSignedIn()
  const { busy, convert, remove } = useCloudActions(share)
  const tiers = retentionTiers(policySummary)
  const availability = cloudConvertAvailability({ share, displayStatus: shareDisplayStatus(share, nowMs), policy: policySummary, signedIn })
  const upload = share.upload
  const reasonKey = upload?.status === 'failed' || upload?.status === 'paused' ? reasonTextKey(upload.reason) : null

  if (availability.kind === 'hidden' && share.cloudState === 'none') return null
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-md border border-hairline p-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-foreground">{t('shareCloudTitle')}</span>
        <CloudStateBadge share={share} />
        {share.cloudState === 'ready' && share.cloudBytes > 0 ? <span className="tabular text-xs text-text-tertiary">{formatBytes(share.cloudBytes)}</span> : null}
      </div>

      {upload ? (
        <div className="flex min-w-0 flex-col gap-1">
          <ProgressBar value={upload.totalBytes > 0 ? uploadPercent(upload) / 100 : null} />
          <div className="tabular break-words text-xs text-muted-foreground">{uploadProgressText(t, upload)}</div>
          {reasonKey !== null ? <div className="break-words text-xs text-destructive">{t(reasonKey)}</div> : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {availability.kind === 'enabled' ? (
          <ActionMenu
            title={t('shareCloudConvert')}
            entries={convertEntries(t, tiers, convert)}
            trigger={
              <Button variant="outline" icon={CloudUpload} loading={busy} disabled={busy}>
                {t('shareCloudConvert')}
              </Button>
            }
          />
        ) : availability.kind === 'disabled' ? (
          <Tooltip content={t(availability.reasonKey)}>
            <span>
              <Button variant="outline" icon={CloudUpload} disabled>
                {t('shareCloudConvert')}
              </Button>
            </span>
          </Tooltip>
        ) : null}
        {upload?.status === 'failed' ? (
          <Button variant="outline" icon={RotateCcw} loading={busy} disabled={busy} onClick={() => void convert(cloudRetryTierId(share, tiers))}>
            {t('shareCloudRetry')}
          </Button>
        ) : null}
        {canDeleteCloudCopy(share) ? (
          <Button variant="ghost" icon={CloudOff} className="text-destructive" loading={busy} onClick={() => void remove()}>
            {t(share.cloudState === 'uploading' ? 'shareCloudCancelUpload' : 'shareCloudDelete')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
