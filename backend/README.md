# Student Expense Tracker V2 — Backend

Django + Django REST Framework, SQLite, timezone Asia/Kolkata.

## Setup

```bash
python -m venv /tmp/et2-venv
/tmp/et2-venv/bin/pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

Environment (see `.env.example`): `DJANGO_SECRET_KEY`, `DJANGO_DEBUG`,
`DJANGO_ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`. `DATABASE_PATH` is an
optional override used only for scratch-database verification — never
set it in the shipped tree.

## Auth

Token authentication (`Authorization: Token <key>`). All `/api/` routes
except register/login require authentication (unauthenticated → 401),
and every queryset is scoped to `request.user`: one user never sees
another user's rows, and legacy owner-null rows are never returned
until adopted.

- `POST /api/auth/register/` — creates the user, seeds the 10 default
  categories (Food, Transport, Education, Accommodation, Shopping,
  Entertainment, Health, Subscriptions, Personal Care, Other), returns
  a token.
- `POST /api/auth/login/` — returns a token.
- `POST /api/auth/logout/` — deletes the token.
- `GET /api/auth/me/`

## API surface (all under `/api/`)

- `GET/POST /api/expenses/`, `GET/PATCH/PUT/DELETE /api/expenses/{id}/`
  — filters: `search` (description + merchant, plus exact id match for
  numeric terms), `category` (id or name), `date_from`, `date_to`,
  `month=YYYY-MM`, `payment_method`, `min_amount`, `max_amount`;
  ordering by `date`/`amount`; pagination page size 20, `page_size`
  query param up to 1000 (enabled by `expenses/pagination.py` — DRF's
  stock paginator ignores that parameter). The original
  `/api/expenses/` path is preserved.
- `GET/POST /api/categories/`, `GET/PATCH/PUT/DELETE /api/categories/{id}/`
  — delete returns 400 with a clear message when expenses use the category.
- `GET/POST /api/budgets/`, `.../{id}/` — `month` is normalized to day 1.
- `GET/POST /api/incomes/`, `.../{id}/`
- `GET/POST /api/recurring/`, `.../{id}/`, plus
  `POST /api/recurring/generate-due/` (`{"up_to_date": "YYYY-MM-DD"}` optional).
  Recurring expenses are generated ONLY via this endpoint or the
  `generate_recurring` management command — never on page load.
- `GET/POST /api/goals/`, `.../{id}/`, plus
  `GET/POST /api/goals/{id}/contributions/` and
  `DELETE /api/goals/{id}/contributions/{contrib_id}/`.
- `GET /api/analytics/?month=YYYY-MM&from=&to=` — totals (spent, income,
  net, counts), previous-month spent + delta %, daily trend, category
  breakdown (total + count + share), last-6-months comparison, budget
  vs actual, daily average, top category, and insights computed from
  real data. All money math is Decimal on the server; money fields are
  serialized as strings to avoid float error.

## Budget double-counting rule

Overall-budget progress ALWAYS uses total spend for the month, and a
category-budget progress ALWAYS uses only that category's spend for the
month. The two figures are computed independently from the same expense
rows, so a category budget is never added into or subtracted from the
overall figure — nothing is counted twice.

Goal contributions are NOT expenses: they never appear in expense
totals, analytics spend, or budget progress. Goal progress is
`sum(contributions) / target_amount`.

## Legacy data

Migration `0002` converts the original free-text `Expense.category`
into `Category` rows case-insensitively (`food` + `Food` → one `Food`
category, owner null) and re-points every legacy expense, keeping all
rows and amounts intact. Adopt them into a user with:

```bash
python manage.py adopt_legacy_data <username>
```

If the user already has a same-name category (registration seeds
`Food`, so this is the normal case), legacy expenses are re-pointed at
the user's existing category and the null-owner duplicate is dropped —
adoption never violates the per-owner unique category constraint.

## Receipts

Optional `FileField` under `MEDIA_ROOT/receipts/`, max 5 MB, only
jpg/jpeg/png/webp/pdf (validated at model and serializer level).

## Tests

```bash
python manage.py test
```
