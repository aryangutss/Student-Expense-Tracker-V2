import { useMemo, useRef, useState } from 'react'
import {
  AlertCircle, CheckCircle2, ClipboardPaste, Download, FileSpreadsheet,
  FileText, Lock, Plus, Sparkles, Trash2, Upload,
} from 'lucide-react'
import { expensesApi, incomesApi, parseErrorMessage } from '../services/api.js'
import { useToast } from '../context/ToastContext.jsx'
import { downloadCSV, formatDate, formatINR, todayInKolkata } from '../utils/format.js'
import {
  computeImportAnalysis,
  generateSampleStatementCSV,
  generateSampleStatementPDF,
  parseCSVStatement,
  parsePDFStatement,
  parseTransactionsFromTextLines,
} from '../utils/statementParser.js'
import { DonutChart, PaymentMethodPieChart } from '../charts/charts.jsx'
import { Modal } from './ui.jsx'

const PAYMENT_METHODS = ['upi', 'card', 'cash', 'bank', 'other']
const INCOME_SOURCES = ['allowance', 'scholarship', 'part-time', 'other']

export default function ImportModal({
  categories = [],
  existingExpenses = [],
  onImported,
  onClose,
}) {
  const { push } = useToast()
  const pdfInputRef = useRef(null)
  const csvInputRef = useRef(null)
  const [fileName, setFileName] = useState('')
  const [fileType, setFileType] = useState('') // 'csv' | 'pdf' | 'text'
  const [rows, setRows] = useState([])
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [includeIncomes, setIncludeIncomes] = useState(true)
  const [rowFilter, setRowFilter] = useState('all')
  const [error, setError] = useState('')

  // Password-protected PDF state
  const [pendingPdfBuffer, setPendingPdfBuffer] = useState(null)
  const [pdfPasswordNeeded, setPdfPasswordNeeded] = useState(false)
  const [pdfPassword, setPdfPassword] = useState('')

  // Raw text paste / PDF diagnostic inspector state
  const [showTextPaste, setShowTextPaste] = useState(false)
  const [rawStatementText, setRawStatementText] = useState('')

  const analysis = useMemo(
    () => computeImportAnalysis(rows, categories),
    [rows, categories],
  )

  const runPdfExtraction = async (buffer, password = '', name = fileName) => {
    setError('')
    setParsing(true)
    try {
      const result = await parsePDFStatement(buffer, categories, existingExpenses, {
        password,
        returnDiagnostics: true,
      })
      const extracted = result.transactions || []
      const lines = result.lines || []
      setPdfPasswordNeeded(false)
      setPendingPdfBuffer(null)

      if (lines.length > 0) {
        setRawStatementText(lines.join('\n'))
      }

      if (!extracted.length) {
        setShowTextPaste(true)
        setError(
          lines.length > 0
            ? `Extracted ${lines.length} text lines from ${name}, but could not auto-detect Date + Amount columns. You can edit the extracted lines below and tap "Analyze Text".`
            : `No selectable text was found in ${name} (it may be a scanned image PDF). Paste your statement lines below or try a CSV statement.`,
        )
      } else {
        push(`Analyzed ${extracted.length} transactions from ${name}.`)
      }
      setRows(extracted)
    } catch (err) {
      if (err?.code === 'PDF_PASSWORD_REQUIRED') {
        setPendingPdfBuffer(buffer)
        setPdfPasswordNeeded(true)
        setError(
          password
            ? 'Incorrect PDF password. Please enter the right password to unlock this statement.'
            : err.message,
        )
      } else {
        setError(parseErrorMessage(err) || 'Failed to parse PDF file.')
      }
    } finally {
      setParsing(false)
    }
  }

  const handleFile = async (file) => {
    if (!file) return
    setError('')
    setPdfPasswordNeeded(false)
    setPendingPdfBuffer(null)
    setFileName(file.name)
    const lower = (file.name || '').toLowerCase()
    const isPdf = lower.endsWith('.pdf') || file.type === 'application/pdf'
    setFileType(isPdf ? 'pdf' : 'csv')

    if (isPdf) {
      const buf = await file.arrayBuffer()
      await runPdfExtraction(buf, '', file.name)
      return
    }

    setParsing(true)
    try {
      const text = await file.text()
      setRawStatementText(text)
      let extracted = parseCSVStatement(text, categories, existingExpenses)
      if (!extracted.length) {
        extracted = parseTransactionsFromTextLines(text.split(/\r?\n/), categories, existingExpenses)
      }
      if (!extracted.length) {
        setShowTextPaste(true)
        setError(
          'No recognizable transactions were found in this file. You can inspect or edit the text below and click "Analyze Text".',
        )
      } else {
        push(`Analyzed ${extracted.length} transactions from ${file.name}.`)
      }
      setRows(extracted)
    } catch (err) {
      setError(parseErrorMessage(err) || 'Failed to parse file.')
    } finally {
      setParsing(false)
    }
  }

  const handleAnalyzePastedText = () => {
    setError('')
    const text = rawStatementText.trim()
    if (!text) {
      setError('Paste or type at least one transaction line (e.g. "2026-10-15 Swiggy Lunch 240.00 Dr").')
      return
    }
    setFileName(fileName || 'pasted-statement.txt')
    setFileType('text')
    let extracted = parseTransactionsFromTextLines(text.split(/\r?\n/), categories, existingExpenses)
    if (!extracted.length) {
      extracted = parseCSVStatement(text, categories, existingExpenses)
    }
    if (!extracted.length) {
      setError('Could not find lines containing both a valid Date and an Amount. Ensure each line has a date (e.g. 15/10/2026) and amount (e.g. 240.00).')
      return
    }
    setRows(extracted)
    setShowTextPaste(false)
    push(`Extracted ${extracted.length} transactions from text!`)
  }

  const addManualRow = () => {
    const defaultCat = categories[0]
    setRows((prev) => [
      {
        id: `manual-${Date.now()}-${prev.length + 1}`,
        selected: true,
        isDuplicate: false,
        kind: 'expense',
        date: todayInKolkata(),
        description: 'New Statement Entry',
        merchant: '',
        category: defaultCat?.id ?? '',
        category_name: defaultCat?.name || 'Other',
        payment_method: 'upi',
        source: 'other',
        amount: '100.00',
        notes: 'Added during statement import',
      },
      ...prev,
    ])
  }

  const loadSampleCSV = () => {
    setError('')
    setPdfPasswordNeeded(false)
    setFileName('sample-bank-upi-statement.csv')
    setFileType('csv')
    const sample = generateSampleStatementCSV()
    setRawStatementText(sample)
    const extracted = parseCSVStatement(sample, categories, existingExpenses)
    setRows(extracted)
    push(`Loaded sample CSV statement (${extracted.length} transactions).`)
  }

  const loadSamplePDF = async () => {
    setError('')
    setPdfPasswordNeeded(false)
    setFileName('sample-bank-upi-statement.pdf')
    setFileType('pdf')
    const pdfBytes = generateSampleStatementPDF()
    await runPdfExtraction(pdfBytes, '', 'sample-bank-upi-statement.pdf')
  }

  const updateRow = (id, patch) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r
        const next = { ...r, ...patch }
        if (patch.category !== undefined) {
          const catObj = categories.find((c) => String(c.id) === String(patch.category))
          next.category_name = catObj?.name || 'Other'
        }
        return next
      }),
    )
  }

  const removeRow = (id) => setRows((prev) => prev.filter((r) => r.id !== id))

  const toggleAll = (checked) => {
    setRows((prev) => prev.map((r) => ({ ...r, selected: checked })))
  }

  const visibleRows = useMemo(() => {
    return rows.filter((r) => {
      if (rowFilter === 'expense') return r.kind === 'expense'
      if (rowFilter === 'income') return r.kind === 'income'
      if (rowFilter === 'duplicate') return r.isDuplicate
      return true
    })
  }, [rows, rowFilter])

  const doImport = async () => {
    const selected = rows.filter((r) => r.selected)
    const expPayload = selected
      .filter((r) => r.kind === 'expense')
      .map((r) => ({
        date: r.date,
        category: r.category ? Number(r.category) : (categories[0]?.id ?? null),
        description: r.description.trim() || 'Imported expense',
        merchant: r.merchant || '',
        amount: r.amount,
        payment_method: r.payment_method || 'upi',
        notes: r.notes || `Imported from ${fileName || 'statement'}`,
        tags: 'imported',
      }))

    const incPayload = includeIncomes
      ? selected
          .filter((r) => r.kind === 'income')
          .map((r) => ({
            date: r.date,
            source: r.source || 'other',
            description: r.description.trim() || 'Imported income',
            amount: r.amount,
          }))
      : []

    if (!expPayload.length && !incPayload.length) {
      push('Select at least one transaction to import.', 'error')
      return
    }

    setImporting(true)
    setError('')
    try {
      let createdExp = 0
      let createdInc = 0
      if (typeof expensesApi.bulkImport === 'function') {
        const res = await expensesApi.bulkImport({
          expenses: expPayload,
          incomes: incPayload,
        })
        createdExp = res?.created_expenses ?? expPayload.length
        createdInc = res?.created_incomes ?? incPayload.length
      } else {
        for (const item of expPayload) {
          await expensesApi.create(item)
          createdExp += 1
        }
        for (const item of incPayload) {
          await incomesApi.create(item)
          createdInc += 1
        }
      }
      const summaryParts = []
      if (createdExp > 0) summaryParts.push(`${createdExp} expense${createdExp === 1 ? '' : 's'}`)
      if (createdInc > 0) summaryParts.push(`${createdInc} income${createdInc === 1 ? '' : 's'}`)
      push(`Successfully imported ${summaryParts.join(' and ')} into your spending analysis!`)
      onImported?.()
    } catch (err) {
      const m = parseErrorMessage(err)
      setError(m)
      push(m, 'error')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Modal title="Import & Analyze Statement (PDF / CSV)" onClose={onClose} wide>
      <div className="form-grid" style={{ gap: 16 }}>
        {/* Upload / Dropzone Bar with dedicated Android-friendly PDF & CSV pickers */}
        <div
          className="import-dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const f = e.dataTransfer?.files?.[0]
            if (f) handleFile(f)
          }}
        >
          <input
            ref={pdfInputRef}
            type="file"
            accept="application/pdf,.pdf"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) handleFile(f)
            }}
          />
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,text/csv,text/comma-separated-values,application/vnd.ms-excel,text/plain"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) handleFile(f)
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="brand-mark" style={{ width: 44, height: 44, flexShrink: 0 }}>
                <Upload size={22} color="#fff" />
              </span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>
                  {fileName ? `Loaded: ${fileName}` : 'Upload Bank / UPI Statement (PDF or CSV)'}
                </div>
                <div className="small muted">
                  Supports PhonePe, GPay, Paytm, SBI, HDFC, ICICI, Axis PDFs & CSVs (including password-protected PDFs).
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => pdfInputRef.current?.click()}
                disabled={parsing}
              >
                <FileText size={16} /> {parsing && fileType === 'pdf' ? 'Analyzing PDF…' : 'Choose PDF'}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => csvInputRef.current?.click()}
                disabled={parsing}
              >
                <FileSpreadsheet size={16} /> {parsing && fileType === 'csv' ? 'Analyzing CSV…' : 'Choose CSV'}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setShowTextPaste((v) => !v)}
              >
                <ClipboardPaste size={14} /> {showTextPaste ? 'Hide Text Box' : 'Paste Text'}
              </button>
              <button type="button" className="btn btn-sm" onClick={loadSamplePDF}>
                <FileText size={14} /> Sample PDF
              </button>
              <button type="button" className="btn btn-sm" onClick={loadSampleCSV}>
                <FileSpreadsheet size={14} /> Sample CSV
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => downloadCSV('statement-template.csv', generateSampleStatementCSV())}
                title="Download a sample CSV template"
              >
                <Download size={14} /> Template
              </button>
            </div>
          </div>
        </div>

        {/* Password-Protected PDF Unlock Prompt */}
        {pdfPasswordNeeded && pendingPdfBuffer && (
          <div className="glass card" style={{ padding: 14, borderColor: 'var(--violet)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, marginBottom: 8 }}>
              <Lock size={16} color="var(--violet)" />
              <span>Unlock Password-Protected PDF Statement</span>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                type="password"
                className="import-input"
                style={{ flex: 1, minWidth: 200 }}
                placeholder="Enter PDF statement password…"
                value={pdfPassword}
                onChange={(e) => setPdfPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && pdfPassword) {
                    runPdfExtraction(pendingPdfBuffer, pdfPassword, fileName)
                  }
                }}
              />
              <button
                type="button"
                className="btn btn-primary"
                disabled={!pdfPassword || parsing}
                onClick={() => runPdfExtraction(pendingPdfBuffer, pdfPassword, fileName)}
              >
                Unlock & Analyze PDF
              </button>
            </div>
          </div>
        )}

        {/* Paste / Inspect Statement Text Panel */}
        {showTextPaste && (
          <div className="glass card" style={{ padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span className="small" style={{ fontWeight: 700 }}>
                Paste Statement Lines or Inspect Extracted PDF Text
              </span>
              <span className="small muted">One transaction per line (Date + Narration + Amount)</span>
            </div>
            <textarea
              className="import-input"
              rows={5}
              placeholder={`Example lines:\n15/10/2026  UPI/SWIGGY LUNCH ORDER  240.00 Dr\nOct 16, 2026  Paid to Delhi Metro  ₹60\n18-10-2026  NEFT Monthly Allowance  8000.00 Cr`}
              value={rawStatementText}
              onChange={(e) => setRawStatementText(e.target.value)}
              style={{ fontFamily: 'monospace', fontSize: 12.5, resize: 'vertical' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button type="button" className="btn btn-sm" onClick={() => setRawStatementText('')}>
                Clear
              </button>
              <button type="button" className="btn btn-sm btn-primary" onClick={handleAnalyzePastedText}>
                <Sparkles size={14} /> Analyze Text
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="glass" style={{ padding: 12, borderColor: 'rgba(248,113,113,0.55)', display: 'flex', gap: 10, alignItems: 'center' }} role="alert">
            <AlertCircle size={18} color="var(--red)" />
            <span className="small" style={{ color: 'var(--red)' }}>{error}</span>
          </div>
        )}

        {rows.length > 0 && (
          <>
            {/* Instant Statement Analysis Summary */}
            <div className="grid grid-4">
              <div className="glass card" style={{ padding: 14 }}>
                <div className="small muted">Selected to Import</div>
                <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>
                  {analysis.selectedCount} <span className="small muted">/ {rows.length}</span>
                </div>
                <div className="small muted">
                  {analysis.expenseCount} expenses · {analysis.incomeCount} incomes
                </div>
              </div>
              <div className="glass card" style={{ padding: 14 }}>
                <div className="small muted">Detected Spend</div>
                <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: '#FF6B8B' }}>
                  {formatINR(analysis.totalSpent)}
                </div>
                <div className="small muted">
                  Top: {analysis.categoryBreakdown[0]?.category || '—'}
                </div>
              </div>
              <div className="glass card" style={{ padding: 14 }}>
                <div className="small muted">Detected Income</div>
                <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: 'var(--green)' }}>
                  +{formatINR(analysis.totalIncome)}
                </div>
                <div className="small muted">
                  {fileType.toUpperCase()} statement
                </div>
              </div>
              <div className="glass card" style={{ padding: 14 }}>
                <div className="small muted">Date Span & Duplicates</div>
                <div style={{ fontSize: 15, fontWeight: 700, marginTop: 6 }}>
                  {analysis.dateFrom ? `${formatDate(analysis.dateFrom)} → ${formatDate(analysis.dateTo)}` : '—'}
                </div>
                <div className="small muted" style={{ marginTop: 2 }}>
                  {analysis.duplicateCount > 0
                    ? `${analysis.duplicateCount} duplicate(s) auto-skipped`
                    : 'No duplicates detected'}
                </div>
              </div>
            </div>

            {/* Live Pie Chart Analysis Preview of the Imported File */}
            {analysis.categoryBreakdown.length > 0 && (
              <div className="grid grid-2">
                <div className="glass card" style={{ padding: 16 }}>
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <Sparkles size={16} color="#FF6B8B" /> Statement Spend by Category
                  </h3>
                  <p className="small muted" style={{ marginBottom: 8 }}>
                    Live preview of how these imported expenses will appear in your Spending Analysis.
                  </p>
                  <DonutChart data={analysis.categoryBreakdown} />
                </div>
                <div className="glass card" style={{ padding: 16 }}>
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <CheckCircle2 size={16} color="#06B6D4" /> Statement Payment Modes
                  </h3>
                  <p className="small muted" style={{ marginBottom: 8 }}>
                    Detected payment channels across your selected transactions.
                  </p>
                  <PaymentMethodPieChart data={analysis.methodBreakdown} />
                </div>
              </div>
            )}

            {/* Filter & Bulk Action Toolbar */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button type="button" className={`btn btn-sm${rowFilter === 'all' ? ' btn-primary' : ''}`} onClick={() => setRowFilter('all')}>
                  All ({rows.length})
                </button>
                <button type="button" className={`btn btn-sm${rowFilter === 'expense' ? ' btn-primary' : ''}`} onClick={() => setRowFilter('expense')}>
                  Expenses ({rows.filter((r) => r.kind === 'expense').length})
                </button>
                <button type="button" className={`btn btn-sm${rowFilter === 'income' ? ' btn-primary' : ''}`} onClick={() => setRowFilter('income')}>
                  Incomes ({rows.filter((r) => r.kind === 'income').length})
                </button>
                {analysis.duplicateCount > 0 && (
                  <button type="button" className={`btn btn-sm${rowFilter === 'duplicate' ? ' btn-primary' : ''}`} onClick={() => setRowFilter('duplicate')}>
                    Duplicates ({analysis.duplicateCount})
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={includeIncomes}
                    onChange={(e) => setIncludeIncomes(e.target.checked)}
                  />
                  Import detected incomes too
                </label>
                <button type="button" className="btn btn-sm" onClick={addManualRow}>
                  <Plus size={14} /> Add Row
                </button>
                <button type="button" className="btn btn-sm" onClick={() => toggleAll(true)}>Select all</button>
                <button type="button" className="btn btn-sm" onClick={() => toggleAll(false)}>Clear selection</button>
              </div>
            </div>

            {/* Interactive Transaction Review List */}
            <div className="import-table-wrap glass">
              {visibleRows.map((row) => (
                <div key={row.id} className={`import-row${row.selected ? '' : ' muted-row'}`}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.description}`}
                    checked={row.selected}
                    onChange={(e) => updateRow(row.id, { selected: e.target.checked })}
                  />
                  <input
                    type="date"
                    className="import-input import-date"
                    value={row.date}
                    onChange={(e) => updateRow(row.id, { date: e.target.value })}
                  />
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <input
                      className="import-input"
                      value={row.description}
                      onChange={(e) => updateRow(row.id, { description: e.target.value })}
                      placeholder="Description"
                    />
                    <div className="small muted" style={{ display: 'flex', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                      {row.merchant && <span className="badge">{row.merchant}</span>}
                      {row.isDuplicate && <span className="badge badge-warn">Already exists</span>}
                    </div>
                  </div>
                  <select
                    className="import-input import-select-sm"
                    value={row.kind}
                    onChange={(e) => updateRow(row.id, { kind: e.target.value })}
                  >
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                  </select>
                  {row.kind === 'expense' ? (
                    <>
                      <select
                        className="import-input import-select"
                        value={row.category}
                        onChange={(e) => updateRow(row.id, { category: e.target.value })}
                      >
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                      <select
                        className="import-input import-select-sm"
                        value={row.payment_method}
                        onChange={(e) => updateRow(row.id, { payment_method: e.target.value })}
                      >
                        {PAYMENT_METHODS.map((m) => (
                          <option key={m} value={m}>{m.toUpperCase()}</option>
                        ))}
                      </select>
                    </>
                  ) : (
                    <select
                      className="import-input import-select"
                      value={row.source}
                      onChange={(e) => updateRow(row.id, { source: e.target.value })}
                    >
                      {INCOME_SOURCES.map((s) => (
                        <option key={s} value={s}>{s.toUpperCase()}</option>
                      ))}
                    </select>
                  )}
                  <input
                    className="import-input import-amount"
                    inputMode="decimal"
                    value={row.amount}
                    onChange={(e) => updateRow(row.id, { amount: e.target.value })}
                    style={{ color: row.kind === 'income' ? 'var(--green)' : 'var(--text)', fontWeight: 700 }}
                  />
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    aria-label="Remove row"
                    onClick={() => removeRow(row.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="form-row">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          {rows.length > 0 && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={importing || analysis.selectedCount === 0}
              onClick={doImport}
            >
              <Sparkles size={16} />
              {importing
                ? 'Importing into Spending Analysis…'
                : `Import ${analysis.selectedCount} Transaction${analysis.selectedCount === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
