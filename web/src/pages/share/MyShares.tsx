// 「我的分享」：文件、方式、有效期、领取次数、最近访问、状态；复制链接、二维码 / 详情（分享面板）、停止。
// 桌面为表格，窄屏为卡片。

import { Copy, QrCode, Share2, Square } from 'lucide-react'
import { useState } from 'react'
import { useT } from '../../i18n'
import type { TFunction } from '../../i18n'
import { copyText } from '../../lib/copy'
import { rpc } from '../../lib/rpc'
import type { ShareDto } from '../../lib/rpc'
import { Badge, Button, EmptyState, Tooltip, confirmDialog, toast, useIsMobile } from '../../ui'
import { accountErrorKey } from '../settings/sections/account/errorText'
import { formatBytes } from '../downloads/dialogs/utils'
import { useNowSeconds } from '../rss/useNow'
import { SHARE_STATUS_KEYS, agoLabel, dateTimeLabel, shareDisplayStatus, shareTitleText, sortShares } from './model'
import type { ShareDisplayStatus } from './model'
import { CloudRowActions, CloudStateBadge } from './CloudStorage'
import { useShares } from './state'
import { openShareDetail } from './store'

export function MyShares() {
  const t = useT()
  const mobile = useIsMobile()
  const shares = useShares()
  const nowMs = useNowSeconds() * 1000
  const ordered = sortShares(shares, nowMs)

  if (ordered.length === 0) {
    return <EmptyState icon={Share2} title={t('shareMineEmpty')} />
  }
  return mobile ? (
    <ul className="flex flex-col gap-2">
      {ordered.map((share) => (
        <ShareCard key={share.id} share={share} nowMs={nowMs} />
      ))}
    </ul>
  ) : (
    <div className="min-w-0 overflow-x-auto rounded-md border border-hairline">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className="bg-chrome text-xs text-text-tertiary">
          <tr>
            <th className="px-3 py-2 font-normal">{t('shareColFile')}</th>
            <th className="px-3 py-2 font-normal">{t('shareColMethod')}</th>
            <th className="px-3 py-2 font-normal">{t('shareColExpiry')}</th>
            <th className="px-3 py-2 font-normal">{t('shareColClaims')}</th>
            <th className="px-3 py-2 font-normal">{t('shareColLastAccess')}</th>
            <th className="px-3 py-2 font-normal">{t('shareColStatus')}</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {ordered.map((share) => (
            <ShareTableRow key={share.id} share={share} nowMs={nowMs} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function claimsText(t: TFunction, share: ShareDto): string {
  return share.maxClaims > 0
    ? t('shareClaimedOf', { count: share.claimCount, max: share.maxClaims })
    : t('shareClaimedCount', { count: share.claimCount })
}

/** 复制 / 二维码 / 停止三个行内操作。 */
function ShareActions({ share, status, nowMs }: { share: ShareDto; status: ShareDisplayStatus; nowMs: number }) {
  const t = useT()
  const [stopping, setStopping] = useState(false)
  const live = status === 'active'

  const stop = async () => {
    const ok = await confirmDialog({ title: t('shareStop'), description: t('shareStopConfirm'), okLabel: t('shareStop'), intent: 'destructive' })
    if (!ok) return
    setStopping(true)
    try {
      await rpc.agent.share.stop({ id: share.id })
    } catch (error) {
      toast.error(t(accountErrorKey(error)))
    } finally {
      setStopping(false)
    }
  }

  return (
    <div className="flex shrink-0 items-center justify-end gap-0.5">
      <Tooltip content={t('shareCopyLink')}>
        <Button
          variant="ghost"
          iconOnly
          aria-label={t('shareCopyLink')}
          disabled={!live}
          onClick={() => {
            copyText(share.url)
            toast.success(t('shareLinkCopied'))
          }}
        >
          <Copy className="size-4" />
        </Button>
      </Tooltip>
      <Tooltip content={t('shareShowQr')}>
        <Button variant="ghost" iconOnly aria-label={t('shareShowQr')} onClick={() => openShareDetail(share.id)}>
          <QrCode className="size-4" />
        </Button>
      </Tooltip>
      <CloudRowActions share={share} nowMs={nowMs} />
      {live ? (
        <Tooltip content={t('shareStop')}>
          <Button variant="ghost" iconOnly aria-label={t('shareStop')} className="text-destructive" loading={stopping} onClick={() => void stop()}>
            <Square className="size-4" />
          </Button>
        </Tooltip>
      ) : null}
    </div>
  )
}

function ShareTableRow({ share, nowMs }: { share: ShareDto; nowMs: number }) {
  const t = useT()
  const status = shareDisplayStatus(share, nowMs)
  return (
    <tr className="border-t border-hairline align-middle">
      <td className="max-w-[320px] px-3 py-2">
        <div className="truncate text-foreground" title={share.title}>
          {shareTitleText(t, share)}
        </div>
        <div className="tabular text-xs text-text-tertiary">
          {t('shareFilesCount', { count: share.files.length })} · {formatBytes(share.totalBytes)}
        </div>
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground">{t(share.mode === 'cloud' ? 'shareModeCloud' : 'shareModeLive')}</td>
      <td className="tabular px-3 py-2 text-xs text-muted-foreground">{dateTimeLabel(share.expiresAt)}</td>
      <td className="tabular px-3 py-2 text-xs text-muted-foreground">{claimsText(t, share)}</td>
      <td className="px-3 py-2 text-xs text-muted-foreground">
        {share.lastAccessedAt === null ? t('shareNever') : agoLabel(t, share.lastAccessedAt, nowMs)}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-1">
          <Badge tone={status === 'active' ? 'success' : 'neutral'}>{t(SHARE_STATUS_KEYS[status])}</Badge>
          <CloudStateBadge share={share} />
        </div>
      </td>
      <td className="px-2 py-1">
        <ShareActions share={share} status={status} nowMs={nowMs} />
      </td>
    </tr>
  )
}

function ShareCard({ share, nowMs }: { share: ShareDto; nowMs: number }) {
  const t = useT()
  const status = shareDisplayStatus(share, nowMs)
  return (
    <li className="flex min-w-0 flex-col gap-1.5 rounded-md border border-hairline bg-surface p-3">
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="break-words text-sm text-foreground" title={share.title}>
            {shareTitleText(t, share)}
          </div>
          <div className="tabular text-xs text-text-tertiary">
            {t('shareFilesCount', { count: share.files.length })} · {formatBytes(share.totalBytes)}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge tone={status === 'active' ? 'success' : 'neutral'}>{t(SHARE_STATUS_KEYS[status])}</Badge>
          <CloudStateBadge share={share} />
        </div>
      </div>
      <div className="tabular flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <span>{t(share.mode === 'cloud' ? 'shareModeCloud' : 'shareModeLive')}</span>
        <span>{t('shareExpiresAt', { time: dateTimeLabel(share.expiresAt) })}</span>
        <span>{claimsText(t, share)}</span>
        <span>
          {t('shareColLastAccess')}: {share.lastAccessedAt === null ? t('shareNever') : agoLabel(t, share.lastAccessedAt, nowMs)}
        </span>
      </div>
      <ShareActions share={share} status={status} nowMs={nowMs} />
    </li>
  )
}
