"""
Assign organisations to project 3 (NAHPA Social Contracting 2026/27) from the
NAHPA FY2026/27 spreadsheet. Idempotent (update_or_create on project+org).
Dry-run by default; pass --apply to persist.

  python manage.py shell -c "import runpy,sys; sys.argv=['x']; runpy.run_path('scripts/nahpa_assign.py')"
We instead exec it directly via the host venv with DJANGO settings configured.
"""
import os, re, sys, zipfile, difflib
from xml.etree import ElementTree as ET
import django
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')
django.setup()
from django.db import transaction
from projects.models import Project, ProjectOrganization, ClientOrganization
from organizations.models import Organization

APPLY = '--apply' in sys.argv
PROJECT_ID = 3
BONASO_ID = 174
CLIENT_ID = 1
ODS = "/home/bonasoadmin/BONASOV1/frontend/docs/2026 27 NAHPA.ods"
OVERRIDE = {'journey of hope': 94, 'stop smoking support group': 106}
NEW = {'success capital'}
COORD_IDS = {  # verified coordinators
    'tebelopele wellness centre': 1, 'hpp': 109, 'mopipi int. trust': 159,
    'bonepwa+': 112, 'mbge': 166, 'makgabaneng': 5,
}

orgs = list(Organization.objects.values_list('id', 'name'))
def norm(s):
    s = re.sub(r'\(.*?\)', '', str(s or '')); s = re.sub(r'[^a-z0-9]+', ' ', s.lower())
    return re.sub(r'\s+', ' ', s).strip()
STOP = set('org organisation organization society trust group groups support centre center association campaign foundation int international the of and for a'.split())
def toks(s): return {w for w in norm(s).split() if w not in STOP}
def score(a, b):
    na, nb = norm(a), norm(b)
    seq = difflib.SequenceMatcher(None, na, nb).ratio()
    ta, tb = toks(a), toks(b)
    jac = len(ta & tb) / len(ta | tb) if (ta | tb) else 0
    tf = sum(max(difflib.SequenceMatcher(None, x, y).ratio() for y in tb) for x in ta) / len(ta) if ta and tb else 0
    return max(seq, jac, tf)
def resolve(name):
    n = norm(name)
    if n in COORD_IDS: return COORD_IDS[n], 'coord'
    if n in OVERRIDE: return OVERRIDE[n], 'override'
    if n in NEW: return None, 'new'
    bid, bs = None, -1
    for oid, nm in orgs:
        s = score(name, nm)
        if s > bs: bid, bs = oid, s
    return (bid, f'{bs:.0%}') if bs >= 0.78 else (None, f'LOW {bs:.0%}')

# ---- parse ODS ----
root = ET.fromstring(zipfile.ZipFile(ODS).read("content.xml"))
T = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0'
def ct(c): return "".join(t for t in c.itertext()).strip()
rows = []
for tbl in root.iter('{%s}table' % T):
    for r in tbl.iter('{%s}table-row' % T):
        cells = []
        for c in r.findall('{%s}table-cell' % T):
            rep = int(c.get('{%s}number-columns-repeated' % T, 1)); cells.extend([ct(c)] * min(rep, 30))
        rows.append(cells)
    break
def g(r, i): return r[i].strip() if len(r) > i else ''
def acro(s): return ''.join(w[0] for w in re.findall(r'[A-Za-z]+', s) if w.lower() not in ('and', 'for', 'of', 'the', 'to'))
def is_self(base, h):
    if norm(base) == norm(h): return True
    A = acro(h).upper(); B = re.sub(r'[^A-Za-z]', '', base).upper(); return len(A) >= 2 and (B == A or B == A + 'PLUS')
clusters = []; cur = None
for idx, r in enumerate(rows[1:], start=1):
    cl, cso, th, loc, dist = g(r, 0), g(r, 1), g(r, 2), g(r, 3), g(r, 4)
    if cl.strip().lower() in ('key', 'total funded', 'total sub grantees'): cur = None; continue
    if cl:
        h = re.sub(r'\s*\(.*?\)\s*$', '', cso).strip()
        cur = {'cluster': cl, 'header': h, 'coordinator': h, 'self': False, 'coord_impl': False, 'subs': [], 'row': idx}
        clusters.append(cur); continue
    if not cur or not cso: continue
    base = re.sub(r'\s*\(.*?\)\s*$', '', cso).strip()
    if 'implementing' in cso.lower(): cur['coord_impl'] = True; continue
    if not cur['self'] and is_self(base, cur['header']): cur['self'] = True; cur['coordinator'] = base; continue
    cur['subs'].append({'name': base, 'thematic': th, 'districts': dist or loc, 'row': idx})

def split_list(s):
    return [x.strip() for x in re.split(r'[,/]', str(s or '')) if x.strip()]

project = Project.objects.get(id=PROJECT_ID)
client = ClientOrganization.objects.filter(id=CLIENT_ID).first()
created = updated = 0; errors = []
def upsert(org_id, role, *, coord=False, sub=False, impl=True, can_report=True,
           cluster='', thematic=None, districts=None, row=None):
    global created, updated
    defaults = dict(role=role, is_coordinator=coord, is_sub_grantee=sub, is_implementer=impl,
                    can_report_indicators=can_report, cluster=cluster or '',
                    thematic_areas=thematic or [], districts_localities=districts or [],
                    is_training=False, is_active=True, source_sheet='NAHPA FY2026/27',
                    source_row=row, client=client)
    obj, was_created = ProjectOrganization.objects.update_or_create(
        project=project, organization_id=org_id, defaults=defaults)
    created += 1 if was_created else 0; updated += 0 if was_created else 1
    return obj

with transaction.atomic():
    # Success Capital (new org) if needed
    sc = Organization.objects.filter(name__iexact='Success Capital').first()
    if not sc:
        # Saved inside the transaction; dry-run rolls it back. This lets the
        # dry-run resolve the Success Capital sub-grantee link representatively.
        sc = Organization.objects.create(name='Success Capital', code='SUCCESS-CAP', type='partner', is_active=True)
        print(f"[new org] Success Capital -> id {sc.id} ({'persisted' if APPLY else 'will roll back in dry-run'})")
    NEW_IDS = {'success capital': sc.id}

    # Pass 1: overseer + coordinators + subs
    bonaso_po = upsert(BONASO_ID, 'lead', coord=False, sub=False, impl=False, can_report=False)
    coord_po = {}; coord_org_ids = set(); done_sub_ids = set()
    # Resolve all coordinator org ids first so a coordinator that ALSO appears as
    # its own implementer-sub (e.g. Mopipi) is never overwritten by a sub row.
    for c in clusters:
        cid, _ = resolve(c['coordinator'])
        if cid is not None: coord_org_ids.add(cid)
    for c in clusters:
        cid, how = resolve(c['coordinator'])
        if cid is None: errors.append(f"COORD unresolved: {c['header']} ({how})"); continue
        po = upsert(cid, 'coordinator', coord=True, impl=True, can_report=True, cluster=c['cluster'], row=c['row'])
        coord_po[c['cluster']] = po
        print(f"COORD {c['cluster'][:30]:30} <- {c['header'][:28]:28} org#{cid} ({how})  subs={len(c['subs'])}")
        for s in c['subs']:
            sid, show = resolve(s['name'])
            if sid is None and norm(s['name']) in NEW: sid = NEW_IDS[norm(s['name'])]
            if sid is None:
                errors.append(f"SUB unresolved: {s['name']} ({show})"); continue
            if sid in coord_org_ids:   # org is a coordinator that also implements
                continue
            if sid in done_sub_ids:    # duplicate sub row -> same org
                continue
            done_sub_ids.add(sid)
            upsert(sid, 'sub_grantee', sub=True, impl=True, can_report=True, cluster=c['cluster'],
                   thematic=split_list(s['thematic']), districts=split_list(s['districts']), row=s['row'])

    # Pass 2: hierarchy parents
    if APPLY or True:
        for c in clusters:
            po = coord_po.get(c['cluster'])
            if po:
                po.parent_assignment = bonaso_po
                if APPLY: po.save(update_fields=['parent_assignment'])
                for s in c['subs']:
                    sid, _ = resolve(s['name'])
                    if sid is None and norm(s['name']) in NEW: sid = NEW_IDS[norm(s['name'])]
                    if sid and sid not in coord_org_ids:
                        spo = ProjectOrganization.objects.filter(project=project, organization_id=sid).first()
                        if spo and APPLY:
                            spo.parent_assignment = po; spo.save(update_fields=['parent_assignment'])

    print(f"\n{'APPLIED' if APPLY else 'DRY-RUN'}: created={created} updated={updated} errors={len(errors)}")
    for e in errors: print("  ERR:", e)
    total = ProjectOrganization.objects.filter(project=project).count()
    print(f"project 3 ProjectOrganization rows (in-txn): {total}")
    if not APPLY:
        transaction.set_rollback(True)
        print("(rolled back — no changes persisted)")
