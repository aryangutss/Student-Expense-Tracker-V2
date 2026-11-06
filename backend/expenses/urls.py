from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("expenses", views.ExpenseViewSet, basename="expense")
router.register("categories", views.CategoryViewSet, basename="category")
router.register("budgets", views.BudgetViewSet, basename="budget")
router.register("incomes", views.IncomeViewSet, basename="income")
router.register("recurring", views.RecurringViewSet, basename="recurring")
router.register("goals", views.SavingsGoalViewSet, basename="goal")

urlpatterns = [
    path("auth/register/", views.register, name="auth-register"),
    path("auth/login/", views.login, name="auth-login"),
    path("auth/logout/", views.logout, name="auth-logout"),
    path("auth/me/", views.me, name="auth-me"),
    path("analytics/", views.analytics, name="analytics"),
    path(
        "goals/<int:goal_id>/contributions/",
        views.GoalContributionListCreateView.as_view(),
        name="goal-contributions",
    ),
    path(
        "goals/<int:goal_id>/contributions/<int:pk>/",
        views.GoalContributionDetailView.as_view(),
        name="goal-contribution-detail",
    ),
    path("", include(router.urls)),
]
