/* Main analysis dashboard for focus timeline and distribution charts. */

import { startTransition, useEffect, useState } from 'react'
import './App.css'
import { ChartTooltip } from './components/chart-tooltip'
import { DonutChart } from './components/donut-chart'
import { TimelineChart } from './components/timeline-chart'
import { getTimeline, type TimelineDayResponse } from './api'
import {
  buildDashboardModel,
  formatDuration,
  type DashboardFilter,
  type TooltipDatum,
} from './lib/chart-model'

function App() {
  const [selectedDate, setSelectedDate] = useState(() => todayString())
  const [timeline, setTimeline] = useState<TimelineDayResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeOnly, setActiveOnly] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<TooltipDatum | null>(null)
  const [filter, setFilter] = useState<DashboardFilter>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      try {
        const nextTimeline = await getTimeline(selectedDate)
        if (cancelled) {
          return
        }

        setTimeline(nextTimeline)
        setLastUpdatedAt(new Date().toLocaleTimeString())
      } catch (loadError) {
        if (cancelled) {
          return
        }

        const message =
          loadError instanceof Error ? loadError.message : '加载本地数据时发生未知错误'
        setError(message)
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [selectedDate, refreshToken])

  const dashboard = timeline ? buildDashboardModel(timeline, activeOnly) : null

  return (
    <>
      <main className="app-shell">
        <section className="topbar-panel">
          <div className="title-block">
            <p className="eyebrow">timeline / analysis panel</p>
            <h1>注意力分析面板</h1>
            <p className="hero-text">
              以图表为主查看一天内的应用切换、域名停留和 presence 状态。
            </p>
          </div>

          <div className="toolbar-grid">
            <label className="field-card">
              <span>日期</span>
              <input
                type="date"
                value={selectedDate}
                onChange={(event) => {
                  const nextDate = event.target.value
                  startTransition(() => {
                    setSelectedDate(nextDate)
                  })
                }}
              />
            </label>

            <label className="toggle-card">
              <span>active only</span>
              <button
                type="button"
                className={`toggle-button ${activeOnly ? 'is-active' : ''}`}
                onClick={() => {
                  setActiveOnly((value) => !value)
                }}
              >
                {activeOnly ? 'On' : 'Off'}
              </button>
            </label>

            <button
              type="button"
              className="action-button"
              onClick={() => {
                setRefreshToken((value) => value + 1)
              }}
            >
              刷新数据
            </button>

            <div className="status-card">
              <span>连接状态</span>
              <strong className={error ? 'status-error' : 'status-ok'}>
                {error ? 'Agent offline' : 'Agent online'}
              </strong>
              <small>{lastUpdatedAt ? `updated ${lastUpdatedAt}` : 'waiting'}</small>
            </div>
          </div>
        </section>

        {loading ? <LoadingState /> : null}
        {error ? <ErrorState error={error} /> : null}

        {!loading && !error && dashboard ? (
          <>
            <section className="summary-grid">
              <SummaryCard
                title="专注时长"
                value={formatDuration(dashboard.summary.focusSeconds)}
                caption={activeOnly ? 'active only' : 'all segments'}
              />
              <SummaryCard
                title="active 时长"
                value={formatDuration(dashboard.summary.activeSeconds)}
                caption="presence = active"
              />
              <SummaryCard
                title="最长专注"
                value={formatDuration(dashboard.summary.longestFocusSeconds)}
                caption="visible longest block"
              />
              <SummaryCard
                title="切换次数"
                value={`${dashboard.summary.switchCount}`}
                caption="visible focus segments"
              />
            </section>

            <section className="meta-strip">
              <MetaPill label="date" value={timeline?.date ?? '--'} />
              <MetaPill label="tz" value={timeline?.timezone ?? '--'} />
              <MetaPill label="focus" value={`${dashboard.meta.focusCount}`} />
              <MetaPill label="domains" value={`${dashboard.meta.browserCount}`} />
              <MetaPill label="presence" value={`${dashboard.meta.presenceCount}`} />
              {filter ? (
                <button
                  type="button"
                  className="clear-filter-button"
                  onClick={() => {
                    setFilter(null)
                  }}
                >
                  清除筛选
                </button>
              ) : null}
            </section>

            <section className="dashboard-grid">
              <div className="panel timeline-panel">
                <div className="panel-header">
                  <div>
                    <p className="section-kicker">timeline</p>
                    <h2>24 小时时间线</h2>
                  </div>
                  <p className="timezone-label">
                    hover 查看详情{activeOnly ? ' / active only' : ''}
                  </p>
                </div>

                <TimelineChart
                  rows={[
                    {
                      id: 'focus',
                      label: '应用',
                      filterKind: 'app',
                      segments: dashboard.focusSegments,
                    },
                    {
                      id: 'browser',
                      label: '域名',
                      filterKind: 'domain',
                      segments: dashboard.browserSegments,
                    },
                    {
                      id: 'presence',
                      label: '状态',
                      segments: dashboard.presenceSegments,
                    },
                  ]}
                  filter={filter}
                  onHover={setTooltip}
                />
              </div>

              <aside className="chart-stack">
                <div className="panel">
                  <DonutChart
                    title="应用分布"
                    totalLabel={formatDuration(dashboard.summary.focusSeconds)}
                    slices={dashboard.appSlices}
                    filter={filter}
                    filterKind="app"
                    onSelect={setFilter}
                    onHover={setTooltip}
                  />
                </div>

                <div className="panel">
                  <DonutChart
                    title="域名分布"
                    totalLabel={formatDuration(
                      dashboard.browserSegments.reduce(
                        (sum, segment) => sum + segment.durationSec,
                        0,
                      ),
                    )}
                    slices={dashboard.domainSlices}
                    filter={filter}
                    filterKind="domain"
                    onSelect={setFilter}
                    onHover={setTooltip}
                  />
                </div>
              </aside>
            </section>
          </>
        ) : null}
      </main>

      <ChartTooltip tooltip={tooltip} />
    </>
  )
}

function SummaryCard(props: { title: string; value: string; caption: string }) {
  return (
    <article className="summary-card">
      <span>{props.title}</span>
      <strong>{props.value}</strong>
      <small>{props.caption}</small>
    </article>
  )
}

function MetaPill(props: { label: string; value: string }) {
  return (
    <article className="meta-pill">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </article>
  )
}

function LoadingState() {
  return <div className="state-card">正在从本地服务读取图表数据…</div>
}

function ErrorState(props: { error: string }) {
  return <div className="state-card error-card">{props.error}</div>
}

function todayString() {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export default App
