// 「接收记录」：分享方、文件数与大小、开始时间、状态。快照只带最近 20 条，其余经 `agent.share.receiveRecords` 翻页。

import { Download } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useT } from '../../i18n'
import { rpc } from '../../lib/rpc'
import type { ShareReceiveRecordDto } from '../../lib/rpc'
import { Badge, Button, EmptyState, toast, useIsMobile } from '../../ui'
import { accountErrorKey } from '../settings/sections/account/errorText'
import { formatBytes } from '../downloads/dialogs/utils'
import { RECEIVE_STATUS_KEYS, dateTimeLabel, mergeReceiveRecords } from './model'
import { useShareRecords } from './state'

const PAGE = 20

const statusTone = (status: ShareReceiveRecordDto['status']) => (status === 'completed' ? 'success' : status === 'failed' ? 'destructive' : 'accent')

interface Paging {
  records: readonly ShareReceiveRecordDto[]
  cursor: string | null
  loading: boolean
}

export function ReceiveRecords() {
  const t = useT()
  const mobile = useIsMobile()
  const live = useShareRecords()
  const [paging, setPaging] = useState<Paging>({ records: [], cursor: null, loading: true })

  // 打开页签时取第一页：既拿到 `nextCursor`，也补上快照之外的更早记录。
  useEffect(() => {
    let cancelled = false
    rpc.agent.share
      .receiveRecords({ limit: PAGE })
      .then((page) => {
        if (!cancelled) setPaging({ records: page.records, cursor: page.nextCursor, loading: false })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setPaging((previous) => ({ ...previous, loading: false }))
        toast.error(t(accountErrorKey(error)))
      })
    return () => {
      cancelled = true
    }
  }, [t])

  const loadMore = async () => {
    if (paging.cursor === null) return
    setPaging((previous) => ({ ...previous, loading: true }))
    try {
      const page = await rpc.agent.share.receiveRecords({ limit: PAGE, cursor: paging.cursor })
      setPaging((previous) => ({ records: [...previous.records, ...page.records], cursor: page.nextCursor, loading: false }))
    } catch (error) {
      setPaging((previous) => ({ ...previous, loading: false }))
      toast.error(t(accountErrorKey(error)))
    }
  }

  const records = mergeReceiveRecords(live, paging.records)
  if (records.length === 0) {
    return <EmptyState icon={Download} title={t('shareReceivedEmpty')} />
  }

  return (
    <div className="flex flex-col gap-3">
      {mobile ? (
        <ul className="flex flex-col gap-2">
          {records.map((record) => (
            <li key={record.id} className="flex min-w-0 flex-col gap-1 rounded-md border border-hairline bg-surface p-3">
              <div className="flex min-w-0 items-start gap-2">
                <span className="min-w-0 flex-1 break-words text-sm text-foreground">{record.title}</span>
                <Badge tone={statusTone(record.status)}>{t(RECEIVE_STATUS_KEYS[record.status])}</Badge>
              </div>
              <div className="tabular text-xs text-muted-foreground">
                {record.senderDeviceName === '' ? t('shareSenderUnknown') : record.senderDeviceName} · {t('shareFilesCount', { count: record.fileCount })} ·{' '}
                {formatBytes(record.totalBytes)}
              </div>
              <div className="tabular text-xs text-text-tertiary">{dateTimeLabel(record.startedAt)}</div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="min-w-0 overflow-x-auto rounded-md border border-hairline">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-chrome text-xs text-text-tertiary">
              <tr>
                <th className="px-3 py-2 font-normal">{t('shareColFile')}</th>
                <th className="px-3 py-2 font-normal">{t('shareColSender')}</th>
                <th className="px-3 py-2 font-normal">{t('shareColSize')}</th>
                <th className="px-3 py-2 font-normal">{t('shareColStarted')}</th>
                <th className="px-3 py-2 font-normal">{t('shareColStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id} className="border-t border-hairline">
                  <td className="max-w-[320px] px-3 py-2">
                    <div className="truncate text-foreground" title={record.title}>
                      {record.title}
                    </div>
                    <div className="text-xs text-text-tertiary">{t('shareFilesCount', { count: record.fileCount })}</div>
                  </td>
                  <td className="max-w-[200px] truncate px-3 py-2 text-xs text-muted-foreground" title={record.senderDeviceName}>
                    {record.senderDeviceName === '' ? t('shareSenderUnknown') : record.senderDeviceName}
                  </td>
                  <td className="tabular px-3 py-2 text-xs text-muted-foreground">{formatBytes(record.totalBytes)}</td>
                  <td className="tabular px-3 py-2 text-xs text-muted-foreground">{dateTimeLabel(record.startedAt)}</td>
                  <td className="px-3 py-2">
                    <Badge tone={statusTone(record.status)}>{t(RECEIVE_STATUS_KEYS[record.status])}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {paging.cursor !== null ? (
        <div className="flex justify-center">
          <Button loading={paging.loading} onClick={() => void loadMore()}>
            {t('shareLoadMore')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
