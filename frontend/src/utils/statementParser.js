// Intelligent CSV & PDF Bank/UPI Statement Parser and Transaction Analyzer.
// Uses Mozilla PDF.js (offline, in-process worker) for real-world PDFs
// (including CIDFonts, /ToUnicode CMaps, multi-column bank tables, PhonePe/GPay/Paytm
// statements, and password-protected PDFs) with a stream/CMap fallback parser.

import { fromPaise, normalizeMoneyString, sumMoney, toPaise, todayInKolkata } from './format.js'

const MONTH_LOOKUP = {
  jan: '01', january: '01',
  feb: '02', february: '02',
  mar: '03', march: '03',
  apr: '04', april: '04',
  may: '05',
  jun: '06', june: '06',
  jul: '07', july: '07',
  aug: '08', august: '08',
  sep: '09', sept: '09', september: '09',
  oct: '10', october: '10',
  nov: '11', november: '11',
  dec: '12', december: '12',
}

// Rich keyword & merchant rules tailored for Indian students
const CATEGORY_RULES = [
  {
    category: 'Food',
    keywords: [
      'swiggy', 'zomato', 'eatclub', 'faasos', 'behrouz', 'dominos', 'pizza',
      'burger', 'kfc', 'mcdonald', 'subway', 'starbucks', 'ccd', 'cafe',
      'coffee', 'tea', 'chai', 'mess', 'canteen', 'tiffin', 'dining',
      'breakfast', 'lunch', 'dinner', 'snacks', 'biryani', 'restaurant',
      'dhaba', 'bakery', 'sweet', 'haldiram', 'bikanervala', 'blinkit',
      'zepto', 'instamart', 'bigbasket', 'dmart', 'grocer', 'supermarket',
      'milk', 'amul', 'fruit', 'vegetable', 'food', 'eatSure', 'magicpin',
    ],
  },
  {
    category: 'Transport',
    keywords: [
      'uber', 'ola', 'rapido', 'namma yatri', 'blu smart', 'metro', 'dmrc',
      'bmrc', 'cmrl', 'irctc', 'railway', 'train', 'redbus', 'abhibus',
      'ksrtc', 'msrtc', 'bus', 'auto', 'rickshaw', 'cab', 'taxi', 'petrol',
      'diesel', 'fuel', 'hpcl', 'bpcl', 'iocl', 'indian oil', 'bharat petroleum',
      'shell', 'fastag', 'toll', 'parking', 'indigo', 'air india', 'akasa',
      'spicejet', 'flight', 'makemytrip', 'goibibo', 'yatra', 'transport',
    ],
  },
  {
    category: 'Education',
    keywords: [
      'tuition', 'college', 'university', 'institute', 'iit', 'nit', 'bits',
      'vit', 'srm', 'semester', 'exam', 'admission', 'hostel fee', 'udemy',
      'coursera', 'edx', 'unacademy', 'physicswallah', 'byju', 'leetcode',
      'geeksforgeeks', 'skillshare', 'book', 'ncert', 'pearson', 'stationery',
      'xerox', 'photocopy', 'printout', 'print', 'library', 'lab', 'thesis',
      'notebook', 'pen', 'course', 'workshop', 'hackathon', 'education',
    ],
  },
  {
    category: 'Accommodation',
    keywords: [
      'hostel', 'pg ', 'paying guest', 'stanza living', 'zolo', 'your space',
      'rent', 'landlord', 'flat', 'apartment', 'society', 'maintenance',
      'electricity', 'bescom', 'mseb', 'tata power', 'adani electricity',
      'bses', 'water bill', 'lpg', 'cylinder', 'indane', 'bharatgas', 'hp gas',
      'wifi', 'broadband', 'jiofiber', 'airtel xstream', 'act fibernet',
      'hathway', 'laundry', 'maid', 'cleaning', 'accommodation', 'room',
    ],
  },
  {
    category: 'Subscriptions',
    keywords: [
      'netflix', 'spotify', 'prime video', 'amazon prime', 'hotstar', 'jiocinema',
      'sonyliv', 'zee5', 'youtube', 'yt premium', 'apple music', 'icloud',
      'google one', 'google play', 'microsoft 365', 'chatgpt', 'openai', 'claude',
      'midjourney', 'canva', 'notion', 'github', 'copilot', 'figma', 'adobe',
      'jio', 'airtel', 'vi ', 'vodafone', 'bsnl', 'recharge', 'prepaid',
      'postpaid', 'subscription',
    ],
  },
  {
    category: 'Shopping',
    keywords: [
      'amazon', 'flipkart', 'myntra', 'ajio', 'meesho', 'nykaa', 'tatacliq',
      'croma', 'reliance digital', 'vijay sales', 'decathlon', 'ikea', 'miniso',
      'zara', 'h&m', 'westside', 'pantaloons', 'zudio', 'max fashion', 'uniqlo',
      'lenskart', 'titan', 'fastrack', 'boat', 'noise', 'mall', 'apparel',
      'clothes', 'shoes', 'sneakers', 'electronics', 'gadget', 'accessory',
      'gift', 'shopping',
    ],
  },
  {
    category: 'Entertainment',
    keywords: [
      'bookmyshow', 'paytm insider', 'district', 'pvr', 'inox', 'cinepolis',
      'cinema', 'movie', 'theatre', 'concert', 'show', 'steam', 'epic games',
      'playstation', 'xbox', 'nintendo', 'valorant', 'bgmi', 'gaming', 'arcade',
      'bowling', 'smaaash', 'wonderla', 'imagica', 'club', 'pub', 'party',
      'outing', 'entertainment',
    ],
  },
  {
    category: 'Health',
    keywords: [
      'apollo', 'pharmeasy', 'tata 1mg', '1mg', 'netmeds', 'medplus', 'wellness',
      'pharmacy', 'chemist', 'medical', 'medicine', 'tablet', 'hospital',
      'clinic', 'doctor', 'consultation', 'diagnostic', 'pathlab', 'lal path',
      'thyrocare', 'dental', 'dentist', 'eye care', 'gym', 'cult.fit', 'cultfit',
      'fitness', 'protein', 'supplement', 'health',
    ],
  },
  {
    category: 'Personal Care',
    keywords: [
      'salon', 'barber', 'haircut', 'enrich', 'lakme', 'naturals', 'jawed habib',
      'urban company', 'spa', 'grooming', 'trimmer', 'skincare', 'minimalist',
      'mamaearth', 'plum', 'cetaphil', 'cosmetics', 'parlour', 'personal care',
    ],
  },
]

const KNOWN_MERCHANTS = [
  ['swiggy', 'Swiggy'],
  ['zomato', 'Zomato'],
  ['blinkit', 'Blinkit'],
  ['zepto', 'Zepto'],
  ['instamart', 'Swiggy Instamart'],
  ['bigbasket', 'BigBasket'],
  ['dmart', 'DMart'],
  ['dominos', "Domino's"],
  ['mcdonald', "McDonald's"],
  ['starbucks', 'Starbucks'],
  ['uber', 'Uber'],
  ['ola', 'Ola'],
  ['rapido', 'Rapido'],
  ['irctc', 'IRCTC'],
  ['redbus', 'redBus'],
  ['metro', 'Metro Rail'],
  ['amazon', 'Amazon'],
  ['flipkart', 'Flipkart'],
  ['myntra', 'Myntra'],
  ['ajio', 'AJIO'],
  ['meesho', 'Meesho'],
  ['nykaa', 'Nykaa'],
  ['zudio', 'Zudio'],
  ['decathlon', 'Decathlon'],
  ['croma', 'Croma'],
  ['netflix', 'Netflix'],
  ['spotify', 'Spotify'],
  ['hotstar', 'JioHotstar'],
  ['youtube', 'YouTube'],
  ['chatgpt', 'OpenAI ChatGPT'],
  ['jiofiber', 'JioFiber'],
  ['jio', 'Jio'],
  ['airtel', 'Airtel'],
  ['bookmyshow', 'BookMyShow'],
  ['pvr', 'PVR Inox'],
  ['apollo', 'Apollo Pharmacy'],
  ['pharmeasy', 'PharmEasy'],
  ['1mg', 'Tata 1mg'],
  ['udemy', 'Udemy'],
  ['coursera', 'Coursera'],
]

export function normalizeStatementDate(raw) {
  if (!raw) return null
  const s = String(raw)
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\s+/g, ' ')
  if (!s) return null

  // 1. YYYY-MM-DD or YYYY/MM/DD or YYYY.MM.DD
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s)
  if (m) {
    const [, y, mo, d] = m
    if (isValidYMD(Number(y), Number(mo), Number(d))) {
      return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
    }
  }

  // 2. DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY (or 2-digit year)
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s)
  if (m) {
    const [, p1, p2, yRaw] = m
    const y = yRaw.length === 2 ? Number(`20${yRaw}`) : Number(yRaw)
    let d = Number(p1)
    let mo = Number(p2)
    if (d <= 12 && mo > 12) {
      const tmp = d; d = mo; mo = tmp
    }
    if (isValidYMD(y, mo, d)) {
      return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }
  }

  // 3. DD MMM YYYY, DD-MMM-YY, DD MMM, YYYY, or compact DDMMMYYYY (e.g. "15 Oct 2026", "05-Oct-26", "15Oct2026")
  m = /^(\d{1,2})[\s,./-]*([A-Za-z]{3,9})[\s,./-]*(\d{2,4})\b/.exec(s)
  if (m) {
    const [, dRaw, monRaw, yRaw] = m
    const mo = MONTH_LOOKUP[monRaw.toLowerCase()]
    const y = yRaw.length === 2 ? Number(`20${yRaw}`) : Number(yRaw)
    const d = Number(dRaw)
    if (mo && isValidYMD(y, Number(mo), d)) {
      return `${String(y).padStart(4, '0')}-${mo}-${String(d).padStart(2, '0')}`
    }
  }

  // 4. MMM DD, YYYY or MMM DD YYYY (e.g. "Oct 15, 2026", "Oct 15 26" — PhonePe / Google Pay format)
  m = /^([A-Za-z]{3,9})[\s.-]+(\d{1,2})(?:st|nd|rd|th)?,?[\s.-]+(\d{2,4})\b/i.exec(s)
  if (m) {
    const [, monRaw, dRaw, yRaw] = m
    const mo = MONTH_LOOKUP[monRaw.toLowerCase()]
    const y = yRaw.length === 2 ? Number(`20${yRaw}`) : Number(yRaw)
    const d = Number(dRaw)
    if (mo && isValidYMD(y, Number(mo), d)) {
      return `${String(y).padStart(4, '0')}-${mo}-${String(d).padStart(2, '0')}`
    }
  }

  return null
}

function isValidYMD(y, m, d) {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

export function parseStatementAmount(raw) {
  if (raw === null || raw === undefined) return null
  let s = String(raw).trim()
  if (!s || s === '-' || s === '--' || /^nil$/i.test(s)) return null

  let sign = 1
  if (/^\(.*\)$/.test(s)) {
    sign = -1
    s = s.slice(1, -1)
  }
  let explicitType = null
  if (/\b(dr\.?|debit|withdrawal|paid|out|sent|debited)\b/i.test(s)) explicitType = 'expense'
  else if (/\b(cr\.?|credit|deposit|received|in|credited|added)\b/i.test(s)) explicitType = 'income'

  s = s
    .replace(/\b(inr|rs\.?|dr\.?|cr\.?|debit|credit|paid|received|debited|credited)\b/gi, '')
    .replace(/[₹$€£,\s()]/g, '')
    .trim()

  if (s.startsWith('-')) {
    sign = -1
    explicitType = explicitType || 'expense'
    s = s.slice(1).trim()
  } else if (s.startsWith('+')) {
    explicitType = explicitType || 'income'
    s = s.slice(1).trim()
  }

  if (s.endsWith('-')) {
    sign = -1
    explicitType = explicitType || 'expense'
    s = s.slice(0, -1).trim()
  } else if (s.endsWith('+')) {
    explicitType = explicitType || 'income'
    s = s.slice(0, -1).trim()
  }

  const norm = normalizeMoneyString(s)
  if (!norm || toPaise(norm) <= 0n) return null
  return {
    amount: norm,
    isNegative: sign < 0,
    explicitType,
  }
}

export function cleanNarrationAndExtractMeta(rawDesc, rawMerchant = '', rawMethod = '') {
  let desc = String(rawDesc || '')
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?\b/g, ' ')
    .replace(/\b(?:Transaction\s*ID|Txn\s*ID|UTR(?:\s*No\.?)?|Ref(?:\s*No\.?)?)\s*[:#-]?\s*[A-Za-z0-9]+\b/gi, ' ')
    .replace(/\b(?:Paid\s+by|Credited\s+to|Debited\s+from)\s+[X*0-9A-Za-z]+\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  let merchant = String(rawMerchant || '').trim()
  let method = String(rawMethod || '').trim().toLowerCase()

  const lower = desc.toLowerCase()

  // Detect payment method from narration if not explicitly provided
  if (!['cash', 'upi', 'card', 'bank', 'other'].includes(method)) {
    if (/\b(upi|gpay|phonepe|paytm|bhim|vpa|qr)\b/i.test(desc) || desc.includes('@')) method = 'upi'
    else if (/\b(pos|debit card|credit card|visa|mastercard|rupay|ecom|swipe|card)\b/i.test(desc)) method = 'card'
    else if (/\b(neft|imps|rtgs|ach|ecs|netbanking|transfer)\b/i.test(desc)) method = 'bank'
    else if (/\b(atm|cash|cwdr)\b/i.test(desc)) method = 'cash'
    else method = 'upi'
  }

  // Parse PhonePe / GPay style narration: "Paid to Swiggy", "Received from Rahul", "Money sent to Zomato"
  const paidToMatch = /\b(?:paid\s+to|money\s+sent\s+to|sent\s+to|received\s+from|transfer\s+to|payment\s+to)\s+([A-Za-z0-9&.'\s-]{2,40})/i.exec(desc)
  if (paidToMatch && paidToMatch[1] && !merchant) {
    const candidate = paidToMatch[1].replace(/\b(debit|credit|upi|inr|rs)\b.*$/i, '').trim()
    if (candidate.length >= 2) merchant = toTitleCase(candidate)
  }

  // Parse structured UPI narration: UPI/123456789/MERCHANT_NAME/vpa@bank/...
  const upiMatch = /\bUPI[-/:](?:CR[-/:]|DR[-/:])?(?:\d+[-/:])?([^/-:]+)[-/:]?/i.exec(desc)
  if (upiMatch && upiMatch[1]) {
    const candidate = upiMatch[1].trim()
    if (candidate.length > 2 && !/^\d+$/.test(candidate)) {
      if (!merchant) merchant = toTitleCase(candidate)
    }
  }

  // Check known merchant dictionary
  for (const [needle, label] of KNOWN_MERCHANTS) {
    if (lower.includes(needle)) {
      merchant = label
      break
    }
  }

  // Clean overly noisy bank reference numbers while keeping meaningful text
  let cleanDesc = desc
    .replace(/^UPI[-/:]\d+[-/:]/i, 'UPI · ')
    .replace(/^POS[-/\s]+\d+[X*]*\d*[-/\s]+/i, 'Card · ')
    .replace(/[-/:][a-zA-Z0-9._-]+@[a-zA-Z]+/g, '')
    .replace(/\b(?:DEBIT|CREDIT)\b\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

  if (!cleanDesc && merchant) cleanDesc = merchant
  return { description: cleanDesc.slice(0, 280), merchant: merchant.slice(0, 180), payment_method: method }
}

function toTitleCase(str) {
  return String(str)
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
}

export function classifyTransaction(description, merchant = '', rawCategory = '', categories = []) {
  const combined = `${description} ${merchant} ${rawCategory}`.toLowerCase()

  // 1. Direct match against user's existing categories if rawCategory is given
  if (rawCategory) {
    const direct = categories.find((c) => c.name.toLowerCase() === String(rawCategory).trim().toLowerCase())
    if (direct) return { categoryId: direct.id, categoryName: direct.name }
  }

  // 2. Match against user's custom categories by name in description
  for (const c of categories) {
    if (c.name && c.name.toLowerCase() !== 'other' && combined.includes(c.name.toLowerCase())) {
      return { categoryId: c.id, categoryName: c.name }
    }
  }

  // 3. Keyword rule matching
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((kw) => combined.includes(kw))) {
      const matchedCat = categories.find((c) => c.name.toLowerCase() === rule.category.toLowerCase())
      return {
        categoryId: matchedCat ? matchedCat.id : (categories[0]?.id ?? ''),
        categoryName: matchedCat ? matchedCat.name : rule.category,
      }
    }
  }

  // 4. Fallback to 'Other' or first category
  const other = categories.find((c) => c.name.toLowerCase() === 'other') || categories[0]
  return {
    categoryId: other ? other.id : '',
    categoryName: other ? other.name : 'Other',
  }
}

export function classifyIncomeSource(description) {
  const lower = String(description || '').toLowerCase()
  if (/\b(scholarship|stipend|fellowship|grant|merit)\b/.test(lower)) return 'scholarship'
  if (/\b(intern|internship|freelance|part[\s-]?time|tutor|teaching|salary|wages)\b/.test(lower)) return 'part-time'
  if (/\b(allowance|pocket|parent|father|mother|dad|mom|home|family|hostel)\b/.test(lower)) return 'allowance'
  return 'other'
}

// ---- CSV Parser ----
export function parseCSVRows(text) {
  const clean = String(text || '').replace(/^\uFEFF/, '')
  const firstLines = clean.split(/\r?\n/).slice(0, 10).filter(Boolean)
  let delimiter = ','
  const sample = firstLines.join('\n')
  const counts = {
    ',': (sample.match(/,/g) || []).length,
    ';': (sample.match(/;/g) || []).length,
    '\t': (sample.match(/\t/g) || []).length,
  }
  if (counts['\t'] > counts[','] && counts['\t'] > counts[';']) delimiter = '\t'
  else if (counts[';'] > counts[',']) delimiter = ';'

  const rows = []
  let row = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i]
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { cur += '"'; i += 1 }
        else inQuotes = false
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === delimiter) {
      row.push(cur.trim()); cur = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i += 1
      row.push(cur.trim()); cur = ''
      if (row.some((cell) => cell !== '')) rows.push(row)
      row = []
    } else {
      cur += ch
    }
  }
  if (cur.trim() || row.length) {
    row.push(cur.trim())
    if (row.some((cell) => cell !== '')) rows.push(row)
  }
  return rows
}

function detectHeaderMapping(rows) {
  for (let r = 0; r < Math.min(rows.length, 25); r += 1) {
    const cols = rows[r].map((c) => String(c || '').toLowerCase().replace(/[^a-z0-9/ ]/g, '').trim())
    const map = {}
    cols.forEach((col, idx) => {
      if (!col) return
      if (map.date === undefined && /\b(date|txn date|transaction date|value date|posted)\b/.test(col)) map.date = idx
      else if (map.description === undefined && /\b(description|narration|particulars|remarks|details|memo|transaction details|title)\b/.test(col)) map.description = idx
      else if (map.merchant === undefined && /\b(merchant|payee|vendor|store|beneficiary)\b/.test(col)) map.merchant = idx
      else if (map.category === undefined && /\b(category|group|tag)\b/.test(col)) map.category = idx
      else if (map.payment_method === undefined && /\b(payment|method|mode|channel)\b/.test(col)) map.payment_method = idx
      else if (map.debit === undefined && /\b(debit|withdrawal|paid out|dr amount|withdrawal amt|spent|expense)\b/.test(col)) map.debit = idx
      else if (map.credit === undefined && /\b(credit|deposit|paid in|cr amount|deposit amt|income)\b/.test(col)) map.credit = idx
      else if (map.type === undefined && /\b(type|dr\/cr|drcr|indicator|direction)\b/.test(col)) map.type = idx
      else if (map.amount === undefined && /\b(amount|amt|value|total|inr|price)\b/.test(col)) map.amount = idx
      else if (map.notes === undefined && /\b(note|notes|comment)\b/.test(col)) map.notes = idx
    })
    if (map.date !== undefined && (map.amount !== undefined || map.debit !== undefined || map.credit !== undefined)) {
      return { headerRowIndex: r, map }
    }
  }
  return null
}

export function parseCSVStatement(csvText, categories = [], existingExpenses = []) {
  const rows = parseCSVRows(csvText)
  if (!rows.length) return []

  const headerInfo = detectHeaderMapping(rows)
  const rawItems = []

  if (headerInfo) {
    const { headerRowIndex, map } = headerInfo
    for (let i = headerRowIndex + 1; i < rows.length; i += 1) {
      const r = rows[i]
      const date = normalizeStatementDate(r[map.date])
      if (!date) continue

      const rawDesc = map.description !== undefined ? r[map.description] : (map.merchant !== undefined ? r[map.merchant] : '')
      const rawMerchant = map.merchant !== undefined ? r[map.merchant] : ''
      const rawCat = map.category !== undefined ? r[map.category] : ''
      const rawMethod = map.payment_method !== undefined ? r[map.payment_method] : ''
      const rawNotes = map.notes !== undefined ? r[map.notes] : ''
      const rawType = map.type !== undefined ? String(r[map.type] || '').toLowerCase() : ''

      let amount = null
      let kind = 'expense'

      if (map.debit !== undefined || map.credit !== undefined) {
        const deb = map.debit !== undefined ? parseStatementAmount(r[map.debit]) : null
        const cred = map.credit !== undefined ? parseStatementAmount(r[map.credit]) : null
        if (deb && toPaise(deb.amount) > 0n) {
          amount = deb.amount
          kind = 'expense'
        } else if (cred && toPaise(cred.amount) > 0n) {
          amount = cred.amount
          kind = 'income'
        }
      }

      if (!amount && map.amount !== undefined) {
        const parsedAmt = parseStatementAmount(r[map.amount])
        if (parsedAmt) {
          amount = parsedAmt.amount
          if (/^(cr|credit|income|deposit|in|credited)$/i.test(rawType) || parsedAmt.explicitType === 'income') {
            kind = 'income'
          } else {
            kind = 'expense'
          }
        }
      }

      if (!amount) continue
      rawItems.push({
        date,
        rawDesc: rawDesc || rawMerchant || 'Imported transaction',
        rawMerchant,
        rawCat,
        rawMethod,
        rawNotes,
        amount,
        kind,
      })
    }
  } else {
    // Headerless CSV fallback
    for (const r of rows) {
      let date = null
      let amountObj = null
      const textParts = []
      for (const cell of r) {
        if (!date) {
          const d = normalizeStatementDate(cell)
          if (d) { date = d; continue }
        }
        if (!amountObj) {
          const a = parseStatementAmount(cell)
          if (a && /\d/.test(cell)) { amountObj = a; continue }
        }
        if (cell) textParts.push(cell)
      }
      if (date && amountObj) {
        rawItems.push({
          date,
          rawDesc: textParts[0] || 'Imported transaction',
          rawMerchant: textParts[1] || '',
          rawCat: textParts[2] || '',
          rawMethod: '',
          rawNotes: '',
          amount: amountObj.amount,
          kind: amountObj.explicitType === 'income' ? 'income' : 'expense',
        })
      }
    }
  }

  return enrichExtractedTransactions(rawItems, categories, existingExpenses)
}

// ---- PDF.js Real Document Engine + Fallback Stream Parser ----
let pdfjsLibPromise = null

async function getPdfJs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = (async () => {
      const [pdfjs, pdfWorker] = await Promise.all([
        import('pdfjs-dist/legacy/build/pdf.mjs'),
        import('pdfjs-dist/legacy/build/pdf.worker.mjs'),
      ])
      if (typeof globalThis !== 'undefined' && pdfWorker) {
        globalThis.pdfjsWorker = pdfWorker
      }
      return pdfjs
    })()
  }
  return pdfjsLibPromise
}

// Reconstructs visual lines and detects Debit/Credit/Balance column X coordinates on each PDF page
function reconstructPageLinesWithColumns(items) {
  const validItems = []
  for (const item of items || []) {
    if (typeof item?.str !== 'string') continue
    const text = item.str.split('\0').join('').trim()
    if (!text) continue
    const tx = Array.isArray(item.transform) ? item.transform : [1, 0, 0, 1, 0, 0]
    validItems.push({
      str: text,
      x: Number(tx[4]) || 0,
      y: Number(tx[5]) || 0,
      width: Number(item.width) || text.length * 5,
    })
  }
  if (!validItems.length) return []

  // Group items into horizontal rows by Y coordinate (within 4.5pt tolerance)
  validItems.sort((a, b) => (Math.abs(b.y - a.y) > 4.5 ? b.y - a.y : a.x - b.x))
  const visualRows = []
  for (const it of validItems) {
    const lastRow = visualRows[visualRows.length - 1]
    if (lastRow && Math.abs(it.y - lastRow.y) <= 4.5) {
      lastRow.items.push(it)
      // Keep running average Y for stability
      lastRow.y = (lastRow.y * (lastRow.items.length - 1) + it.y) / lastRow.items.length
    } else {
      visualRows.push({ y: it.y, items: [it] })
    }
  }

  // Detect column header X positions (Debit / Credit / Balance) if the page has a tabular header
  let debitColX = null
  let creditColX = null
  let balanceColX = null

  const pageLines = []
  for (const row of visualRows) {
    row.items.sort((a, b) => a.x - b.x)
    const rowTextLower = row.items.map((i) => i.str.toLowerCase()).join(' ')

    // Check if this visual row is a table header row
    if (
      /\b(date|txn|transaction|particulars|narration|description|details)\b/.test(rowTextLower) &&
      /\b(debit|withdrawal|credit|deposit|balance|amount|dr|cr)\b/.test(rowTextLower)
    ) {
      for (const cell of row.items) {
        const cl = cell.str.toLowerCase()
        const centerX = cell.x + cell.width / 2
        if (/\b(withdrawal|debit|dr\.?|paid\s*out)\b/.test(cl) && !/credit|cr\b/.test(cl)) {
          debitColX = centerX
        } else if (/\b(deposit|credit|cr\.?|paid\s*in)\b/.test(cl) && !/debit|dr\b/.test(cl)) {
          creditColX = centerX
        } else if (/\b(balance|closing|avail)\b/.test(cl)) {
          balanceColX = centerX
        }
      }
      continue
    }

    // Build line string, tagging numeric cells with Dr/Cr if column X coordinates are known
    const rowPieces = []
    for (let idx = 0; idx < row.items.length; idx += 1) {
      const cell = row.items[idx]
      let tokenStr = cell.str

      if ((debitColX !== null || creditColX !== null) && /^-?(?:₹|INR|Rs\.?\s*)?(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{2}$/.test(tokenStr)) {
        const centerX = cell.x + cell.width / 2
        const distDebit = debitColX !== null ? Math.abs(centerX - debitColX) : Infinity
        const distCredit = creditColX !== null ? Math.abs(centerX - creditColX) : Infinity
        const distBalance = balanceColX !== null ? Math.abs(centerX - balanceColX) : Infinity

        if (distBalance < 48 && distBalance < distDebit && distBalance < distCredit) {
          // Leave running balance untagged at the end of the line
        } else if (distCredit < 55 && distCredit < distDebit) {
          tokenStr = `${tokenStr} Cr`
        } else if (distDebit < 55 && distDebit <= distCredit) {
          tokenStr = `${tokenStr} Dr`
        }
      }

      if (idx > 0) {
        const prev = row.items[idx - 1]
        const gap = cell.x - (prev.x + prev.width)
        rowPieces.push(gap > 10 ? `   ${tokenStr}` : ` ${tokenStr}`)
      } else {
        rowPieces.push(tokenStr)
      }
    }

    const joined = rowPieces.join('').replace(/\s+/g, ' ').trim()
    if (joined) pageLines.push(joined)
  }

  return pageLines
}

async function extractLinesWithPdfJs(bytes, password = '') {
  const pdfjs = await getPdfJs()
  // Copy bytes because PDF.js may detach/transfer the underlying ArrayBuffer
  const dataCopy = new Uint8Array(bytes.length)
  dataCopy.set(bytes)

  const loadingTask = pdfjs.getDocument({
    data: dataCopy,
    password: password || undefined,
    useSystemFonts: true,
    isEvalSupported: false,
    stopAtErrors: false,
    verbosity: 0,
  })

  try {
    const doc = await loadingTask.promise
    const allLines = []
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum += 1) {
      const page = await doc.getPage(pageNum)
      const textContent = await page.getTextContent({
        includeMarkedContent: false,
        disableNormalization: false,
      })
      const pageLines = reconstructPageLinesWithColumns(textContent.items || [])
      allLines.push(...pageLines)
    }
    await doc.destroy()
    return allLines
  } catch (err) {
    try { await loadingTask.destroy() } catch { /* ignore */ }
    if (err?.name === 'PasswordException' || /password/i.test(String(err?.message || ''))) {
      const pwErr = new Error('This PDF statement is password-protected. Please enter the PDF password below to unlock and analyze it.')
      pwErr.code = 'PDF_PASSWORD_REQUIRED'
      throw pwErr
    }
    throw err
  }
}

// ---- Fallback Low-Level PDF Stream Parser ----
async function decompressFlateStream(uint8) {
  if (typeof DecompressionStream === 'undefined') return null
  for (const format of ['deflate', 'deflate-raw']) {
    try {
      const ds = new DecompressionStream(format)
      const writer = ds.writable.getWriter()
      writer.write(uint8)
      writer.close()
      const out = await new Response(ds.readable).arrayBuffer()
      return new TextDecoder('latin1').decode(out)
    } catch {
      // try next format
    }
  }
  return null
}

function decodePDFStringToken(token) {
  if (!token) return ''
  if (token.startsWith('(') && token.endsWith(')')) {
    const inner = token.slice(1, -1)
    let out = ''
    for (let i = 0; i < inner.length; i += 1) {
      const ch = inner[i]
      if (ch === '\\') {
        const next = inner[i + 1]
        if (next === 'n') { out += '\n'; i += 1 }
        else if (next === 'r') { out += '\r'; i += 1 }
        else if (next === 't') { out += ' '; i += 1 }
        else if (next === '(' || next === ')' || next === '\\') { out += next; i += 1 }
        else if (/[0-7]/.test(next)) {
          const oct = inner.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)?.[0] || next
          out += String.fromCharCode(parseInt(oct, 8))
          i += oct.length
        } else {
          out += next || ''
          i += 1
        }
      } else {
        out += ch
      }
    }
    return out
  }
  if (token.startsWith('<') && token.endsWith('>')) {
    const hex = token.slice(1, -1).replace(/\s+/g, '')
    if (!/^[0-9a-fA-F]+$/.test(hex)) return ''
    if (hex.toUpperCase().startsWith('FEFF') || (hex.length % 4 === 0 && /^00[2-7][0-9a-fA-F]/.test(hex))) {
      let out = ''
      const start = hex.toUpperCase().startsWith('FEFF') ? 4 : 0
      for (let i = start; i < hex.length; i += 4) {
        const code = parseInt(hex.slice(i, i + 4), 16)
        if (code >= 32) out += String.fromCharCode(code)
      }
      return out
    }
    let out = ''
    for (let i = 0; i < hex.length; i += 2) {
      const code = parseInt(hex.slice(i, i + 2), 16)
      if (code >= 32) out += String.fromCharCode(code)
    }
    return out
  }
  return ''
}

function extractLinesFromPDFContentStream(content) {
  const lines = []
  let currentLine = []
  let lastY = null

  const opRegex = /(\([^)\\\\]*(?:\\.[^)\\\\]*)*\)|<[0-9a-fA-F\s]+>|\[[^\]]*\]|-?\d+(?:\.\d+)?)\s*(Tj|TJ|Td|TD|Tm|T\*|'|")?|\b(BT|ET|T\*)\b/g
  const tokens = []
  let match
  while ((match = opRegex.exec(content)) !== null) {
    if (!match[0].trim()) continue
    if (match[3]) {
      tokens.push({ arg: '', op: match[3] })
    } else {
      tokens.push({ arg: match[1] || '', op: match[2] || '' })
    }
  }

  const numStack = []
  for (const t of tokens) {
    if (!t.op && /^-?\d+(\.\d+)?$/.test(t.arg)) {
      numStack.push(Number(t.arg))
      continue
    }
    if (t.op === 'BT' || t.op === 'ET') {
      if (currentLine.length) {
        lines.push(currentLine.join(' ').replace(/\s+/g, ' ').trim())
        currentLine = []
      }
      lastY = null
      numStack.length = 0
    } else if (t.op === 'Td' || t.op === 'TD') {
      const ty = /^-?\d+(\.\d+)?$/.test(t.arg) ? Number(t.arg) : (numStack.length ? numStack[numStack.length - 1] : 0)
      if (Math.abs(ty) > 0.5 && currentLine.length) {
        lines.push(currentLine.join(' ').replace(/\s+/g, ' ').trim())
        currentLine = []
      }
      numStack.length = 0
    } else if (t.op === 'Tm') {
      const y = /^-?\d+(\.\d+)?$/.test(t.arg) ? Number(t.arg) : (numStack.length >= 2 ? numStack[numStack.length - 1] : null)
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 1 && currentLine.length) {
        lines.push(currentLine.join(' ').replace(/\s+/g, ' ').trim())
        currentLine = []
      }
      if (y !== null) lastY = y
      numStack.length = 0
    } else if (t.op === 'T*' || t.op === "'" || t.op === '"') {
      if (currentLine.length) {
        lines.push(currentLine.join(' ').replace(/\s+/g, ' ').trim())
        currentLine = []
      }
      if (t.arg && (t.arg.startsWith('(') || t.arg.startsWith('<'))) {
        const s = decodePDFStringToken(t.arg)
        if (s.trim()) currentLine.push(s.trim())
      }
      numStack.length = 0
    } else if (t.op === 'Tj') {
      const s = decodePDFStringToken(t.arg)
      if (s.trim()) currentLine.push(s.trim())
      numStack.length = 0
    } else if (t.op === 'TJ' && t.arg.startsWith('[')) {
      const parts = t.arg.match(/\([^)\\\\]*(?:\\.[^)\\\\]*)*\)|<[0-9a-fA-F\s]+>|-?\d+(?:\.\d+)?/g) || []
      let piece = ''
      for (const p of parts) {
        if (p.startsWith('(') || p.startsWith('<')) piece += decodePDFStringToken(p)
        else if (Number(p) < -120) piece += ' '
      }
      if (piece.trim()) currentLine.push(piece.trim())
      numStack.length = 0
    }
  }
  if (currentLine.length) {
    lines.push(currentLine.join(' ').replace(/\s+/g, ' ').trim())
  }
  return lines.filter(Boolean)
}

export async function extractTextLinesFromPDF(input, options = {}) {
  let bytes
  if (typeof input === 'string') {
    bytes = new TextEncoder().encode(input)
  } else if (input && typeof input.byteLength === 'number') {
    bytes = ArrayBuffer.isView(input)
      ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
      : new Uint8Array(input)
  } else {
    bytes = new Uint8Array(0)
  }

  // 1. Primary: Real PDF.js engine (decodes ToUnicode CMaps, CIDFonts, Flate predictors, multi-column layouts)
  try {
    const pdfJsLines = await extractLinesWithPdfJs(bytes, options.password || '')
    if (pdfJsLines && pdfJsLines.length > 0) {
      return pdfJsLines
    }
  } catch (err) {
    if (err?.code === 'PDF_PASSWORD_REQUIRED') throw err
    // Fall through to stream scanner if input was a minimal/synthetic PDF snippet
  }

  // 2. Fallback: Direct PDF stream & raw text scanner
  const rawText = new TextDecoder('latin1').decode(bytes)
  const extractedLines = []

  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g
  let match
  while ((match = streamRegex.exec(rawText)) !== null) {
    const startIdx = match.index + match[0].indexOf('\n') + 1
    const bodyLen = match[1].length
    const subBytes = bytes.subarray(startIdx, startIdx + bodyLen)

    const dictHeader = rawText.slice(Math.max(0, match.index - 250), match.index)
    let streamContent = null
    if (/FlateDecode/i.test(dictHeader)) {
      streamContent = await decompressFlateStream(subBytes)
    }
    if (!streamContent) {
      streamContent = match[1]
    }
    const streamLines = extractLinesFromPDFContentStream(streamContent)
    extractedLines.push(...streamLines)
  }

  if (extractedLines.length === 0) {
    const fallbackLines = extractLinesFromPDFContentStream(rawText)
    if (fallbackLines.length > 0) extractedLines.push(...fallbackLines)
    else extractedLines.push(...rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))
  }

  return extractedLines
}

// Broad Date Matcher covering ISO, DD/MM/YYYY, DD-MMM-YYYY, DDMMMYYYY, and PhonePe/GPay "MMM DD, YYYY"
const LINE_DATE_REGEX = /\b(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}[\s,./-]*[A-Za-z]{3,9}[\s,./-]*\d{2,4}|[A-Za-z]{3,9}[\s.-]+\d{1,2}(?:st|nd|rd|th)?,?[\s.-]+\d{2,4})\b/

// Broad Amount Matcher covering decimals ("240.00", "1,25,000.00") AND integer currency/Dr/Cr tokens ("₹285", "Rs. 450", "500 Dr")
const LINE_AMOUNT_REGEX = /(?:[+-]\s*)?(?:(?:₹|INR|Rs\.?)\s*)?-?(?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d{1,2})?(?:\s*(?:Dr\.?|Cr\.?|DR|CR|Debit|Credit))?(?!\d)/g

function extractValidAmountTokens(text) {
  // Strip timestamps like "02:30 PM" or "14:22:10" before scanning for amounts
  const cleanText = text.replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?\b/g, (m) => ' '.repeat(m.length))
  return [...cleanText.matchAll(LINE_AMOUNT_REGEX)]
    .map((m) => ({ text: m[0].trim(), index: m.index }))
    .filter((tok) => {
      if (!tok.text) return false
      const charBefore = tok.index > 0 ? cleanText[tok.index - 1] : ' '
      const charAfter = cleanText[tok.index + tok.text.length] || ' '
      // Ignore numbers glued to slashes, hashes, asterisks, or letters (e.g., UPI/429001/, XXXX1234, T261015)
      if (/[/*#@A-Za-z]/.test(charBefore) || /[/*#@A-Za-z]/.test(charAfter)) return false

      // Ignore numbers immediately preceded by Ref/UTR/ID/A/C/Chq keywords
      const prefixSlice = cleanText.slice(Math.max(0, tok.index - 18), tok.index)
      if (/\b(?:utr|ref|txn|id|no\.?|chq|cheque|a\/c|acct|card|ending|xxxx)\s*[:#-]?\s*$/i.test(prefixSlice)) {
        return false
      }

      const digitsOnly = tok.text.replace(/\D/g, '')
      const hasDecimal = /\.\d{1,2}\b/.test(tok.text)
      const hasCurrencyOrMarker = /(?:₹|INR|Rs\.?|Dr\.?|Cr\.?|Debit|Credit)/i.test(tok.text)

      // Plain integers without a decimal point AND without ₹/Rs/INR/Dr/Cr are only accepted
      // if they are reasonable transaction amounts and not 6+ digit reference numbers or 4-digit years
      if (!hasDecimal && !hasCurrencyOrMarker) {
        if (digitsOnly.length >= 6) return false
        const numVal = Number(digitsOnly)
        if (numVal >= 1990 && numVal <= 2035 && tok.index < cleanText.length * 0.45) return false
      }

      return parseStatementAmount(tok.text) !== null
    })
}

function findDateInLine(line) {
  const regex = new RegExp(LINE_DATE_REGEX.source, 'g')
  let m
  while ((m = regex.exec(line)) !== null) {
    const normalized = normalizeStatementDate(m[1])
    if (normalized) {
      return { date: normalized, matchText: m[0], index: m.index }
    }
  }
  return null
}

function isSummaryOrHeaderLine(line) {
  return /^(?:date\s+(?:description|narration|particulars)|txn\s+date|sl\.?\s*no|opening\s+balance|closing\s+balance|statement\s+summary|total\s+(?:debit|credit|amount)|page\s+\d+\s+of\s+\d+|generated\s+on|this\s+is\s+a\s+computer|system\s+generated)/i.test(
    line.trim(),
  )
}

export function parseTransactionsFromTextLines(lines, categories = [], existingExpenses = []) {
  const cleanedLines = (lines || [])
    .map((l) => String(l || '').replace(/\s+/g, ' ').trim())
    .filter((l) => l.length >= 3)

  // Pre-pass: stitch split 2-line dates (e.g., Line 1: "15 Oct Paid to Swiggy ₹285", Line 2: "2026 ...")
  const mergedLines = []
  for (let i = 0; i < cleanedLines.length; i += 1) {
    let cur = cleanedLines[i]
    const partialDate = /^(\d{1,2}[\s-]+[A-Za-z]{3,9}|[A-Za-z]{3,9}[\s-]+\d{1,2})\b(.*)$/.exec(cur)
    if (partialDate && !findDateInLine(cur) && i + 1 < cleanedLines.length) {
      const nextLine = cleanedLines[i + 1]
      const yearStart = /^(20\d{2})\b(.*)$/.exec(nextLine)
      if (yearStart) {
        cur = `${partialDate[1]} ${yearStart[1]} ${partialDate[2]} ${yearStart[2]}`.replace(/\s+/g, ' ').trim()
        i += 1
      }
    }
    mergedLines.push(cur)
  }

  const rawItems = []
  for (let i = 0; i < mergedLines.length; i += 1) {
    const line = mergedLines[i]
    if (line.length < 6 || isSummaryOrHeaderLine(line)) continue

    const dateHit = findDateInLine(line)
    if (!dateHit) continue
    const { date } = dateHit

    // Remove the matched date from the line
    let remainder = (
      line.slice(0, dateHit.index) +
      ' ' +
      line.slice(dateHit.index + dateHit.matchText.length)
    ).trim()

    // Remove secondary "Value Date" if immediately at the start of remainder
    const secondDateHit = findDateInLine(remainder.slice(0, 22))
    if (secondDateHit && secondDateHit.index <= 2) {
      remainder = remainder.slice(secondDateHit.index + secondDateHit.matchText.length).trim()
    }

    // Look ahead up to 3 continuation lines that belong to this transaction block
    // (lines without a new transaction date and not summary/footer headers)
    let amountTokens = extractValidAmountTokens(remainder)
    let lookaheadCount = 0
    while (i + 1 < mergedLines.length && lookaheadCount < 3) {
      const nextLine = mergedLines[i + 1]
      if (isSummaryOrHeaderLine(nextLine) || findDateInLine(nextLine)) break

      const nextAmounts = extractValidAmountTokens(nextLine)
      // Merge continuation line if we don't have an amount yet, OR if the next line has narration context without a conflicting amount
      if (amountTokens.length === 0 || nextAmounts.length === 0) {
        remainder = `${remainder} ${nextLine}`.replace(/\s+/g, ' ').trim()
        amountTokens = extractValidAmountTokens(remainder)
        i += 1
        lookaheadCount += 1
      } else {
        break
      }
    }

    if (amountTokens.length === 0) continue

    // Prefer tokens that have a decimal point or currency/Dr/Cr marker over plain integers
    const strongTokens = amountTokens.filter(
      (t) => /\.\d{1,2}\b/.test(t.text) || /(?:₹|INR|Rs\.?|Dr\.?|Cr\.?|Debit|Credit)/i.test(t.text),
    )
    const candidatePool = strongTokens.length > 0 ? strongTokens : amountTokens

    // If the line ends with [Txn Amount] [Running Balance], pick the transaction amount
    let chosenToken = candidatePool[candidatePool.length - 1]
    if (candidatePool.length >= 2) {
      const prevTok = candidatePool[candidatePool.length - 2]
      const lastHasDrCr = /\b(?:dr\.?|cr\.?|debit|credit)\b/i.test(chosenToken.text)
      const prevHasDrCr = /\b(?:dr\.?|cr\.?|debit|credit)\b/i.test(prevTok.text)
      if (prevHasDrCr && !lastHasDrCr) {
        chosenToken = prevTok
      } else if (!lastHasDrCr && prevTok.index > remainder.length * 0.32) {
        chosenToken = prevTok
      }
    }

    const parsedAmt = parseStatementAmount(chosenToken.text)
    if (!parsedAmt) continue

    const beforeAmt = remainder.slice(0, chosenToken.index)
    const afterAmt = remainder.slice(chosenToken.index + chosenToken.text.length)
    // Remove any trailing running balance from afterAmt so we keep any narration text that appeared after the amount
    const afterWithoutBalance = afterAmt
      .replace(/(?:₹|INR|Rs\.?\s*)?-?(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{1,2}(?:\s*(?:Dr\.?|Cr\.?))?/gi, ' ')
      .trim()

    const descPart = `${beforeAmt} ${afterWithoutBalance}`
      .replace(/[|\t]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()

    let kind = 'expense'
    if (
      parsedAmt.explicitType === 'income' ||
      /\b(cr\.?|credit|credited|deposit|received\s+from|refund|cashback|allowance|scholarship|salary|stipend|added\s+to)\b/i.test(afterAmt) ||
      /\b(neft[\s/-]*cr|imps[\s/-]*cr|upi[\s/-]*cr|ach[\s/-]*cr|credit|credited|received\s+from|refund|cashback|allowance|scholarship|stipend|salary)\b/i.test(descPart)
    ) {
      if (!/\b(dr\.?|debit|debited|paid\s+to|sent\s+to|withdrawal)\b/i.test(chosenToken.text)) {
        kind = 'income'
      }
    }

    rawItems.push({
      date,
      rawDesc: descPart || 'PDF Statement Transaction',
      rawMerchant: '',
      rawCat: '',
      rawMethod: '',
      rawNotes: 'Imported from PDF statement',
      amount: parsedAmt.amount,
      kind,
    })
  }

  return enrichExtractedTransactions(rawItems, categories, existingExpenses)
}

export async function parsePDFStatement(arrayBuffer, categories = [], existingExpenses = [], options = {}) {
  const lines = await extractTextLinesFromPDF(arrayBuffer, options)
  const transactions = parseTransactionsFromTextLines(lines, categories, existingExpenses)
  if (options.returnDiagnostics) {
    return { transactions, lines }
  }
  return transactions
}

function enrichExtractedTransactions(rawItems, categories, existingExpenses) {
  const existingKeys = new Set(
    (existingExpenses || []).map((e) => `${e.date}|${normalizeMoneyString(e.amount)}|${String(e.description || '').toLowerCase().trim()}`),
  )

  return rawItems.map((item, idx) => {
    const cleaned = cleanNarrationAndExtractMeta(item.rawDesc, item.rawMerchant, item.rawMethod)
    const catInfo = classifyTransaction(cleaned.description, cleaned.merchant, item.rawCat, categories)
    const incomeSource = classifyIncomeSource(cleaned.description)
    const dupKey = `${item.date}|${item.amount}|${cleaned.description.toLowerCase().trim()}`
    const isDuplicate = existingKeys.has(dupKey)

    return {
      id: `imp-${idx + 1}-${Date.now()}`,
      selected: !isDuplicate,
      isDuplicate,
      kind: item.kind || 'expense',
      date: item.date,
      description: cleaned.description || 'Transaction',
      merchant: cleaned.merchant,
      category: catInfo.categoryId,
      category_name: catInfo.categoryName,
      payment_method: cleaned.payment_method,
      source: incomeSource,
      amount: item.amount,
      notes: item.rawNotes || '',
    }
  })
}

export function computeImportAnalysis(rows, categories = []) {
  const selected = (rows || []).filter((r) => r.selected)
  const expenses = selected.filter((r) => r.kind === 'expense')
  const incomes = selected.filter((r) => r.kind === 'income')

  const totalSpent = sumMoney(expenses.map((e) => e.amount))
  const totalIncome = sumMoney(incomes.map((i) => i.amount))
  const spentP = toPaise(totalSpent)

  const byCat = new Map()
  for (const e of expenses) {
    const catObj = categories.find((c) => String(c.id) === String(e.category))
    const name = catObj?.name || e.category_name || 'Other'
    const cur = byCat.get(name) || { total: 0n, count: 0, color: catObj?.color }
    cur.total += toPaise(e.amount)
    cur.count += 1
    byCat.set(name, cur)
  }

  const categoryBreakdown = [...byCat.entries()]
    .map(([category, v]) => ({
      category,
      total: fromPaise(v.total),
      count: v.count,
      color: v.color,
      share: spentP > 0n ? (Number((v.total * 10000n) / spentP) / 100).toFixed(1) : '0.0',
    }))
    .sort((a, b) => Number(toPaise(b.total) - toPaise(a.total)))

  const byMethod = new Map()
  for (const e of expenses) {
    const m = (e.payment_method || 'other').toUpperCase()
    const cur = byMethod.get(m) || { total: 0n, count: 0 }
    cur.total += toPaise(e.amount)
    cur.count += 1
    byMethod.set(m, cur)
  }
  const methodBreakdown = [...byMethod.entries()]
    .map(([method, v]) => ({
      method,
      total: fromPaise(v.total),
      count: v.count,
      share: spentP > 0n ? (Number((v.total * 10000n) / spentP) / 100).toFixed(1) : '0.0',
    }))
    .sort((a, b) => Number(toPaise(b.total) - toPaise(a.total)))

  const dates = selected.map((r) => r.date).filter(Boolean).sort()
  return {
    selectedCount: selected.length,
    expenseCount: expenses.length,
    incomeCount: incomes.length,
    duplicateCount: (rows || []).filter((r) => r.isDuplicate).length,
    totalSpent,
    totalIncome,
    dateFrom: dates[0] || null,
    dateTo: dates[dates.length - 1] || null,
    categoryBreakdown,
    methodBreakdown,
  }
}

// Generates a realistic sample CSV bank/UPI statement for instant user testing
export function generateSampleStatementCSV() {
  const ym = todayInKolkata().slice(0, 7)
  return [
    'Date,Narration,Merchant,Payment Method,Debit,Credit',
    `${ym}-02,UPI/42891001/SWIGGY/swiggy@axis,Swiggy,UPI,285.00,`,
    `${ym}-03,UPI/42891002/DELHI METRO RAIL/dmrc@sbi,Metro Rail,UPI,60.00,`,
    `${ym}-04,NEFT-CR-HOSTEL MONTHLY ALLOWANCE,Family Allowance,Bank,,8000.00`,
    `${ym}-05,UPI/42891004/UDEMY COURSE PYTHON/udemy@icici,Udemy,Card,499.00,`,
    `${ym}-07,UPI/42891005/ZOMATO ORDER/zomato@hdfc,Zomato,UPI,340.00,`,
    `${ym}-09,POS 4111XXXX1234 AMAZON INDIA,Amazon,Card,1250.00,`,
    `${ym}-11,UPI/42891007/SPOTIFY STUDENT PLAN,Spotify,UPI,59.00,`,
    `${ym}-12,UPI/42891008/APOLLO PHARMACY,Apollo Pharmacy,UPI,220.00,`,
    `${ym}-14,UPI/42891009/PVR INOX MOVIES,PVR Inox,UPI,380.00,`,
    `${ym}-16,UPI/42891010/HOSTEL WIFI JIOFIBER,JioFiber,UPI,599.00,`,
  ].join('\r\n')
}

// Generates a valid minimal PDF file containing a realistic student bank/UPI statement
export function generateSampleStatementPDF() {
  const ym = todayInKolkata().slice(0, 7)
  const statementLines = [
    'STUDENT EXPENSE TRACKER - SAMPLE BANK & UPI STATEMENT',
    `${ym}-02  UPI/429001/SWIGGY LUNCH ORDER          240.00 Dr`,
    `${ym}-03  UPI/429002/UBER AUTO CAMPUS RIDE       115.00 Dr`,
    `${ym}-04  NEFT/CR/MONTHLY HOSTEL ALLOWANCE      7500.00 Cr`,
    `${ym}-06  UPI/429003/COLLEGE STATIONERY & BOOKS  450.00 Dr`,
    `${ym}-08  UPI/429004/BLINKIT GROCERIES & SNACKS  320.00 Dr`,
    `${ym}-10  POS/429005/MYNTRA CAMPUS WEAR          980.00 Dr`,
    `${ym}-12  UPI/429006/NETFLIX MOBILE PLAN         149.00 Dr`,
    `${ym}-15  UPI/429007/APOLLO MEDICAL STORE        190.00 Dr`,
  ]
  const btOps = [
    'BT',
    '/F1 11 Tf',
    '50 760 Td',
    ...statementLines.map((line, i) => (i === 0 ? `(${line}) Tj` : `0 -22 Td (${line}) Tj`)),
    'ET',
  ]
  const streamBody = btOps.join('\n')

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj',
    `4 0 obj\n<< /Length ${streamBody.length} >>\nstream\n${streamBody}\nendstream\nendobj`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj',
  ]

  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (const obj of objects) {
    offsets.push(pdf.length)
    pdf += `${obj}\n`
  }
  const xrefStart = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`
  return new TextEncoder().encode(pdf)
}
