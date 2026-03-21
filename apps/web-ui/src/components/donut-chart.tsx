/* Interactive SVG donut chart used for app and domain time distributions. */

import type { MouseEvent } from 'react'
import {
  formatDuration,
  isFilterActive,
  type DashboardFilter,
  type DonutSlice,
  type TooltipDatum,
} from '../lib/chart-model'

const SIZE = 220
const CENTER = SIZE / 2
const OUTER_RADIUS = 78
const INNER_RADIUS = 48

export function DonutChart(props: {
  title: string
  totalLabel: string
  slices: DonutSlice[]
  filter: DashboardFilter
  filterKind: 'app' | 'domain'
  onSelect: (filter: DashboardFilter) => void
  onHover: (tooltip: TooltipDatum | null) => void
}) {
  const total = props.slices.reduce((sum, slice) => sum + slice.value, 0)
  const arcSlices = buildArcSlices(props.slices, total)

  if (props.slices.length === 0) {
    return <div className="empty-card">没有可展示的数据</div>
  }

  return (
    <div className="donut-card">
      <div className="panel-header">
        <div>
          <p className="section-kicker">{props.filterKind}</p>
          <h2>{props.title}</h2>
        </div>
      </div>

      <div className="donut-layout">
        <svg className="donut-svg" viewBox={`0 0 ${SIZE} ${SIZE}`}>
          {arcSlices.map(({ slice, path }) => {
            const isActive = isFilterActive(props.filter, props.filterKind, slice.key)
            const shouldDim =
              props.filter?.kind === props.filterKind &&
              !isActive &&
              props.filter.key !== slice.key

            return (
              <path
                key={slice.id}
                className={`donut-slice ${shouldDim ? 'is-dimmed' : ''}`}
                d={path}
                fill={slice.color}
                onMouseEnter={(event) => {
                  props.onHover(buildSliceTooltip(event, slice))
                }}
                onMouseMove={(event) => {
                  props.onHover(buildSliceTooltip(event, slice))
                }}
                onMouseLeave={() => {
                  props.onHover(null)
                }}
                onClick={() => {
                  if (slice.key === 'others') {
                    return
                  }

                  props.onSelect(
                    isActive ? null : { kind: props.filterKind, key: slice.key },
                  )
                }}
              />
            )
          })}

          <circle cx={CENTER} cy={CENTER} r={INNER_RADIUS - 1} fill="#ffffff" />
          <text x={CENTER} y={CENTER - 4} textAnchor="middle" className="donut-center-value">
            {props.totalLabel}
          </text>
          <text x={CENTER} y={CENTER + 18} textAnchor="middle" className="donut-center-caption">
            total
          </text>
        </svg>

        <div className="donut-legend">
          {props.slices.map((slice) => {
            const isActive = isFilterActive(props.filter, props.filterKind, slice.key)
            const shouldDim =
              props.filter?.kind === props.filterKind &&
              !isActive &&
              props.filter.key !== slice.key

            return (
              <button
                key={slice.id}
                type="button"
                className={`legend-row ${shouldDim ? 'is-dimmed' : ''}`}
                onClick={() => {
                  if (slice.key === 'others') {
                    return
                  }

                  props.onSelect(
                    isActive ? null : { kind: props.filterKind, key: slice.key },
                  )
                }}
                onMouseEnter={(event) => {
                  props.onHover(buildSliceTooltip(event, slice))
                }}
                onMouseMove={(event) => {
                  props.onHover(buildSliceTooltip(event, slice))
                }}
                onMouseLeave={() => {
                  props.onHover(null)
                }}
              >
                <span className="legend-dot" style={{ backgroundColor: slice.color }} />
                <div className="legend-copy">
                  <strong>{slice.label}</strong>
                  <span>{slice.percentage.toFixed(1)}%</span>
                </div>
                <span className="legend-value">{formatDuration(slice.value)}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function buildArcSlices(slices: DonutSlice[], total: number) {
  const arcs: Array<{ slice: DonutSlice; path: string }> = []
  let currentAngle = -90

  for (const slice of slices) {
    const angle = total === 0 ? 0 : (slice.value / total) * 360
    arcs.push({
      slice,
      path: describeArc(currentAngle, currentAngle + angle),
    })
    currentAngle += angle
  }

  return arcs
}

function buildSliceTooltip(
  event: MouseEvent<SVGPathElement | HTMLButtonElement>,
  slice: DonutSlice,
): TooltipDatum {
  return {
    x: event.clientX,
    y: event.clientY,
    color: slice.color,
    title: slice.label,
    lines: [formatDuration(slice.value), `${slice.percentage.toFixed(1)}%`],
  }
}

function describeArc(startAngle: number, endAngle: number) {
  const startOuter = polarToCartesian(OUTER_RADIUS, endAngle)
  const endOuter = polarToCartesian(OUTER_RADIUS, startAngle)
  const startInner = polarToCartesian(INNER_RADIUS, startAngle)
  const endInner = polarToCartesian(INNER_RADIUS, endAngle)
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0

  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${OUTER_RADIUS} ${OUTER_RADIUS} 0 ${largeArcFlag} 0 ${endOuter.x} ${endOuter.y}`,
    `L ${startInner.x} ${startInner.y}`,
    `A ${INNER_RADIUS} ${INNER_RADIUS} 0 ${largeArcFlag} 1 ${endInner.x} ${endInner.y}`,
    'Z',
  ].join(' ')
}

function polarToCartesian(radius: number, angle: number) {
  const radians = ((angle - 90) * Math.PI) / 180
  return {
    x: CENTER + radius * Math.cos(radians),
    y: CENTER + radius * Math.sin(radians),
  }
}
