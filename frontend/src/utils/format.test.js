import { describe, expect, it } from 'vitest'
import { addMoney, computeDashboardStats, formatDate, formatINR, isValidMoney, monthLabel, normalizeMoneyString, previousMonth, subtractMoney, sumMoney, validateExpenseForm } from './format.js'

describe('INR formatting (string money, no floats)', () => {
  it('formats Indian grouping with 2 decimals', () => {
    expect(formatINR('1234567.89')).toBe('₹12,34,567.89')
    expect(formatINR('250')).toBe('₹250.00')
    expect(formatINR('0.1')).toBe('₹0.10')
  })
  it('normalizes money strings', () => {
    expect(normalizeMoneyString('1,250.5')).toBe('1250.50')
    expect(normalizeMoneyString('abc')).toBeNull()
    expect(isValidMoney('-5')).toBe(false)
    expect(isValidMoney('250.00')).toBe(true)
  })
  it('sums without float drift (0.10 + 0.20 = 0.30)', () => {
    expect(addMoney('0.10', '0.20')).toBe('0.30')
    expect(sumMoney(['0.10', '0.20', '100.00'])).toBe('100.30')
    expect(subtractMoney('1000.00', '250.50')).toBe('749.50')
  })
})
describe('date/month helpers (date-only strings, no UTC shift)', () => {
  it('formats YYYY-MM-DD by parts', () => { expect(formatDate('2026-10-05')).toBe('05 Oct 2026') })
  it('labels months and steps back across a year boundary', () => {
    expect(monthLabel('2026-01')).toBe('January 2026')
    expect(previousMonth('2026-01')).toBe('2025-12')
  })
})
describe('ExpenseForm validation', () => {
  it('requires date, category, description and a valid amount', () => {
    const errs = validateExpenseForm({ date: '', category: '', description: '', amount: 'abc' })
    expect(errs.date).toBeTruthy(); expect(errs.category).toBeTruthy(); expect(errs.description).toBeTruthy(); expect(errs.amount).toBeTruthy()
  })
  it('passes a valid form', () => {
    expect(validateExpenseForm({ date: '2026-10-29', category: 1, description: 'Lunch', amount: '250.00', payment_method: 'upi' })).toEqual({})
  })
})
describe('dashboard calculation', () => {
  it('derives spend, remaining, utilisation and net from analytics only', () => {
    const analytics = { totals: { spent: '4000.00', income: '10000.00', expense_count: 8, income_count: 1 }, daily_average: '129.03', previous_month: { month: '2026-09', spent: '5000.00', delta_percent: '-20.00' }, budgets: { overall: { budgeted: '8000.00', spent: '4000.00', remaining: '4000.00', percent_used: '50.00' }, categories: [] }, top_category: { category: 'Food' } }
    const s = computeDashboardStats({ analytics, budgets: [] })
    expect(s.spent).toBe('4000.00'); expect(s.remaining).toBe('4000.00'); expect(s.utilisation).toBe(50); expect(s.net).toBe('6000.00'); expect(s.hasBudget).toBe(true); expect(s.previousMonthSpent).toBe('5000.00'); expect(s.previousMonthDeltaPct).toBe('-20.00'); expect(s.topCategory.category).toBe('Food')
  })
  it('reports no budget gracefully', () => {
    const s = computeDashboardStats({ analytics: { totals: { spent: '100.00', income: '0.00' }, budgets: { overall: null, categories: [] } }, budgets: [] })
    expect(s.hasBudget).toBe(false); expect(s.remaining).toBeNull(); expect(s.utilisation).toBeNull()
  })
})
