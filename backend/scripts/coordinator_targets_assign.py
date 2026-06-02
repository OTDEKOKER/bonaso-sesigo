"""
Populate analysis.CoordinatorTarget (the model behind the 'Coordinator Portfolio
Targets' UI) for project 3 / year 2026 from 'targets 2026 27.ods'. One row per
(project, coordinator, indicator, year, quarter) — 4 quarter rows per
coordinator-indicator that has any value. Dry-run unless --apply.
"""
import os, re, sys, zipfile, difflib
from decimal import Decimal
from xml.etree import ElementTree as ET
import django
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')
django.setup()
from django.db import transaction
from indicators.models import Indicator
from projects.models import ProjectIndicator
from analysis.models import CoordinatorTarget

APPLY = '--apply' in sys.argv
PROJECT = 3
YEAR = 2026
ODS = "/home/bonasoadmin/BONASOV1/frontend/docs/targets 2026 27.ods"
COORD_ORG = [('MBGE',166),('BONEPWA+',112),('HPP',109),('TEBELOPELE',1),('MOPIPI',159),('MAKGABANENG',5)]

proj_ind = set(ProjectIndicator.objects.filter(project_id=PROJECT).values_list('indicator_id', flat=True))
inds = [(i,n) for i,n in Indicator.objects.exclude(name__istartswith='DEMO').exclude(code__startswith='DEMO-').exclude(is_deprecated=True).values_list('id','name')]
HIV_ID = (Indicator.objects.filter(name='Number of people reached with HIV prevention messages').first() or type('x',(),{'id':None})).id
def norm(s): return re.sub(r'\s+',' ',re.sub(r'[^a-z0-9 ]',' ',str(s or '').lower())).strip()
def match(name):
    if 'reached with hiv prevention' in name.lower() and HIV_ID: return HIV_ID
    nn=norm(name); bid=bs=-1
    for iid,n in inds:
        s=difflib.SequenceMatcher(None,nn,norm(n)).ratio()
        if iid in proj_ind: s+=0.0001
        if s>bs: bid,bs=iid,s
    return bid if bs>=0.6 else None
def num(v):
    v=str(v or '').strip().replace(',','').replace('%','')
    try: return Decimal(v) if v not in ('','-') else Decimal(0)
    except: return Decimal(0)

T='urn:oasis:names:tc:opendocument:xmlns:table:1.0'
root=ET.fromstring(zipfile.ZipFile(ODS).read("content.xml"))
def ct(c): return "".join(t for t in c.itertext()).strip()
tbl=next(root.iter('{%s}table'%T)); rows=[]
for r in tbl.iter('{%s}table-row'%T):
    cells=[]
    for c in r.findall('{%s}table-cell'%T):
        rep=int(c.get('{%s}number-columns-repeated'%T,1)); cells.extend([ct(c)]*min(rep,15))
    rows.append(cells[:7])
qidx=[i for i,r in enumerate(rows) if r and r[0].strip().upper()=='QUARTERS']
n_pairs=0; n_rows=0; skipped=0; unmatched=[]
with transaction.atomic():
    for k,qi in enumerate(qidx):
        start=qidx[k-1]+7 if k>0 else 0
        name=' '.join(x for r in rows[start:qi] for x in r if x).strip(); name=re.sub(r'^\d[\d,\. ]*','',name).strip()
        qv={q:[(rows[qi+o][c] if qi+o<len(rows) and c<len(rows[qi+o]) else '') for c in range(1,7)] for o,q in [(2,'Q1'),(3,'Q2'),(4,'Q3'),(5,'Q4')]}
        active=[]
        for ci,(cn,oid) in enumerate(COORD_ORG):
            qq=[num(qv[q][ci]) for q in ('Q1','Q2','Q3','Q4')]
            if sum(qq)>0: active.append((oid,qq))
        if not active: skipped+=1; continue
        iid=match(name)
        if not iid: unmatched.append(name); continue
        for oid,qq in active:
            n_pairs+=1
            for qlabel,val in zip(('Q1','Q2','Q3','Q4'),qq):
                CoordinatorTarget.objects.update_or_create(
                    project_id=PROJECT, coordinator_id=oid, indicator_id=iid, year=YEAR, quarter=qlabel,
                    defaults=dict(target_value=val, is_active=True))
                n_rows+=1
    print(f"{'APPLIED' if APPLY else 'DRY-RUN'}: coordinator-indicator pairs={n_pairs}, CoordinatorTarget rows={n_rows} (4/quarter), skipped(no values)={skipped}, unmatched={len(unmatched)}")
    for u in unmatched: print("  UNMATCHED:", u[:50])
    if not APPLY:
        transaction.set_rollback(True); print("(rolled back)")
