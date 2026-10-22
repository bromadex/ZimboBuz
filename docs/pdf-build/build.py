"""Build docs/ZimERP-master-plan.pdf from docs/ZimERP-master-plan.md.

Pass 1 renders with placeholder TOC page numbers, pass 2 fills in the real
numbers found by searching the pass-1 PDF for each heading.
"""
import re, subprocess, sys, json, html
from pathlib import Path
import markdown
import pdfplumber
from pypdf import PdfReader, PdfWriter

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "docs/ZimERP-master-plan.md"
OUT = ROOT / "docs/ZimERP-master-plan.pdf"
WORK = Path(__file__).resolve().parent

md_text = SRC.read_text()
# Drop the title block (rendered on the cover instead): everything before the first '---'.
body_md = md_text.split("\n---\n", 1)[1]

md = markdown.Markdown(extensions=["tables", "attr_list", "md_in_html", "sane_lists"])
body_html = md.convert(body_md)

# Give Part headings ids and a class; collect TOC entries (parts + h2 sections).
toc = []
def part_repl(m):
    title = re.sub(r"<[^>]+>", "", m.group(1))
    pid = "part-" + re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    toc.append(("part", pid, title))
    return f'<h1 class="part" id="{pid}">{m.group(1)}</h1>'
body_html = re.sub(r"<h1>(.*?)</h1>", part_repl, body_html)

def collect(html_text):
    entries = []
    for m in re.finditer(r'<h1 class="part" id="([^"]+)">(.*?)</h1>|<h2 id="([^"]+)">(.*?)</h2>', html_text):
        if m.group(1):
            entries.append(("part", m.group(1), re.sub(r"<[^>]+>", "", m.group(2))))
        else:
            entries.append(("sec", m.group(3), re.sub(r"<[^>]+>", "", m.group(4))))
    return entries
toc = collect(body_html)

# Make cross-references clickable: §4.3 → #s4, "Appendix C" → #appC.
body_html = re.sub(r"§(\d+)((?:\.\d+)?)", r'<a href="#s\1">§\1\2</a>', body_html)
body_html = re.sub(r"Appendix ([A-F])(?![.\w])", r'<a href="#app\1">Appendix \1</a>', body_html)

def toc_html(pages):
    rows = []
    for kind, hid, title in toc:
        pg = pages.get(hid, "00")
        cls = "toc-part" if kind == "part" else "toc-sec"
        rows.append(f'<a class="{cls}" href="#{hid}"><span class="t">{html.escape(html.unescape(title))}</span><span class="dots"></span><span class="p">{pg}</span></a>')
    return '<nav class="toc"><h2 class="toc-title">Contents</h2>' + "".join(rows) + "</nav>"

CSS = (WORK / "style.css").read_text()

def page(inner, extra_class=""):
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>ZimERP Master Plan</title><style>{CSS}</style></head>
<body class="{extra_class}">{inner}</body></html>"""

intro = """<section class="intro">
<p class="lede">This plan brings every ZimERP decision into one place: the market, the product and how its parts connect, the technology, and how the business makes money, finds customers and supports them.</p>
<div class="howto">
<div><b>Part I · Strategy</b><span>Why ZimERP, who it competes with, what it is.</span></div>
<div><b>Part II · Product</b><span>How everything connects, modules, Zimbabwe features, payments, websites, apps, email and the release plan.</span></div>
<div><b>Part III · Technology</b><span>Architecture, hosting, security and quality.</span></div>
<div><b>Part IV · Business</b><span>Pricing, marketing, support, team, legal, finance, risks and metrics.</span></div>
</div>
<p class="note">Section references such as §4.3 are links. Figures marked as estimates must be confirmed with real quotes and pilot feedback.</p>
</section>"""

def render(html_str, pdf_path, footer=True):
    hp = WORK / ("_render_" + pdf_path.stem + ".html")
    hp.write_text(html_str)
    subprocess.run(["node", str(WORK / "render.mjs"), str(hp), str(pdf_path), "1" if footer else "0"], check=True)

def body(pages):
    return page(toc_html(pages) + intro + '<main>' + body_html + '</main>')

# Pass 1
p1 = WORK / "pass1.pdf"
render(body({}), p1)

def norm(s):
    return re.sub(r"\s+", " ", s).strip().lower()

pages = {}
with pdfplumber.open(str(p1)) as pdf:
    texts = [norm(pg.extract_text() or "") for pg in pdf.pages]
toc_pages = 2  # contents occupy the first pages; skip them when searching
for kind, hid, title in toc:
    needle = norm(html.unescape(title))
    for i, t in enumerate(texts):
        if i < toc_pages:
            continue
        if needle in t:
            pages[hid] = str(i + 1)
            break
missing = [t for k, h, t in toc if h not in pages]
if missing:
    print("WARN headings not found:", missing, file=sys.stderr)

# Pass 2
body_pdf = WORK / "body.pdf"
render(body(pages), body_pdf)

# Cover (no footer)
cover_html = page((WORK / "cover.html").read_text(), "cover-page")
cover_pdf = WORK / "cover.pdf"
render(cover_html, cover_pdf, footer=False)

w = PdfWriter()
for f in (cover_pdf, body_pdf):
    for pg in PdfReader(str(f)).pages:
        w.add_page(pg)
w.add_metadata({"/Title": "ZimERP Master Plan", "/Author": "ZimERP", "/Subject": "Consolidated product, technology and business plan"})
with open(OUT, "wb") as fh:
    w.write(fh)
print("pages:", len(PdfReader(str(OUT)).pages), "toc entries:", len(toc), "found:", len(pages))
