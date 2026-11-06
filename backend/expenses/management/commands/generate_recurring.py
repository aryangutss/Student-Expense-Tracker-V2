"""Generate due recurring expenses (explicit only -- never on page load).

Usage:
  python manage.py generate_recurring [--username USER] [--up-to YYYY-MM-DD]
Without --username, generates for all users.
"""

from datetime import date

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from expenses.services import generate_due_recurring


class Command(BaseCommand):
    help = "Generate expenses due from active recurring rules."

    def add_arguments(self, parser):
        parser.add_argument("--username", default=None)
        parser.add_argument("--up-to", default=None,
                            help="Up-to date YYYY-MM-DD (default: today)")

    def handle(self, *args, **options):
        up_to = None
        if options["up_to"]:
            try:
                up_to = date.fromisoformat(options["up_to"])
            except ValueError:
                raise CommandError("Invalid --up-to date; use YYYY-MM-DD.")
        User = get_user_model()
        users = User.objects.all()
        if options["username"]:
            users = users.filter(username=options["username"])
            if not users.exists():
                raise CommandError(f"No user named '{options['username']}'.")
        total = 0
        for user in users:
            created, _ = generate_due_recurring(user, up_to)
            total += len(created)
            self.stdout.write(f"{user.username}: created {len(created)}")
        self.stdout.write(self.style.SUCCESS(f"Total created: {total}"))
