import { useMemo, useState, type ReactNode } from 'react'
import { useElementWidth, useUniqueId } from './ui'

export interface ChartSeries {
  name: string
  color: string
  values: number[]
}

interface AreaChartProps {
  series: ChartSeries[]
  labels?: number[]
  height?: number
  formatValue: (value: number) => string
  formatLabel?: (value: number) => string
  gridLines?: number
  emptyLabel?: string
}

export function AreaChart({
  series,
  labels,
  height = 220,
  formatValue,
  formatLabel,
  gridLines = 4,
  emptyLabel
}: AreaChartProps): ReactNode {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const gradientId = useUniqueId('grad')

  const count = series[0]?.values.length ?? 0
  const padLeft = 6
  const padRight = 6
  const padTop = 12
  const padBottom = 20
  const chartWidth = Math.max(0, width - padLeft - padRight)
  const chartHeight = Math.max(0, height - padTop - padBottom)

  const maxValue = useMemo(() => {
    let max = 0
    for (const entry of series) {
      for (const value of entry.values) {
        if (Number.isFinite(value) && value > max) max = value
      }
    }
    return max > 0 ? max * 1.15 : 1
  }, [series])

  const xFor = (index: number): number =>
    count <= 1 ? padLeft + chartWidth / 2 : padLeft + (index / (count - 1)) * chartWidth
  const yFor = (value: number): number =>
    padTop + chartHeight - (Math.max(0, value) / maxValue) * chartHeight

  const buildPath = (values: number[]): string => {
    if (values.length === 0) return ''
    return values
      .map((value, index) => `${index === 0 ? 'M' : 'L'}${xFor(index).toFixed(2)},${yFor(value).toFixed(2)}`)
      .join(' ')
  }

  const buildArea = (values: number[]): string => {
    if (values.length === 0) return ''
    const line = buildPath(values)
    return `${line} L${xFor(values.length - 1).toFixed(2)},${(padTop + chartHeight).toFixed(2)} L${xFor(0).toFixed(2)},${(padTop + chartHeight).toFixed(2)} Z`
  }

  const hoverIndex = hover !== null && hover >= 0 && hover < count ? hover : null
  const axisLabels = useMemo(() => {
    if (!labels || labels.length === 0) return []
    const indexes = count <= 2 ? [0, count - 1] : [0, Math.floor((count - 1) / 2), count - 1]
    return indexes
      .filter((index, position) => index >= 0 && indexes.indexOf(index) === position)
      .map((index) => ({ index, label: formatLabel ? formatLabel(labels[index]) : String(labels[index]) }))
  }, [labels, count, formatLabel])

  return (
    <div className="chart" ref={ref} style={{ height }}>
      {width > 0 ? (
        <svg width={width} height={height} role="img">
          <defs>
            {series.map((entry, index) => (
              <linearGradient key={entry.name} id={`${gradientId}-${index}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={entry.color} stopOpacity="0.34" />
                <stop offset="100%" stopColor={entry.color} stopOpacity="0.02" />
              </linearGradient>
            ))}
          </defs>
          <g className="chart-grid">
            {Array.from({ length: gridLines + 1 }, (_, index) => {
              const value = (maxValue / gridLines) * index
              const y = yFor(value)
              return <line key={index} x1={padLeft} x2={padLeft + chartWidth} y1={y} y2={y} />
            })}
          </g>
          {series.map((entry, index) => (
            <g key={entry.name}>
              <path d={buildArea(entry.values)} fill={`url(#${gradientId}-${index})`} />
              <path
                d={buildPath(entry.values)}
                fill="none"
                stroke={entry.color}
                strokeWidth={1.9}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </g>
          ))}
          {hoverIndex !== null ? (
            <g>
              <line
                x1={xFor(hoverIndex)}
                x2={xFor(hoverIndex)}
                y1={padTop}
                y2={padTop + chartHeight}
                stroke="rgba(148,175,220,0.35)"
                strokeDasharray="3 3"
              />
              {series.map((entry) => (
                <circle
                  key={entry.name}
                  cx={xFor(hoverIndex)}
                  cy={yFor(entry.values[hoverIndex] ?? 0)}
                  r={3.4}
                  fill={entry.color}
                  stroke="var(--bg-0)"
                  strokeWidth={1.6}
                />
              ))}
            </g>
          ) : null}
          {axisLabels.map((entry) => (
            <text
              key={entry.index}
              className="chart-axis"
              x={xFor(entry.index)}
              y={height - 5}
              textAnchor={entry.index === 0 ? 'start' : entry.index === count - 1 ? 'end' : 'middle'}
            >
              {entry.label}
            </text>
          ))}
          <rect
            x={padLeft}
            y={padTop}
            width={chartWidth}
            height={chartHeight}
            fill="transparent"
            onMouseMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              const relative = event.clientX - rect.left
              const index = count <= 1 ? 0 : Math.round((relative / Math.max(1, chartWidth)) * (count - 1))
              setHover(Math.max(0, Math.min(count - 1, index)))
            }}
            onMouseLeave={() => setHover(null)}
          />
        </svg>
      ) : null}
      {count === 0 && emptyLabel ? (
        <div className="empty" style={{ position: 'absolute', inset: 0, padding: 0 }}>
          <p>{emptyLabel}</p>
        </div>
      ) : null}
      {hoverIndex !== null ? (
        <div
          className="chart-tooltip"
          style={{
            left: Math.max(60, Math.min(width - 60, xFor(hoverIndex))),
            top: Math.max(30, yFor(Math.max(...series.map((entry) => entry.values[hoverIndex] ?? 0))) - 8)
          }}
        >
          {labels && labels[hoverIndex] !== undefined ? (
            <div className="tiny muted" style={{ marginBottom: 3 }}>
              {formatLabel ? formatLabel(labels[hoverIndex]) : labels[hoverIndex]}
            </div>
          ) : null}
          {series.map((entry) => (
            <div key={entry.name} className="row" style={{ gap: 6 }}>
              <span className="legend-swatch" style={{ background: entry.color }} />
              <span className="muted">{entry.name}</span>
              <strong className="tabular" style={{ marginLeft: 'auto' }}>
                {formatValue(entry.values[hoverIndex] ?? 0)}
              </strong>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function Sparkline({
  values,
  color = 'var(--accent-2)',
  width = 86,
  height = 28
}: {
  values: number[]
  color?: string
  width?: number
  height?: number
}): ReactNode {
  const id = useUniqueId('spark')
  if (values.length < 2) return <svg width={width} height={height} />
  const max = Math.max(...values, 1)
  const step = width / (values.length - 1)
  const points = values.map((value, index) => `${index * step},${height - (value / max) * (height - 3) - 1.5}`)
  const line = `M${points.join(' L')}`
  const area = `${line} L${width},${height} L0,${height} Z`
  return (
    <svg width={width} height={height} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.4" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
    </svg>
  )
}

export interface DonutSlice {
  label: string
  value: number
  color: string
}

export function Donut({
  data,
  size = 148,
  thickness = 14,
  centerLabel,
  centerValue
}: {
  data: DonutSlice[]
  size?: number
  thickness?: number
  centerLabel?: string
  centerValue?: string
}): ReactNode {
  const total = data.reduce((sum, entry) => sum + entry.value, 0)
  const radius = (size - thickness) / 2
  const circumference = 2 * Math.PI * radius
  let offset = 0
  return (
    <div className="row" style={{ gap: 18, alignItems: 'center' }}>
      <svg width={size} height={size} style={{ flex: `0 0 ${size}px` }} aria-hidden="true">
        <g transform={`translate(${size / 2}, ${size / 2}) rotate(-90)`}>
          <circle r={radius} fill="none" stroke="var(--panel-strong)" strokeWidth={thickness} />
          {total > 0
            ? data.map((entry) => {
                const length = (entry.value / total) * circumference
                const dash = `${Math.max(0, length - 2)} ${circumference - Math.max(0, length - 2)}`
                const element = (
                  <circle
                    key={entry.label}
                    r={radius}
                    fill="none"
                    stroke={entry.color}
                    strokeWidth={thickness}
                    strokeDasharray={dash}
                    strokeDashoffset={-offset}
                    strokeLinecap="round"
                  />
                )
                offset += length
                return element
              })
            : null}
        </g>
        <text
          x="50%"
          y="47%"
          textAnchor="middle"
          style={{ fill: 'var(--text)', fontSize: 20, fontWeight: 650 }}
        >
          {centerValue ?? total}
        </text>
        {centerLabel ? (
          <text x="50%" y="60%" textAnchor="middle" style={{ fill: 'var(--muted)', fontSize: 10 }}>
            {centerLabel}
          </text>
        ) : null}
      </svg>
      <div className="col" style={{ gap: 6, flex: 1, minWidth: 0 }}>
        {data.length === 0 ? <span className="tiny muted">—</span> : null}
        {data.map((entry) => (
          <div key={entry.label} className="row" style={{ gap: 7 }}>
            <span className="legend-swatch" style={{ background: entry.color }} />
            <span className="tiny truncate" style={{ color: 'var(--text-soft)' }}>
              {entry.label}
            </span>
            <span className="tiny tabular muted" style={{ marginLeft: 'auto' }}>
              {entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function BarList({
  items,
  color = 'var(--accent)',
  emptyLabel
}: {
  items: { label: string; value: number; hint?: string }[]
  color?: string
  emptyLabel?: string
}): ReactNode {
  const max = Math.max(...items.map((item) => item.value), 1)
  if (items.length === 0) return <div className="tiny muted">{emptyLabel ?? '—'}</div>
  return (
    <div className="col" style={{ gap: 9 }}>
      {items.map((item) => (
        <div key={item.label} className="col" style={{ gap: 4 }}>
          <div className="row between" style={{ gap: 10 }}>
            <span className="tiny truncate" style={{ color: 'var(--text-soft)' }}>
              {item.label}
            </span>
            <span className="tiny tabular muted">
              {item.hint ?? item.value}
            </span>
          </div>
          <div className="progress thin">
            <span style={{ width: `${(item.value / max) * 100}%`, background: color }} />
          </div>
        </div>
      ))}
    </div>
  )
}
