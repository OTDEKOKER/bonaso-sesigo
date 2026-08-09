"""Server-side validation for CSO office GPS coordinates.

The questionnaire captures the office location on the device (browser Geolocation
API); the raw values still arrive from an untrusted client, so they are validated
here before they can reach the model columns. Rules (see the feature spec):

  * latitude / longitude are required for a submission and must be finite numbers
    in range (lat -90..90, lng -180..180); blank / malformed / NaN / infinite are
    rejected.
  * accuracy (metres) and captured-at timestamp are optional but validated when
    present.
  * the capture method defaults to ``device_gps``.
  * a *valid* coordinate outside Botswana's geographic extent is accepted but
    flagged for administrative review — never silently moved or replaced.

The functions are deliberately pure (no DRF import) so they are cheap to unit
test and reusable from anywhere.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation

from django.utils.dateparse import parse_datetime
from django.utils import timezone

# Field name the frontend anchors its capture widget to, used as the error key so
# a validation problem surfaces beside the "Capture Current Location" control.
LOCATION_ERROR_KEY = "cso_office_location"

# Reserved payload/answer keys carrying the captured location. These are NOT
# questionnaire schema fields — they are handled explicitly (not via the schema
# loop) and preserved across draft saves.
LOCATION_KEYS = (
    "latitude",
    "longitude",
    "location_accuracy",
    "location_captured_at",
    "location_capture_method",
)

DEFAULT_CAPTURE_METHOD = "device_gps"
MAX_METHOD_LEN = 30

# Botswana geographic extent (padded a little beyond the true bounding box of
# lng 19.99..29.37, lat -26.90..-17.78). A valid coordinate outside this box is
# flagged for review rather than rejected (border areas stay valid).
BW_MIN_LNG, BW_MAX_LNG = Decimal("19.0"), Decimal("30.0")
BW_MIN_LAT, BW_MAX_LAT = Decimal("-27.5"), Decimal("-17.0")

_LAT_Q = Decimal("0.000001")   # 6 decimal places (model precision)
_ACC_Q = Decimal("0.01")       # 2 decimal places


def _to_decimal(raw: object) -> Decimal | None:
    """Parse a finite Decimal from a raw value, or None if not a finite number."""
    if raw is None:
        return None
    text = str(raw).strip()
    if text == "":
        return None
    try:
        value = Decimal(text)
    except (InvalidOperation, ValueError, TypeError):
        return None
    if not value.is_finite():  # rejects NaN / Infinity
        return None
    return value


def validate_location(ctx: dict, *, required: bool) -> tuple[dict, dict]:
    """Validate the location keys in ``ctx``.

    Returns ``(values, errors)``. ``values`` holds the validated model-column
    fields (only present when there are no errors); ``errors`` maps the location
    error key to a respondent-safe message. Never raises.
    """
    errors: dict[str, str] = {}
    values: dict[str, object] = {}

    lat = _to_decimal(ctx.get("latitude"))
    lng = _to_decimal(ctx.get("longitude"))

    # Presence: both must be captured together.
    if lat is None or lng is None:
        if required:
            errors[LOCATION_ERROR_KEY] = (
                "The CSO office location is required. Please use the "
                "“Capture Current Location” button while at the office."
            )
        return values, errors

    # Range.
    if not (Decimal("-90") <= lat <= Decimal("90")):
        errors[LOCATION_ERROR_KEY] = "The captured latitude is out of range."
        return values, errors
    if not (Decimal("-180") <= lng <= Decimal("180")):
        errors[LOCATION_ERROR_KEY] = "The captured longitude is out of range."
        return values, errors

    values["latitude"] = lat.quantize(_LAT_Q)
    values["longitude"] = lng.quantize(_LAT_Q)

    # Optional accuracy (metres): must be a finite, non-negative number if given.
    accuracy = _to_decimal(ctx.get("location_accuracy"))
    if accuracy is not None and accuracy >= 0:
        values["location_accuracy"] = accuracy.quantize(_ACC_Q)

    # Optional capture timestamp (ISO 8601). Made timezone-aware if naive.
    raw_when = str(ctx.get("location_captured_at") or "").strip()
    when = parse_datetime(raw_when) if raw_when else None
    if when is not None:
        if timezone.is_naive(when):
            when = timezone.make_aware(when, timezone.get_default_timezone())
        values["location_captured_at"] = when

    # Capture method (defaulted, length-capped). Kept as an opaque short token.
    method = (str(ctx.get("location_capture_method") or "").strip() or DEFAULT_CAPTURE_METHOD)
    values["location_capture_method"] = method[:MAX_METHOD_LEN]

    # Botswana extent: accept but flag clearly-out-of-country coordinates.
    outside = not (BW_MIN_LAT <= lat <= BW_MAX_LAT and BW_MIN_LNG <= lng <= BW_MAX_LNG)
    values["location_flagged"] = outside
    values["location_flag_reason"] = (
        "Captured location is outside Botswana's geographic extent." if outside else ""
    )

    return values, errors
