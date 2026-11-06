from django.contrib import admin

from .models import (
    Budget,
    Category,
    Expense,
    GoalContribution,
    Income,
    RecurringRule,
    SavingsGoal,
)

for model in (Category, Expense, Budget, Income, RecurringRule,
              SavingsGoal, GoalContribution):
    admin.site.register(model)
