"""Calibra MB/hora real con ffprobe sobre Courses/ y detecta mp4 truncados."""
import json
import shutil
import subprocess
from pathlib import Path

SDIR = Path(__file__).resolve().parent
ROOT = SDIR.parent
COURSES = ROOT / "Courses"
OUT = SDIR / "calibracion_ratio.json"

ffprobe = shutil.which("ffprobe")
print(f"ffprobe: {ffprobe}")

rows = []
bad = []
total_mb = 0.0
total_h = 0.0
if COURSES.exists() and ffprobe:
    for d in sorted([p for p in COURSES.iterdir() if p.is_dir()]):
        files = [f for f in d.rglob("*") if f.is_file()]
        mb = sum(f.stat().st_size for f in files) / 1e6
        secs = 0.0
        n = 0
        zeros = [f for f in d.rglob("*.mp4") if f.stat().st_size == 0]
        for f in sorted(d.rglob("*.mp4")):
            n += 1
            try:
                out = subprocess.run(
                    [
                        ffprobe,
                        "-v",
                        "error",
                        "-show_entries",
                        "format=duration",
                        "-of",
                        "csv=p=0",
                        str(f),
                    ],
                    capture_output=True,
                    text=True,
                    timeout=60,
                )
                dur = float((out.stdout or "0").strip().splitlines()[-1]) if out.stdout.strip() else 0.0
            except Exception:  # noqa: BLE001
                dur = 0.0
            if dur <= 1:
                bad.append(str(f.relative_to(ROOT)))
            secs += dur
        for z in zeros:
            bad.append(str(z.relative_to(ROOT)) + " (0 bytes)")
        h = secs / 3600.0
        ratio = round(mb / h) if h > 0.05 else None
        rows.append({"folder": d.name, "mb": round(mb), "classes": n, "hours": round(h, 2), "mb_per_hour": ratio})
        if h > 0.05 and mb > 30:
            total_mb += mb
            total_h += h

weighted = round(total_mb / total_h) if total_h > 0 else None
for r in rows:
    print(f"{r['mb']:6d} MB  {r['classes']:3d} clases  {r['hours']:6.2f} h  -> {r['mb_per_hour']} MB/h   {r['folder']}")
print(f"\nPONDERADO: {total_mb:.0f} MB / {total_h:.2f} h = {weighted} MB/h")
print(f"archivos truncados/sospechosos: {len(bad)}")
for b in bad[:30]:
    print("  ", b)

OUT.write_text(
    json.dumps(
        {"mb_per_hour_weighted": weighted, "folders": rows, "bad": bad},
        ensure_ascii=False,
        indent=2,
    ),
    encoding="utf-8",
)
