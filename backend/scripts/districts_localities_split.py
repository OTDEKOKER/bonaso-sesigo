"""
Set ProjectOrganization.districts (col E DISTRICT) and .localities (col D LOCALITY)
SEPARATELY for project 3 orgs, from the NAHPA org sheet. Applies the agreed
spelling normalizations. De-duplicated preserving order. Dry-run unless --apply.
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
ROW_OVERRIDE = {80:192, 87:107}  # Mabogo North (#192) and The Fighters Support Group (#107)
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

# spelling normalizations agreed with the user (apply to both districts & localities)
def fix_token(t):
    t = re.sub(r'\s+district$', '', t.strip(), flags=re.I).strip()  # "Central District" -> "Central"
    k = re.sub(r'\s+',' ', t.lower())
    mapping = {
        'f-town':'Francistown','f-twon':'Francistown','ftown':'Francistown','f town':'Francistown',
        'mahalapyaye':'Mahalapye','mahapaye':'Mahalapye','mahalapaye':'Mahalapye',
        'mogoditshane':'Mogoditshane','mogodistahne':'Mogoditshane','mogodishane':'Mogoditshane',
        'palapye':'Palapye','francistown':'Francistown','mahalapye':'Mahalapye',
    }
    return mapping.get(k, t.strip())

def split(s):
    # split on commas, slashes, newlines (paragraph breaks) and " and "
    raw = [x.strip() for x in re.split(r'[,/\n]|\s+and\s+', str(s or '')) if x.strip()]
    out = []
    for x in raw:
        # "Mahalapaye Palapye" (space-joined, no separator) -> Mahalapye + Palapye
        if re.fullmatch(r'(?i)mahala\w*\s+palapye', x):
            for part in (fix_token('mahalapye'), fix_token('palapye')):
                if part not in out: out.append(part)
            continue
        v = fix_token(x)
        if v and v not in out: out.append(v)
    return out

T='urn:oasis:names:tc:opendocument:xmlns:table:1.0'
root=ET.fromstring(zipfile.ZipFile("/home/bonasoadmin/BONASOV1/frontend/docs/2026 27 NAHPA.ods").read("content.xml"))
import html
P='urn:oasis:names:tc:opendocument:xmlns:text:1.0'
def para_text(p):
    # serialize, turn soft line-breaks/tabs into separators, strip remaining tags
    raw = ET.tostring(p, encoding='unicode')
    raw = re.sub(r'<[^>]*line-break[^>]*/?>', '\n', raw)
    raw = re.sub(r'<[^>]*tab[^>]*/?>', ' ', raw)
    raw = re.sub(r'<\w+:s(?:\s[^<>]*)?/?>', ' ', raw)  # <text:s/> = literal space(s)
    return html.unescape(re.sub(r'<[^>]+>', '', raw)).strip()
def ct(c):
    # join each paragraph (<text:p>) with a newline so multi-line cells split correctly
    paras = [t for t in (para_text(p) for p in c.findall('{%s}p'%P)) if t]
    return "\n".join(paras) if paras else "".join(c.itertext()).strip()
tbl=next(root.iter('{%s}table'%T)); rows=[]
for r in tbl.iter('{%s}table-row'%T):
    cells=[]
    for c in r.findall('{%s}table-cell'%T):
        rep=int(c.get('{%s}number-columns-repeated'%T,1)); cells.extend([ct(c)]*min(rep,15))
    rows.append(cells[:6])
def g(r,i): return r[i].strip() if len(r)>i else ''

dacc, lacc = {}, {}   # org_id -> ordered list
for ridx, r in enumerate(rows):
    cl = g(r,0); cso = g(r,1)
    if cl.strip().lower() in ('key','total funded','total sub grantees','cluster'): continue
    if not cso or cso.strip().upper()=='CIVIL SOCIETY ORGANISATION': continue
    districts = split(g(r,4)); localities = split(g(r,3))
    if not districts and not localities: continue
    oid = resolve(ridx, cso)
    if not oid: continue
    dl = dacc.setdefault(oid, [])
    for v in districts:
        if v not in dl: dl.append(v)
    ll = lacc.setdefault(oid, [])
    for v in localities:
        if v not in ll: ll.append(v)

name_by_id = {p.organization_id: p.organization.name for p in po_orgs}
changed = 0
all_ids = sorted(set(dacc) | set(lacc))
for oid in all_ids:
    po = ProjectOrganization.objects.filter(project_id=PROJECT, organization_id=oid).first()
    if not po: continue
    d = dacc.get(oid, []); l = lacc.get(oid, [])
    if (po.districts or []) != d or (po.localities or []) != l:
        changed += 1
        print(f"  {name_by_id.get(oid,oid)[:28]:28} D={d}  L={l}")
        if APPLY:
            po.districts = d; po.localities = l
            po.save(update_fields=['districts','localities','updated_at'])
print(f"\n{'APPLIED' if APPLY else 'DRY-RUN'}: orgs updated={changed} (of {len(all_ids)} with sheet data)")
