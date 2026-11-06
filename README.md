# Student Expense Tracker V2 (Web + Android APK)

A full-stack + offline-capable Android student finance application featuring **Smart PDF & CSV Bank/UPI Statement Import & Analysis**, **Interactive All-Pie-Chart Spending Analytics**, **Frosted Liquid Glass UI with Reactive Click/Tap Glow Effects**, **Budgets**, **Income & Allowance Tracking**, **Recurring Expenses**, **Savings Goals**, and **On-Device JSON Backup & Restore**.

---

## Tech Stack

- **Frontend:** React 19, Vite, React Router v7, Recharts (Interactive Multi-Slice Pie/Donut Charts), Mozilla PDF.js (`pdfjs-dist` offline engine), Lucide Icons.
- **Mobile / Android:** Capacitor 8 (`com.student.expensetracker`) with offline-first On-Device Storage mode (`localApi.js`) + optional Live Django Server sync mode.
- **Backend:** Django 5 + Django REST Framework, Token Authentication, `django-filter`, `django-cors-headers`, SQLite (`Decimal` precision money handling, `Asia/Kolkata` timezone).
- **Currency & Math:** Indian Rupees (`₹` / `en-IN`), exact integer-paise (`BigInt`) and `Decimal` string arithmetic so totals never drift due to floating-point rounding.

---

## Key Features

### 1. Smart PDF & CSV Bank / UPI Statement Import & Analyzer
- **Real PDF.js Offline Extraction (`statementParser.js`):** Parses real-world bank and UPI statements (PhonePe, Google Pay, Paytm, SBI, HDFC, ICICI, Axis, Kotak, etc.), including CIDFont / `/ToUnicode` CMap PDFs, multi-column Debit/Credit/Balance tables, and multi-line wrapped transaction narrations.
- **Password-Protected PDF Support:** Detects encrypted bank statement PDFs and provides an inline password prompt to unlock and analyze them directly on-device.
- **Auto-Categorization & Merchant Detection:** Cleans noisy `UPI/...`, `POS/...`, `NEFT/...`, and `IMPS/...` narrations, extracts merchant names (`Swiggy`, `Zomato`, `Uber`, `Metro Rail`, `Amazon`, `Flipkart`, `Myntra`, `Netflix`, `Spotify`, `Apollo Pharmacy`, `Udemy`, etc.), detects payment channels (`UPI`, `Card`, `Bank`, `Cash`), and classifies transactions into student categories (`Food`, `Transport`, `Education`, `Accommodation`, `Subscriptions`, `Shopping`, `Entertainment`, `Health`, `Personal Care`, `Other`).
- **Expense vs. Income & Duplicate Guard:** Automatically separates `Dr`/`Debit` expenses from `Cr`/`Credit` incomes (allowances, scholarships, refunds) and unchecks existing duplicate entries.
- **Live Pie Chart Import Preview (`ImportModal.jsx`):** Previews how the statement affects your **Category Spend Share** and **Payment Mode Share** before importing, with inline row editing, raw text paste/inspection, and one-tap **Sample PDF** / **Sample CSV** loaders.

### 2. All-Pie-Chart Visual Analytics & Iridescent Palette
- Every chart across **Dashboard**, **Analytics**, and **Statement Import Studio** uses an interactive multi-colored Pie/Donut architecture (`charts.jsx`) with active slice hover/tap expansion (`renderActiveShape`), dynamic center KPI callouts, and interactive slice filter pills:
  - **Category Spend Share Pie (`DonutChart`)**
  - **Daily Spend Distribution Pie (`TrendChart`)**
  - **6-Month Spend & Cash-Flow Pie (`ComparisonChart`)**
  - **Payment Modes Share Pie (`PaymentMethodPieChart`)**
  - **Budget Allocation & Utilization Pie (`BudgetPieChart`)**

### 3. Frosted Liquid Glass UI & Reactive Click Glow
- **Milky Frosted Glass Surfaces (`tokens.css`, `components.css`):** Multi-layered frosted translucent surfaces with SVG fractal-noise frost grain, `backdrop-filter: blur(42px) saturate(215%)`, refractive top/left specular borders, and ambient aurora background orbs.
- **Universal Click / Tap Glow (`ClickGlowManager` in `App.jsx`):** Every tap or click on buttons, cards, navigation tabs, chart pills, inputs, and transaction rows emits a coordinate-aware radial neon-glass bloom (`--click-x`, `--click-y`) and floating pointer ripple orb.

### 4. Complete Student Finance Suite
- **Dashboard:** Monthly spend, remaining budget, utilization %, daily average, top category, previous-month comparison, budget alerts (80% / 100%), smart data-driven insights, and recent transactions.
- **Transactions:** Full search, multi-criteria filtering (date range, month, category, payment method, min/max amount), sorting, pagination, repeat-expense, CSV export, and statement import.
- **Income & Allowance (`/income`):** Dedicated tracker for allowances, scholarships, stipends, and part-time income with source filters and CSV export.
- **Budgets (`/budgets`):** Overall monthly budget + per-category monthly budgets with non-double-counted utilization bars and historical month selector.
- **Recurring Expenses (`/recurring`):** Weekly, monthly, and yearly rules with pause/resume and idempotent **"Generate due now"** execution.
- **Savings Goals (`/goals`):** Target amounts, deadlines, contribution history (tracked separately from expenses), and completion estimates.
- **Settings & Backup (`/settings`):** Dark/Light frosted theme toggle, On-Device vs. Server API mode switcher, and **JSON Backup & Restore** for offline Android data portability.

---

## Project Structure

```text
Student_Expense_Tracker_V2/
├── Student_Expense_Tracker_V2.apk     # Ready-to-install Android APK
├── backend/
│   ├── config/                        # Django settings & root URL configuration
│   ├── expenses/                      # Models, serializers, views, bulk-import & analytics APIs, tests
│   ├── requirements.txt               # Python dependencies
│   └── manage.py
└── frontend/
    ├── android/                       # Capacitor Android Gradle project (com.student.expensetracker)
    ├── src/
    │   ├── charts/charts.jsx          # All-Pie-Chart visual analytics components
    │   ├── components/                # UI primitives, ExpenseForm, ImportModal
    │   ├── context/                   # AuthContext & ToastContext
    │   ├── layouts/AppShell.jsx       # Sidebar, Topbar, Mobile Bottom Nav & More Drawer
    │   ├── pages/                     # Dashboard, Transactions, Income, Budgets, Analytics, etc.
    │   ├── services/                  # api.js (REST client) & localApi.js (Offline On-Device engine)
    │   ├── styles/                    # tokens.css & components.css (Frosted Liquid Glass + Click Glow)
    │   └── utils/                     # format.js (BigInt INR math) & statementParser.js (PDF.js + CSV parser)
    ├── package.json
    └── vite.config.js
```

---

## Quick Start

### 1. Frontend (Web Development & Build)

```bash
cd frontend
npm install
npm run dev       # Start Vite dev server at http://localhost:5173
npm test          # Run 24 Vitest unit & component tests
npm run lint      # Run ESLint
npm run build     # Build code-split production bundle into dist/
```

### 2. Backend (Django REST API)

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate | macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py test        # Run 26 Django REST API tests
python manage.py runserver   # http://127.0.0.1:8000
```

### 3. Android APK Build (Capacitor + Gradle)

```bash
cd frontend
npm run build
npx cap sync android
cd android
./gradlew assembleDebug
```

The built APK is output to `frontend/android/app/build/outputs/apk/debug/app-debug.apk` (and included at the repository root as `Student_Expense_Tracker_V2.apk`).

---

## API Overview

| Area | Endpoints |
|---|---|
| **Auth** | `POST /api/auth/register/`, `POST /api/auth/login/`, `POST /api/auth/logout/`, `GET /api/auth/me/` |
| **Expenses** | `GET/POST /api/expenses/`, `GET/PATCH/PUT/DELETE /api/expenses/{id}/`, `POST /api/expenses/bulk-import/` |
| **Categories** | `GET/POST /api/categories/`, `GET/PATCH/DELETE /api/categories/{id}/` |
| **Budgets** | `GET/POST /api/budgets/`, `GET/PATCH/DELETE /api/budgets/{id}/` |
| **Income** | `GET/POST /api/incomes/`, `GET/PATCH/DELETE /api/incomes/{id}/` |
| **Recurring** | `GET/POST /api/recurring/`, `GET/PATCH/DELETE /api/recurring/{id}/`, `POST /api/recurring/generate-due/` |
| **Goals** | `GET/POST /api/goals/`, `GET/PATCH/DELETE /api/goals/{id}/`, `GET/POST /api/goals/{id}/contributions/` |
| **Analytics** | `GET /api/analytics/?month=YYYY-MM&from=&to=` (totals, category share, payment method share, daily spend, 6-month comparison, budgets, insights) |
