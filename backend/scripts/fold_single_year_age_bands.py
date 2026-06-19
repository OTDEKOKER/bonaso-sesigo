"""Fold single-year age-band keys (e.g. "11","12","17") into the standard
5-year bands ("10-14","15-19", …) inside aggregate value JSON.

Some aggregates store ages 10-19 as individual years alongside the 5-year bands,
which makes the aggregates table show stray columns (11,12,13,16,17,18,…). This
walks each affected aggregate's value, sums every pure-digit band key into its
5-year band, and saves — facts re-sync via the post_save signal. Totals are
unchanged (folding only regroups leaves).

Exports affected aggregates (full value) to a restore file first. Set APPLY=1 to
write; otherwise dry-run (reports counts + a before/after sample).
"""
import copy
import datetime
import json
import os
import re

from aggregates.models import Aggregate

APPLY = os.environ.get("APPLY") == "1"
TS = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
RESTORE = f"/app/backups/single_year_band_restore_{TS}.json"

_DIGITS = re.compile(r"^\d{1,2}$")


def band_for_age(age: int) -> str:
    if age >= 65:
        return "65+"
    start = age - (age % 5)
    return f"{start}-{start + 4}"


def _deep_add(a, b):
    """Sum two leaf/nested values: numbers add; dicts merge key-wise."""
    if isinstance(a, dict) or isinstance(b, dict):
        out = dict(a) if isinstance(a, dict) else {}
        for k, v in (b.items() if isinstance(b, dict) else []):
            out[k] = _deep_add(out.get(k), v)
        return out
    return (a or 0) + (b or 0)


def fold(node):
    """Recursively fold pure-digit band keys into 5-year bands. Returns (new, changed)."""
    changed = False
    if isinstance(node, dict):
        # recurse first
        new = {}
        for k, v in node.items():
            nv, c = fold(v)
            changed = changed or c
            new[k] = nv
        # does this dict hold single-year band keys?
        digit_keys = [k for k in new if isinstance(k, str) and _DIGITS.match(k)]
        if digit_keys:
            for k in digit_keys:
                target = band_for_age(int(k))
                new[target] = _deep_add(new.get(target), new[k])
                del new[k]
            changed = True
        return new, changed
    if isinstance(node, list):
        out = []
        for item in node:
            nv, c = fold(item)
            changed = changed or c
            out.append(nv)
        return out, changed
    return node, changed


affected = []
sample = None
for a in Aggregate.objects.all().iterator():
    s = json.dumps(a.value)
    if not re.search(r'"\d{1,2}"\s*:', s):
        continue
    new_value, changed = fold(copy.deepcopy(a.value))
    if changed:
        if sample is None:
            sample = (a.id, copy.deepcopy(a.value), new_value)
        affected.append((a, new_value))

print(f"aggregates with single-year bands to fold: {len(affected)}")

# restore export (originals)
with open(RESTORE, "w") as fh:
    json.dump([
        {"id": a.id, "value": a.value} for a, _ in affected
    ], fh, default=str)
print("restore file:", RESTORE)

if sample:
    sid, before, after = sample
    def bands_of(v):
        s = json.dumps(v)
        return sorted(set(re.findall(r'"(\d{1,2}(?:-\d{2})?|65\+)"\s*:', s)))
    print(f"\nsample aggregate {sid}")
    print("  bands BEFORE:", bands_of(before))
    print("  bands AFTER :", bands_of(after))

if APPLY:
    n = 0
    for a, new_value in affected:
        a.value = new_value
        a.save(update_fields=["value", "updated_at"])  # triggers fact re-sync
        n += 1
    print(f"\nUPDATED {n} aggregates (facts re-sync on commit).")
else:
    print("\nDRY RUN — set APPLY=1 to apply.")
