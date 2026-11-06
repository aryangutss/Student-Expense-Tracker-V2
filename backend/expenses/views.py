"""API views: per-user querysets only.

Legacy owner-null rows are never returned until adopted (adopt_legacy_data);
every queryset here filters owner=request.user, so one user can never see,
update, or delete another user's rows, and unauthenticated requests get 401
via TokenAuthentication + IsAuthenticated.
"""

import calendar
import re
from datetime import date, timedelta
from decimal import Decimal

import django_filters
from django.contrib.auth import authenticate
from django.db.models import Count, Q, Sum
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.authtoken.models import Token
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.filters import OrderingFilter, SearchFilter
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import (
    Budget,
    Category,
    Expense,
    GoalContribution,
    Income,
    RecurringRule,
    SavingsGoal,
)
from .serializers import (
    BudgetSerializer,
    CategorySerializer,
    ExpenseSerializer,
    GoalContributionSerializer,
    IncomeSerializer,
    RecurringRuleSerializer,
    RegisterSerializer,
    SavingsGoalSerializer,
    UserSerializer,
)
from .services import generate_due_recurring, seed_default_categories

ZERO = Decimal("0")


def money(value):
    """Serialize a Decimal as a string to avoid float error in JSON."""
    if value is None:
        return "0.00"
    return str(Decimal(value).quantize(Decimal("0.01")))


def pct(numerator, denominator):
    if not denominator:
        return "0.00"
    return str((Decimal(numerator) / Decimal(denominator) * 100).quantize(
        Decimal("0.01")))


class OwnerViewSet(viewsets.ModelViewSet):
    """Base viewset scoping every queryset to request.user."""

    def get_queryset(self):
        return self.queryset.filter(owner=self.request.user)

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)


# ---------------------------------------------------------------- auth

@api_view(["POST"])
@permission_classes([AllowAny])
def register(request):
    serializer = RegisterSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    user = serializer.save()
    seed_default_categories(user)
    token, _ = Token.objects.get_or_create(user=user)
    return Response(
        {"token": token.key, "user": UserSerializer(user).data},
        status=status.HTTP_201_CREATED,
    )


@api_view(["POST"])
@permission_classes([AllowAny])
def login(request):
    username = request.data.get("username")
    password = request.data.get("password")
    if not username or not password:
        return Response(
            {"detail": "Username and password are required."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    user = authenticate(username=username, password=password)
    if user is None:
        return Response(
            {"detail": "Invalid username or password."},
            status=status.HTTP_401_UNAUTHORIZED,
        )
    token, _ = Token.objects.get_or_create(user=user)
    return Response({"token": token.key, "user": UserSerializer(user).data})


@api_view(["POST"])
def logout(request):
    request.user.auth_token.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET"])
def me(request):
    return Response(UserSerializer(request.user).data)


# ---------------------------------------------------------------- categories

class CategoryViewSet(OwnerViewSet):
    queryset = Category.objects.all()
    serializer_class = CategorySerializer
    pagination_class = None  # categories are a small list; return all

    def destroy(self, request, *args, **kwargs):
        category = self.get_object()
        used = Expense.objects.filter(
            owner=request.user, category=category
        ).count()
        if used:
            return Response(
                {"detail": (
                    f"Cannot delete category '{category.name}' because it "
                    f"is used by {used} expense(s). Reassign or delete "
                    "those expenses first."
                )},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().destroy(request, *args, **kwargs)


# ---------------------------------------------------------------- expenses

class ExpenseFilter(django_filters.FilterSet):
    category = django_filters.CharFilter(method="filter_category")
    date_from = django_filters.DateFilter(field_name="date", lookup_expr="gte")
    date_to = django_filters.DateFilter(field_name="date", lookup_expr="lte")
    month = django_filters.CharFilter(method="filter_month")
    min_amount = django_filters.NumberFilter(field_name="amount", lookup_expr="gte")
    max_amount = django_filters.NumberFilter(field_name="amount", lookup_expr="lte")

    def filter_category(self, queryset, name, value):
        value = value.strip()
        if value.isdigit():
            return queryset.filter(category_id=int(value))
        return queryset.filter(category__name__iexact=value)

    def filter_month(self, queryset, name, value):
        if not re.fullmatch(r"\d{4}-\d{2}", value.strip()):
            return queryset.none()
        year, month = map(int, value.strip().split("-"))
        if not 1 <= month <= 12:
            return queryset.none()
        return queryset.filter(date__year=year, date__month=month)

    class Meta:
        model = Expense
        fields = ["payment_method"]


class ExpenseSearchFilter(SearchFilter):
    """SearchFilter plus exact-id match: a numeric search term also
    matches the transaction id, so the UI's 'search by id' works."""

    def filter_queryset(self, request, queryset, view):
        terms = self.get_search_terms(request)
        if len(terms) == 1 and terms[0].isdigit():
            term = terms[0]
            return queryset.filter(
                Q(description__icontains=term)
                | Q(merchant__icontains=term)
                | Q(pk=int(term))
            )
        return super().filter_queryset(request, queryset, view)


class ExpenseViewSet(OwnerViewSet):
    queryset = Expense.objects.select_related("category").all()
    serializer_class = ExpenseSerializer
    filterset_class = ExpenseFilter
    filter_backends = [
        django_filters.rest_framework.DjangoFilterBackend,
        ExpenseSearchFilter,
        OrderingFilter,
    ]
    search_fields = ["description", "merchant"]
    ordering_fields = ["date", "amount", "id"]
    ordering = ["-date", "-id"]

    def get_queryset(self):
        return super().get_queryset().select_related("category")

    @action(detail=False, methods=["post"], url_path="bulk-import")
    def bulk_import(self, request):
        from django.db import transaction

        expenses_in = request.data.get("expenses") or []
        incomes_in = request.data.get("incomes") or []
        if not isinstance(expenses_in, list) or not isinstance(incomes_in, list):
            return Response(
                {"detail": "Expected 'expenses' and 'incomes' lists."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        created_expenses = 0
        created_incomes = 0
        errors = []
        with transaction.atomic():
            for idx, item in enumerate(expenses_in):
                ser = ExpenseSerializer(data=item, context={"request": request})
                if ser.is_valid():
                    ser.save(owner=request.user)
                    created_expenses += 1
                else:
                    errors.append({"index": idx, "type": "expense", "errors": ser.errors})
            for idx, item in enumerate(incomes_in):
                ser = IncomeSerializer(data=item, context={"request": request})
                if ser.is_valid():
                    ser.save(owner=request.user)
                    created_incomes += 1
                else:
                    errors.append({"index": idx, "type": "income", "errors": ser.errors})
        return Response({
            "created_expenses": created_expenses,
            "created_incomes": created_incomes,
            "errors": errors,
        }, status=status.HTTP_201_CREATED)


class BudgetFilter(django_filters.FilterSet):
    # The frontend sends month=YYYY-MM; a plain DateFilter would reject
    # that and return no rows, so parse it like the expense filter does.
    month = django_filters.CharFilter(method="filter_month")

    def filter_month(self, queryset, name, value):
        if not re.fullmatch(r"\d{4}-\d{2}", value.strip()):
            return queryset.none()
        year, month = map(int, value.strip().split("-"))
        if not 1 <= month <= 12:
            return queryset.none()
        return queryset.filter(month__year=year, month__month=month)

    class Meta:
        model = Budget
        fields = ["category"]


class BudgetViewSet(OwnerViewSet):
    queryset = Budget.objects.select_related("category").all()
    serializer_class = BudgetSerializer
    filterset_class = BudgetFilter
    ordering_fields = ["month", "amount"]
    ordering = ["-month"]


class IncomeFilter(django_filters.FilterSet):
    month = django_filters.CharFilter(method="filter_month")

    def filter_month(self, queryset, name, value):
        if not re.fullmatch(r"\d{4}-\d{2}", value.strip()):
            return queryset.none()
        year, month = map(int, value.strip().split("-"))
        if not 1 <= month <= 12:
            return queryset.none()
        return queryset.filter(date__year=year, date__month=month)

    class Meta:
        model = Income
        fields = ["source"]


class IncomeViewSet(OwnerViewSet):
    queryset = Income.objects.all()
    serializer_class = IncomeSerializer
    filterset_class = IncomeFilter
    filter_backends = [
        django_filters.rest_framework.DjangoFilterBackend,
        SearchFilter,
        OrderingFilter,
    ]
    search_fields = ["description", "source"]
    ordering_fields = ["date", "amount"]
    ordering = ["-date", "-id"]


class RecurringViewSet(OwnerViewSet):
    queryset = RecurringRule.objects.select_related("category").all()
    serializer_class = RecurringRuleSerializer
    filterset_fields = ["frequency", "active", "category"]
    ordering_fields = ["next_due", "amount"]
    ordering = ["next_due"]

    @action(detail=False, methods=["post"], url_path="generate-due")
    def generate_due(self, request):
        up_to = request.data.get("up_to_date")
        parsed = None
        if up_to:
            try:
                parsed = date.fromisoformat(str(up_to))
            except ValueError:
                return Response(
                    {"up_to_date": ["Enter a valid date (YYYY-MM-DD)."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        created, _ = generate_due_recurring(request.user, parsed)
        return Response({
            "created": len(created),
            "expenses": ExpenseSerializer(created, many=True).data,
        })


class SavingsGoalViewSet(OwnerViewSet):
    queryset = SavingsGoal.objects.prefetch_related("contributions").all()
    serializer_class = SavingsGoalSerializer
    search_fields = ["name"]
    ordering_fields = ["name", "target_amount"]
    ordering = ["name"]


# ------------------------------------------------------- goal contributions

class GoalContributionListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def _goal(self, request, goal_id):
        from django.shortcuts import get_object_or_404

        return get_object_or_404(SavingsGoal, pk=goal_id, owner=request.user)

    def get(self, request, goal_id):
        goal = self._goal(request, goal_id)
        contributions = goal.contributions.filter(owner=request.user)
        page = PageNumberPagination()
        page.page_size = 20
        result = page.paginate_queryset(contributions, request)
        serializer = GoalContributionSerializer(result, many=True)
        return page.get_paginated_response(serializer.data)

    def post(self, request, goal_id):
        goal = self._goal(request, goal_id)
        data = dict(request.data)
        data["goal"] = goal.pk
        serializer = GoalContributionSerializer(
            data=data, context={"request": request}
        )
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        serializer.save(owner=request.user, goal=goal)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class GoalContributionDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, goal_id, pk):
        from django.shortcuts import get_object_or_404

        goal = get_object_or_404(SavingsGoal, pk=goal_id, owner=request.user)
        contribution = get_object_or_404(
            GoalContribution, pk=pk, goal=goal, owner=request.user
        )
        contribution.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------- analytics

def _parse_range(request):
    """Return (start, end, month_label). month=YYYY-MM wins; else from/to;
    else the current month (Asia/Kolkata)."""
    month_param = request.query_params.get("month")
    from_param = request.query_params.get("from")
    to_param = request.query_params.get("to")
    today = timezone.localdate()
    if month_param and re.fullmatch(r"\d{4}-\d{2}", month_param.strip()):
        year, month = map(int, month_param.strip().split("-"))
        if 1 <= month <= 12:
            start = date(year, month, 1)
            end = date(year, month, calendar.monthrange(year, month)[1])
            return start, end, month_param.strip()
    if from_param or to_param:
        start = date.fromisoformat(from_param) if from_param else today.replace(day=1)
        end = date.fromisoformat(to_param) if to_param else today
        return start, end, f"{start:%Y-%m}"
    start = today.replace(day=1)
    end = date(today.year, today.month, calendar.monthrange(today.year, today.month)[1])
    return start, end, f"{today:%Y-%m}"


def _prev_month(year, month):
    if month == 1:
        return year - 1, 12
    return year, month - 1


@api_view(["GET"])
def analytics(request):
    user = request.user
    start, end, month_label = _parse_range(request)
    expenses = Expense.objects.filter(owner=user, date__gte=start, date__lte=end)
    incomes = Income.objects.filter(owner=user, date__gte=start, date__lte=end)

    spent = expenses.aggregate(t=Sum("amount"))["t"] or ZERO
    income_total = incomes.aggregate(t=Sum("amount"))["t"] or ZERO
    net = income_total - spent

    # Previous calendar month (relative to the range start).
    py, pm = _prev_month(start.year, start.month)
    prev_expenses = Expense.objects.filter(
        owner=user, date__year=py, date__month=pm
    )
    prev_spent = prev_expenses.aggregate(t=Sum("amount"))["t"] or ZERO
    delta_pct = pct(spent - prev_spent, prev_spent) if prev_spent else (
        "0.00" if spent == 0 else "100.00"
    )

    # Daily trend over the whole range (including zero days).
    daily_map = {
        row["date"]: row["total"]
        for row in expenses.values("date").annotate(total=Sum("amount"))
    }
    daily_trend = []
    cursor = start
    while cursor <= end:
        daily_trend.append(
            {"date": str(cursor), "spent": money(daily_map.get(cursor, ZERO))}
        )
        cursor += timedelta(days=1)
    days_in_range = (end - start).days + 1
    daily_average = (spent / days_in_range).quantize(Decimal("0.01")) \
        if days_in_range else ZERO

    # Category breakdown (uncategorized grouped under "Uncategorized").
    breakdown = []
    for row in expenses.values("category__name").annotate(
        total=Sum("amount"), count=Count("id")
    ).order_by("-total"):
        name = row["category__name"] or "Uncategorized"
        breakdown.append({
            "category": name,
            "total": money(row["total"]),
            "count": row["count"],
            "share": pct(row["total"], spent),
        })
    top_category = breakdown[0] if breakdown else None

    # Payment method breakdown for pie chart analysis.
    payment_method_breakdown = []
    for row in expenses.values("payment_method").annotate(
        total=Sum("amount"), count=Count("id")
    ).order_by("-total"):
        method_name = (row["payment_method"] or "other").upper()
        payment_method_breakdown.append({
            "method": method_name,
            "total": money(row["total"]),
            "count": row["count"],
            "share": pct(row["total"], spent),
        })

    # Monthly comparison: last 6 months ending at the range month.
    monthly_comparison = []
    y, m = start.year, start.month
    months = []
    for _ in range(6):
        months.append((y, m))
        y, m = _prev_month(y, m)
    for y, m in reversed(months):
        ms = Expense.objects.filter(owner=user, date__year=y, date__month=m) \
            .aggregate(t=Sum("amount"))["t"] or ZERO
        mi = Income.objects.filter(owner=user, date__year=y, date__month=m) \
            .aggregate(t=Sum("amount"))["t"] or ZERO
        monthly_comparison.append({
            "month": f"{y:04d}-{m:02d}",
            "spent": money(ms),
            "income": money(mi),
        })

    # Budget vs actual. Overall uses TOTAL month spend; each category
    # budget uses ONLY that category's spend (no double counting).
    month_start = start.replace(day=1)
    month_expenses = Expense.objects.filter(
        owner=user, date__year=month_start.year, date__month=month_start.month
    )
    month_spent = month_expenses.aggregate(t=Sum("amount"))["t"] or ZERO
    overall = Budget.objects.filter(
        owner=user, month=month_start, category__isnull=True
    ).first()
    budgets_out = {
        "overall": None,
        "categories": [],
    }
    if overall is not None:
        budgets_out["overall"] = {
            "budgeted": money(overall.amount),
            "spent": money(month_spent),
            "remaining": money(overall.amount - month_spent),
            "percent_used": pct(month_spent, overall.amount),
            "alert_threshold": overall.alert_threshold,
            "over_threshold": month_spent >= overall.amount
            * Decimal(overall.alert_threshold) / 100,
            "over_budget": month_spent > overall.amount,
        }
    for budget in Budget.objects.filter(
        owner=user, month=month_start, category__isnull=False
    ).select_related("category"):
        cat_spent = month_expenses.filter(category=budget.category) \
            .aggregate(t=Sum("amount"))["t"] or ZERO
        budgets_out["categories"].append({
            "category": budget.category.name if budget.category else None,
            "category_id": budget.category_id,
            "budgeted": money(budget.amount),
            "spent": money(cat_spent),
            "remaining": money(budget.amount - cat_spent),
            "percent_used": pct(cat_spent, budget.amount),
            "alert_threshold": budget.alert_threshold,
            "over_threshold": cat_spent >= budget.amount
            * Decimal(budget.alert_threshold) / 100,
            "over_budget": cat_spent > budget.amount,
        })

    # Insights, computed from real data only.
    insights = []
    if top_category:
        insights.append(
            f"Top category: {top_category['category']} at "
            f"₹{top_category['total']} ({top_category['share']}% of spend)."
        )
    # Biggest category increase vs previous month.
    prev_map = {
        (row["category__name"] or "Uncategorized"): row["total"]
        for row in prev_expenses.values("category__name").annotate(
            total=Sum("amount"))
    }
    curr_map = {
        row["category"]: Decimal(row["total"])
        for row in breakdown
    }
    increases = [
        (name, curr_map[name] - prev_map.get(name, ZERO))
        for name in curr_map
        if curr_map[name] - prev_map.get(name, ZERO) > 0
    ]
    if increases:
        name, inc = max(increases, key=lambda item: item[1])
        insights.append(
            f"Biggest increase vs previous month: {name} up by ₹{money(inc)}."
        )
    # Unusual-spend days: above 2x the daily average.
    if daily_average > 0:
        unusual = [
            item for item in daily_trend
            if Decimal(item["spent"]) > 2 * daily_average
        ]
        for item in unusual:
            insights.append(
                f"Unusual spend on {item['date']}: ₹{item['spent']} "
                f"(daily average ₹{money(daily_average)})."
            )
    if budgets_out["overall"] and budgets_out["overall"]["over_budget"]:
        insights.append("Overall budget exceeded for this month.")
    for goal in SavingsGoal.objects.filter(owner=user).prefetch_related(
        "contributions"
    ):
        progress = goal.progress_percent
        if progress >= 100:
            insights.append(f"Goal '{goal.name}' reached ({progress}%).")
        elif progress >= 80:
            insights.append(
                f"Goal '{goal.name}' is close at {progress}% of target."
            )
    if net < 0:
        insights.append(f"Spending exceeded income by ₹{money(-net)} this period.")

    return Response({
        "month": month_label,
        "from": str(start),
        "to": str(end),
        "totals": {
            "spent": money(spent),
            "income": money(income_total),
            "net": money(net),
            "expense_count": expenses.count(),
            "income_count": incomes.count(),
        },
        "previous_month": {
            "month": f"{py:04d}-{pm:02d}",
            "spent": money(prev_spent),
            "delta_percent": delta_pct,
        },
        "daily_trend": daily_trend,
        "daily_average": money(daily_average),
        "category_breakdown": breakdown,
        "payment_method_breakdown": payment_method_breakdown,
        "top_category": top_category,
        "monthly_comparison": monthly_comparison,
        "budgets": budgets_out,
        "insights": insights,
    })
