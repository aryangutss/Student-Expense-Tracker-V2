import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Printer, Upload } from 'lucide-react'
import { analyticsApi, categoriesApi, expensesApi, parseErrorMessage } from '../services/api.js'
import { useToast } from '../context/ToastContext.jsx'
import { buildCSV, currentMonth, downloadCSV, formatINR, monthLabel, normalizeMoneyString, sumMoney } from '../utils/format.js'
import { EmptyState, ErrorState, GlassCard, PageHeader, Skeleton } from '../components/ui.jsx'
import ImportModal from '../components/ImportModal.jsx'
import { BudgetPieChart, ComparisonChart, DonutChart, PaymentMethodPieChart, TrendChart } from '../charts/charts.jsx'

export default function Analytics() {
  const { push } = useToast()
  const navigate = useNavigate()
  const [month, setMonth] = useState(currentMonth())
  const [data, setData] = useState(null)
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [trendCategory, setTrendCategory] = useState('')
  const [catTrendData, setCatTrendData] = useState([])
  const [importOpen, setImportOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [a, c] = await Promise.all([
        analyticsApi.get({ month }),
        categoriesApi.list({ page_size: 100 }),
      ])
      setData(a)
      setCategories(c.results)
    } catch (e) {
      setError(parseErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [month])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!trendCategory || !data?.daily_trend) { setCatTrendData([]); return }
    let live = true
    expensesApi.list({ category: trendCategory, month, page_size: 1000 })
      .then((r) => {
        if (!live) return
        const txns = r.results || []
        const byDate = (data.daily_trend || []).map((d) => ({
          date: d.date,
          spent: sumMoney(txns.filter((t) => t.date === d.date).map((t) => t.amount)),
        }))
        setCatTrendData(byDate)
      })
      .catch(() => { if (live) setCatTrendData([]) })
    return () => { live = false }
  }, [trendCategory, month, data])

  const exportCSV = () => {
    if (!data) return
    const rows = [
      ['Metric', 'Value'],
      ['Month', month],
      ['Spent', normalizeMoneyString(data.totals?.spent) || ''],
      ['Income', normalizeMoneyString(data.totals?.income) || ''],
      ['Net', normalizeMoneyString(data.totals?.net) || ''],
      [],
      ['Category', 'Total', 'Count', 'Share %'],
      ...(data.category_breakdown || []).map((c) => [c.category, normalizeMoneyString(c.total) || '', c.count, c.share]),
      [],
      ['Date', 'Total'],
      ...(data.daily_trend || []).map((d) => [d.date, normalizeMoneyString(d.spent) || '']),
    ]
    downloadCSV(`analytics-${month}.csv`, buildCSV(rows))
    push('Analytics report exported as CSV.')
  }

  const goTx = (q) => navigate(`/transactions?${q}`)

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle={`${monthLabel(month)} · Multi-hue pie chart suite — tap any slice or legend pill to drill into its transactions.`}
        actions={
          <>
            <button type="button" className="btn no-print" onClick={() => setImportOpen(true)}>
              <Upload size={16} /> Import PDF / CSV
            </button>
            <button type="button" className="btn no-print" onClick={() => window.print()}>
              <Printer size={16} /> Print report
            </button>
            <button type="button" className="btn no-print" onClick={exportCSV}>
              <Download size={16} /> Export CSV
            </button>
          </>
        }
      />
      <div className="field" style={{ maxWidth: 220, marginBottom: 16 }}>
        <label htmlFor="a-month">Month</label>
        <input id="a-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
      </div>
      {loading ? (
        <Skeleton lines={6} />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !data ? (
        <EmptyState title="No analytics data" />
      ) : (
        <>
          <div className="grid grid-3">
            <GlassCard className="stat-card">
              <p className="muted small">Spent</p>
              <p style={{ fontSize: 24, fontWeight: 800, color: '#FF6B8B' }}>{formatINR(data.totals?.spent)}</p>
              <p className="small muted">{data.totals?.expense_count ?? 0} transactions</p>
            </GlassCard>
            <GlassCard className="stat-card">
              <p className="muted small">Income</p>
              <p style={{ fontSize: 24, fontWeight: 800, color: 'var(--green)' }}>{formatINR(data.totals?.income)}</p>
              <p className="small muted">{data.totals?.income_count ?? 0} income entries</p>
            </GlassCard>
            <GlassCard className="stat-card">
              <p className="muted small">Net · Daily average</p>
              <p style={{ fontSize: 24, fontWeight: 800 }}>{formatINR(data.totals?.net)}</p>
              <p className="small muted">Daily average {formatINR(data.daily_average)}</p>
            </GlassCard>
          </div>
          <div className="grid grid-2" style={{ marginTop: 16 }}>
            <GlassCard>
              <h2>Spending by category</h2>
              {(data.category_breakdown || []).length ? (
                <DonutChart data={data.category_breakdown} onSelect={(cat) => goTx(`category=${encodeURIComponent(cat)}`)} />
              ) : (
                <EmptyState title="No category data this month" />
              )}
            </GlassCard>
            <GlassCard>
              <h2>Daily trend</h2>
              {(data.daily_trend || []).length ? (
                <TrendChart data={data.daily_trend} onSelect={(d) => goTx(`date_from=${d}&date_to=${d}`)} />
              ) : (
                <EmptyState title="No daily data this month" />
              )}
            </GlassCard>
            <GlassCard>
              <h2>Monthly comparison</h2>
              {(data.monthly_comparison || []).length ? (
                <ComparisonChart data={data.monthly_comparison} onSelect={(m) => goTx(`month=${m}`)} />
              ) : (
                <EmptyState title="No monthly data yet" />
              )}
            </GlassCard>
            <GlassCard>
              <h2>Payment methods & budget vs actual</h2>
              {(data.payment_method_breakdown || []).length > 0 ? (
                <PaymentMethodPieChart
                  data={data.payment_method_breakdown}
                  onSelect={(method) => goTx(`payment_method=${encodeURIComponent(method)}&month=${month}`)}
                />
              ) : null}
              {data.budgets?.overall ? (
                <div style={{ marginTop: 12 }}>
                  <p className="small muted">
                    Overall: spent {formatINR(data.budgets.overall.spent)} of {formatINR(data.budgets.overall.budgeted)} · remaining {formatINR(data.budgets.overall.remaining)} ({data.budgets.overall.percent_used ?? '—'}%)
                  </p>
                  <BudgetPieChart budgets={data.budgets} />
                </div>
              ) : (
                !(data.payment_method_breakdown || []).length && (
                  <EmptyState title="No budget set for this month" hint="Set a budget to compare planned vs actual spending." />
                )
              )}
            </GlassCard>
          </div>
          <GlassCard style={{ marginTop: 16 }}>
            <h2>Category trend</h2>
            <div className="field" style={{ maxWidth: 260 }}>
              <label htmlFor="a-cat">Category</label>
              <select id="a-cat" value={trendCategory} onChange={(e) => setTrendCategory(e.target.value)}>
                <option value="">All categories (daily trend above)</option>
                {(data.category_breakdown || []).map((c) => (
                  <option key={c.category} value={c.category}>{c.category}</option>
                ))}
              </select>
            </div>
            {trendCategory ? (
              <>
                {catTrendData.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <TrendChart
                      data={catTrendData}
                      onSelect={(d) => goTx(`category=${encodeURIComponent(trendCategory)}&date_from=${d}&date_to=${d}`)}
                    />
                  </div>
                )}
                <p className="small muted" style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => goTx(`category=${encodeURIComponent(trendCategory)}&month=${month}`)}
                  >
                    View {data.category_breakdown.find((c) => String(c.category) === trendCategory)?.category || 'category'} transactions for {monthLabel(month)}
                  </button>
                </p>
              </>
            ) : (
              <p className="small muted" style={{ marginTop: 10 }}>
                Pick a category to plot its daily spending distribution pie chart and jump to its transactions for this month.
              </p>
            )}
          </GlassCard>
          {(data.insights || []).length > 0 && (
            <GlassCard style={{ marginTop: 16 }}>
              <h2>Insights</h2>
              <ul>
                {data.insights.map((ins, i) => (
                  <li key={i}>{typeof ins === 'string' ? ins : <><strong>{ins.title}</strong>{ins.detail ? ` — ${ins.detail}` : ''}</>}</li>
                ))}
              </ul>
            </GlassCard>
          )}
        </>
      )}
      {importOpen && (
        <ImportModal
          categories={categories}
          existingExpenses={[]}
          onImported={() => { setImportOpen(false); load() }}
          onClose={() => setImportOpen(false)}
        />
      )}
    </>
  )
}
