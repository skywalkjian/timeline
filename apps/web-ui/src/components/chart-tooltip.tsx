/* Shared floating tooltip for all interactive charts. */

import type { TooltipDatum } from '../lib/chart-model'

export function ChartTooltip(props: { tooltip: TooltipDatum | null }) {
  if (!props.tooltip) {
    return null
  }

  return (
    <div
      className="chart-tooltip"
      style={{
        left: `${props.tooltip.x + 14}px`,
        top: `${props.tooltip.y + 14}px`,
        borderColor: props.tooltip.color,
      }}
    >
      <strong>{props.tooltip.title}</strong>
      {props.tooltip.lines.map((line, index) => (
        <span key={`${index}-${line}`}>{line}</span>
      ))}
    </div>
  )
}
