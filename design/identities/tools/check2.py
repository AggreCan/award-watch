"""Load each page in an iframe of an exact width and report horizontal overflow inside it."""
import re, shutil, subprocess, sys
from pathlib import Path
SRC = Path(r"C:/Users/kylep/OneDrive/Desktop/Repositories/public-money-watch/design/identities")
WORK = Path(__file__).with_name("check2")
CHROME = r"C:/Program Files/Google/Chrome/Application/chrome.exe"
WIDTHS = [int(w) for w in sys.argv[1].split(",")]
HARNESS = """<!doctype html><html><body style="margin:0">
<iframe id="f" src="%s" style="width:%dpx;height:1000px;border:0;display:block"></iframe>
<pre id="measure"></pre>
<script>
var f=document.getElementById('f');
f.addEventListener('load',function(){setTimeout(function(){
 var d=f.contentDocument, W=d.documentElement.clientWidth, out=['client='+W+' scroll='+d.documentElement.scrollWidth];
 var bad=[]; d.querySelectorAll('body *').forEach(function(el){var r=el.getBoundingClientRect(); if(r.width&&r.right>W+0.5)bad.push(el);});
 bad=bad.filter(function(el){return !bad.some(function(o){return o!==el&&el.contains(o);});});
 bad.slice(0,6).forEach(function(el){var r=el.getBoundingClientRect();out.push('OVER '+el.tagName.toLowerCase()+'.'+(typeof el.className==='string'?el.className:'')+' right='+Math.round(r.right)+' '+(el.textContent||'').trim().slice(0,40));});
 var t=d.querySelector('table.data td'); out.push('td='+(t?f.contentWindow.getComputedStyle(t).display:'-'));
 document.getElementById('measure').textContent=out.join(' | ');
},1500);});
</script></body></html>"""
if WORK.exists(): shutil.rmtree(WORK)
shutil.copytree(SRC, WORK)
for w in WIDTHS:
    for html in sorted(p for p in WORK.glob("*/*.html") if not p.name.startswith("_h_")):
        h = html.parent / f"_h_{html.stem}_{w}.html"
        h.write_text(HARNESS % (html.name, w), encoding="utf-8")
        r = subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--allow-file-access-from-files", "--window-size=1400,1100",
                            "--virtual-time-budget=8000", "--dump-dom", h.as_uri()], capture_output=True, text=True, encoding="utf-8", timeout=90)
        m = re.search(r'<pre id="measure">(.*?)</pre>', r.stdout, re.S)
        res = (m.group(1) if m else "NO RESULT").replace("&amp;", "&")
        print(("!! " if "OVER" in res or not res.strip() else "OK ") + f"{w:>5} {html.parent.name}/{html.name}: {res}")
