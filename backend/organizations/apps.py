from django.apps import AppConfig


class OrganizationsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'organizations'

    def ready(self):
        # Invalidate the cached org-tree adjacency (organizations.tree_cache)
        # whenever an Organization is created, re-parented, or deleted, so
        # get_descendants never serves a stale subtree after an admin edit.
        from django.db.models.signals import post_delete, post_save

        from .models import Organization
        from .tree_cache import invalidate_org_tree_cache

        post_save.connect(
            invalidate_org_tree_cache,
            sender=Organization,
            dispatch_uid="org_tree_cache_invalidate_save",
        )
        post_delete.connect(
            invalidate_org_tree_cache,
            sender=Organization,
            dispatch_uid="org_tree_cache_invalidate_delete",
        )
