"""Models for Student Expense Tracker V2.

Budget double-counting rule (documented here for the coordinator's README):
overall-budget progress ALWAYS uses total spend for the month, and a
category-budget progress ALWAYS uses only that category's spend for the
month. A category budget is never subtracted from, or added into, the
overall budget's spend figure -- the two progress figures are computed
independently from the same expense rows, so nothing is counted twice.

Goal contributions are NOT expenses: they never appear in expense totals,
analytics spend, or budget progress. Goal progress is purely
sum(contributions) / target_amount.
"""

import os
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator, RegexValidator
from django.db import models
from django.db.models import Q
from django.db.models.functions import Lower

HEX_COLOR_VALIDATOR = RegexValidator(
    regex=r"^#[0-9A-Fa-f]{6}$",
    message="Color must be a hex value like #F97316.",
)

MAX_RECEIPT_BYTES = 5 * 1024 * 1024
ALLOWED_RECEIPT_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".pdf"}


def validate_receipt(value):
    """Receipt: at most 5 MB, only jpg/jpeg/png/webp/pdf."""
    if not value:
        return
    size = getattr(value, "size", None)
    if size is not None and size > MAX_RECEIPT_BYTES:
        raise ValidationError("Receipt must be at most 5 MB.")
    ext = os.path.splitext(getattr(value, "name", ""))[1].lower()
    if ext not in ALLOWED_RECEIPT_EXTENSIONS:
        raise ValidationError(
            "Receipt must be a jpg, jpeg, png, webp, or pdf file."
        )


def validate_positive_amount(value):
    if value is not None and value <= 0:
        raise ValidationError("Amount must be greater than 0.")


class TimestampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Category(TimestampedModel):
    """A spending category. owner=None means a legacy/shared row that has
    not been adopted yet (see adopt_legacy_data); it is never returned by
    the per-user API until adopted."""

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="categories",
    )
    name = models.CharField(max_length=100)
    icon = models.CharField(
        max_length=100, default="package",
        help_text="Lucide icon name, e.g. 'utensils'.",
    )
    color = models.CharField(
        max_length=7, default="#64748B", validators=[HEX_COLOR_VALIDATOR]
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                Lower("name"), "owner",
                name="unique_category_name_per_owner_ci",
            )
        ]
        indexes = [models.Index(fields=["owner", "name"])]
        ordering = ["name"]

    def __str__(self):
        return self.name

    def clean(self):
        super().clean()
        if self.name is not None:
            self.name = self.name.strip()
            if not self.name:
                raise ValidationError({"name": "Name must not be blank."})


class RecurringRule(TimestampedModel):
    FREQUENCY_CHOICES = [
        ("weekly", "Weekly"),
        ("monthly", "Monthly"),
        ("yearly", "Yearly"),
    ]

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        null=True, blank=True, related_name="recurring_rules",
    )
    category = models.ForeignKey(
        Category, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="recurring_rules",
    )
    description = models.CharField(max_length=300)
    amount = models.DecimalField(
        max_digits=12, decimal_places=2,
        validators=[validate_positive_amount],
    )
    frequency = models.CharField(max_length=20, choices=FREQUENCY_CHOICES)
    start_date = models.DateField()
    end_date = models.DateField(null=True, blank=True)
    next_due = models.DateField()
    active = models.BooleanField(default=True)
    last_generated_date = models.DateField(null=True, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                check=Q(amount__gt=0), name="recurring_amount_positive"
            )
        ]
        indexes = [models.Index(fields=["owner", "next_due"])]
        ordering = ["next_due"]

    def clean(self):
        super().clean()
        if self.end_date and self.end_date < self.start_date:
            raise ValidationError(
                {"end_date": "End date must not be before start date."}
            )

    def __str__(self):
        return f"{self.description} ({self.frequency})"


class Expense(TimestampedModel):
    PAYMENT_METHOD_CHOICES = [
        ("cash", "Cash"),
        ("upi", "UPI"),
        ("card", "Card"),
        ("bank", "Bank transfer"),
        ("other", "Other"),
    ]

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        null=True, blank=True, related_name="expenses",
    )
    date = models.DateField()
    category = models.ForeignKey(
        Category, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="expenses",
    )
    description = models.CharField(max_length=300)
    amount = models.DecimalField(
        max_digits=12, decimal_places=2,
        validators=[validate_positive_amount],
    )
    merchant = models.CharField(max_length=200, blank=True, default="")
    payment_method = models.CharField(
        max_length=20, choices=PAYMENT_METHOD_CHOICES, default="cash"
    )
    notes = models.TextField(blank=True, default="")
    tags = models.CharField(
        max_length=300, blank=True, default="",
        help_text="Comma-separated tags, e.g. 'hostel, weekend'.",
    )
    receipt = models.FileField(
        upload_to="receipts/", null=True, blank=True,
        validators=[validate_receipt],
    )
    recurring_rule = models.ForeignKey(
        RecurringRule, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="generated_expenses",
    )
    # The due date this instance was generated for; part of the
    # idempotency key with recurring_rule (see generate_due_recurring).
    recurring_date = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ["-date", "-id"]
        constraints = [
            models.CheckConstraint(
                check=Q(amount__gt=0), name="expense_amount_positive"
            ),
            models.UniqueConstraint(
                fields=["recurring_rule", "recurring_date"],
                name="unique_recurring_instance",
            ),
        ]
        indexes = [models.Index(fields=["owner", "date"])]

    def clean(self):
        super().clean()
        if self.description is not None and not self.description.strip():
            raise ValidationError(
                {"description": "Description must not be blank."}
            )
        if self.receipt:
            validate_receipt(self.receipt)

    def __str__(self):
        return f"{self.date} {self.description} {self.amount}"


class Budget(TimestampedModel):
    """month is always stored as day 1 of the month. category=None means
    the overall monthly budget; a set category means a category budget.
    See the module docstring for the no-double-count rule."""

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        null=True, blank=True, related_name="budgets",
    )
    month = models.DateField(help_text="Always day 1 of the month.")
    category = models.ForeignKey(
        Category, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="budgets",
    )
    amount = models.DecimalField(
        max_digits=12, decimal_places=2,
        validators=[validate_positive_amount],
    )
    alert_threshold = models.PositiveIntegerField(default=80)

    class Meta:
        constraints = [
            models.CheckConstraint(
                check=Q(amount__gt=0), name="budget_amount_positive"
            ),
            # Overall budget: one per owner+month (category IS NULL).
            models.UniqueConstraint(
                fields=["owner", "month"],
                condition=Q(category__isnull=True),
                name="unique_overall_budget_per_month",
            ),
            # Category budget: one per owner+month+category.
            models.UniqueConstraint(
                fields=["owner", "month", "category"],
                condition=Q(category__isnull=False),
                name="unique_category_budget_per_month",
            ),
        ]
        indexes = [models.Index(fields=["owner", "month"])]
        ordering = ["-month"]

    def save(self, *args, **kwargs):
        if self.month:
            self.month = self.month.replace(day=1)
        super().save(*args, **kwargs)

    def __str__(self):
        scope = self.category.name if self.category else "Overall"
        return f"{scope} {self.month:%Y-%m} {self.amount}"


class Income(TimestampedModel):
    SOURCE_CHOICES = [
        ("allowance", "Allowance"),
        ("scholarship", "Scholarship"),
        ("part-time", "Part-time work"),
        ("other", "Other"),
    ]

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        null=True, blank=True, related_name="incomes",
    )
    date = models.DateField()
    source = models.CharField(max_length=20, choices=SOURCE_CHOICES)
    description = models.CharField(max_length=300)
    amount = models.DecimalField(
        max_digits=12, decimal_places=2,
        validators=[validate_positive_amount],
    )

    class Meta:
        constraints = [
            models.CheckConstraint(
                check=Q(amount__gt=0), name="income_amount_positive"
            )
        ]
        indexes = [models.Index(fields=["owner", "date"])]
        ordering = ["-date", "-id"]

    def __str__(self):
        return f"{self.date} {self.source} {self.amount}"


class SavingsGoal(TimestampedModel):
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        null=True, blank=True, related_name="savings_goals",
    )
    name = models.CharField(max_length=200)
    target_amount = models.DecimalField(
        max_digits=12, decimal_places=2,
        validators=[validate_positive_amount],
    )
    target_date = models.DateField(null=True, blank=True)
    description = models.TextField(blank=True, default="")

    class Meta:
        constraints = [
            models.CheckConstraint(
                check=Q(target_amount__gt=0), name="goal_target_positive"
            )
        ]
        ordering = ["name"]

    @property
    def saved_amount(self):
        total = self.contributions.aggregate(total=models.Sum("amount"))["total"]
        return total or Decimal("0")

    @property
    def progress_percent(self):
        if not self.target_amount:
            return Decimal("0")
        return (self.saved_amount / self.target_amount * Decimal("100")).quantize(
            Decimal("0.01")
        )

    def __str__(self):
        return self.name


class GoalContribution(TimestampedModel):
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        null=True, blank=True, related_name="goal_contributions",
    )
    goal = models.ForeignKey(
        SavingsGoal, on_delete=models.CASCADE, related_name="contributions"
    )
    amount = models.DecimalField(
        max_digits=12, decimal_places=2,
        validators=[validate_positive_amount],
    )
    date = models.DateField()
    note = models.CharField(max_length=300, blank=True, default="")

    class Meta:
        constraints = [
            models.CheckConstraint(
                check=Q(amount__gt=0), name="contribution_amount_positive"
            )
        ]
        indexes = [models.Index(fields=["owner", "goal"])]
        ordering = ["-date", "-id"]

    def __str__(self):
        return f"{self.goal.name} +{self.amount} on {self.date}"
