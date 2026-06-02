from django.apps import AppConfig


class ProjectsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'projects'

    def ready(self):
        # Connect ProjectIndicatorOrganizationTarget -> CoordinatorTarget sync signals.
        from . import target_sync  # noqa: F401
