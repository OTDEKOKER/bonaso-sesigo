"""
Make the 2026/27 coordinator-workbook indicator name variants durable as
`IndicatorAlias` rows, so future Excel imports auto-resolve them to the same
canonical indicator the 2026-06-05 load chose.

Safety rules (additive only — no deprecation of cross-project indicators):
  * Only create an alias when the workbook wording differs from the resolved
    indicator's own name AND no *other* indicator already owns that normalized
    name (prevents hijacking another real indicator's import resolution).
  * Separately, merge the single genuinely-unused exact duplicate
    I607 "Number of lubricants distributed" -> I357 (used by no project).

Dry-run by default; pass --apply.
"""
import argparse
import os
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")
import django  # noqa: E402

django.setup()

from django.db import transaction  # noqa: E402

from indicators.models import Indicator, IndicatorAlias  # noqa: E402
from projects.models import ProjectIndicator  # noqa: E402

# reuse the loader's parser + matcher so resolution stays identical
import coordinator_indicators_targets_2627 as loader  # noqa: E402

UNUSED_DUP_MERGE = {607: 357}  # deprecated_id -> canonical_id (I607 used by no project)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    rows = loader.parse_workbook()
    resolve = loader.build_matcher()

    # normalized name -> indicator id, for collision detection
    norm_to_ind = {}
    for i, n in Indicator.objects.values_list("id", "name"):
        norm_to_ind.setdefault(loader.norm(n), i)

    uniq = {}
    for r in rows:
        uniq.setdefault(r["norm"], r["name"])

    created, skipped_exact, skipped_collision, already = [], 0, [], 0
    with transaction.atomic():
        for nn, name in sorted(uniq.items()):
            iid, method, score = resolve(nn)
            if iid is None:  # would be a brand-new indicator (none left post-load), skip
                continue
            canon = Indicator.objects.get(id=iid)
            if loader.norm(canon.name) == nn:
                skipped_exact += 1
                continue
            owner = norm_to_ind.get(nn)
            if owner is not None and owner != iid:
                skipped_collision.append((name, owner, iid))
                continue
            if IndicatorAlias.objects.filter(normalized_name=nn).exists():
                already += 1
                continue
            if args.apply:
                IndicatorAlias.objects.create(indicator=canon, name=name, notes="SC2026/27 coordinator workbook variant")
            created.append((name, iid, canon.name, method))

        # merge unused exact duplicates
        merges = []
        for dup_id, canon_id in UNUSED_DUP_MERGE.items():
            dup = Indicator.objects.filter(id=dup_id).first()
            canon = Indicator.objects.filter(id=canon_id).first()
            if not dup or not canon:
                continue
            if ProjectIndicator.objects.filter(indicator_id=dup_id).exists():
                merges.append((dup_id, canon_id, "SKIPPED — has project usage"))
                continue
            if args.apply:
                if not IndicatorAlias.objects.filter(normalized_name=loader.norm(dup.name)).exists():
                    IndicatorAlias.objects.create(indicator=canon, name=dup.name, notes="merged unused duplicate")
                dup.canonical_indicator = canon
                dup.is_deprecated = True
                dup.is_active = False
                dup.save(update_fields=["canonical_indicator", "is_deprecated", "is_active", "updated_at"])
            merges.append((dup_id, canon_id, "merged"))

        if not args.apply:
            transaction.set_rollback(True)

    print(("APPLIED" if args.apply else "DRY-RUN") + " ------------------------------")
    print(f"aliases to create: {len(created)} | already-present: {already} | skipped exact-name: {skipped_exact} | skipped collisions: {len(skipped_collision)}")
    for name, iid, cname, method in created:
        print(f"  + alias {name[:48]!r} -> I{iid} {cname[:40]!r} [{method}]")
    if skipped_collision:
        print("collisions (left alone — name owned by another indicator):")
        for name, owner, iid in skipped_collision:
            print(f"  ! {name[:48]!r} owned by I{owner}, would-resolve I{iid}")
    print("merges:")
    for dup_id, canon_id, status in merges:
        print(f"  I{dup_id} -> I{canon_id}: {status}")


if __name__ == "__main__":
    main()
