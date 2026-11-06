"""Assign all owner-null categories/expenses/incomes to one user.

Usage: python manage.py adopt_legacy_data <username>
Legacy rows are invisible via the API until adopted; this command is the
explicit, auditable adoption step (nothing is adopted implicitly).
"""

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from expenses.services import adopt_legacy_data


class Command(BaseCommand):
    help = "Assign all owner-null categories, expenses, and incomes to a user."

    def add_arguments(self, parser):
        parser.add_argument("username", help="Username to adopt legacy rows into")

    def handle(self, *args, **options):
        User = get_user_model()
        try:
            user = User.objects.get(username=options["username"])
        except User.DoesNotExist:
            raise CommandError(f"No user named '{options['username']}'.")
        counts = adopt_legacy_data(user)
        self.stdout.write(
            self.style.SUCCESS(
                f"Adopted into {user.username}: "
                f"{counts['categories']} categories, "
                f"{counts['expenses']} expenses, "
                f"{counts['incomes']} incomes."
            )
        )
