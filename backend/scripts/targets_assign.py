"""
Assign NAHPA FY2026/27 indicator targets to coordinators (project 3) from
'targets 2026 27.ods'. Each indicator block has columns B-G = coordinators
(MBGE, BONEPWA+, HPP, TEBELOPELE, MOPIPI, MAKGABANENG) and rows Q1-Q4 = targets.
A coordinator with a blank/0 value is NOT reporting that indicator (skipped).

Dry-run by default; pass --apply to persist.
"""
import os, re, sys, zipfile, difflib
from decimal import Decimal
from xml.etree import ElementTree as ET
import django
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')
django.setup()
from django.db import transaction
from django.db.models import Sum
from indicators.models import Indicator
from projects.models import Project, ProjectIndicator, ProjectIndicatorAssignment, ProjectIndicatorOrganizationTarget, ProjectOrganization

APPLY = '--apply' in sys.argv
PROJECT_ID = 3
ODS = "/home/bonasoadmin/BONASOV1/frontend/docs/targets 2026 27.ods"
# data columns B-G -> coordinator org ids
COORD_ORG = [('MBGE',166), ('BONEPWA+',112), ('HPP',109), ('TEBELOPELE',1), ('MOPIPI',159), ('MAKGABANENG',5)]

# --- indicator matching (exclude DEMO / training / deprecated) ---
proj_ind_ids = set(ProjectIndicator.objects.filter(project_id=PROJECT_ID).values_list('indicator_id', flat=True))
inds = [(i, n) for i, n in Indicator.objects.exclude(name__istartswith='DEMO').exclude(code__startswith='DEMO-').exclude(is_deprecated=True).values_list('id', 'name')]
def norm(s): return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9 ]', ' ', str(s or '').lower())).strip()
def match_indicator(name):
    nn = norm(name); bid = None; bs = -1; bnm = ''
    for iid, nm in inds:
        s = difflib.SequenceMatcher(None, nn, norm(nm)).ratio()
        if iid in proj_ind_ids: s += 0.0001
        if s > bs: bid, bs, bnm = iid, s, nm
    return bid, bs, bnm

# coordinator ProjectOrganization (for assignment.project_organization link)
coord_po = {oid: ProjectOrganization.objects.filter(project_id=PROJECT_ID, organization_id=oid).first() for _, oid in COORD_ORG}

# --- parse ODS ---
T = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0'
root = ET.fromstring(zipfile.ZipFile(ODS).read("content.xml"))
def ct(c): return "".join(t for t in c.itertext()).strip()
tbl = next(root.iter('{%s}table' % T)); rows = []
for r in tbl.iter('{%s}table-row' % T):
    cells = []
    for c in r.findall('{%s}table-cell' % T):
        rep = int(c.get('{%s}number-columns-repeated' % T, 1)); cells.extend([ct(c)] * min(rep, 15))
    rows.append(cells[:7])
qidx = [i for i, r in enumerate(rows) if r and r[0].strip().upper() == 'QUARTERS']
def num(v):
    # Targets are a mix of counts and percentages ("100%", "1.40%"); store the
    # numeric value (the indicator's type distinguishes count vs percentage).
    v = str(v or '').strip().replace(',', '').replace('%', '')
    try: return Decimal(v) if v not in ('', '-') else Decimal(0)
    except Exception: return Decimal(0)

n_pi = n_tgt = n_assign = skip_noval = 0
unmatched = []
project = Project.objects.get(id=PROJECT_ID)
with transaction.atomic():
    for k, qi in enumerate(qidx):
        start = qidx[k-1] + 7 if k > 0 else 0
        name = ' '.join(x for r in rows[start:qi] for x in r if x).strip()
        name = re.sub(r'^\d[\d,\. ]*', '', name).strip()
        qv = {q: [(rows[qi+o][c] if qi+o < len(rows) and c < len(rows[qi+o]) else '') for c in range(1, 7)]
              for o, q in [(2, 'Q1'), (3, 'Q2'), (4, 'Q3'), (5, 'Q4')]}
        # coordinators with a positive value
        active = []
        for ci, (cname, oid) in enumerate(COORD_ORG):
            qq = [num(qv[q][ci]) for q in ('Q1', 'Q2', 'Q3', 'Q4')]
            if sum(qq) > 0:
                active.append((cname, oid, qq))
        if not active:
            skip_noval += 1; continue
        iid, score, bnm = match_indicator(name)
        if score < 0.6:
            unmatched.append((name, bnm, score)); continue
        pi, _ = ProjectIndicator.objects.get_or_create(project=project, indicator_id=iid)
        n_pi += 1
        for cname, oid, qq in active:
            ProjectIndicatorOrganizationTarget.objects.update_or_create(
                project_indicator=pi, organization_id=oid,
                defaults=dict(q1_target=qq[0], q2_target=qq[1], q3_target=qq[2], q4_target=qq[3], target_value=sum(qq)))
            ProjectIndicatorAssignment.objects.update_or_create(
                project_indicator=pi, organization_id=oid,
                defaults=dict(assignment_source='organization_target', is_active=True,
                              project_organization=coord_po.get(oid)))
            n_tgt += 1; n_assign += 1
        # roll up project-indicator quarterly targets = sum of org targets
        agg = ProjectIndicatorOrganizationTarget.objects.filter(project_indicator=pi).aggregate(
            q1=Sum('q1_target'), q2=Sum('q2_target'), q3=Sum('q3_target'), q4=Sum('q4_target'), tv=Sum('target_value'))
        pi.q1_target = agg['q1'] or 0; pi.q2_target = agg['q2'] or 0; pi.q3_target = agg['q3'] or 0
        pi.q4_target = agg['q4'] or 0; pi.target_value = agg['tv'] or 0
        pi.save(update_fields=['q1_target', 'q2_target', 'q3_target', 'q4_target', 'target_value'])

    print(f"{'APPLIED' if APPLY else 'DRY-RUN'}: project_indicators touched={n_pi}, org-targets={n_tgt}, "
          f"assignments={n_assign}, indicators skipped (no values)={skip_noval}, unmatched={len(unmatched)}")
    for nm, bnm, sc in unmatched:
        print(f"  UNMATCHED ({sc:.2f}): {nm[:50]} -> best {bnm[:40]}")
    if not APPLY:
        transaction.set_rollback(True)
        print("(rolled back — no changes persisted)")
