import { describe, it, expect, beforeEach } from 'vitest'
import {
  exportLocalBackup, importLocalBackup,
  localAnalyticsApi, localAuthApi, localBudgetsApi, localCategoriesApi,
  localExpensesApi, localGoalsApi, localIncomesApi, localRecurringApi,
} from './localApi.js'

beforeEach(() => { localStorage.clear() })

async function registered() {
  await localAuthApi.register({ username: 'tester', email: '', password: 'password123' })
  const cats = (await localCategoriesApi.list({ page_size: 100 })).results
  return cats
}

describe('on-device auth + categories', () => {
  it('seeds 10 default categories on register and rejects a second account', async () => {
    const cats = await registered()
    expect(cats).toHaveLength(10)
    expect(cats.map((c) => c.name)).toContain('Food')
    await expect(localAuthApi.register({ username: 'other', password: 'password123' })).rejects.toMatchObject({ status: 400 })
  })
  it('rejects a duplicate category name case-insensitively', async () => {
    await registered()
    await expect(localCategoriesApi.create({ name: 'food' })).rejects.toMatchObject({ status: 400 })
  })
  it('blocks deleting a category that is in use', async () => {
    const cats = await registered()
    const food = cats.find((c) => c.name === 'Food')
    await localExpensesApi.create({ date: '2026-10-05', category: food.id, description: 'Lunch', amount: '150' })
    await expect(localCategoriesApi.remove(food.id)).rejects.toMatchObject({ status: 400 })
  })
})

describe('on-device expenses', () => {
  it('validates amount and filters/paginates', async () => {
    const cats = await registered()
    const food = cats.find((c) => c.name === 'Food')
    await expect(localExpensesApi.create({ date: '2026-10-05', category: food.id, description: 'Lunch', amount: '-5' })).rejects.toMatchObject({ status: 400 })
    await localExpensesApi.create({ date: '2026-10-05', category: food.id, description: 'Lunch', amount: '150' })
    await localExpensesApi.create({ date: '2026-10-06', category: food.id, description: 'Dinner', amount: '250.50' })
    const all = await localExpensesApi.list({ page_size: 100 })
    expect(all.count).toBe(2)
    const page1 = await localExpensesApi.list({ page: 1, page_size: 1 })
    expect(page1.results).toHaveLength(1)
    expect(page1.next).toBe(2)
    const found = await localExpensesApi.list({ search: 'dinn' })
    expect(found.results.map((e) => e.description)).toEqual(['Dinner'])
    const edited = await localExpensesApi.update(all.results[0].id, { amount: '175' })
    expect(edited.amount).toBe('175.00')
  })
})

describe('on-device budgets + analytics', () => {
  it('persists budgets, rejects duplicates, and analytics matches the list', async () => {
    const cats = await registered()
    const food = cats.find((c) => c.name === 'Food')
    await localExpensesApi.create({ date: '2026-09-20', category: food.id, description: 'Lunch', amount: '150' })
    await localExpensesApi.create({ date: '2026-09-27', category: food.id, description: 'Dinner', amount: '250' })
    await localBudgetsApi.create({ month: '2026-09-01', category: null, amount: '1000' })
    await expect(localBudgetsApi.create({ month: '2026-09-01', category: null, amount: '500' })).rejects.toMatchObject({ status: 400 })
    const a = await localAnalyticsApi.get({ month: '2026-09' })
    expect(a.totals.spent).toBe('400.00')
    expect(a.totals.expense_count).toBe(2)
    expect(a.category_breakdown).toEqual([{ category: 'Food', total: '400.00', count: 2, share: '100.00' }])
    expect(a.budgets.overall.budgeted).toBe('1000.00')
    expect(a.budgets.overall.spent).toBe('400.00')
    expect(a.insights[0]).toMatch(/Top category: Food/)
  })
})

describe('on-device recurring', () => {
  it('generates monthly dues clamped to month end and never twice', async () => {
    const cats = await registered()
    const food = cats.find((c) => c.name === 'Food')
    await localRecurringApi.create({
      category: food.id, description: 'Rent', amount: '5000',
      frequency: 'monthly', start_date: '2026-01-31', end_date: null, active: true,
    })
    // Generate dues up to today, then run again: the second run must add none.
    const first = await localRecurringApi.generateDue()
    expect(first.created).toBeGreaterThan(0)
    const second = await localRecurringApi.generateDue()
    expect(second.created).toBe(0)
    const created = (await localExpensesApi.list({ search: 'Rent', page_size: 1000 })).results
    // Jan 31 -> Feb 28 clamp must appear among generated dates
    expect(created.map((e) => e.date)).toContain('2026-02-28')
    expect(new Set(created.map((e) => e.date)).size).toBe(created.length)
  })
})

describe('on-device goals', () => {
  it('computes saved amount and progress from contributions', async () => {
    await registered()
    const g = await localGoalsApi.create({ name: 'Laptop', target_amount: '10000', target_date: null, description: '' })
    await localGoalsApi.contributions.create(g.id, { amount: '2500', date: '2026-10-01', note: '' })
    const after = await localGoalsApi.get(g.id)
    expect(after.saved_amount).toBe('2500.00')
    expect(after.progress_percent).toBe('25.00')
  })
})

describe('on-device incomes + backup/restore', () => {
  it('creates, filters by source/search/month, and exports/restores JSON backup', async () => {
    const cats = await registered()
    const food = cats.find((c) => c.name === 'Food')
    const exp = await localExpensesApi.create({ date: '2026-10-05', category: food.id, description: 'Lunch', amount: '150' })
    expect(exp.category_icon).toBe('utensils')
    await localIncomesApi.create({ date: '2026-10-01', source: 'allowance', description: 'Hostel pocket money', amount: '5000' })
    await localIncomesApi.create({ date: '2026-10-10', source: 'scholarship', description: 'Merit grant', amount: '12000' })
    const bySource = await localIncomesApi.list({ source: 'scholarship' })
    expect(bySource.count).toBe(1)
    expect(bySource.results[0].description).toBe('Merit grant')
    const backup = exportLocalBackup()
    localStorage.clear()
    const summary = importLocalBackup(backup)
    expect(summary.expenses).toBe(1)
    expect(summary.incomes).toBe(2)
    const afterIncomes = await localIncomesApi.list({ month: '2026-10' })
    expect(afterIncomes.count).toBe(2)
  })
})
