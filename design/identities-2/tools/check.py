"""Load each page in an iframe of an exact width (both schemes) and report horizontal overflow.

Usage: python check.py 360,700,1000,1280 WORKDIR
Copies the pages into WORKDIR so the harness files never land in the repo."""
import re, shutil, subprocess, sys
from pathlib import Path

SRC = Path(__file__).resolve().parents[1]
CHROME = r"C:/Program Files/Google/Chrome/Application/chrome.exe"
WIDTHS = [int(w) for w in sys.argv[1].split(",")]
WORK = Path(sys.argv[2]) / "identities-2"
HARNESS = """<!doctype html><html><body style="margin:0">
<iframe id="f" src="%s" style="width:%dpx;height:900px;border:0;display:block"></iframe>
<pre id="measure"></pre>
<script>
var f=document.getElementById('f');
f.addEventListener('load',function(){setTimeout(function(){
 var d=f.contentDocument, W=d.documentElement.clientWidth, out=['client='+W+' scroll='+d.documentElement.scrollWidth];
 var bad=[]; d.querySelectorAll('body *').forEach(function(el){var r=el.getBoundingClientRect(); var hid=el.closest('thead,.vh');if(hid&&f.contentWindow.getComputedStyle(hid).position==='absolute')return;if(r.width&&r.right>W+0.5&&f.contentWindow.getComputedStyle(el).position!=='absolute')bad.push(el);});
 bad=bad.filter(function(el){return !bad.some(function(o){return o!==el&&el.contains(o);});});
 bad.slice(0,6).forEach(function(el){var r=el.getBoundingClientRect();out.push('OVER '+el.tagName.toLowerCase()+'.'+(typeof el.className==='string'?el.className:'')+' right='+Math.round(r.right)+' '+(el.textContent||'').trim().slice(0,40));});
 var t=d.querySelector('table.t td'); out.push('td='+(t?f.contentWindow.getComputedStyle(t).display:'-'));
 document.getElementById('measure').textContent=out.join(' | ');
},1200);});
</script></body></html>"""

if WORK.exists():
    shutil.rmtree(WORK)
shutil.copytree(SRC, WORK, ignore=shutil.ignore_patterns("tools", "*.md"))
pages = sorted(p for p in WORK.glob("*/*.html")) + [WORK / "index.html"]
fails = 0
for scheme in ("1", "0"):
    for w in WIDTHS:
        for html in pages:
            if not html.exists():
                continue
            h = html.parent / f"_h_{html.stem}_{w}.html"
            h.write_text(HARNESS % (html.name, w), encoding="utf-8")
            r = subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--allow-file-access-from-files", "--window-size=1400,1000",
                                f"--blink-settings=preferredColorScheme={scheme}", "--virtual-time-budget=6000", "--dump-dom", h.as_uri()],
                               capture_output=True, text=True, encoding="utf-8", timeout=90)
            m = re.search(r'<pre id="measure">(.*?)</pre>', r.stdout, re.S)
            res = (m.group(1) if m else "NO RESULT").replace("&amp;", "&")
            ok = "OVER" not in res and res.strip() and "NO RESULT" not in res
            fails += not ok
            rel = html.relative_to(WORK).as_posix()
            print(("OK " if ok else "!! ") + f"{'light' if scheme == '1' else 'dark '} {w:>5} {rel}: {res}")
print("failures:", fails)
