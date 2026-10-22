// 任务表行的小件组件：数值元信息单元格与树轨。

import { cn } from '../../../lib/cn'
import { CELL_PADDING_X, TREE_CHEVRON, TREE_INDENT } from './rowMetrics'

export function Meta({
  children,
  numeric,
  tertiary,
  success,
}: {
  children: string
  numeric: boolean
  tertiary?: boolean
  success?: boolean
}) {
  return (
    <div
      className={cn(
        'min-w-0 truncate text-xs',
        numeric && 'tabular text-right',
        success ? 'text-success' : tertiary ? 'text-text-tertiary' : 'text-muted-foreground',
      )}
    >
      {children}
    </div>
  )
}

/** 树轨：每级缩进的 chevron 中线处一条细竖线（贯穿整行高，需放在 `relative` 且拉伸到行高的单元格内）。 */
export function TreeRails({ depth }: { depth: number }) {
  return Array.from({ length: depth }, (_, level) => (
    <span
      key={level}
      aria-hidden
      className="pointer-events-none absolute inset-y-0 w-px bg-hairline"
      style={{ left: CELL_PADDING_X + level * TREE_INDENT + TREE_CHEVRON / 2 }}
    />
  ))
}
