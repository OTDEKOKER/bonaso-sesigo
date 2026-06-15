from django.apps import AppConfig


class AggregatesConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'aggregates'

    def ready(self):
        from . import signals  # noqa: F401  (connect AggregateFact sync signals)
