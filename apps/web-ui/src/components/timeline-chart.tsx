/* Interactive zoomable timeline chart with selectable focus and detail rows. */

import type { MouseEvent } from 'react'
import {
  formatClockRange,
  formatDuration,
  type ChartSegment,
  type TooltipDatum,
} from '../lib/chart-model'

type TimelineRow = {
  id: string
  label: string
  segments: ChartSegment[]
  selectedKey?: string | null
}

export function TimelineChart(props: {
  rows: TimelineRow[]
  viewStartSec: number
  viewEndSec: number
  selectedSegmentId?: string | null
  onHover: (tooltip: TooltipDatum | null) => void
  onSelectSegment?: (segment: ChartSegment) => void
}) {
  const visibleDuration = Math.max(props.viewEndSec - props.viewStartSec, 1)
  const tickHours = buildTicks(props.viewStartSec, props.viewEndSec)
  const visibleHours = Math.max(visibleDuration / 3600, 1)

  return (
    <div className="timeline-chart">
      <div className="timeline-scale">
        <span className="timeline-scale-label" />
        <div className="timeline-scale-track">
          {tickHours.map((hour) => (
            <span key={hour.position}>{hour.label}</span>
          ))}
        </div>
      </div>

      {props.rows.map((row) => (
        <div key={row.id} className="timeline-row">
          <div className="timeline-row-meta">
            <strong>{row.label}</strong>
            <span>{row.segments.length}</span>
          </div>

          <div
            className="timeline-lane"
            style={{
              backgroundSize: `calc(100% / ${visibleHours}) 100%, 100% 100%`,
            }}
          >
            {row.segments.length === 0 ? <p className="empty-inline">没有数据</p> : null}

            {row.segments.map((segment) => {
              const visibleSegment = clipToViewport(
                segment,
                props.viewStartSec,
                props.viewEndSec,
              )
              if (!visibleSegment) {
                return null
              }

              const shouldDim =
                row.selectedKey !== null &&
                row.selectedKey !== undefined &&
                row.selectedKey !== segment.key
              const isSelected = props.selectedSegmentId === segment.id

              return (
                <button
                  key={segment.id}
                  type="button"
                  className={`timeline-segment ${shouldDim ? 'is-dimmed' : ''} ${
                    isSelected ? 'is-selected' : ''
                  }`}
                  style={{
                    left: `${((visibleSegment.startSec - props.viewStartSec) / visibleDuration) * 100}%`,
                    width: `${Math.max(
                      ((visibleSegment.endSec - visibleSegment.startSec) / visibleDuration) *
                        100,
                      0.5,
                    )}%`,
                    backgroundColor: segment.color,
                  }}
                  onMouseEnter={(event) => {
                    props.onHover(buildTooltip(event, visibleSegment))
                  }}
                  onMouseMove={(event) => {
                    props.onHover(buildTooltip(event, visibleSegment))
                  }}
                  onMouseLeave={() => {
                    props.onHover(null)
                  }}
                  onClick={() => {
                    props.onSelectSegment?.(segment)
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

function clipToViewport(segment: ChartSegment, viewStartSec: number, viewEndSec: number) {
  const startSec = Math.max(segment.startSec, viewStartSec)
  const endSec = Math.min(segment.endSec, viewEndSec)

  if (endSec <= startSec) {
    return null
  }

  return {
    ...segment,
    startSec,
    endSec,
    durationSec: endSec - startSec,
  }
}

function buildTicks(viewStartSec: number, viewEndSec: number) {
  const tickCount = 6
  const total = viewEndSec - viewStartSec

  return Array.from({ length: tickCount + 1 }).map((_, index) => {
    const seconds = viewStartSec + (total / tickCount) * index
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    return {
      position: seconds,
      label: `${`${hours}`.padStart(2, '0')}:${`${minutes}`.padStart(2, '0')}`,
    }
  })
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
