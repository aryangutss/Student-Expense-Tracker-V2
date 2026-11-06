"""Backend tests for Student Expense Tracker V2 (DRF APITestCase).

Run: python manage.py test
Covers: expense CRUD + validation, budgets, categories (+ delete block),
filtering/sorting/pagination, analytics, recurring generation
(month-boundary, leap year, idempotency, paused), goal progress,
auth isolation + 401, legacy adoption, and migration safety on a
scratch DB copy holding the 4 original legacy rows.
"""

import os
import sqlite3
import subprocess
import sys
import tempfile
from datetime import date
from decimal import Decimal

from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase

from .models import Category, Expense
from .services import adopt_legacy_data, generate_due_recurring

User = get_user_model()


def make_user(username):
    user = User.objects.create_user(username=username, password="testpass123")
    token = Token.objects.create(user=user)
    return user, token


class BaseAPITest(APITestCase):
    def setUp(self):
        self.user_a, self.token_a = make_user("alice")
        self.user_b, self.token_b = make_user("bob")
        self.cat_a = Category.objects.create(
            owner=self.user_a, name="Food", icon="utensils", color="#F97316"
        )
        self.cat_b = Category.objects.create(
            owner=self.user_b, name="Food", icon="utensils", color="#F97316"
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {self.token_a.key}")

    def as_b(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {self.token_b.key}")

    def as_anon(self):
        self.client.credentials()


class ExpenseCRUDTests(BaseAPITest):
    def test_create_list_detail_patch_put_delete(self):
        created = self.client.post("/api/expenses/", {
            "date": "2026-10-05", "category": self.cat_a.id,
            "description": "Hostel dinner", "amount": "120.00",
            "merchant": "Mess", "payment_method": "upi",
        }, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        exp_id = created.data["id"]
        self.assertEqual(created.data["category_name"], "Food")

        listed = self.client.get("/api/expenses/")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.data["count"], 1)

        detail = self.client.get(f"/api/expenses/{exp_id}/")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.data["description"], "Hostel dinner")

        patched = self.client.patch(
            f"/api/expenses/{exp_id}/", {"amount": "130.50"}, format="json")
        self.assertEqual(patched.status_code, 200)
        self.assertEqual(patched.data["amount"], "130.50")

        put = self.client.put(f"/api/expenses/{exp_id}/", {
            "date": "2026-10-06", "category": self.cat_a.id,
            "description": "Lunch", "amount": "150.00",
        }, format="json")
        self.assertEqual(put.status_code, 200)
        self.assertEqual(put.data["description"], "Lunch")

        deleted = self.client.delete(f"/api/expenses/{exp_id}/")
        self.assertEqual(deleted.status_code, 204)
        self.assertEqual(self.client.get("/api/expenses/").data["count"], 0)

    def test_invalid_amount_date_description(self):
        for payload, field in [
            ({"date": "2026-10-05", "category": self.cat_a.id,
              "description": "x", "amount": "0"}, "amount"),
            ({"date": "2026-10-05", "category": self.cat_a.id,
              "description": "x", "amount": "-5"}, "amount"),
            ({"date": "not-a-date", "category": self.cat_a.id,
              "description": "x", "amount": "10"}, "date"),
            ({"date": "2026-10-05", "category": self.cat_a.id,
              "description": "   ", "amount": "10"}, "description"),
            ({"date": "2026-10-05", "category": self.cat_a.id,
              "description": "x"}, "amount"),
        ]:
            resp = self.client.post("/api/expenses/", payload, format="json")
            self.assertEqual(resp.status_code, 400, payload)
            self.assertIn(field, resp.data, payload)

    def test_category_by_name_accepted(self):
        resp = self.client.post("/api/expenses/", {
            "date": "2026-10-05", "category": "food",
            "description": "Lunch", "amount": "150",
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.data["category"], self.cat_a.id)
        self.assertEqual(resp.data["category_color"], "#F97316")
        self.assertEqual(resp.data["category_icon"], "utensils")

    def test_receipt_validation_blocks_bad_extension(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        bad_file = SimpleUploadedFile(
            "malware.exe", b"not-an-image", content_type="application/octet-stream"
        )
        resp = self.client.post("/api/expenses/", {
            "date": "2026-10-05", "category": self.cat_a.id,
            "description": "Receipt test", "amount": "99.00",
            "receipt": bad_file,
        }, format="multipart")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("receipt", resp.data)


class BudgetTests(BaseAPITest):
    def test_budget_persistence_update_and_category_budgets(self):
        overall = self.client.post("/api/budgets/", {
            "month": "2026-10-01", "amount": "5000",
        }, format="json")
        self.assertEqual(overall.status_code, 201, overall.content)
        budget_id = overall.data["id"]

        # Duplicate overall budget for the same month must be rejected.
        dup = self.client.post("/api/budgets/", {
            "month": "2026-10-15", "amount": "6000",
        }, format="json")
        self.assertEqual(dup.status_code, 400)

        # Category budget for the same month is independent and allowed.
        cat_budget = self.client.post("/api/budgets/", {
            "month": "2026-10-01", "category": self.cat_a.id,
            "amount": "2000",
        }, format="json")
        self.assertEqual(cat_budget.status_code, 201, cat_budget.content)

        # Duplicate category budget rejected.
        dup_cat = self.client.post("/api/budgets/", {
            "month": "2026-10-01", "category": self.cat_a.id,
            "amount": "3000",
        }, format="json")
        self.assertEqual(dup_cat.status_code, 400)

        updated = self.client.patch(
            f"/api/budgets/{budget_id}/", {"amount": "5500"}, format="json")
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.data["amount"], "5500.00")
        # Month is normalized to day 1 even when given mid-month on create
        # (duplicate check above already proved this for Oct 15).

    def test_budget_amount_must_be_positive(self):
        resp = self.client.post("/api/budgets/", {
            "month": "2026-10-01", "amount": "0",
        }, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("amount", resp.data)


class CategoryTests(BaseAPITest):
    def test_category_crud_and_case_insensitive_duplicate(self):
        created = self.client.post("/api/categories/", {
            "name": "Transport", "icon": "car", "color": "#3B82F6",
        }, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        cat_id = created.data["id"]

        dup = self.client.post("/api/categories/", {
            "name": "transport", "icon": "car", "color": "#3B82F6",
        }, format="json")
        self.assertEqual(dup.status_code, 400)
        self.assertIn("name", dup.data)

        patched = self.client.patch(
            f"/api/categories/{cat_id}/", {"color": "#000000"}, format="json")
        self.assertEqual(patched.status_code, 200)
        self.assertEqual(patched.data["color"], "#000000")

        deleted = self.client.delete(f"/api/categories/{cat_id}/")
        self.assertEqual(deleted.status_code, 204)

    def test_delete_blocked_when_used(self):
        Expense.objects.create(
            owner=self.user_a, date=date(2026, 10, 5), category=self.cat_a,
            description="Lunch", amount=Decimal("150"),
        )
        resp = self.client.delete(f"/api/categories/{self.cat_a.id}/")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("used by 1 expense", resp.data["detail"])
        self.assertTrue(Category.objects.filter(pk=self.cat_a.id).exists())

    def test_register_seeds_default_categories(self):
        resp = self.client.post("/api/auth/register/", {
            "username": "newuser", "password": "strongpass123",
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.content)
        user = User.objects.get(username="newuser")
        names = set(user.categories.values_list("name", flat=True))
        for expected in ("Food", "Transport", "Education", "Accommodation",
                         "Shopping", "Entertainment", "Health",
                         "Subscriptions", "Personal Care", "Other"):
            self.assertIn(expected, names)


class FilteringSortingPaginationTests(BaseAPITest):
    def setUp(self):
        super().setUp()
        for i in range(22):
            Expense.objects.create(
                owner=self.user_a, date=date(2026, 10, (i % 28) + 1),
                category=self.cat_a, description=f"Meal {i}",
                amount=Decimal(100 + i), payment_method="upi" if i % 2 else "cash",
            )

    def test_pagination_page_size_20(self):
        first = self.client.get("/api/expenses/")
        self.assertEqual(first.data["count"], 22)
        self.assertEqual(len(first.data["results"]), 20)
        self.assertIsNotNone(first.data["next"])
        second = self.client.get("/api/expenses/?page=2")
        self.assertEqual(len(second.data["results"]), 2)

    def test_pagination_page_size_query_param(self):
        # The frontend relies on ?page_size= (lists, CSV export). DRF's
        # stock paginator ignores that parameter unless the pagination
        # class itself enables it, so this is pinned by a test.
        page = self.client.get("/api/expenses/?page_size=5")
        self.assertEqual(len(page.data["results"]), 5)
        self.assertEqual(page.data["count"], 22)
        big = self.client.get("/api/expenses/?page_size=1000")
        self.assertEqual(len(big.data["results"]), 22)

    def test_filters(self):
        by_search = self.client.get("/api/expenses/?search=Meal 1")
        self.assertTrue(by_search.data["count"] >= 1)
        by_method = self.client.get("/api/expenses/?payment_method=upi")
        self.assertEqual(by_method.data["count"], 11)
        by_month = self.client.get("/api/expenses/?month=2026-10")
        self.assertEqual(by_month.data["count"], 22)
        by_name = self.client.get("/api/expenses/?category=Food")
        self.assertEqual(by_name.data["count"], 22)
        by_range = self.client.get(
            "/api/expenses/?min_amount=110&max_amount=115")
        self.assertEqual(by_range.data["count"], 6)

    def test_ordering_by_amount(self):
        resp = self.client.get("/api/expenses/?ordering=amount")
        amounts = [Decimal(r["amount"]) for r in resp.data["results"]]
        self.assertEqual(amounts, sorted(amounts))


class AnalyticsTests(BaseAPITest):
    def setUp(self):
        super().setUp()
        Expense.objects.create(owner=self.user_a, date=date(2026, 10, 5),
                               category=self.cat_a, description="Lunch",
                               amount=Decimal("150"))
        Expense.objects.create(owner=self.user_a, date=date(2026, 10, 6),
                               category=self.cat_a, description="Dinner",
                               amount=Decimal("250"))
        from .models import Income
        Income.objects.create(owner=self.user_a, date=date(2026, 10, 1),
                              source="allowance", description="Pocket money",
                              amount=Decimal("1000"))
        Expense.objects.create(owner=self.user_a, date=date(2026, 9, 20),
                               category=self.cat_a, description="Old",
                               amount=Decimal("200"))

    def test_totals_and_category_aggregation(self):
        resp = self.client.get("/api/analytics/?month=2026-10")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data["totals"]["spent"], "400.00")
        self.assertEqual(resp.data["totals"]["income"], "1000.00")
        self.assertEqual(resp.data["totals"]["net"], "600.00")
        self.assertEqual(resp.data["totals"]["expense_count"], 2)
        self.assertEqual(resp.data["previous_month"]["spent"], "200.00")
        breakdown = resp.data["category_breakdown"]
        self.assertEqual(len(breakdown), 1)
        self.assertEqual(breakdown[0]["category"], "Food")
        self.assertEqual(breakdown[0]["total"], "400.00")
        self.assertEqual(breakdown[0]["share"], "100.00")
        self.assertEqual(resp.data["top_category"]["category"], "Food")
        months = {m["month"]: m for m in resp.data["monthly_comparison"]}
        self.assertEqual(months["2026-10"]["spent"], "400.00")
        self.assertEqual(months["2026-09"]["spent"], "200.00")
        self.assertTrue(any("Top category" in i for i in resp.data["insights"]))

    def test_budget_vs_actual_no_double_count(self):
        self.client.post("/api/budgets/", {
            "month": "2026-10-01", "amount": "1000"}, format="json")
        self.client.post("/api/budgets/", {
            "month": "2026-10-01", "category": self.cat_a.id,
            "amount": "500"}, format="json")
        resp = self.client.get("/api/analytics/?month=2026-10")
        # Overall uses TOTAL month spend (400); category uses Food spend (400).
        self.assertEqual(resp.data["budgets"]["overall"]["spent"], "400.00")
        self.assertEqual(resp.data["budgets"]["categories"][0]["spent"], "400.00")

    def test_income_month_and_source_filters(self):
        resp = self.client.get("/api/incomes/?month=2026-10&source=allowance")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["count"], 1)
        self.assertEqual(resp.data["results"][0]["amount"], "1000.00")
        empty = self.client.get("/api/incomes/?month=2026-09")
        self.assertEqual(empty.data["count"], 0)


class RecurringTests(BaseAPITest):
    def test_month_boundary_leap_year_and_idempotency(self):
        from .models import RecurringRule
        rule = RecurringRule.objects.create(
            owner=self.user_a, category=self.cat_a, description="Rent",
            amount=Decimal("5000"), frequency="monthly",
            start_date=date(2024, 1, 31), next_due=date(2024, 1, 31),
        )
        created, _ = generate_due_recurring(self.user_a, date(2024, 3, 31))
        # Jan 31 -> Feb 29 (leap-year clamp) -> Mar 29.
        self.assertEqual(len(created), 3)
        self.assertEqual(
            sorted(str(e.date) for e in created),
            ["2024-01-31", "2024-02-29", "2024-03-29"],
        )
        rule.refresh_from_db()
        self.assertEqual(str(rule.next_due), "2024-04-29")
        # Second run creates nothing twice.
        created2, _ = generate_due_recurring(self.user_a, date(2024, 3, 31))
        self.assertEqual(len(created2), 0)
        self.assertEqual(Expense.objects.filter(
            recurring_rule=rule).count(), 3)

    def test_paused_rule_generates_nothing(self):
        from .models import RecurringRule
        RecurringRule.objects.create(
            owner=self.user_a, category=self.cat_a, description="Paused",
            amount=Decimal("100"), frequency="weekly",
            start_date=date(2026, 10, 1), next_due=date(2026, 10, 1),
            active=False,
        )
        created, _ = generate_due_recurring(self.user_a, date(2026, 10, 29))
        self.assertEqual(len(created), 0)

    def test_generate_due_endpoint(self):
        from .models import RecurringRule
        RecurringRule.objects.create(
            owner=self.user_a, category=self.cat_a, description="Weekly",
            amount=Decimal("100"), frequency="weekly",
            start_date=date(2026, 10, 1), next_due=date(2026, 10, 1),
        )
        resp = self.client.post("/api/recurring/generate-due/", {
            "up_to_date": "2026-10-15"}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data["created"], 3)  # Oct 1, 8, 15
        again = self.client.post("/api/recurring/generate-due/", {
            "up_to_date": "2026-10-15"}, format="json")
        self.assertEqual(again.data["created"], 0)


class GoalTests(BaseAPITest):
    def test_goal_progress_math_and_contributions(self):
        goal = self.client.post("/api/goals/", {
            "name": "Laptop", "target_amount": "1000",
        }, format="json")
        self.assertEqual(goal.status_code, 201, goal.content)
        goal_id = goal.data["id"]

        contrib = self.client.post(
            f"/api/goals/{goal_id}/contributions/", {
                "amount": "250", "date": "2026-10-05", "note": "saved",
            }, format="json")
        self.assertEqual(contrib.status_code, 201, contrib.content)
        contrib_id = contrib.data["id"]

        detail = self.client.get(f"/api/goals/{goal_id}/")
        self.assertEqual(detail.data["saved_amount"], "250.00")
        self.assertEqual(detail.data["progress_percent"], "25.00")

        listed = self.client.get(f"/api/goals/{goal_id}/contributions/")
        self.assertEqual(listed.data["count"], 1)

        deleted = self.client.delete(
            f"/api/goals/{goal_id}/contributions/{contrib_id}/")
        self.assertEqual(deleted.status_code, 204)
        detail2 = self.client.get(f"/api/goals/{goal_id}/")
        self.assertEqual(detail2.data["saved_amount"], "0.00")
        # Contributions are NOT expenses: expense list stays empty.
        self.assertEqual(self.client.get("/api/expenses/").data["count"], 0)


class AuthIsolationTests(BaseAPITest):
    def test_unauthenticated_gets_401(self):
        self.as_anon()
        for url in ("/api/expenses/", "/api/categories/", "/api/analytics/"):
            resp = self.client.get(url)
            self.assertEqual(resp.status_code, 401, url)

    def test_user_b_cannot_read_update_delete_user_a_rows(self):
        expense = Expense.objects.create(
            owner=self.user_a, date=date(2026, 10, 5), category=self.cat_a,
            description="Private", amount=Decimal("150"),
        )
        self.as_b()
        self.assertEqual(self.client.get("/api/expenses/").data["count"], 0)
        self.assertEqual(
            self.client.get(f"/api/expenses/{expense.id}/").status_code, 404)
        self.assertEqual(
            self.client.patch(f"/api/expenses/{expense.id}/",
                              {"amount": "1"}, format="json").status_code, 404)
        self.assertEqual(
            self.client.delete(f"/api/expenses/{expense.id}/").status_code, 404)
        self.assertTrue(Expense.objects.filter(pk=expense.id).exists())

    def test_login_logout_me(self):
        self.as_anon()
        login = self.client.post("/api/auth/login/", {
            "username": "alice", "password": "testpass123"}, format="json")
        self.assertEqual(login.status_code, 200)
        token = login.data["token"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token}")
        me = self.client.get("/api/auth/me/")
        self.assertEqual(me.data["username"], "alice")
        logout = self.client.post("/api/auth/logout/")
        self.assertEqual(logout.status_code, 204)
        self.assertEqual(self.client.get("/api/expenses/").status_code, 401)


class LegacyAdoptionTests(TestCase):
    def test_adopt_assigns_owner_null_rows(self):
        user = User.objects.create_user(username="adopter", password="x12345678")
        cat = Category.objects.create(owner=None, name="Food")
        Expense.objects.create(owner=None, date=date(2026, 10, 5),
                               category=cat, description="Hostel dinner",
                               amount=Decimal("120"))
        counts = adopt_legacy_data(user)
        self.assertEqual(counts["expenses"], 1)
        self.assertEqual(counts["categories"], 1)
        self.assertEqual(Expense.objects.filter(owner=user).count(), 1)

    def test_adopt_merges_into_seeded_category(self):
        # Real adopter path: registration seeds 'Food' first, so adopting
        # a null-owner 'Food' must re-point expenses at the seeded row
        # instead of violating the per-owner unique category constraint.
        from .services import seed_default_categories
        user = User.objects.create_user(username="adopter2", password="x12345678")
        seed_default_categories(user)
        cat = Category.objects.create(owner=None, name="Food")
        Expense.objects.create(owner=None, date=date(2026, 10, 5),
                               category=cat, description="Hostel dinner",
                               amount=Decimal("120"))
        adopt_legacy_data(user)
        self.assertEqual(Expense.objects.filter(owner=user).count(), 1)
        self.assertEqual(
            Category.objects.filter(owner=user, name__iexact="Food").count(), 1)
        self.assertEqual(
            Expense.objects.get(owner=user).category.owner, user)


class MigrationSafetyTests(TestCase):
    """Run real migrations on a scratch DB copy holding the 4 legacy rows.

    This test shells out to manage.py with DATABASE_PATH pointed at a temp
    file -- never the shipped db.sqlite3 -- first migrating only 0001,
    inserting the 4 original rows, then migrating to head (0002) and
    asserting all 4 survive with identical amounts and a single merged
    'Food' category.
    """

    def test_legacy_rows_survive_0002(self):
        backend_dir = settings.BASE_DIR
        tmp = tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False)
        tmp.close()
        db_path = tmp.name
        try:
            env = dict(os.environ, DATABASE_PATH=db_path,
                       DJANGO_SETTINGS_MODULE="config.settings")
            for args in (["migrate", "expenses", "0001"],
                         ["migrate"]):
                result = subprocess.run(
                    [sys.executable, "manage.py"] + args,
                    cwd=str(backend_dir), env=env,
                    capture_output=True, text=True, timeout=180,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                if args[-1] == "0001":
                    conn = sqlite3.connect(db_path)
                    rows = [
                        (2, "2026-09-20", "food", "Lunch", 150),
                        (3, "2026-09-20", "food", "Lunch", 150),
                        (4, "2026-09-27", "food", "Dinner with friends", 250),
                        (7, "2026-10-05", "Food", "Hostel dinner", 120),
                    ]
                    conn.executemany(
                        "INSERT INTO expenses_expense "
                        "(id, date, category, description, amount) "
                        "VALUES (?, ?, ?, ?, ?)", rows)
                    conn.commit()
                    conn.close()
            conn = sqlite3.connect(db_path)
            survived = conn.execute(
                "SELECT date, description, amount FROM expenses_expense "
                "ORDER BY id").fetchall()
            self.assertEqual(len(survived), 4)
            self.assertEqual(
                [float(r[2]) for r in survived], [150.0, 150.0, 250.0, 120.0])
            cats = conn.execute(
                "SELECT name, owner_id FROM expenses_category").fetchall()
            self.assertEqual(len(cats), 1)
            self.assertEqual(cats[0][0], "Food")
            self.assertIsNone(cats[0][1])
            cat_ids = conn.execute(
                "SELECT DISTINCT category_id FROM expenses_expense").fetchall()
            self.assertEqual(len(cat_ids), 1)
            self.assertIsNotNone(cat_ids[0][0])
            conn.close()
        finally:
            if os.path.exists(db_path):
                os.unlink(db_path)
