import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowDownRight, ArrowUpRight, CalendarDays, CreditCard, Lightbulb, List, Target, TrendingUp, Upload, Wallet } from 'lucide-react'
import { analyticsApi, budgetsApi, categoriesApi, expensesApi, parseErrorMessage } from '../services/api.js'
import { computeDashboardStats, currentMonth, formatINR, formatPct, monthLabel, subtractMoney } from '../utils/format.js'
import { BudgetBar, EmptyState, ErrorState, GlassCard, PageHeader, Skeleton, StatCard } from '../components/ui.jsx'
import ImportModal from '../components/ImportModal.jsx'
import TransactionRow from '../components/TransactionRow.jsx'
import { DonutChart, PaymentMethodPieChart } from '../charts/charts.jsx'

export default function Dashboard() {
  const navigate = useNavigate()
  const month = currentMonth()
  const [analytics, setAnalytics] = useState(null)
  const [recent, setRecent] = useState([])
  const [budgets, setBudgets] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [importOpen, setImportOpen] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    Promise.all([
      analyticsApi.get({ month }),
      expensesApi.list({ month, ordering: '-date', page_size: 5 }),
      budgetsApi.list({ month }),
      categoriesApi.list({ page_size: 100 }),
    ])
      .then(([a, e, b, c]) => {
        setAnalytics(a)
        setRecent(e.results)
        setBudgets(b.results)
        setCategories(c.results)
      })
      .catch((e) => setError(parseErrorMessage(e)))
      .finally(() => setLoading(false))
  }, [month])

  useEffect(() => { load() }, [load])

  if (loading) return <><PageHeader title="Dashboard" subtitle={monthLabel(month)} /><Skeleton lines={6} /></>
  if (error) return <><PageHeader title="Dashboard" /><ErrorState message={error} onRetry={load} /></>

  const s = computeDashboardStats({ analytics, budgets })
  const delta = s.previousMonthDeltaPct
  const deltaUp = delta != null && Number(delta) > 0

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`${monthLabel(month)} · All figures come from your transactions and budgets — nothing is invented.`}
        actions={
          <>
            <button type="button" className="btn" onClick={() => setImportOpen(true)}>
              <Upload size={16} /> Import PDF / CSV
            </button>
            <Link className="btn" to="/income">Income ({formatINR(s.income)})</Link>
            <Link className="btn btn-primary" to="/transactions">View transactions</Link>
          </>
        }
      />
      <div className="grid grid-4">
        <StatCard icon={<Wallet size={16} />} accentColor="#FF6B8B" label="Spent this month" value={formatINR(s.spent)} sub={`${s.expenseCount} transactions`} />
        <StatCard icon={<Target size={16} />} accentColor="#10B981" label="Remaining budget" value={s.hasBudget ? formatINR(s.remaining) : 'No budget set'} sub={s.hasBudget ? `${formatPct(s.utilisation)} used` : 'Set one on the Budgets page'} />
        <StatCard icon={<TrendingUp size={16} />} accentColor="#06B6D4" label="Daily average" value={formatINR(s.dailyAverage)} sub={`Top: ${s.topCategory?.category_name || s.topCategory?.category || '—'}`} />
        <StatCard icon={<CalendarDays size={16} />} accentColor="#A855F7" label="vs previous month" value={s.previousMonthSpent ? formatINR(s.previousMonthSpent) : '—'} sub={delta != null ? `${deltaUp ? '▲' : '▼'} ${formatPct(Math.abs(Number(delta)))} vs last month` : 'No previous-month data'} />
      </div>
      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <GlassCard>
          <h2>Spending by category</h2>
          {(analytics?.category_breakdown || []).length === 0 ? (
            <EmptyState title="No spending this month" hint="Add your first expense or import a PDF/CSV statement to see the pie chart." />
          ) : (
            <>
              <DonutChart data={analytics.category_breakdown} onSelect={(cat) => navigate(`/transactions?category=${encodeURIComponent(cat)}`)} />
              <div className="grid" style={{ gap: 4, marginTop: 8 }}>
                {analytics.category_breakdown.map((c) => (
                  <div key={c.category} style={{ display: 'flex', justifyContent: 'space-between' }} className="small">
                    <span>{c.category} · {c.count} txns</span>
                    <span>{formatINR(c.total)} ({formatPct(c.share)})</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </GlassCard>
        <GlassCard>
          <h2>Budget progress & payment modes</h2>
          {s.hasBudget ? (
            <>
              <p className="muted small">Overall budget {formatINR(s.budget)} · spent {formatINR(s.spent)} · remaining {formatINR(s.remaining)}</p>
              <div style={{ marginTop: 12 }}><BudgetBar spent={s.spent} budget={s.budget} /></div>
              <p className="small muted" style={{ marginTop: 10 }}>
                {Number(s.remaining) < 0 ? `Over budget by ${formatINR(subtractMoney(s.spent, s.budget))}.` : 'Within budget for now.'}
              </p>
            </>
          ) : (
            <EmptyState title="No budget set for this month" hint="Set an overall or per-category budget on the Budgets page to track progress here." />
          )}
          {(analytics?.budgets?.categories || []).length > 0 && (
            <div style={{ marginTop: 16 }}>
              {analytics.budgets.categories.map((b) => (
                <div key={b.category_id || b.category} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }} className="small">
                    <span>{b.category}</span>
                    <span>{formatINR(b.spent)} / {formatINR(b.budgeted)}</span>
                  </div>
                  <BudgetBar spent={b.spent} budget={b.budgeted} threshold={b.alert_threshold} />
                </div>
              ))}
            </div>
          )}
          {(analytics?.payment_method_breakdown || []).length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 6 }}><CreditCard size={15} /> Payment methods share</h3>
              <PaymentMethodPieChart
                data={analytics.payment_method_breakdown}
                onSelect={(method) => navigate(`/transactions?payment_method=${encodeURIComponent(method)}`)}
              />
            </div>
          )}
        </GlassCard>
      </div>
      {analytics?.insights?.length > 0 && (
        <GlassCard style={{ marginTop: 16 }}>
          <h2 style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Lightbulb size={18} color="#F59E0B" /> Insights</h2>
          <ul>
            {analytics.insights.map((ins, i) => (
              <li key={i}>{typeof ins === 'string' ? ins : <><strong>{ins.title}</strong>{ins.detail ? ` — ${ins.detail}` : ''}</>}</li>
            ))}
          </ul>
        </GlassCard>
      )}
      <GlassCard style={{ marginTop: 16 }}>
        <h2 style={{ display: 'flex', gap: 8, alignItems: 'center' }}><List size={16} /> Recent transactions</h2>
        {recent.length === 0 ? (
          <EmptyState title="No transactions yet" hint="Use Quick add or Import PDF / CSV to record your expenses." />
        ) : (
          recent.map((tx) => (
            <TransactionRow
              key={tx.id}
              tx={tx}
              onEdit={() => navigate(`/transactions?edit=${tx.id}`)}
              onDelete={() => navigate('/transactions')}
              onRepeat={() => navigate(`/transactions?repeat=${tx.id}`)}
            />
          ))
        )}
      </GlassCard>
      <p className="small muted" style={{ marginTop: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
        {deltaUp ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />} Net this month: {formatINR(s.net)} (income {formatINR(s.income)} − spent {formatINR(s.spent)}).
      </p>
      {importOpen && (
        <ImportModal
          categories={categories}
          existingExpenses={recent}
          onImported={() => { setImportOpen(false); load() }}
          onClose={() => setImportOpen(false)}
        />
      )}
    </>
  )
}
