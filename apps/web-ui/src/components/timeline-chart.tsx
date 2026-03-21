/* Interactive 24-hour timeline chart with focus, domain, and presence lanes. */

import type { MouseEvent } from 'react'
import {
  formatClockRange,
  formatDuration,
  isFilterActive,
  type ChartSegment,
  type DashboardFilter,
  type TooltipDatum,
} from '../lib/chart-model'

const DAY_SECONDS = 24 * 60 * 60

type TimelineRow = {
  id: string
  label: string
  filterKind?: 'app' | 'domain'
  segments: ChartSegment[]
}

export function TimelineChart(props: {
  rows: TimelineRow[]
  filter: DashboardFilter
  onHover: (tooltip: TooltipDatum | null) => void
}) {
  return (
    <div className="timeline-chart">
      <div className="timeline-scale">
        <span className="timeline-scale-label" />
        <div className="timeline-scale-track">
          {Array.from({ length: 13 }).map((_, index) => {
            const hour = index * 2
            return <span key={hour}>{`${`${hour}`.padStart(2, '0')}:00`}</span>
          })}
        </div>
      </div>

      {props.rows.map((row) => (
        <div key={row.id} className="timeline-row">
          <div className="timeline-row-meta">
            <strong>{row.label}</strong>
            <span>{row.segments.length}</span>
          </div>

          <div className="timeline-lane">
            {row.segments.length === 0 ? <p className="empty-inline">没有数据</p> : null}

            {row.segments.map((segment) => {
              const shouldDim =
                row.filterKind !== undefined &&
                props.filter?.kind === row.filterKind &&
                !isFilterActive(props.filter, row.filterKind, segment.key)

              return (
                <button
                  key={segment.id}
                  type="button"
                  className={`timeline-segment ${shouldDim ? 'is-dimmed' : ''}`}
                  style={{
                    left: `${(segment.startSec / DAY_SECONDS) * 100}%`,
                    width: `${Math.max(
                      ((segment.endSec - segment.startSec) / DAY_SECONDS) * 100,
                      0.36,
                    )}%`,
                    backgroundColor: segment.color,
                  }}
                  onMouseEnter={(event) => {
                    props.onHover(buildTooltip(event, segment))
                  }}
                  onMouseMove={(event) => {
                    props.onHover(buildTooltip(event, segment))
                  }}
                  onMouseLeave={() => {
                    props.onHover(null)
                  }}
                  title={segment.label}
                >
                  <span>{segment.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function buildTooltip(
  event: MouseEvent<HTMLButtonElement>,
  segment: ChartSegment,
): TooltipDatum {
  return {
    x: event.clientX,
    y: event.clientY,
    color: segment.color,
    title: segment.label,
    lines: [
      segment.detail,
      formatClockRange(segment.startSec, segment.endSec),
      formatDuration(segment.durationSec),
    ],
  }
}
