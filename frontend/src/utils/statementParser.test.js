import { describe, expect, it } from 'vitest'
import {
  computeImportAnalysis,
  generateSampleStatementCSV,
  generateSampleStatementPDF,
  normalizeStatementDate,
  parseCSVStatement,
  parsePDFStatement,
  parseStatementAmount,
  parseTransactionsFromTextLines,
} from './statementParser.js'

const MOCK_CATEGORIES = [
  { id: 1, name: 'Food', color: '#FF6B8B' },
  { id: 2, name: 'Transport', color: '#6366F1' },
  { id: 3, name: 'Education', color: '#06B6D4' },
  { id: 4, name: 'Accommodation', color: '#10B981' },
  { id: 5, name: 'Shopping', color: '#F59E0B' },
  { id: 6, name: 'Entertainment', color: '#A855F7' },
  { id: 7, name: 'Health', color: '#38BDF8' },
  { id: 8, name: 'Subscriptions', color: '#EC4899' },
  { id: 9, name: 'Personal Care', color: '#F97316' },
  { id: 10, name: 'Other', color: '#14B8A6' },
]

describe('statementParser date & amount normalization', () => {
  it('parses Indian, PhonePe/GPay, and ISO statement dates', () => {
    expect(normalizeStatementDate('2026-10-15')).toBe('2026-10-15')
    expect(normalizeStatementDate('15/10/2026')).toBe('2026-10-15')
    expect(normalizeStatementDate('05-Oct-2026')).toBe('2026-10-05')
    expect(normalizeStatementDate('12 Oct 26')).toBe('2026-10-12')
    expect(normalizeStatementDate('Oct 15, 2026')).toBe('2026-10-15')
    expect(normalizeStatementDate('15Oct2026')).toBe('2026-10-15')
  })

  it('parses formatted INR amounts and Dr/Cr markers', () => {
    expect(parseStatementAmount('₹1,250.50 Dr')).toMatchObject({ amount: '1250.50', explicitType: 'expense' })
    expect(parseStatementAmount('8,000.00 Cr')).toMatchObject({ amount: '8000.00', explicitType: 'income' })
    expect(parseStatementAmount('₹285')).toMatchObject({ amount: '285.00' })
  })
})

describe('CSV & PDF statement transaction extraction and analysis', () => {
  it('extracts, categorizes, and analyzes sample CSV statement', () => {
    const csv = generateSampleStatementCSV()
    const rows = parseCSVStatement(csv, MOCK_CATEGORIES, [])
    expect(rows.length).toBe(10)
    const swiggy = rows.find((r) => r.merchant === 'Swiggy')
    expect(swiggy).toBeTruthy()
    expect(swiggy.category_name).toBe('Food')
    expect(swiggy.amount).toBe('285.00')
    expect(swiggy.kind).toBe('expense')

    const allowance = rows.find((r) => r.kind === 'income')
    expect(allowance).toBeTruthy()
    expect(allowance.amount).toBe('8000.00')
    expect(allowance.source).toBe('allowance')

    const analysis = computeImportAnalysis(rows, MOCK_CATEGORIES)
    expect(analysis.expenseCount).toBe(9)
    expect(analysis.incomeCount).toBe(1)
    expect(analysis.totalSpent).toBe('3692.00')
    expect(analysis.totalIncome).toBe('8000.00')
    expect(analysis.categoryBreakdown.length).toBeGreaterThan(3)
  })

  it('extracts and categorizes transactions from a PDF statement buffer', async () => {
    const pdfBytes = generateSampleStatementPDF()
    const rows = await parsePDFStatement(pdfBytes, MOCK_CATEGORIES, [])
    expect(rows.length).toBe(8)
    const expRows = rows.filter((r) => r.kind === 'expense')
    const incRows = rows.filter((r) => r.kind === 'income')
    expect(expRows.length).toBe(7)
    expect(incRows.length).toBe(1)
    expect(incRows[0].amount).toBe('7500.00')
  })

  it('parses multi-line PhonePe/GPay and bank PDF statement lines', () => {
    const lines = [
      'Statement of Account',
      'Oct 15, 2026   Paid to Swiggy   DEBIT   ₹285',
      '02:30 PM   Transaction ID T26101500912   UTR 429001829102',
      '16/10/2026   UPI/4290028191/DELHI METRO RAIL',
      'Ref No 9981271   60.00 Dr   14,220.00',
      'Oct 18, 2026   Received from Family Hostel Allowance   CREDIT   ₹5,000',
    ]
    const rows = parseTransactionsFromTextLines(lines, MOCK_CATEGORIES, [])
    expect(rows.length).toBe(3)
    expect(rows[0]).toMatchObject({
      date: '2026-10-15',
      merchant: 'Swiggy',
      category_name: 'Food',
      amount: '285.00',
      kind: 'expense',
    })
    expect(rows[1]).toMatchObject({
      date: '2026-10-16',
      merchant: 'Metro Rail',
      category_name: 'Transport',
      amount: '60.00',
      kind: 'expense',
    })
    expect(rows[2]).toMatchObject({
      date: '2026-10-18',
      amount: '5000.00',
      kind: 'income',
      source: 'allowance',
    })
  })
})
