import { useState } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Sector, Tooltip } from 'recharts'
import { formatDate, formatINR, monthLabel } from '../utils/format.js'

// Curated 14-color iridescent liquid-glass palette — guarantees distinct,
// high-contrast, visually harmonious colors across all pie chart slices.
const AESTHETIC_PALETTE = [
  '#FF6B8B', // Coral Rose
  '#6366F1', // Electric Indigo
  '#06B6D4', // Cyan Glow
  '#10B981', // Emerald Mint
  '#F59E0B', // Amber Gold
  '#A855F7', // Vivid Violet
  '#38BDF8', // Sky Azure
  '#EC4899', // Magenta Pink
  '#F97316', // Sunset Tangerine
  '#14B8A6', // Tropical Teal
  '#84CC16', // Peridot Lime
  '#E879F9', // Orchid Fuchsia
  '#FB7185', // Rose Blush
  '#818CF8', // Soft Periwinkle
]

function GlassPieTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const item = payload[0]
  const data = item?.payload || {}
  const color = data.fill || item.color || '#6366F1'
  const pct = data.pct != null ? `${Number(data.pct).toFixed(1)}%` : (data.share != null ? `${Number(data.share).toFixed(1)}%` : null)
  return (
    <div className="glass pie-tooltip" style={{ padding: '10px 14px', minWidth: 165 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, boxShadow: `0 0 10px ${color}` }} />
        <strong style={{ fontSize: 13 }}>{data.label || item.name}</strong>
      </div>
      <div style={{ fontSize: 15, fontWeight: 800 }}>{formatINR(item.value)}</div>
      <div className="small muted">
        {pct ? `${pct} of total` : ''}
        {data.count != null ? ` · ${data.count} txn${data.count === 1 ? '' : 's'}` : ''}
      </div>
    </div>
  )
}

function renderActiveSlice(props) {
  const {
    cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill,
  } = props
  return (
    <g>
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={Math.max(0, innerRadius - 2)}
        outerRadius={outerRadius + 7}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
        cornerRadius={6}
      />
      <Sector
        cx={cx}
        cy={cy}
        startAngle={startAngle}
        endAngle={endAngle}
        innerRadius={outerRadius + 10}
        outerRadius={outerRadius + 13}
        fill={fill}
        opacity={0.65}
      />
    </g>
  )
}

function PieLegendPills({ slices, activeIndex, onHover, onClick }) {
  if (!slices?.length) return null
  return (
    <div className="pie-legend">
      {slices.map((s, idx) => (
        <button
          key={s.key || s.label || idx}
          type="button"
          className={`pie-legend-pill${activeIndex === idx ? ' active' : ''}`}
          onMouseEnter={() => onHover?.(idx)}
          onMouseLeave={() => onHover?.(-1)}
          onClick={() => onClick?.(s)}
        >
          <span className="pie-dot" style={{ background: s.fill, boxShadow: `0 0 8px ${s.fill}88` }} />
          <span className="pie-legend-name">{s.label}</span>
          <span className="pie-legend-pct">{s.pct != null ? `${Number(s.pct).toFixed(1)}%` : ''}</span>
        </button>
      ))}
    </div>
  )
}

function UniversalPieChart({
  slices,
  innerRadius = 56,
  outerRadius = 94,
  height = 250,
  centerLabel,
  centerValue,
  onSliceClick,
  showLegend = true,
}) {
  const [activeIndex, setActiveIndex] = useState(-1)
  const validSlices = (slices || []).filter((s) => s.value > 0)

  if (validSlices.length === 0) {
    return (
      <div className="empty" style={{ padding: '28px 12px' }}>
        <p className="small muted">No positive values to display in this pie chart yet.</p>
      </div>
    )
  }

  const activeSlice = activeIndex >= 0 && validSlices[activeIndex] ? validSlices[activeIndex] : null

  return (
    <div className="pie-chart-wrap">
      <div style={{ position: 'relative', width: '100%', height }}>
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie
              data={validSlices}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius={innerRadius}
              outerRadius={outerRadius}
              paddingAngle={validSlices.length > 1 ? 3 : 0}
              cornerRadius={6}
              stroke="rgba(255,255,255,0.14)"
              strokeWidth={1.5}
              activeIndex={activeIndex >= 0 ? activeIndex : undefined}
              activeShape={renderActiveSlice}
              onMouseEnter={(_, idx) => setActiveIndex(idx)}
              onMouseLeave={() => setActiveIndex(-1)}
              onClick={(d) => {
                const payload = d?.payload || d
                if (payload) onSliceClick?.(payload)
              }}
              isAnimationActive
              animationDuration={520}
            >
              {validSlices.map((entry, i) => (
                <Cell key={entry.key || entry.label || i} fill={entry.fill} style={{ cursor: onSliceClick ? 'pointer' : 'default' }} />
              ))}
            </Pie>
            <Tooltip content={<GlassPieTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        {innerRadius > 35 && (centerLabel || centerValue || activeSlice) && (
          <div className="pie-center-overlay" aria-hidden>
            <span className="pie-center-label">
              {activeSlice ? activeSlice.label : (centerLabel || 'Total')}
            </span>
            <strong className="pie-center-value">
              {activeSlice ? formatINR(activeSlice.value) : (centerValue || '')}
            </strong>
            {activeSlice?.pct != null && (
              <span className="pie-center-sub">{Number(activeSlice.pct).toFixed(1)}%</span>
            )}
          </div>
        )}
      </div>
      {showLegend && (
        <PieLegendPills
          slices={validSlices}
          activeIndex={activeIndex}
          onHover={setActiveIndex}
          onClick={(s) => onSliceClick?.(s)}
        />
      )}
    </div>
  )
}

// 1. Category Spending Pie Chart
export function DonutChart({ data, onSelect }) {
  const raw = (data || []).map((d) => ({ ...d, value: Number(d.total) || 0 })).filter((d) => d.value > 0)
  const total = raw.reduce((acc, d) => acc + d.value, 0)
  const usedColors = new Set()

  const slices = raw.map((d, i) => {
    let fill = AESTHETIC_PALETTE[i % AESTHETIC_PALETTE.length]
    if (d.color && !usedColors.has(d.color.toLowerCase())) {
      fill = d.color
    }
    usedColors.add(fill.toLowerCase())
    return {
      key: d.category,
      label: d.category,
      category: d.category,
      value: d.value,
      count: d.count,
      pct: d.share != null ? Number(d.share) : (total > 0 ? (d.value / total) * 100 : 0),
      fill,
    }
  })

  return (
    <UniversalPieChart
      slices={slices}
      innerRadius={58}
      outerRadius={94}
      centerLabel="Spent"
      centerValue={formatINR(total)}
      onSliceClick={(s) => { if (s?.category) onSelect?.(s.category) }}
    />
  )
}

// 2. Daily Spending Distribution Pie Chart (replaces area chart so all charts are pie charts)
export function TrendChart({ data, onSelect }) {
  const activeDays = (data || [])
    .map((d) => ({ date: d.date, value: Number(d.spent) || 0 }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value)

  const total = activeDays.reduce((acc, d) => acc + d.value, 0)
  // Group top 8 spending days as distinct slices and combine remaining days into "Other days"
  const topDays = activeDays.slice(0, 8)
  const restDays = activeDays.slice(8)
  const restTotal = restDays.reduce((acc, d) => acc + d.value, 0)

  const slices = topDays.map((d, i) => ({
    key: d.date,
    date: d.date,
    label: formatDate(d.date).slice(0, 6),
    value: d.value,
    pct: total > 0 ? (d.value / total) * 100 : 0,
    fill: AESTHETIC_PALETTE[(i + 2) % AESTHETIC_PALETTE.length],
  }))

  if (restTotal > 0) {
    slices.push({
      key: 'other-days',
      date: restDays[0]?.date,
      label: `${restDays.length} other day${restDays.length === 1 ? '' : 's'}`,
      value: restTotal,
      pct: total > 0 ? (restTotal / total) * 100 : 0,
      fill: AESTHETIC_PALETTE[10],
    })
  }

  return (
    <UniversalPieChart
      slices={slices}
      innerRadius={52}
      outerRadius={92}
      centerLabel={`${activeDays.length} active day${activeDays.length === 1 ? '' : 's'}`}
      centerValue={formatINR(total)}
      onSliceClick={(s) => { if (s?.date) onSelect?.(s.date) }}
    />
  )
}

// 3. Monthly Comparison & Cash Flow Pie Chart (with toggle between 6-Month Spend Pie & Cash-Flow Pie)
export function ComparisonChart({ data, onSelect }) {
  const [view, setView] = useState('months') // 'months' | 'cashflow'
  const items = (data || []).map((d) => ({
    month: d.month,
    spent: Number(d.spent) || 0,
    income: Number(d.income) || 0,
  }))

  const totalSpent = items.reduce((acc, d) => acc + d.spent, 0)
  const totalIncome = items.reduce((acc, d) => acc + d.income, 0)

  const monthSlices = items
    .filter((d) => d.spent > 0)
    .map((d, i) => ({
      key: d.month,
      month: d.month,
      label: monthLabel(d.month).slice(0, 3) + ' ' + d.month.slice(2, 4),
      value: d.spent,
      pct: totalSpent > 0 ? (d.spent / totalSpent) * 100 : 0,
      fill: AESTHETIC_PALETTE[(i + 4) % AESTHETIC_PALETTE.length],
    }))

  const cashflowTotal = totalSpent + totalIncome
  const cashflowSlices = [
    {
      key: 'spent',
      label: '6-Mo Spent',
      value: totalSpent,
      pct: cashflowTotal > 0 ? (totalSpent / cashflowTotal) * 100 : 0,
      fill: '#FF6B8B',
    },
    {
      key: 'income',
      label: '6-Mo Income',
      value: totalIncome,
      pct: cashflowTotal > 0 ? (totalIncome / cashflowTotal) * 100 : 0,
      fill: '#10B981',
    },
  ].filter((s) => s.value > 0)

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, justifyContent: 'flex-end' }}>
        <button
          type="button"
          className={`btn btn-sm${view === 'months' ? ' btn-primary' : ''}`}
          onClick={() => setView('months')}
        >
          By Month
        </button>
        <button
          type="button"
          className={`btn btn-sm${view === 'cashflow' ? ' btn-primary' : ''}`}
          onClick={() => setView('cashflow')}
        >
          Income vs Spend
        </button>
      </div>
      {view === 'months' ? (
        <UniversalPieChart
          slices={monthSlices}
          innerRadius={54}
          outerRadius={92}
          centerLabel="6-Mo Spend"
          centerValue={formatINR(totalSpent)}
          onSliceClick={(s) => { if (s?.month) onSelect?.(s.month) }}
        />
      ) : (
        <UniversalPieChart
          slices={cashflowSlices}
          innerRadius={54}
          outerRadius={92}
          centerLabel="Net Flow"
          centerValue={formatINR(totalIncome - totalSpent)}
        />
      )}
    </div>
  )
}

// 4. Payment Method Pie Chart
export function PaymentMethodPieChart({ data, onSelect }) {
  const raw = (data || []).map((d) => ({ ...d, value: Number(d.total) || 0 })).filter((d) => d.value > 0)
  const total = raw.reduce((acc, d) => acc + d.value, 0)
  const methodColors = {
    UPI: '#06B6D4',
    CARD: '#A855F7',
    CASH: '#10B981',
    BANK: '#6366F1',
    OTHER: '#F59E0B',
  }
  const slices = raw.map((d, i) => ({
    key: d.method,
    method: d.method.toLowerCase(),
    label: d.method,
    value: d.value,
    count: d.count,
    pct: d.share != null ? Number(d.share) : (total > 0 ? (d.value / total) * 100 : 0),
    fill: methodColors[d.method] || AESTHETIC_PALETTE[(i + 6) % AESTHETIC_PALETTE.length],
  }))

  return (
    <UniversalPieChart
      slices={slices}
      innerRadius={54}
      outerRadius={92}
      centerLabel="Methods"
      centerValue={formatINR(total)}
      onSliceClick={(s) => { if (s?.method) onSelect?.(s.method) }}
    />
  )
}

// 5. Budget vs Actual Pie Chart
export function BudgetPieChart({ budgets }) {
  if (!budgets?.overall && !(budgets?.categories || []).length) return null
  const catBudgets = budgets?.categories || []
  const overall = budgets?.overall

  let slices = []
  if (catBudgets.length > 0) {
    const total = catBudgets.reduce((acc, b) => acc + (Number(b.spent) || 0), 0)
    slices = catBudgets.map((b, i) => ({
      key: b.category || i,
      label: `${b.category} (Spent)`,
      value: Number(b.spent) || 0,
      pct: total > 0 ? ((Number(b.spent) || 0) / total) * 100 : 0,
      fill: AESTHETIC_PALETTE[(i + 1) % AESTHETIC_PALETTE.length],
    }))
    if (overall && Number(overall.remaining) > 0) {
      slices.push({
        key: 'remaining-budget',
        label: 'Remaining Budget',
        value: Number(overall.remaining),
        pct: Number(overall.budgeted) > 0 ? (Number(overall.remaining) / Number(overall.budgeted)) * 100 : 0,
        fill: '#10B981',
      })
    }
  } else if (overall) {
    const spent = Number(overall.spent) || 0
    const rem = Math.max(0, Number(overall.remaining) || 0)
    const tot = spent + rem
    slices = [
      { key: 'spent', label: 'Spent', value: spent, pct: tot > 0 ? (spent / tot) * 100 : 0, fill: '#FF6B8B' },
      { key: 'rem', label: 'Remaining', value: rem, pct: tot > 0 ? (rem / tot) * 100 : 0, fill: '#10B981' },
    ]
  }

  return (
    <UniversalPieChart
      slices={slices}
      innerRadius={52}
      outerRadius={90}
      centerLabel={overall ? 'Used' : 'Budget'}
      centerValue={overall ? `${overall.percent_used}%` : ''}
    />
  )
}
