import subprocess, glob, re, os, sys, json
import numpy as np
from PIL import Image
d=sys.argv[1]; rows=[]
for f in sorted(glob.glob(d+'/*.pdf')):
    info=subprocess.run(['pdfinfo',f],capture_output=True,text=True).stdout
    n=int(re.search(r'Pages:\s+(\d+)',info).group(1)); size=os.path.getsize(f)
    inks=[]
    for p in range(1,n+1):
        subprocess.run(['pdftoppm','-r','30','-f',str(p),'-l',str(p),'-gray','-png',f,'/tmp/_pg'],check=True)
        g=glob.glob('/tmp/_pg-*.png')[0]; im=np.array(Image.open(g)); os.remove(g)
        ink=(im<200); r_=np.where(ink.any(axis=1))[0]
        inks.append((round(float(ink.mean())*100,2), round(float(r_.max()+1)/im.shape[0]*100) if len(r_) else 0))
    rows.append({'file':os.path.basename(f)[:-4],'pages':n,'MB':round(size/1e6,2),'MB_per_page':round(size/1e6/n,2),'pages_ink_pct_extent_pct':inks})
for r in rows: print(r['file'].ljust(46), 'pages',r['pages'],'MB',str(r['MB']).rjust(6),'MB/page',r['MB_per_page'],r['pages_ink_pct_extent_pct'])
json.dump(rows,open(d+'/analysis.json','w'),indent=1)
