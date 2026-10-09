# Master plan PDF build

Regenerates `docs/ZimERP-master-plan.pdf` from `docs/ZimERP-master-plan.md`.

Requirements: Python 3 with `markdown`, `pdfplumber` and `pypdf`; Node.js; a Chromium binary (the script uses `/opt/pw-browsers/chromium`, change `executablePath` in `render.mjs` if yours is elsewhere).

```
cd docs/pdf-build
npm install
pip install markdown pdfplumber pypdf
python3 build.py
```

The build renders twice so the table of contents shows correct page numbers.
