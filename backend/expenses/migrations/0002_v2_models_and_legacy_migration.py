# Student Expense Tracker V2 -- migration 0002.
#
# (a) Adds all new models/fields (Category, RecurringRule, Budget, Income,
#     SavingsGoal, GoalContribution, and the new Expense fields).
# (b) Migrates legacy Expense.category free text into Category rows
#     CASE-INSENSITIVELY: 'food' and 'Food' become ONE Category named
#     'Food' (owner=None, i.e. unadopted legacy data), and every legacy
#     expense is pointed at it.
# (c) Keeps every legacy row and amount intact: the old text column is
#     only dropped after all rows have been re-pointed, and no row is
#     deleted or re-created. Amounts are never touched (only max_digits
#     widens from 8 to 12).
#
# Reverse: the data step is a no-op on reverse (the legacy text values
# cannot be reconstructed exactly once the column is dropped); the schema
# steps reverse normally.

from django.conf import settings
from django.core.validators import RegexValidator
from django.db import migrations, models
from django.utils import timezone
from expenses.models import validate_positive_amount, validate_receipt
import django.db.models.deletion
from django.db.models.functions import Lower

LEGACY_STYLE = {
    "food": ("utensils", "#F97316"),
    "transport": ("car", "#3B82F6"),
    "education": ("graduation-cap", "#8B5CF6"),
    "accommodation": ("home", "#0EA5E9"),
    "shopping": ("shopping-bag", "#EC4899"),
    "entertainment": ("film", "#F43F5E"),
    "health": ("heart-pulse", "#22C55E"),
    "subscriptions": ("repeat", "#6366F1"),
    "personal care": ("sparkles", "#14B8A6"),
    "other": ("package", "#64748B"),
}


def migrate_legacy_categories(apps, schema_editor):
    Category = apps.get_model("expenses", "Category")
    Expense = apps.get_model("expenses", "Expense")
    # Distinct legacy texts, grouped case-insensitively, in first-seen order.
    groups = {}
    for text in Expense.objects.values_list("legacy_category", flat=True):
        if text is None:
            continue
        key = text.strip().lower()
        if not key:
            continue
        groups.setdefault(key, []).append(text.strip())
    for key, variants in groups.items():
        # Prefer an already title-cased variant ('Food' over 'food').
        display = next(
            (v for v in variants if v == v.title()), variants[0].title()
        )
        icon, color = LEGACY_STYLE.get(key, ("package", "#64748B"))
        category = Category.objects.create(
            owner=None, name=display, icon=icon, color=color
        )
        Expense.objects.filter(legacy_category__iexact=key).update(
            category=category
        )


class Migration(migrations.Migration):

    dependencies = [
        ("expenses", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="Category",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("name", models.CharField(max_length=100)),
                ("icon", models.CharField(default="package", help_text="Lucide icon name, e.g. 'utensils'.", max_length=100)),
                ("color", models.CharField(default="#64748B", max_length=7, validators=[RegexValidator(message="Color must be a hex value like #F97316.", regex="^#[0-9A-Fa-f]{6}$")])),
                ("owner", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name="categories", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["name"]},
        ),
        migrations.AddConstraint(
            model_name="category",
            constraint=models.UniqueConstraint(Lower("name"), "owner", name="unique_category_name_per_owner_ci"),
        ),
        migrations.AddIndex(
            model_name="category",
            index=models.Index(fields=["owner", "name"], name="expenses_ca_owner_i_714bae_idx"),
        ),
        migrations.CreateModel(
            name="RecurringRule",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("description", models.CharField(max_length=300)),
                ("amount", models.DecimalField(decimal_places=2, max_digits=12, validators=[validate_positive_amount])),
                ("frequency", models.CharField(choices=[("weekly", "Weekly"), ("monthly", "Monthly"), ("yearly", "Yearly")], max_length=20)),
                ("start_date", models.DateField()),
                ("end_date", models.DateField(blank=True, null=True)),
                ("next_due", models.DateField()),
                ("active", models.BooleanField(default=True)),
                ("last_generated_date", models.DateField(blank=True, null=True)),
                ("category", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="recurring_rules", to="expenses.category")),
                ("owner", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name="recurring_rules", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["next_due"]},
        ),
        migrations.AddConstraint(
            model_name="recurringrule",
            constraint=models.CheckConstraint(check=models.Q(amount__gt=0), name="recurring_amount_positive"),
        ),
        migrations.AddIndex(
            model_name="recurringrule",
            index=models.Index(fields=["owner", "next_due"], name="expenses_re_owner_i_4bff22_idx"),
        ),
        # --- Expense: rename the free-text column aside, then add the FK.
        migrations.RenameField(
            model_name="expense", old_name="category", new_name="legacy_category",
        ),
        migrations.AddField(
            model_name="expense",
            name="owner",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name="expenses", to=settings.AUTH_USER_MODEL),
        ),
        migrations.AddField(
            model_name="expense",
            name="category",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="expenses", to="expenses.category"),
        ),
        migrations.AddField(
            model_name="expense",
            name="merchant",
            field=models.CharField(blank=True, default="", max_length=200),
        ),
        migrations.AddField(
            model_name="expense",
            name="payment_method",
            field=models.CharField(choices=[("cash", "Cash"), ("upi", "UPI"), ("card", "Card"), ("bank", "Bank transfer"), ("other", "Other")], default="cash", max_length=20),
        ),
        migrations.AddField(
            model_name="expense",
            name="notes",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="expense",
            name="tags",
            field=models.CharField(blank=True, default="", help_text="Comma-separated tags, e.g. 'hostel, weekend'.", max_length=300),
        ),
        migrations.AddField(
            model_name="expense",
            name="receipt",
            field=models.FileField(blank=True, null=True, upload_to="receipts/", validators=[validate_receipt]),
        ),
        migrations.AddField(
            model_name="expense",
            name="recurring_rule",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="generated_expenses", to="expenses.recurringrule"),
        ),
        migrations.AddField(
            model_name="expense",
            name="recurring_date",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="expense",
            name="created_at",
            field=models.DateTimeField(auto_now_add=True, default=timezone.now),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="expense",
            name="updated_at",
            field=models.DateTimeField(auto_now=True, default=timezone.now),
            preserve_default=False,
        ),
        migrations.AlterField(
            model_name="expense",
            name="amount",
            field=models.DecimalField(decimal_places=2, max_digits=12, validators=[validate_positive_amount]),
        ),
        migrations.AlterModelOptions(
            name="expense",
            options={"ordering": ["-date", "-id"]},
        ),
        migrations.AddConstraint(
            model_name="expense",
            constraint=models.CheckConstraint(check=models.Q(amount__gt=0), name="expense_amount_positive"),
        ),
        migrations.AddConstraint(
            model_name="expense",
            constraint=models.UniqueConstraint(fields=["recurring_rule", "recurring_date"], name="unique_recurring_instance"),
        ),
        migrations.AddIndex(
            model_name="expense",
            index=models.Index(fields=["owner", "date"], name="expenses_ex_owner_i_d056f1_idx"),
        ),
        # --- Data migration: legacy text -> Category rows (case-insensitive).
        migrations.RunPython(migrate_legacy_categories, migrations.RunPython.noop),
        migrations.RemoveField(model_name="expense", name="legacy_category"),
        # --- Remaining new models.
        migrations.CreateModel(
            name="Budget",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("month", models.DateField(help_text="Always day 1 of the month.")),
                ("amount", models.DecimalField(decimal_places=2, max_digits=12, validators=[validate_positive_amount])),
                ("alert_threshold", models.PositiveIntegerField(default=80)),
                ("category", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="budgets", to="expenses.category")),
                ("owner", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name="budgets", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["-month"]},
        ),
        migrations.AddConstraint(
            model_name="budget",
            constraint=models.CheckConstraint(check=models.Q(amount__gt=0), name="budget_amount_positive"),
        ),
        migrations.AddConstraint(
            model_name="budget",
            constraint=models.UniqueConstraint(condition=models.Q(category__isnull=True), fields=["owner", "month"], name="unique_overall_budget_per_month"),
        ),
        migrations.AddConstraint(
            model_name="budget",
            constraint=models.UniqueConstraint(condition=models.Q(category__isnull=False), fields=["owner", "month", "category"], name="unique_category_budget_per_month"),
        ),
        migrations.AddIndex(
            model_name="budget",
            index=models.Index(fields=["owner", "month"], name="expenses_bu_owner_i_eb9cf7_idx"),
        ),
        migrations.CreateModel(
            name="Income",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("date", models.DateField()),
                ("source", models.CharField(choices=[("allowance", "Allowance"), ("scholarship", "Scholarship"), ("part-time", "Part-time work"), ("other", "Other")], max_length=20)),
                ("description", models.CharField(max_length=300)),
                ("amount", models.DecimalField(decimal_places=2, max_digits=12, validators=[validate_positive_amount])),
                ("owner", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name="incomes", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["-date", "-id"]},
        ),
        migrations.AddConstraint(
            model_name="income",
            constraint=models.CheckConstraint(check=models.Q(amount__gt=0), name="income_amount_positive"),
        ),
        migrations.AddIndex(
            model_name="income",
            index=models.Index(fields=["owner", "date"], name="expenses_in_owner_i_c98f7c_idx"),
        ),
        migrations.CreateModel(
            name="SavingsGoal",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("name", models.CharField(max_length=200)),
                ("target_amount", models.DecimalField(decimal_places=2, max_digits=12, validators=[validate_positive_amount])),
                ("target_date", models.DateField(blank=True, null=True)),
                ("description", models.TextField(blank=True, default="")),
                ("owner", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name="savings_goals", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["name"]},
        ),
        migrations.AddConstraint(
            model_name="savingsgoal",
            constraint=models.CheckConstraint(check=models.Q(target_amount__gt=0), name="goal_target_positive"),
        ),
        migrations.CreateModel(
            name="GoalContribution",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("amount", models.DecimalField(decimal_places=2, max_digits=12, validators=[validate_positive_amount])),
                ("date", models.DateField()),
                ("note", models.CharField(blank=True, default="", max_length=300)),
                ("goal", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="contributions", to="expenses.savingsgoal")),
                ("owner", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name="goal_contributions", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["-date", "-id"]},
        ),
        migrations.AddConstraint(
            model_name="goalcontribution",
            constraint=models.CheckConstraint(check=models.Q(amount__gt=0), name="contribution_amount_positive"),
        ),
        migrations.AddIndex(
            model_name="goalcontribution",
            index=models.Index(fields=["owner", "goal"], name="expenses_go_owner_i_6d486c_idx"),
        ),
    ]
