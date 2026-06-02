"""
Set ProjectOrganization.districts_localities (project 3) = DISTRICTS (col E) +
LOCALITIES (col D) for each org, from the NAHPA org sheet. Districts first, then
localities, de-duplicated preserving order. Dry-run unless --apply.
"""
import os, re, sys, zipfile, difflib
from xml.etree import ElementTree as ET
import django
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')
django.setup()
from organizations.models import Organization
from projects.models import ProjectOrganization

APPLY = '--apply' in sys.argv
PROJECT = 3
# org resolution (mirrors the corrected NAHPA assignment)
COORD = {'tebelopele wellness centre':1,'hpp':109,'mopipi int trust':159,'mopipi international trust':159,
         'bonepwa':112,'bonepwa+':112,'mbge':166,'men and boys for gender equality':166,'makgabaneng':5}
OVERRIDE_NAME = {'journey of hope':94,'stop smoking support group':106,'success capital':191}
ROW_OVERRIDE = {80:192, 87:107}  # Mabogo North (#192) and The Fighters Support Group (#107) — post-correction orgs
po_orgs = list(ProjectOrganization.objects.filter(project_id=PROJECT).select_related('organization'))
cand = [(p.organization_id, p.organization.name) for p in po_orgs]
def norm(s): return re.sub(r'\s+',' ',re.sub(r'[^a-z0-9 ]',' ',str(s or '').lower())).strip()
def resolve(ridx, cso):
    if ridx in ROW_OVERRIDE: return ROW_OVERRIDE[ridx]
    base = re.sub(r'\s*\(.*?\)\s*$','',cso).strip(); n = norm(base)
    if n in COORD: return COORD[n]
    if n in OVERRIDE_NAME: return OVERRIDE_NAME[n]
    bid, bs = None, -1
    for oid, nm in cand:
        s = difflib.SequenceMatcher(None, n, norm(nm)).ratio()
        if s > bs: bid, bs = oid, s
    return bid if bs >= 0.7 else None

T='urn:oasis:names:tc:opendocument:xmlns:table:1.0'
root=ET.fromstring(zipfile.ZipFile("/home/bonasoadmin/BONASOV1/frontend/docs/2026 27 NAHPA.ods").read("content.xml"))
def ct(c): return "".join(t for t in c.itertext()).strip()
tbl=next(root.iter('{%s}table'%T)); rows=[]
for r in tbl.iter('{%s}table-row'%T):
    cells=[]
    for c in r.findall('{%s}table-cell'%T):
        rep=int(c.get('{%s}number-columns-repeated'%T,1)); cells.extend([ct(c)]*min(rep,15))
    rows.append(cells[:6])
def g(r,i): return r[i].strip() if len(r)>i else ''
def split(s): return [x.strip() for x in re.split(r'[,/]', str(s or '')) if x.strip()]

acc = {}   # org_id -> ordered list
for ridx, r in enumerate(rows):
    cl = g(r,0); cso = g(r,1)
    if cl.strip().lower() in ('key','total funded','total sub grantees','cluster'): continue
    if not cso or cso.strip().upper()=='CIVIL SOCIETY ORGANISATION': continue
    districts = split(g(r,4)); localities = split(g(r,3))
    if not districts and not localities: continue
    oid = resolve(ridx, cso)
    if not oid: continue
    lst = acc.setdefault(oid, [])
    for v in districts + localities:
        if v not in lst: lst.append(v)

name_by_id = {p.organization_id: p.organization.name for p in po_orgs}
changed = 0
for oid, vals in sorted(acc.items()):
    po = ProjectOrganization.objects.filter(project_id=PROJECT, organization_id=oid).first()
    if not po: continue
    if (po.districts_localities or []) != vals:
        changed += 1
        print(f"  {name_by_id.get(oid,oid)[:30]:30} <- {vals}")
        if APPLY:
            po.districts_localities = vals; po.save(update_fields=['districts_localities','updated_at'])
print(f"\n{'APPLIED' if APPLY else 'DRY-RUN'}: orgs updated={changed} (of {len(acc)} with sheet district/locality data)")
