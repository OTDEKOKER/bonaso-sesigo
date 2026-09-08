from django.db import models
from django.conf import settings


class Organization(models.Model):
    TYPE_CHOICES = [
        ('headquarters', 'Headquarters'),
        ('regional', 'Regional Office'),
        ('district', 'District Office'),
        ('partner', 'Partner Organization'),
        ('ngo', 'NGO'),
        ('government', 'Government'),
        ('funder', 'Funder'),
    ]

    name = models.CharField(max_length=255)
    code = models.CharField(max_length=50, unique=True)
    type = models.CharField(max_length=20, choices=TYPE_CHOICES, default='district')
    parent = models.ForeignKey(
        'self',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='children'
    )
    description = models.TextField(blank=True)
    address = models.TextField(blank=True)
    phone = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    is_active = models.BooleanField(default=True)
    dashboard_config = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # ✅ Removed created_by to break circular dependency

    class Meta:
        ordering = ['name', 'id']

    def __str__(self):
        return f"{self.name} ({self.code})"

    def get_descendants(self):
        # Descendant lookups previously recursed one query per node. Resolve the
        # id set from the cached org-tree adjacency (organizations.tree_cache)
        # and hydrate in a single query, preserving the "returns Organization
        # objects" contract callers rely on (serializers, offline snapshot).
        from .tree_cache import descendant_ids

        ids = descendant_ids(self.id)
        if not ids:
            return []
        return list(Organization.objects.filter(id__in=ids))

    def get_ancestors(self):
        ancestors = []
        current = self.parent
        while current:
            ancestors.append(current)
            current = current.parent
        return ancestors
