"""Quarterly Reporting Control Framework — shared reporting-window service.

This is the ONE place that decides whether an organisation may submit reporting
data for a given (project, period) *right now*. Every aggregate write path
routes through :class:`aggregates.views.AggregateViewSet._assert_period_reporting_eligible`,
which delegates here, so single entry, bulk entry, workbook upload,
interaction-generated aggregates and the overwrite CLI all share identical rules
without re-implementing them.

Design principles (see ``ReportingPeriod`` docstring):

* Eligibility (org assigned to project + org has assigned indicators) is NOT
  decided here — that stays with the existing assignment architecture and is
  enforced by ``_assert_write_scope`` before we are ever called. We only decide
  the *timing* question.
* The quarter-completion floor is always on: a period may only be reported after
  it has fully elapsed (Q1 Apr-Jun opens 1 Jul, …). This is enforced whether or
  not an admin has configured a ``ReportingPeriod``.
* A ``ReportingPeriod`` is an OVERLAY. When one exists for the project+quarter it
  governs the submission window (Scheduled/Open/Closed/Archived + late window).
  When none exists we fall back to the floor, preserving backward compatibility
  for every live project the moment this ships.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime

from django.utils import timezone

from . import reporting_workbook as rw


# Decision states surfaced to callers and the frontend. ``can_submit`` is the
# only thing the write path acts on; the rest drives the dashboard display.
STATE_OPEN_DEFAULT = 'open_default'      # no configured period, quarter elapsed → allowed (legacy behaviour)
STATE_NOT_ELAPSED = 'not_elapsed'        # reporting quarter has not finished yet → blocked
STATE_DRAFT = 'draft'                    # period exists but admin has not scheduled it → blocked
STATE_SCHEDULED = 'scheduled'            # window announced but not yet open → blocked
STATE_OPEN = 'open'                      # inside the administrator window → allowed
STATE_LATE = 'late'                      # past close but late reporting active → allowed
STATE_CLOSED = 'closed'                  # window closed (and late not active) → blocked
STATE_ARCHIVED = 'archived'             # period archived → blocked

ALLOWED_STATES = {STATE_OPEN_DEFAULT, STATE_OPEN, STATE_LATE}


@dataclass(frozen=True)
class WindowDecision:
    """Outcome of evaluating one (project, period) submission window."""

    can_submit: bool
    state: str
    message: str
    period_id: int | None = None
    submission_opens: datetime | None = None
    submission_closes: datetime | None = None
    late_opens: datetime | None = None
    late_closes: datetime | None = None
    allow_late_reporting: bool = False
    earliest_open_date: date | None = None
    quarter: int | None = None
    fiscal_year: int | None = None

    @property
    def is_late(self) -> bool:
        return self.state == STATE_LATE


def _now(now=None) -> datetime:
    return now or timezone.now()


def _today(now=None) -> date:
    return timezone.localdate(now) if now is not None else timezone.localdate()


def get_reporting_period(project, period_start, period_end):
    """Return the configured :class:`ReportingPeriod` for the exact fiscal
    quarter a (period_start, period_end) covers, or ``None`` — either because no
    admin has configured one, or because the dates are not a canonical quarter
    (monthly/yearly periods are governed only by the quarter-completion floor).
    """
    from .models import ReportingPeriod

    info = rw.quarter_of_period(period_start, period_end)
    if info is None:
        return None
    quarter, fiscal_year = info
    return (
        ReportingPeriod.objects.filter(
            project=project, quarter=quarter, fiscal_year=fiscal_year,
        )
        .only(
            'id', 'status', 'quarter', 'fiscal_year',
            'submission_opens', 'submission_closes',
            'allow_late_reporting', 'late_reporting_opens', 'late_reporting_closes',
            'coverage_end',
        )
        .first()
    )


def evaluate_window(project, period_start, period_end, *, now=None) -> WindowDecision:
    """Evaluate the reporting window for one (project, period). Pure/read-only —
    performs at most one indexed lookup and never writes."""
    now = _now(now)
    today = _today(now)
    earliest_open = rw.earliest_reporting_open_date(period_end)
    elapsed = rw.period_has_fully_elapsed(period_end, today)

    period = get_reporting_period(project, period_start, period_end)

    # ── No configured period → quarter-completion floor only (legacy path) ───
    if period is None:
        if elapsed:
            return WindowDecision(
                can_submit=True, state=STATE_OPEN_DEFAULT,
                message='Reporting is open for this period.',
                earliest_open_date=earliest_open,
            )
        return WindowDecision(
            can_submit=False, state=STATE_NOT_ELAPSED,
            message=rw.reporting_not_yet_eligible_message(period_start, period_end),
            earliest_open_date=earliest_open,
        )

    base = dict(
        period_id=period.id,
        submission_opens=period.submission_opens,
        submission_closes=period.submission_closes,
        late_opens=period.late_reporting_opens,
        late_closes=period.late_reporting_closes,
        allow_late_reporting=period.allow_late_reporting,
        earliest_open_date=earliest_open,
        quarter=period.quarter,
        fiscal_year=period.fiscal_year,
    )

    # The floor still applies even when a period is configured — an admin must
    # never open a quarter before it elapses (model.clean enforces this too, but
    # we defend in depth here for data that predates the validation).
    if not elapsed:
        return WindowDecision(
            can_submit=False, state=STATE_NOT_ELAPSED,
            message=rw.reporting_not_yet_eligible_message(period_start, period_end),
            **base,
        )

    if period.status == period.STATUS_ARCHIVED:
        return WindowDecision(
            can_submit=False, state=STATE_ARCHIVED,
            message='Reporting for this period has been archived and is closed.',
            **base,
        )

    if period.status == period.STATUS_DRAFT:
        return WindowDecision(
            can_submit=False, state=STATE_DRAFT,
            message='Reporting for this quarter has not yet opened.',
            **base,
        )

    if period.status == period.STATUS_SCHEDULED:
        return WindowDecision(
            can_submit=False, state=STATE_SCHEDULED,
            message='Reporting for this quarter has not yet opened.',
            **base,
        )

    if period.status == period.STATUS_OPEN:
        # Guard the announced window edges when set.
        if period.submission_opens and now < period.submission_opens:
            return WindowDecision(
                can_submit=False, state=STATE_SCHEDULED,
                message='Reporting for this quarter has not yet opened.',
                **base,
            )
        if period.submission_closes and now > period.submission_closes:
            # Past the deadline: only late reporting can keep it open.
            if _late_window_active(period, now):
                return WindowDecision(
                    can_submit=True, state=STATE_LATE,
                    message='Late reporting is enabled for this period.',
                    **base,
                )
            return WindowDecision(
                can_submit=False, state=STATE_CLOSED,
                message='Reporting for this period has closed.',
                **base,
            )
        return WindowDecision(
            can_submit=True, state=STATE_OPEN,
            message='Reporting is open for this period.',
            **base,
        )

    # status == CLOSED (explicitly closed by an admin) — late reporting may
    # still re-permit submission within its own window.
    if _late_window_active(period, now):
        return WindowDecision(
            can_submit=True, state=STATE_LATE,
            message='Late reporting is enabled for this period.',
            **base,
        )
    return WindowDecision(
        can_submit=False, state=STATE_CLOSED,
        message='Reporting for this period has closed.',
        **base,
    )


def _late_window_active(period, now: datetime) -> bool:
    if not period.allow_late_reporting:
        return False
    if period.late_reporting_opens and now < period.late_reporting_opens:
        return False
    if period.late_reporting_closes and now > period.late_reporting_closes:
        return False
    return True
