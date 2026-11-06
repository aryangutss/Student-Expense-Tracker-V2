# Student Expense Tracker — Frontend (V2)

React 19 + Vite frontend for the Student Expense Tracker V2 upgrade.

## Run

```bash
cp .env.example .env   # set VITE_API_URL (default http://127.0.0.1:8000)
npm install
npm run dev            # dev server
npm run build          # production build
npm test               # Vitest suite
npm run lint
```

## Routes

`/login`, `/register`, `/` (Dashboard), `/transactions`, `/budgets`,
`/analytics`, `/categories`, `/recurring`, `/goals`, `/settings`.
Protected routes redirect to `/login` without a token; refresh keeps the
route and browser back/forward work (react-router-dom).

## Data notes (linked from Settings)

- API base URL comes only from `VITE_API_URL`; no component hardcodes a host.
- Auth is `Authorization: Token <token>`. Data is per-account on the backend.
- Only the auth token and the theme choice (`dark`/`light`) are stored in
  `localStorage`. No expenses, budgets, goals or other financial data are
  stored locally.
- Money arrives as strings and is displayed as strings: totals use integer
  paise arithmetic (`src/utils/format.js`), never JS float math. INR is
  formatted with Indian grouping (en-IN) and 2 decimals.
- Dates are date-only strings (`YYYY-MM-DD`) handled by parts in
  Asia/Kolkata, never parsed through `new Date(str)`, so no UTC shift.
- Pagination is 20 per page; the Transactions page total is the current
  page's total — use Export CSV for the full filtered set.
- Chart segments in Analytics click through to filtered Transactions, so
  chart numbers and the transaction list come from the same API.
