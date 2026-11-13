from pathlib import Path
import re,subprocess,os,shutil
from weasyprint import HTML
ROOT=Path(__file__).resolve().parent.parent
TMP=Path('/tmp/ge-workbook-pdf'); TMP.mkdir(exist_ok=True)
css=(ROOT/'style.css').read_text(); css=re.sub(r"@import[^\n]+\n",'',css)
# use installed Noto Sans Thai; no remote font request during PDF generation
(TMP/'style.css').write_text(css)
(TMP/'logo.png').write_bytes((ROOT/'logo.png').read_bytes())
shutil.copytree(ROOT/'fonts',TMP/'fonts',dirs_exist_ok=True)
for lang in ['th','en']:
 cache={}
 for kind in ['print','key']:
  text=(ROOT/f'{kind}-{lang}.html').read_text()
  def outline(m):
   svg=m.group(0)
   if svg in cache:return cache[svg]
   idx=len(cache); inp=TMP/f'art-{lang}-{idx}.svg';out=TMP/f'path-{lang}-{idx}.svg'
   inp.write_text(svg.replace('<text ','<text font-family="Noto Sans Thai" '))
   env=dict(os.environ,INKSCAPE_PROFILE_DIR=str(TMP/'ink-profile'))
   subprocess.run(['inkscape',str(inp),'--export-text-to-path','--export-plain-svg','--export-type=svg','--export-filename='+str(out)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,env=env)
   result=out.read_text();result=result[result.index('<svg'):]
   assert '<text' not in result
   cache[svg]=result
   return result
  text=re.sub(r'<svg\b.*?</svg>',outline,text,flags=re.S)
  file=TMP/f'{kind}-{lang}.html';file.write_text(text)
  HTML(filename=str(file)).write_pdf(str(ROOT/f'{kind}-{lang}.pdf'))
  print(kind,lang,flush=True)
