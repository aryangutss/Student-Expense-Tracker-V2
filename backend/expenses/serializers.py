from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db.models import Q
from rest_framework import serializers

from .models import (
    Budget,
    Category,
    Expense,
    GoalContribution,
    Income,
    RecurringRule,
    SavingsGoal,
    validate_receipt,
)

User = get_user_model()


def _request_user(context):
    request = context.get("request")
    return getattr(request, "user", None) if request else None


def _validate_unique_category_name(user, name, instance=None):
    if user is None or not getattr(user, "is_authenticated", False):
        return
    qs = Category.objects.filter(owner=user, name__iexact=name.strip())
    if instance is not None:
        qs = qs.exclude(pk=instance.pk)
    if qs.exists():
        raise serializers.ValidationError(
            {"name": "You already have a category with this name."}
        )


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ["id", "name", "icon", "color", "created_at", "updated_at"]
        read_only_fields = ["created_at", "updated_at"]

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Name must not be blank.")
        return value

    def validate(self, attrs):
        name = attrs.get("name", getattr(self.instance, "name", None))
        if name:
            _validate_unique_category_name(
                _request_user(self.context), name, self.instance
            )
        return attrs

    def create(self, validated_data):
        validated_data["owner"] = _request_user(self.context)
        return super().create(validated_data)


class CategoryField(serializers.Field):
    """Accepts a category id (int) or a category name (string, matched
    case-insensitively among the user's own + legacy null-owner
    categories). Serializes as the category id."""

    def to_representation(self, value):
        return value.pk if value is not None else None

    def to_internal_value(self, data):
        if data is None or data == "":
            return None
        user = _request_user(self.context)
        base = Category.objects.all()
        if user is not None and getattr(user, "is_authenticated", False):
            base = base.filter(Q(owner=user) | Q(owner__isnull=True))
        if isinstance(data, int) or (isinstance(data, str) and data.isdigit()):
            try:
                return base.get(pk=int(data))
            except Category.DoesNotExist:
                raise serializers.ValidationError("Category not found.")
        if isinstance(data, str):
            try:
                return base.get(name__iexact=data.strip())
            except Category.DoesNotExist:
                raise serializers.ValidationError(
                    f"Category '{data}' not found."
                )
            except Category.MultipleObjectsReturned:
                return base.filter(name__iexact=data.strip()).first()
        raise serializers.ValidationError("Category must be an id or a name.")


class ExpenseSerializer(serializers.ModelSerializer):
    category = CategoryField(required=False, allow_null=True)
    category_name = serializers.SerializerMethodField()
    category_color = serializers.SerializerMethodField()
    category_icon = serializers.SerializerMethodField()
    owner = serializers.ReadOnlyField(source="owner.username")

    class Meta:
        model = Expense
        fields = [
            "id", "owner", "date", "category", "category_name",
            "category_color", "category_icon",
            "description", "amount", "merchant", "payment_method",
            "notes", "tags", "receipt", "recurring_rule",
            "recurring_date", "created_at", "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]

    def get_category_name(self, obj):
        return obj.category.name if obj.category else None

    def get_category_color(self, obj):
        return obj.category.color if obj.category else None

    def get_category_icon(self, obj):
        return obj.category.icon if obj.category else None

    def validate_description(self, value):
        if not value.strip():
            raise serializers.ValidationError("Description must not be blank.")
        return value.strip()

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Amount must be greater than 0.")
        return value

    def validate_receipt(self, value):
        if value:
            validate_receipt(value)
        return value

    def create(self, validated_data):
        validated_data["owner"] = _request_user(self.context)
        return super().create(validated_data)


class BudgetSerializer(serializers.ModelSerializer):
    category_name = serializers.SerializerMethodField()
    owner = serializers.ReadOnlyField(source="owner.username")

    class Meta:
        model = Budget
        fields = ["id", "owner", "month", "category", "category_name",
                  "amount", "alert_threshold", "created_at", "updated_at"]
        read_only_fields = ["created_at", "updated_at"]

    def get_category_name(self, obj):
        return obj.category.name if obj.category else None

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Amount must be greater than 0.")
        return value

    def validate_month(self, value):
        return value.replace(day=1)

    def validate(self, attrs):
        user = _request_user(self.context)
        category = attrs.get("category")
        if category is not None and category.owner is not None \
                and user is not None and category.owner != user:
            raise serializers.ValidationError(
                {"category": "Category belongs to another user."}
            )
        month = attrs.get("month", getattr(self.instance, "month", None))
        category = attrs.get(
            "category",
            getattr(self.instance, "category", None) if self.instance else None,
        )
        # When PATCH omits category, attrs has no key; fall back above.
        # Explicit null on PATCH must clear it, so check raw input too.
        if self.instance is not None and "category" in self.initial_data:
            category = attrs.get("category", None)
        if user is not None and getattr(user, "is_authenticated", False) and month:
            qs = Budget.objects.filter(owner=user, month=month.replace(day=1))
            qs = qs.filter(category__isnull=True) if category is None \
                else qs.filter(category=category)
            if self.instance is not None:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                scope = "overall budget for this month" if category is None \
                    else "budget for this category and month"
                raise serializers.ValidationError(
                    {"month": f"You already have an {scope}."}
                )
        return attrs

    def create(self, validated_data):
        validated_data["owner"] = _request_user(self.context)
        return super().create(validated_data)


class IncomeSerializer(serializers.ModelSerializer):
    owner = serializers.ReadOnlyField(source="owner.username")

    class Meta:
        model = Income
        fields = ["id", "owner", "date", "source", "description",
                  "amount", "created_at", "updated_at"]
        read_only_fields = ["created_at", "updated_at"]

    def validate_description(self, value):
        if not value.strip():
            raise serializers.ValidationError("Description must not be blank.")
        return value.strip()

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Amount must be greater than 0.")
        return value

    def create(self, validated_data):
        validated_data["owner"] = _request_user(self.context)
        return super().create(validated_data)


class RecurringRuleSerializer(serializers.ModelSerializer):
    category_name = serializers.SerializerMethodField()
    owner = serializers.ReadOnlyField(source="owner.username")

    class Meta:
        model = RecurringRule
        fields = ["id", "owner", "category", "category_name",
                  "description", "amount", "frequency", "start_date",
                  "end_date", "next_due", "active", "last_generated_date",
                  "created_at", "updated_at"]
        read_only_fields = ["created_at", "updated_at", "last_generated_date"]

    def get_category_name(self, obj):
        return obj.category.name if obj.category else None

    def validate_description(self, value):
        if not value.strip():
            raise serializers.ValidationError("Description must not be blank.")
        return value.strip()

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Amount must be greater than 0.")
        return value

    def validate(self, attrs):
        user = _request_user(self.context)
        category = attrs.get("category")
        if category is not None and category.owner is not None \
                and user is not None and category.owner != user:
            raise serializers.ValidationError(
                {"category": "Category belongs to another user."}
            )
        start = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end = attrs.get("end_date", getattr(self.instance, "end_date", None))
        if start and end and end < start:
            raise serializers.ValidationError(
                {"end_date": "End date must not be before start date."}
            )
        return attrs

    def create(self, validated_data):
        validated_data["owner"] = _request_user(self.context)
        return super().create(validated_data)


class SavingsGoalSerializer(serializers.ModelSerializer):
    saved_amount = serializers.SerializerMethodField()
    progress_percent = serializers.SerializerMethodField()
    owner = serializers.ReadOnlyField(source="owner.username")

    def get_saved_amount(self, obj):
        return str(obj.saved_amount.quantize(Decimal("0.01")))

    def get_progress_percent(self, obj):
        return str(obj.progress_percent)

    class Meta:
        model = SavingsGoal
        fields = ["id", "owner", "name", "target_amount", "target_date",
                  "description", "saved_amount", "progress_percent",
                  "created_at", "updated_at"]
        read_only_fields = ["created_at", "updated_at"]

    def validate_name(self, value):
        if not value.strip():
            raise serializers.ValidationError("Name must not be blank.")
        return value.strip()

    def validate_target_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError(
                "Target amount must be greater than 0."
            )
        return value

    def create(self, validated_data):
        validated_data["owner"] = _request_user(self.context)
        return super().create(validated_data)


class GoalContributionSerializer(serializers.ModelSerializer):
    owner = serializers.ReadOnlyField(source="owner.username")

    class Meta:
        model = GoalContribution
        fields = ["id", "owner", "goal", "amount", "date", "note",
                  "created_at", "updated_at"]
        read_only_fields = ["created_at", "updated_at"]

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Amount must be greater than 0.")
        return value

    def validate(self, attrs):
        user = _request_user(self.context)
        goal = attrs.get("goal")
        if goal is not None and goal.owner is not None \
                and user is not None and goal.owner != user:
            raise serializers.ValidationError(
                {"goal": "Goal belongs to another user."}
            )
        return attrs

    def create(self, validated_data):
        validated_data["owner"] = _request_user(self.context)
        return super().create(validated_data)


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)

    class Meta:
        model = User
        fields = ["id", "username", "email", "password"]

    def create(self, validated_data):
        user = User.objects.create_user(
            username=validated_data["username"],
            email=validated_data.get("email", ""),
            password=validated_data["password"],
        )
        return user


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "username", "email"]
