from django.conf import settings
from django.db import models


class IdempotencyKey(models.Model):
    """Server-side record of a processed idempotent mutation (OFF-1).

    The offline client stamps every queueable mutation with an
    ``X-Idempotency-Key`` and replays it until it gets a success. Without a
    server-side record, a replay that follows a *lost ACK* (the server committed
    but the response never reached the client) creates a duplicate row. This
    table lets the server recognise a replayed key and return the ORIGINAL
    response instead of creating a second record.

    A row is claimed (created, ``completed=False``) before the wrapped handler
    runs; on success the response status/body are stored and ``completed`` is
    set. The unique (user, key) constraint makes the claim atomic across
    gunicorn workers, so concurrent replays cannot both create the underlying
    object.
    """

    key = models.CharField(max_length=255, db_index=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='idempotency_keys',
    )
    method = models.CharField(max_length=10)
    path = models.CharField(max_length=255)
    # Hash of the request body, so the same key replayed with a *different*
    # payload is rejected rather than silently returning the wrong response.
    request_hash = models.CharField(max_length=64, blank=True)
    status_code = models.PositiveIntegerField(null=True, blank=True)
    response_body = models.JSONField(null=True, blank=True)
    completed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['user', 'key'], name='uniq_user_idempotency_key'),
        ]
        indexes = [
            models.Index(fields=['created_at']),
        ]
        ordering = ['-created_at']

    def __str__(self):
        state = 'completed' if self.completed else 'pending'
        return f'IdempotencyKey({self.key}, {self.method} {self.path}, {state})'
