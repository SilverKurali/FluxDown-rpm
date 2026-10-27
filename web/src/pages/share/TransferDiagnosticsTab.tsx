// 任务详情「传输诊断」页：快传接收任务的路径时间线、各路径 RTT / 丢包 / cwnd / 速率、对端 NAT 与运营商。
// 只在任务有快传事实（`snapshot.share.taskFacts`）时作为 tab 出现；挂载期间按 2 秒轮询该会话。

import { useT } from '../../i18n'
import { Spinner } from '../../ui'
import { canSwitchBridge } from './model'
import { SessionDetailView } from './SessionDetail'
import { SwitchBridgeButton } from './SourceBadge'
import { useShareTaskFacts } from './state'
import { useShareDiagnostics } from './useShareDiagnostics'

export function TransferDiagnosticsTab({ taskId, taskState }: { taskId: string; taskState: string }) {
  const t = useT()
  const facts = useShareTaskFacts(taskId)
  const sessionId = facts?.sessionId ?? undefined
  const { data } = useShareDiagnostics({ sessionId, enabled: sessionId !== undefined, intervalMs: 2000 })
  const detail = data?.sessions.find((session) => session.sessionId === sessionId)

  if (!facts) return null
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {facts.relayStuck ? <div className="rounded-md bg-warning/15 px-3 py-2 text-xs text-warning">{t('shareDiagRelayStuck')}</div> : null}
      {canSwitchBridge(facts, taskState) ? (
        <div>
          <SwitchBridgeButton taskId={taskId} emphasized={facts.relayStuck} />
        </div>
      ) : null}
      {detail ? (
        <SessionDetailView detail={detail} />
      ) : (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
          <Spinner size="md" />
          {t(sessionId === undefined ? 'shareDiagNoSession' : 'shareDiagLoading')}
        </div>
      )}
    </div>
  )
}
