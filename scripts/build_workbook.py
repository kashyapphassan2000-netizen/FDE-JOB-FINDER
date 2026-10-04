"""Extracts EVERY cell of EVERY sheet of the Excel workbook, word for word, into data/workbook.json.
Re-run after editing the Excel:  python scripts/build_workbook.py data/source_workbook.xlsx data/workbook.json"""
import openpyxl, json, sys, datetime
src = sys.argv[1] if len(sys.argv) > 1 else 'data/source_workbook.xlsx'
out = sys.argv[2] if len(sys.argv) > 2 else 'data/workbook.json'
wb = openpyxl.load_workbook(src, data_only=True)

def cell(v):
    if v is None: return ''
    if isinstance(v, float) and v.is_integer(): return str(int(v))
    if isinstance(v, (datetime.date, datetime.datetime)): return v.isoformat()[:10]
    return str(v)

sheets = []
total_rows = total_cells = 0
for ws in wb:
    rows = [[cell(c) for c in r] for r in ws.iter_rows(values_only=True)]
    # trim trailing empty columns / rows
    width = max((max((i + 1 for i, c in enumerate(r) if c.strip()), default=0) for r in rows), default=0)
    rows = [r[:width] for r in rows]
    while rows and not any(c.strip() for c in rows[-1]): rows.pop()
    # header = first row with >= 2 filled cells
    h = next((i for i, r in enumerate(rows) if sum(1 for c in r if c.strip()) >= 2), 0)
    data = []
    for i, r in enumerate(rows[h + 1:], start=h + 1):
        if not any(c.strip() for c in r): continue
        filled = [c for c in r if c.strip()]
        data.append({'i': i, 'cells': r, 'section': len(filled) == 1 and bool(r[0].strip())})
        total_cells += len(filled)
    total_rows += len(data)
    sheets.append({'name': ws.title, 'title': ' '.join(c for r in rows[:h] for c in r if c.strip()), 'header': rows[h] if rows else [], 'rows': data})
json.dump({'source': (sys.argv[3] if len(sys.argv) > 3 else src.split('/')[-1]), 'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'sheets': sheets}, open(out, 'w'), ensure_ascii=False)
print(f'{len(sheets)} sheets, {total_rows} rows, {total_cells} non-empty cells -> {out}')
