from django.apps import AppConfig


class CsoMappingConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'cso_mapping'
    verbose_name = 'CSO Mapping & Capacity Assessment'

    def ready(self):
        # Register deployment safety checks (draft retention must be configured).
        from . import checks  # noqa: F401
