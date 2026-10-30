import { Radio } from 'lucide-react'
import { useT } from '../../../i18n'
import { cn } from '../../../lib/cn'
import { ContextMenuArea, EmptyState, RevealCallout } from '../../../ui'
import type { Translate } from '../table/text'
import { copyEntry, PollError, RowCopyButton, SkeletonRows, useMeasuredRoot, useNowSecs } from './btParts'
import {
  lastOkText,
  mapTrackerRows,
  nextAnnounceText,
  showNoneWorking,
  splitMiddle,
  TRACKER_DOT,
  TRACKER_TEXT,
  trackerLayout,
  trackerStatusKey,
} from './btStatus'
import type { TrackerLayout, TrackerRow } from './btStatus'
import type { BtTrackerStatus } from '../../../lib/rpc'
import { useBtStatus } from './useBtStatus'

const DASH = '—'

const GRID: Record<Exclude<TrackerLayout, 'card'>, string> = {
  table: 'grid-cols-[minmax(7.5rem,9.5rem)_minmax(0,1fr)_3.25rem_6rem_6.5rem]',
  wide: 'grid-cols-[minmax(7.5rem,9.5rem)_minmax(0,1.4fr)_3.25rem_minmax(0,1fr)_6rem_6.5rem]',
}

function StatusCell({ status, label }: { status: BtTrackerStatus; label: string }) {
  return (
    <span className={cn('flex min-w-0 items-center gap-1.5 text-xs font-medium', TRACKER_TEXT[status])}>
      <span aria-hidden className={cn('size-2 shrink-0 rounded-full', TRACKER_DOT[status])} />
      <span className="truncate">{label}</span>
    </span>
  )
}

/** URL：头部按宽度截断、尾部固定，视觉上是中间省略；文本仍连续可选。 */
function UrlText({ url }: { url: string }) {
  const { head, tail } = splitMiddle(url)
  return (
    <span title={url} className="flex min-w-0 font-mono text-xs text-foreground">
      <span className="min-w-0 truncate whitespace-pre">{head}</span>
      {tail === '' ? null : <span className="shrink-0 whitespace-pre">{tail}</span>}
    </span>
  )
}

function SourceChip({ t, source }: { t: Translate; source: TrackerRow['source'] }) {
  return (
    <span className="shrink-0 rounded-sm bg-muted px-1.5 py-px text-caption text-text-tertiary">
      {t(source === 'torrent' ? 'btTrackerSourceTorrent' : 'btTrackerSourceSession')}
    </span>
  )
}

function Row({ row, layout, t, now }: { row: TrackerRow; layout: TrackerLayout; t: Translate; now: number }) {
  const status = t(trackerStatusKey(row.status))
  const peers = row.peers === null ? DASH : String(row.peers)
  const next = nextAnnounceText(t, row.nextAnnounceAt, now) ?? DASH
  const last = lastOkText(t, row.lastOkAt, now)
  const message = row.message
  const messageLine =
    message === '' ? null : (
      <span title={message} className={cn('block truncate text-xs', row.status === 'notWorking' ? 'text-destructive' : 'text-muted-foreground')}>
        {message}
      </span>
    )
  const menu = [copyEntry(t('btCopyTrackerUrl'), row.url, 'urlCopied', t)]

  if (layout === 'card') {
    return (
      <ContextMenuArea entries={menu} title={row.url} className="group/row border-b border-hairline px-1 py-2 hover:bg-row-hover">
        <div className="flex items-center gap-2">
          <StatusCell status={row.status} label={status} />
          <SourceChip t={t} source={row.source} />
          <span className="tabular ml-auto shrink-0 text-xs text-muted-foreground">{peers}</span>
          <RowCopyButton label={t('btCopyTrackerUrl')} value={row.url} doneKey="urlCopied" />
        </div>
        <div className="mt-1 flex">
          <UrlText url={row.url} />
        </div>
        {messageLine ? <div className="mt-0.5">{messageLine}</div> : null}
        <div className="tabular mt-1 flex flex-wrap gap-x-3 text-xs text-text-tertiary">
          <span>
            {t('btTrackerNextAnnounce')}: {next}
          </span>
          <span>
            {t('btTrackerLastOk')}: {last}
          </span>
        </div>
      </ContextMenuArea>
    )
  }

  return (
    <ContextMenuArea entries={menu} title={row.url} className="group/row border-b border-hairline hover:bg-row-hover">
      <div className={cn('grid items-center gap-x-3 px-1 py-1.5', GRID[layout])}>
        <StatusCell status={row.status} label={status} />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <UrlText url={row.url} />
            <SourceChip t={t} source={row.source} />
            <RowCopyButton label={t('btCopyTrackerUrl')} value={row.url} doneKey="urlCopied" />
          </div>
          {layout === 'table' ? messageLine : null}
        </div>
        <span className="tabular text-right text-xs text-muted-foreground">{peers}</span>
        {layout === 'wide' ? <div className="min-w-0">{messageLine}</div> : null}
        <span className="tabular truncate text-xs text-muted-foreground">{next}</span>
        <span className="tabular truncate text-xs text-muted-foreground">{last}</span>
      </div>
    </ContextMenuArea>
  )
}

function Header({ layout, t }: { layout: Exclude<TrackerLayout, 'card'>; t: Translate }) {
  return (
    <div className={cn('grid gap-x-3 border-b border-hairline px-1 pb-1 text-xs text-text-tertiary', GRID[layout])}>
      <span>{t('btTrackerStatus')}</span>
      <span>{t('btTrackerUrl')}</span>
      <span className="text-right">{t('btTrackerPeers')}</span>
      {layout === 'wide' ? <span>{t('btTrackerMessage')}</span> : null}
      <span>{t('btTrackerNextAnnounce')}</span>
      <span>{t('btTrackerLastOk')}</span>
    </div>
  )
}

function DhtRow({ enabled, layout, t }: { enabled: boolean; layout: TrackerLayout; t: Translate }) {
  const status: BtTrackerStatus = enabled ? 'working' : 'notContacted'
  const label = t(enabled ? 'btTrackerDhtOn' : 'btTrackerDhtOff')
  if (layout === 'card') {
    return (
      <div className="flex items-center gap-2 border-b border-hairline px-1 py-2">
        <StatusCell status={status} label={label} />
        <span className="ml-auto font-mono text-xs text-muted-foreground">{t('btTrackerDht')}</span>
      </div>
    )
  }
  return (
    <div className={cn('grid items-center gap-x-3 border-b border-hairline px-1 py-1.5', GRID[layout])}>
      <StatusCell status={status} label={label} />
      <span className="font-mono text-xs text-muted-foreground">{t('btTrackerDht')}</span>
    </div>
  )
}

export function BtTrackersTab({ taskId }: { taskId: string }) {
  const t = useT()
  const { data, error } = useBtStatus(taskId)
  const now = useNowSecs()
  const { ref, width } = useMeasuredRoot()
  const layout = trackerLayout(width)
  const rows = data ? mapTrackerRows(data.trackers) : []
  const warn = data !== null && showNoneWorking(data.trackers)

  return (
    <div ref={ref} className="flex flex-col gap-2">
      <RevealCallout visible={warn} tone="warning" title={t('btTabTrackers')} body={t('btTrackersNoneWorking')} contentClassName="" />
      <PollError message={error} />
      {data === null ? (
        error === null ? <SkeletonRows /> : null
      ) : (
        <div className="flex flex-col">
          {layout === 'card' ? null : <Header layout={layout} t={t} />}
          <DhtRow enabled={data.dhtEnabled} layout={layout} t={t} />
          {rows.length === 0 ? (
            <EmptyState icon={Radio} title={t('btTrackersEmpty')} className="py-6" />
          ) : (
            rows.map((row) => <Row key={row.key} row={row} layout={layout} t={t} now={now} />)
          )}
        </div>
      )}
    </div>
  )
}
