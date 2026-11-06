"""Service functions: default categories, recurring generation, adoption."""

import calendar
from datetime import date, timedelta

from django.db import transaction
from django.utils import timezone

from .models import Budget, Category, Expense, RecurringRule

DEFAULT_CATEGORIES = [
    ("Food", "utensils", "#F97316"),
    ("Transport", "car", "#3B82F6"),
    ("Education", "graduation-cap", "#8B5CF6"),
    ("Accommodation", "home", "#0EA5E9"),
    ("Shopping", "shopping-bag", "#EC4899"),
    ("Entertainment", "film", "#F43F5E"),
    ("Health", "heart-pulse", "#22C55E"),
    ("Subscriptions", "repeat", "#6366F1"),
    ("Personal Care", "sparkles", "#14B8A6"),
    ("Other", "package", "#64748B"),
]


def seed_default_categories(user):
    """Create the 10 default categories for a user, idempotently
    (case-insensitive: an existing 'food' is not duplicated as 'Food')."""
    created = []
    existing = {
        c.name.lower(): c
        for c in Category.objects.filter(owner=user)
    }
    for name, icon, color in DEFAULT_CATEGORIES:
        if name.lower() in existing:
            continue
        created.append(
            Category.objects.create(
                owner=user, name=name, icon=icon, color=color
            )
        )
    return created


def _advance_due(due, frequency):
    """Advance one due date, clamping to the end of the target month so
    month boundaries and leap years are handled (Jan 31 -> Feb 28/29,
    Feb 29 yearly -> Feb 28 in non-leap years)."""
    if frequency == "weekly":
        return due + timedelta(days=7)
    if frequency == "monthly":
        year, month = due.year, due.month + 1
        if month == 13:
            year, month = year + 1, 1
        last_day = calendar.monthrange(year, month)[1]
        return date(year, month, min(due.day, last_day))
    if frequency == "yearly":
        year = due.year + 1
        last_day = calendar.monthrange(year, due.month)[1]
        return date(year, due.month, min(due.day, last_day))
    raise ValueError(f"Unknown frequency: {frequency}")


@transaction.atomic
def generate_due_recurring(user, up_to_date=None):
    """Create one Expense per due date up to ``up_to_date`` (default today,
    Asia/Kolkata) for the user's active rules.

    - Never generates for paused (active=False) rules or past end_date.
    - Idempotent: the (recurring_rule, recurring_date) unique constraint
      plus get_or_create means running twice creates nothing twice, even
      if next_due was already advanced by a first run.
    - Never runs implicitly on page load; only via the API endpoint or
      the generate_recurring management command.
    Returns (created_expenses, rules_touched).
    """
    if up_to_date is None:
        up_to_date = timezone.localdate()
    created, touched = [], []
    rules = user.recurring_rules.filter(active=True).select_related("category")
    for rule in rules:
        due = rule.next_due
        generated_any = False
        while due is not None and due <= up_to_date:
            if rule.end_date is not None and due > rule.end_date:
                break
            expense, was_created = Expense.objects.get_or_create(
                recurring_rule=rule,
                recurring_date=due,
                defaults={
                    "owner": user,
                    "date": due,
                    "category": rule.category,
                    "description": rule.description,
                    "amount": rule.amount,
                    "payment_method": "other",
                },
            )
            if was_created:
                created.append(expense)
            generated_any = True
            rule.last_generated_date = due
            due = _advance_due(due, rule.frequency)
            # Guard against a rule whose advance never moves forward.
            if due <= rule.next_due and not generated_any:
                break
        if generated_any:
            rule.next_due = due
            rule.save(update_fields=["next_due", "last_generated_date", "updated_at"])
            touched.append(rule)
    return created, touched


def adopt_legacy_data(user):
    """Assign every owner-null category/expense/income to ``user``.

    Categories are merged case-insensitively first (two null-owner
    categories differing only by case collapse into one, keeping the
    first id), so expenses pointing at the duplicate are re-pointed.
    Returns a dict of counts."""
    counts = {"categories": 0, "expenses": 0, "incomes": 0}
    # Merge duplicate null-owner categories by lower-cased name.
    seen = {}
    for cat in Category.objects.filter(owner__isnull=True).order_by("id"):
        key = cat.name.strip().lower()
        if key in seen:
            Expense.objects.filter(category=cat).update(category=seen[key])
            cat.delete()
        else:
            seen[key] = cat
    # If the user already has a same-name category (e.g. the 'Food'
    # seeded at registration), re-point legacy expenses at the user's
    # category and drop the null-owner duplicate instead of assigning
    # it — a blind owner update would violate the per-owner unique
    # category constraint. This is the path every real adopter hits,
    # since registration seeds the defaults first.
    for cat in list(Category.objects.filter(owner__isnull=True).order_by("id")):
        own = Category.objects.filter(
            owner=user, name__iexact=cat.name.strip()
        ).first()
        if own is not None:
            Expense.objects.filter(category=cat).update(category=own)
            RecurringRule.objects.filter(category=cat).update(category=own)
            Budget.objects.filter(category=cat).update(category=own)
            cat.delete()
            counts["categories"] += 1
    counts["categories"] += Category.objects.filter(
        owner__isnull=True
    ).update(owner=user)
    counts["expenses"] = Expense.objects.filter(
        owner__isnull=True
    ).update(owner=user)
    from .models import Income

    counts["incomes"] = Income.objects.filter(owner__isnull=True).update(owner=user)
    return counts
