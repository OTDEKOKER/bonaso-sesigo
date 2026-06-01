from decimal import Decimal

from .models import ProjectIndicator


def _coerce_pk(value):
    return getattr(value, "pk", value)


def _to_decimal(value):
    if value is None or value == "":
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def ensure_project_indicator_link(
    project,
    indicator,
    *,
    target_value=0,
    current_value=0,
    baseline_value=0,
    q1_target=0,
    q2_target=0,
    q3_target=0,
    q4_target=0,
):
    project_id = _coerce_pk(project)
    indicator_id = _coerce_pk(indicator)
    _, created = ProjectIndicator.objects.get_or_create(
        project_id=project_id,
        indicator_id=indicator_id,
        defaults={
            'target_value': _to_decimal(target_value),
            'current_value': _to_decimal(current_value),
            'baseline_value': _to_decimal(baseline_value),
            'q1_target': _to_decimal(q1_target),
            'q2_target': _to_decimal(q2_target),
            'q3_target': _to_decimal(q3_target),
            'q4_target': _to_decimal(q4_target),
        },
    )
    return created
