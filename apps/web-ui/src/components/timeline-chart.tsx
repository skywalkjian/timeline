/* Devtools-inspired waterfall timeline with stacked lanes and an overview navigator. */

import { useEffect, useMemo, useRef } from 'react'
import type {
  CSSProperties,
  HTMLAttributes,
  LegacyRef,
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
} from 'react'
import Timeline, {
  DateHeader,
  SidebarHeader,
  TimelineHeaders,
  type Id,
  type OnTimeChange,
  type TimelineGroupBase,
  type TimelineItemBase,
} from 'react-calendar-timeline'
import 'react-calendar-timeline/dist/style.css'
import {
  formatClockRange,
  formatDuration,
  type ChartSegment,
} from '../lib/chart-model'

type TimelineRow = {
  id: string
  label: string
  segments: ChartSegment[]
  selectedKey?: string | null
}

type VisualGroup = TimelineGroupBase & {
  title: string
  rowId: string
  laneIndex: number
  laneCount: number
  primary: boolean
}

type TimelineItem = TimelineItemBase<number> & {
  segment: ChartSegment
  label: string
  detail: string
  opacity: number
  color: string
  className: string
}

type OverviewSegment = {
  id: string
  leftPct: number
  widthPct: number
  topPct: number
  heightPct: number
  color: string
  opacity: number
}

type TimelineItemRendererProps = {
  item: TimelineItem
  itemContext: {
    selected: boolean
  }
  getItemProps: (params: {
    className?: string
    style?: CSSProperties
  }) => HTMLAttributes<HTMLDivElement> & {
    key: string
    ref: LegacyRef<HTMLDivElement>
  }
}

type DragState = {
  mode: 'move' | 'resize-start' | 'resize-end'
  startClientX: number
  startSec: number
  endSec: number
}

const DAY_SECONDS = 24 * 60 * 60
const DEFAULT_DATE = '2026-03-21'
const MIN_ZOOM_MS = 5 * 60 * 1000
const SIDEBAR_WIDTH = 104
const LINE_HEIGHT = 42
const SNAP_SECONDS = 5 * 60

export function TimelineChart(props: {
  rows: TimelineRow[]
  viewStartSec: number
  viewEndSec: number
  baseDate?: string
  selectedSegmentId?: string | null
  interactiveZoom?: boolean
  minViewHours?: number
  maxViewHours?: number
  onViewportChange?: (startSec: number, endSec: number) => void
  onSelectSegment?: (segment: ChartSegment) => void
}) {
  const overviewRef = useRef<HTMLDivElement | null>(null)
  const dragStateRef = useRef<DragState | null>(null)
  const baseMs = toLocalMidnightMs(props.baseDate ?? DEFAULT_DATE)
  const visibleTimeStart = baseMs + props.viewStartSec * 1000
  const visibleTimeEnd = baseMs + props.viewEndSec * 1000
  const minZoom = Math.max((props.minViewHours ?? 1 / 12) * 3600 * 1000, MIN_ZOOM_MS)
  const maxZoom = Math.min((props.maxViewHours ?? 24) * 3600 * 1000, DAY_SECONDS * 1000)
  const minZoomSec = Math.round(minZoom / 1000)
  const maxZoomSec = Math.round(maxZoom / 1000)
  const layout = useMemo(
    () => buildTimelineLayout(props.rows, baseMs, props.selectedSegmentId),
    [baseMs, props.rows, props.selectedSegmentId],
  )
  const selected = props.selectedSegmentId ? [props.selectedSegmentId] : []
  const secondaryLabelFormat =
    props.viewEndSec - props.viewStartSec <= 1800 ? 'HH:mm:ss' : 'HH:mm'
  const viewportLabel = `${formatClock(props.viewStartSec)} - ${formatClock(props.viewEndSec)}`
  const viewportDuration = props.viewEndSec - props.viewStartSec
  const windowLeftPct = (props.viewStartSec / DAY_SECONDS) * 100
  const windowWidthPct = (viewportDuration / DAY_SECONDS) * 100
  const visibleTableItems = useMemo(
    () => buildVisibleTableItems(layout.items, props.viewStartSec, props.viewEndSec),
    [layout.items, props.viewEndSec, props.viewStartSec],
  )

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const drag = dragStateRef.current
      const container = overviewRef.current

      if (!drag || !container || !props.onViewportChange) {
        return
      }

      const rect = container.getBoundingClientRect()
      if (rect.width <= 0) {
        return
      }

      const deltaRatio = (event.clientX - drag.startClientX) / rect.width
      const deltaSec = deltaRatio * DAY_SECONDS

      if (drag.mode === 'move') {
        const next = clampWindow(drag.startSec + deltaSec, drag.endSec + deltaSec)
        props.onViewportChange(next.startSec, next.endSec)
        return
      }

      if (drag.mode === 'resize-start') {
        const proposedStart = snapToStep(drag.startSec + deltaSec)
        const minStart = Math.max(0, drag.endSec - maxZoomSec)
        const maxStart = Math.max(0, drag.endSec - minZoomSec)
        const nextStart = clampNumber(proposedStart, minStart, maxStart)
        props.onViewportChange(nextStart, drag.endSec)
        return
      }

      const proposedEnd = snapToStep(drag.endSec + deltaSec)
      const minEnd = Math.min(DAY_SECONDS, drag.startSec + minZoomSec)
      const maxEnd = Math.min(DAY_SECONDS, drag.startSec + maxZoomSec)
      const nextEnd = clampNumber(proposedEnd, minEnd, maxEnd)
      props.onViewportChange(drag.startSec, nextEnd)
    }

    function handlePointerUp() {
      dragStateRef.current = null
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [maxZoomSec, minZoomSec, props])

  if (layout.items.length === 0) {
    return <div className="empty-card">没有可展示的时间线数据</div>
  }

  const handleTimeChange: OnTimeChange<TimelineItem, VisualGroup> = (
    nextVisibleStart,
    nextVisibleEnd,
    updateScrollCanvas,
  ) => {
    const clamped = clampViewport(nextVisibleStart, nextVisibleEnd, baseMs, minZoom, maxZoom)
    updateScrollCanvas(clamped.startMs, clamped.endMs)
    props.onViewportChange?.(
      Math.round((clamped.startMs - baseMs) / 1000),
      Math.round((clamped.endMs - baseMs) / 1000),
    )
  }

  return (
    <div className={`timeline-chart-host ${props.interactiveZoom ? 'is-interactive' : ''}`}>
      <div className="timeline-chart-meta">
        <span>Viewport</span>
        <strong>{viewportLabel}</strong>
        <span>{formatDuration(viewportDuration)}</span>
      </div>

      <Timeline<TimelineItem, VisualGroup>
        groups={layout.groups}
        items={layout.items}
        sidebarWidth={SIDEBAR_WIDTH}
        rightSidebarWidth={0}
        selected={selected}
        defaultTimeStart={visibleTimeStart}
        defaultTimeEnd={visibleTimeEnd}
        visibleTimeStart={visibleTimeStart}
        visibleTimeEnd={visibleTimeEnd}
        canMove={false}
        canResize={false}
        canChangeGroup={false}
        canSelect
        stackItems={false}
        lineHeight={LINE_HEIGHT}
        itemHeightRatio={0.68}
        dragSnap={SNAP_SECONDS * 1000}
        minZoom={minZoom}
        maxZoom={maxZoom}
        buffer={1}
        traditionalZoom={props.interactiveZoom}
        onTimeChange={handleTimeChange}
        onItemSelect={(itemId) => {
          const segment = findSegmentById(layout.items, itemId)
          if (segment) {
            props.onSelectSegment?.(segment)
          }
        }}
        onItemClick={(itemId) => {
          const segment = findSegmentById(layout.items, itemId)
          if (segment) {
            props.onSelectSegment?.(segment)
          }
        }}
        groupRenderer={({ group }) => (
          <div className={`timeline-group-label ${group.primary ? 'is-primary' : 'is-secondary'}`}>
            <strong>{group.primary ? group.title : ''}</strong>
            <span>{group.primary ? `${group.laneCount} lanes` : `lane ${group.laneIndex + 1}`}</span>
          </div>
        )}
        itemRenderer={(rendererProps) => renderItem(rendererProps)}
        className="timeline-calendar"
      >
        <TimelineHeaders className="timeline-calendar-headers">
          <SidebarHeader>
            {({ getRootProps }) => (
              <div {...getRootProps({ style: { background: 'transparent', border: 'none' } })} />
            )}
          </SidebarHeader>
          <DateHeader
            unit="primaryHeader"
            labelFormat={([intervalStart]) => intervalStart.format('YYYY/MM/DD')}
            className="timeline-primary-header"
          />
          <DateHeader
            labelFormat={([intervalStart]) => intervalStart.format(secondaryLabelFormat)}
            className="timeline-secondary-header"
          />
        </TimelineHeaders>
      </Timeline>

      {props.interactiveZoom ? (
        <div className="timeline-overview-panel">
          <div className="timeline-overview-header">
            <span>Navigator</span>
            <span>拖动窗口平移，拖两侧手柄缩放</span>
          </div>

          <div
            ref={overviewRef}
            className="timeline-overview"
            onPointerDown={(event) => {
              if (!props.onViewportChange) {
                return
              }

              const rect = overviewRef.current?.getBoundingClientRect()
              if (!rect) {
                return
              }

              const ratio = clampNumber((event.clientX - rect.left) / rect.width, 0, 1)
              const centerSec = ratio * DAY_SECONDS
              const half = viewportDuration / 2
              const next = clampWindow(centerSec - half, centerSec + half)
              props.onViewportChange(next.startSec, next.endSec)
            }}
          >
            <div className="timeline-overview-grid" />

            {layout.overviewSegments.map((segment) => (
              <span
                key={segment.id}
                className="timeline-overview-segment"
                style={{
                  left: `${segment.leftPct}%`,
                  width: `${segment.widthPct}%`,
                  top: `${segment.topPct}%`,
                  height: `${segment.heightPct}%`,
                  backgroundColor: segment.color,
                  opacity: segment.opacity,
                }}
              />
            ))}

            <div
              className="timeline-overview-window"
              style={{
                left: `${windowLeftPct}%`,
                width: `${Math.max(windowWidthPct, 1.2)}%`,
              }}
              onPointerDown={(event) => beginOverviewDrag(event, 'move', props, dragStateRef)}
            >
              <button
                type="button"
                className="timeline-overview-handle is-start"
                onPointerDown={(event) =>
                  beginOverviewDrag(event, 'resize-start', props, dragStateRef)
                }
              />
              <div className="timeline-overview-window-body">
                <span>{viewportLabel}</span>
              </div>
              <button
                type="button"
                className="timeline-overview-handle is-end"
                onPointerDown={(event) =>
                  beginOverviewDrag(event, 'resize-end', props, dragStateRef)
                }
              />
            </div>
          </div>
        </div>
      ) : null}

      <div className="timeline-table-panel">
        <div className="timeline-table-header">
          <span>名称</span>
          <span>类型</span>
          <span>说明</span>
          <span>时间段</span>
          <span>时长</span>
        </div>

        <div className="timeline-table-body">
          {visibleTableItems.map((item) => (
            <button
              key={`${item.id}-row`}
              type="button"
              className={`timeline-table-row ${item.id === props.selectedSegmentId ? 'is-selected' : ''}`}
              onClick={() => {
                props.onSelectSegment?.(item.segment)
              }}
            >
              <span className="timeline-table-name">
                <i style={{ backgroundColor: item.color }} />
                {item.label}
              </span>
              <span>{segmentTypeLabel(item.segment)}</span>
              <span className="timeline-table-detail">{item.detail}</span>
              <span>{formatClockRange(item.segment.startSec, item.segment.endSec)}</span>
              <span>{formatDuration(item.segment.durationSec)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function buildTimelineLayout(
  rows: TimelineRow[],
  baseMs: number,
  selectedSegmentId?: string | null,
) {
  const groups: VisualGroup[] = []
  const items: TimelineItem[] = []
  const overviewSegments: OverviewSegment[] = []
  const totalRows = Math.max(rows.length, 1)

  rows.forEach((row, rowIndex) => {
    const lanes = buildLanes(row.segments)
    const laneCount = Math.max(lanes.length, 1)

    if (lanes.length === 0) {
      groups.push({
        id: `${row.id}-lane-0`,
        title: row.label,
        rowId: row.id,
        laneIndex: 0,
        laneCount,
        primary: true,
      })
    }

    lanes.forEach((laneSegments, laneIndex) => {
      const groupId = `${row.id}-lane-${laneIndex}`
      groups.push({
        id: groupId,
        title: row.label,
        rowId: row.id,
        laneIndex,
        laneCount,
        primary: laneIndex === 0,
      })

      laneSegments.forEach((segment) => {
        const shouldDim =
          row.selectedKey !== null &&
          row.selectedKey !== undefined &&
          row.selectedKey !== segment.key

        items.push({
          id: segment.id,
          group: groupId,
          title: segment.label,
          start_time: baseMs + segment.startSec * 1000,
          end_time: baseMs + segment.endSec * 1000,
          canMove: false,
          canResize: false,
          canChangeGroup: false,
          className: buildItemClassName(shouldDim, selectedSegmentId === segment.id),
          itemProps: {
            title: buildTooltipText(segment),
          },
          segment,
          label: segment.label,
          detail: segment.detail,
          opacity: shouldDim ? 0.22 : 0.98,
          color: segment.color,
        })

        overviewSegments.push({
          id: `${segment.id}-overview`,
          leftPct: (segment.startSec / DAY_SECONDS) * 100,
          widthPct: Math.max((segment.durationSec / DAY_SECONDS) * 100, 0.2),
          topPct: (rowIndex / totalRows) * 100 + 10,
          heightPct: 26 / totalRows,
          color: segment.color,
          opacity: shouldDim ? 0.18 : 0.88,
        })
      })
    })
  })

  return { groups, items, overviewSegments }
}

function buildLanes(segments: ChartSegment[]) {
  const lanes: ChartSegment[][] = []
  const ordered = [...segments].sort((left, right) => {
    if (left.startSec !== right.startSec) {
      return left.startSec - right.startSec
    }

    return left.endSec - right.endSec
  })

  for (const segment of ordered) {
    let placed = false

    for (const lane of lanes) {
      const last = lane[lane.length - 1]
      if (last.endSec <= segment.startSec) {
        lane.push(segment)
        placed = true
        break
      }
    }

    if (!placed) {
      lanes.push([segment])
    }
  }

  return lanes
}

function renderItem(props: TimelineItemRendererProps) {
  const { item, itemContext, getItemProps } = props
  const itemProps = getItemProps({
    className: item.className,
    style: {
      background: item.color,
      borderColor: itemContext.selected ? '#c3d0ff' : 'rgba(255, 255, 255, 0.16)',
      color: '#ecf2ff',
      borderRadius: 6,
      borderWidth: itemContext.selected ? 1 : 1,
      opacity: item.opacity,
      boxShadow: itemContext.selected ? '0 0 0 1px rgba(195, 208, 255, 0.42)' : 'none',
    },
  })

  return (
    <div {...itemProps}>
      <div className="timeline-item-copy">
        <span className="timeline-item-label">{item.label}</span>
        <small className="timeline-item-detail">{item.detail}</small>
      </div>
    </div>
  )
}

function beginOverviewDrag(
  event: ReactPointerEvent<HTMLElement>,
  mode: DragState['mode'],
  props: {
    viewStartSec: number
    viewEndSec: number
  },
  dragStateRef: MutableRefObject<DragState | null>,
) {
  event.preventDefault()
  event.stopPropagation()
  dragStateRef.current = {
    mode,
    startClientX: event.clientX,
    startSec: props.viewStartSec,
    endSec: props.viewEndSec,
  }
}

function buildVisibleTableItems(items: TimelineItem[], viewStartSec: number, viewEndSec: number) {
  return items
    .filter((item) => item.segment.endSec > viewStartSec && item.segment.startSec < viewEndSec)
    .sort((left, right) => {
      if (left.segment.startSec !== right.segment.startSec) {
        return left.segment.startSec - right.segment.startSec
      }

      return right.segment.durationSec - left.segment.durationSec
    })
}

function clampViewport(
  startMs: number,
  endMs: number,
  baseMs: number,
  minZoom: number,
  maxZoom: number,
) {
  const dayStart = baseMs
  const dayEnd = baseMs + DAY_SECONDS * 1000
  const duration = Math.min(Math.max(endMs - startMs, minZoom), maxZoom)
  let nextStart = startMs
  let nextEnd = nextStart + duration

  if (nextStart < dayStart) {
    nextStart = dayStart
    nextEnd = nextStart + duration
  }

  if (nextEnd > dayEnd) {
    nextEnd = dayEnd
    nextStart = nextEnd - duration
  }

  return {
    startMs: Math.max(dayStart, nextStart),
    endMs: Math.min(dayEnd, nextEnd),
  }
}

function clampWindow(startSec: number, endSec: number) {
  const duration = endSec - startSec
  let nextStart = startSec
  let nextEnd = endSec

  if (nextStart < 0) {
    nextStart = 0
    nextEnd = duration
  }

  if (nextEnd > DAY_SECONDS) {
    nextEnd = DAY_SECONDS
    nextStart = DAY_SECONDS - duration
  }

  return {
    startSec: snapToStep(nextStart),
    endSec: snapToStep(nextEnd),
  }
}

function findSegmentById(items: TimelineItem[], itemId: Id) {
  const match = items.find((item) => item.id === itemId)
  return match?.segment ?? null
}

function buildItemClassName(isDimmed: boolean, isSelected: boolean) {
  return ['timeline-item', isDimmed ? 'is-dimmed' : '', isSelected ? 'is-selected' : '']
    .filter(Boolean)
    .join(' ')
}

function buildTooltipText(segment: ChartSegment) {
  return [
    segment.label,
    segment.detail,
    formatClockRange(segment.startSec, segment.endSec),
    formatDuration(segment.durationSec),
  ].join('\n')
}

function toLocalMidnightMs(dateText: string) {
  const date = new Date(`${dateText}T00:00:00`)
  return date.getTime()
}

function formatClock(seconds: number) {
  const clamped = clampNumber(seconds, 0, DAY_SECONDS)
  const hours = Math.floor(clamped / 3600)
  const minutes = Math.floor((clamped % 3600) / 60)
  return `${`${hours}`.padStart(2, '0')}:${`${minutes}`.padStart(2, '0')}`
}

function snapToStep(seconds: number) {
  return Math.round(seconds / SNAP_SECONDS) * SNAP_SECONDS
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max))
}

function segmentTypeLabel(segment: ChartSegment) {
  if (segment.tone === 'presence') {
    return '状态'
  }

  if (segment.tone === 'browser') {
    return '域名'
  }

  return segment.isBrowser ? '浏览器' : '应用'
}
