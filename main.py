import io
import re
import json as json_lib
import httpx
import pdfplumber
from docx import Document
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl
from typing import Optional

SUPABASE_URL = "https://uijmqieglkryrkhszimg.supabase.co"
SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVpam1xaWVnbGtyeXJraHN6aW1nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwMjQ0MDMsImV4cCI6MjEwNzYwMDQwM30.eyeZzr-2f_ZpIf9Zos_-9Vylei0jhEdpO5d1kRdTg6k"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVpam1xaWVnbGtyeXJraHN6aW1nIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjAyNDQwMywiZXhwIjoyMTA3NjAwNDAzfQ.yVetcc3xQLlGz7fDN0_d_E8T0dN2WMCzS24mvunOEZY"

async def save_review_to_supabase(data: dict):
    """Save a user review to Supabase REVIEWS table."""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{SUPABASE_URL}/rest/v1/REVIEWS",
                json=data,
                headers={
                    "apikey": SUPABASE_KEY,
                    "Authorization": f"Bearer {SUPABASE_KEY}",
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal",
                },
            )
        print(f"[SUPABASE] saved review, status={resp.status_code}, body={resp.text}")
    except Exception as e:
        print(f"[SUPABASE] review save failed: {e}")

async def get_reviews_from_supabase(strain: str, cultivator: str) -> list:
    """Fetch reviews for a strain/cultivator from Supabase."""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{SUPABASE_URL}/rest/v1/REVIEWS",
                params={"strain": f"eq.{strain}", "cultivator": f"eq.{cultivator}", "order": "created_at.desc", "limit": "20", "select": "*"},
                headers={
                    "apikey": SUPABASE_KEY,
                    "Authorization": f"Bearer {SUPABASE_KEY}",
                },
            )
        print(f"[REVIEWS] fetch status={resp.status_code} body={resp.text[:1000]}")
        return resp.json() if resp.status_code == 200 else []
    except Exception as e:
        print(f"[SUPABASE] fetch reviews failed: {e}")
        return []

async def save_scan_to_supabase(data: dict, user_id: str = None):
    """Save a scan result to Supabase. Fires and doesn't block the response."""
    try:
        row = {
            "strain":         data.get("product_name"),
            "cultivator":     data.get("cultivator"),
            "batch_number":   data.get("batch_number"),
            "lab_name":       data.get("lab_name"),
            "thc":            data.get("thc"),
            "cbd":            data.get("cbd"),
            "total_terpenes": data.get("total_terpenes"),
            "terpenes":       data.get("terpenes", []),
            "pesticides":     (data.get("pesticides") or {}).get("status"),
            "microbials":     (data.get("microbials") or {}).get("status"),
            "mycotoxins":     (data.get("mycotoxins") or {}).get("status"),
            "moisture":       data.get("moisture"),
            "water_activity": data.get("water_activity"),
            "user_id":        user_id,
        }
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{SUPABASE_URL}/rest/v1/SCANS",
                json=row,
                headers={
                    "apikey": SUPABASE_KEY,
                    "Authorization": f"Bearer {SUPABASE_KEY}",
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal",
                },
            )
        print(f"[SUPABASE] saved scan, status={resp.status_code}, body={resp.text}")
    except Exception as e:
        print(f"[SUPABASE] save failed: {e}")

app = FastAPI(title="CannaFool API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

MOBILE_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
BACKEND_IP = "10.20.32.187"


# ── Models ────────────────────────────────────────────────────────────────────

class COARequest(BaseModel):
    url: HttpUrl
    user_id: Optional[str] = None

class ReviewRequest(BaseModel):
    strain: Optional[str] = None
    cultivator: Optional[str] = None
    batch_number: Optional[str] = None
    device_id: str
    aroma: Optional[int] = None
    taste: Optional[int] = None
    bag_appeal: Optional[int] = None
    moisture_cure: Optional[int] = None
    effects: Optional[int] = None
    overall: Optional[int] = None
    comment: Optional[str] = None
    bag_appeal_photo: Optional[str] = None


class Terpene(BaseModel):
    name: str
    percentage: Optional[float] = None


class HeavyMetal(BaseModel):
    name: str
    result: str  # "ND", numeric value, or "Passed"
    status: str  # "Passed" or "Failed"


class TestSection(BaseModel):
    status: str  # "Pass", "Fail", "Not Tested"


class COAResponse(BaseModel):
    product_name: Optional[str] = None
    cultivator: Optional[str] = None
    lab_name: Optional[str] = None
    batch_number: Optional[str] = None
    thc: Optional[float] = None
    cbd: Optional[float] = None
    terpenes: list[Terpene] = []
    total_terpenes: Optional[float] = None
    heavy_metals: list[HeavyMetal] = []
    pesticides: Optional[TestSection] = None
    microbials: Optional[TestSection] = None
    mycotoxins: Optional[TestSection] = None
    moisture: Optional[str] = None
    water_activity: Optional[str] = None


# ── PDF helpers ───────────────────────────────────────────────────────────────

def extract_text_from_pdf(data: bytes) -> str:
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        pages = [page.extract_text() or "" for page in pdf.pages]
    return "\n".join(pages)


def extract_terpenes_from_pdf(data: bytes) -> list:
    """Parse terpene section from COA PDF. Format: Name | LOQ(%) | Result(mg/g) | Result(%)"""
    terpenes = []
    try:
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            full_text = "\n".join(page.extract_text() or "" for page in pdf.pages)

        # Find terpene section between GCMS header and NOTES
        section_match = re.search(
            r'by GCMS.*?%\s+mg/g\s+%\s+%\s+mg/g\s+%\s*\n(.*?)(?:NOTES|See COA|$)',
            full_text, re.DOTALL | re.IGNORECASE
        )
        if not section_match:
            section_match = re.search(
                r'Terpenes\s*\nby GCMS(.*?)(?:NOTES|$)',
                full_text, re.DOTALL | re.IGNORECASE
            )

        if section_match:
            section = section_match.group(1)
            skip = {'analyte', 'result', 'loq', 'page', 'gcms', 'hplc', 'total', 'notes', 'date'}
            entry_pat = re.compile(
                r'([A-Za-z][A-Za-z0-9 \-+()/]*?)[ \t]+((?:\d+\.\d+[ \t]+){1,2})(\d+\.\d+)'
            )
            for line in section.splitlines():
                # Remove "ND" tokens from line before parsing
                clean_line = re.sub(r'\bND\b', '', line)
                for m in entry_pat.finditer(clean_line):
                    name = m.group(1).strip()
                    name = re.sub(r'[\s\d.]+$', '', name).strip()
                    pct = float(m.group(3))
                    if any(w in name.lower() for w in skip) or len(name) < 3:
                        continue
                    if 0.001 <= pct <= 5:
                        terpenes.append({"name": name, "percentage": round(pct, 4)})

    except Exception as e:
        print(f"[TERPENE] error: {e}")

    terpenes = sorted(terpenes, key=lambda t: t["percentage"], reverse=True)
    print(f"[TERPENE TABLE] found {len(terpenes)}: {terpenes[:5]}")
    return terpenes


def extract_text_from_docx(data: bytes) -> str:
    doc = Document(io.BytesIO(data))
    return "\n".join(p.text for p in doc.paragraphs if p.text.strip())


def extract_coa_values(text: str) -> dict:
    """Parse Ohio-regulated COA PDF text."""

    def find(pattern, default=None):
        m = re.search(pattern, text, re.IGNORECASE)
        return m.group(1).strip() if m else default

    # ── Core fields ───────────────────────────────────────────────────────────
    strain    = find(r"Strain:\s*(.+)")
    cultivator = find(r"Prepared For:\s*(.+)")
    batch     = find(r"METRC Batch:\s*(\S+)")
    thc_str   = find(r"Total THC[:\s]+([\d.]+)\s*%")
    cbd_str   = find(r"Total CBD[:\s]+([\d.]+)\s*%")
    thc       = float(thc_str) if thc_str else None
    cbd       = float(cbd_str) if cbd_str else None
    lab_name  = find(r"^(.+?(?:Lab(?:oratories?)?|Testing|Analytics).+?)$")
    # Moisture & Water Activity appear as "Moisture Water Activity\n11.2% 0.54 aw"
    # Print full text to find moisture
    print(f"[FULL TEXT] {text!r}")
    # Format: "9.22% 0.50 aw\nMicrobials Moisture Water Activity"
    mw = re.search(r"([\d.]+)\s*%\s+([\d.]+)\s*aw\s*\n\S.*?Moisture.*?Water Activity", text, re.IGNORECASE)
    moisture  = mw.group(1) if mw else None
    water_act = mw.group(2) if mw else None
    print(f"[MOISTURE] moisture={moisture!r} water_activity={water_act!r}")

    # ── Terpenes ──────────────────────────────────────────────────────────────
    CANNABINOID_WORDS = {"thc", "cbd", "cbg", "cbn", "cbc", "cbdv", "thcv", "thca", "cbda",
                         "delta", "total", "analyte", "loq", "cannabinoid", "result", "limit"}
    terpene_section = re.search(r"Terpene.*?(?=Heavy Metals|Pesticide|Microbial|Mycotoxin|$)", text, re.DOTALL | re.IGNORECASE)
    print(f"[TERPENE] section found: {bool(terpene_section)}")
    if terpene_section:
        print(f"[TERPENE] text snippet: {terpene_section.group()[:300]!r}")
    terpenes = []
    if terpene_section:
        for line in terpene_section.group().splitlines():
            m = re.match(
                r"^\s*([A-Za-z][\w\s\-()+]+?)\s+(?:[\d.]+\s+)+([\d.]+)\s*$",
                line,
            )
            if m:
                name = m.group(1).strip()
                pct  = float(m.group(2))
                # Skip cannabinoid rows and header rows
                if any(w in name.lower() for w in CANNABINOID_WORDS):
                    continue
                if pct >= 0.001:
                    terpenes.append({"name": name, "percentage": pct})

    # ── Heavy Metals ──────────────────────────────────────────────────────────
    heavy_metals = []
    metals_section = re.search(
        r"Heavy Metals\s*\nby\s+\w+(.*?)(?=NOTES|Page \d)",
        text, re.DOTALL | re.IGNORECASE
    )
    print(f"[METALS] section found: {bool(metals_section)}")
    if metals_section:
        print(f"[METALS] snippet: {metals_section.group()[:300]!r}")
        for line in metals_section.group().splitlines():
            m = re.match(
                r"^\s*(Arsenic|Cadmium|Lead|Mercury)(?:\s*\([^)]+\))?"
                r"\s+[\d.]+\s+[\d.]+\s+(\S+)\s+(Pass(?:ed)?|Fail(?:ed)?|ND)",
                line, re.IGNORECASE
            )
            if m:
                status_raw = m.group(3).lower()
                heavy_metals.append({
                    "name":   m.group(1),
                    "result": m.group(2),
                    "status": "Passed" if status_raw.startswith("pass") else "Failed",
                })
    print(f"[METALS] found {len(heavy_metals)}: {heavy_metals}")

    # ── Pesticides ────────────────────────────────────────────────────────────
    pesticides = None
    if re.search(r"Pesticides", text, re.IGNORECASE):
        failed = bool(re.search(r"Pesticides.*?Failed", text, re.DOTALL | re.IGNORECASE))
        not_tested = bool(re.search(r"Not Tested\s*\n\s*Pesticides", text, re.IGNORECASE))
        pesticides = {"status": "Not Tested" if not_tested else ("Fail" if failed else "Pass")}

    # ── Microbials ────────────────────────────────────────────────────────────
    microbials = None
    if re.search(r"Microbials", text, re.IGNORECASE):
        failed = bool(re.search(r"Microbials.*?Failed", text, re.DOTALL | re.IGNORECASE))
        not_tested = bool(re.search(r"Not Tested\s*\n\s*Microbials", text, re.IGNORECASE))
        microbials = {"status": "Not Tested" if not_tested else ("Fail" if failed else "Pass")}

    # ── Mycotoxins ────────────────────────────────────────────────────────────
    mycotoxins = None
    if re.search(r"Mycotoxins", text, re.IGNORECASE):
        failed = bool(re.search(r"Mycotoxins.*?Failed", text, re.DOTALL | re.IGNORECASE))
        not_tested = bool(re.search(r"Not Tested\s*\n\s*Mycotoxins", text, re.IGNORECASE))
        mycotoxins = {"status": "Not Tested" if not_tested else ("Fail" if failed else "Pass")}

    return {
        "product_name": strain,
        "cultivator":   cultivator,
        "lab_name":     lab_name,
        "batch_number": batch,
        "thc":          thc,
        "cbd":          cbd,
        "terpenes":     terpenes,
        "heavy_metals": heavy_metals,
        "pesticides":   pesticides,
        "microbials":   microbials,
        "mycotoxins":   mycotoxins,
        "moisture":     moisture,
        "water_activity": water_act,
    }


# ── 1A4 platform ──────────────────────────────────────────────────────────────

async def parse_1a4_landing(url: str, client: httpx.AsyncClient) -> dict:
    """Call the 1A4 API, then download and parse the full PDF for complete data."""
    # Follow short URL redirect (e.g. https://1a4.com/XXXX -> https://app.1a4.com/landingpage/...)
    if "app.1a4.com" not in url:
        resp = await client.get(url, headers={"User-Agent": MOBILE_UA})
        url = str(resp.url)
        print(f"[1A4] redirected to: {url!r}")

    parts = url.rstrip("/").split("/")
    package_id = parts[-2]
    index      = parts[-1]
    api_url    = f"https://app.1a4.com/api/landingpage/data?id={package_id}&index={index}"

    resp = await client.get(api_url, headers={"User-Agent": MOBILE_UA})
    resp.raise_for_status()
    payload = resp.json()

    # Parse nested coaCard.data JSON
    coa_raw = payload.get("coaCard", {}).get("data", "{}")
    coa     = json_lib.loads(coa_raw) if isinstance(coa_raw, str) else coa_raw

    strain   = coa.get("strainName") or coa.get("strain")
    batch    = coa.get("batchTag") or coa.get("lotNumber")
    lab_name = (coa.get("lab") or {}).get("name")
    # Try multiple field paths for THC/CBD
    thc = (
        (coa.get("totals") or {}).get("thc", {}).get("percent") or
        (coa.get("ingredients") or {}).get("totalThc", {}).get("percent") or
        (coa.get("unit") or {}).get("thc", {}).get("percent")
    )
    cbd = (
        (coa.get("totals") or {}).get("cbd", {}).get("percent") or
        (coa.get("ingredients") or {}).get("totalCbd", {}).get("percent") or
        (coa.get("unit") or {}).get("cbd", {}).get("percent")
    )

    # Extract terpenes from 1A4 JSON
    json_terpenes = []
    raw_terps = coa.get("terpenes") or {}
    print(f"[1A4] raw terpenes from JSON: {raw_terps!r}")
    if isinstance(raw_terps, dict):
        for key, val in raw_terps.items():
            if isinstance(val, dict):
                pct = val.get("percent") or val.get("percentage") or val.get("value")
            else:
                pct = val
            try:
                pct = float(pct)
                if pct >= 0.001:
                    json_terpenes.append({"name": key.replace("_", " ").title(), "percentage": pct})
            except (TypeError, ValueError):
                pass
    elif isinstance(raw_terps, list):
        for t in raw_terps:
            name = t.get("name") or t.get("analyte", "")
            pct = t.get("percent") or t.get("percentage") or t.get("value")
            try:
                pct = float(pct)
                if name and pct >= 0.001:
                    json_terpenes.append({"name": name, "percentage": pct})
            except (TypeError, ValueError):
                pass

    print(f"[1A4] strain={strain!r} batch={batch!r} thc={thc!r} cbd={cbd!r} lab={lab_name!r} terpenes={len(json_terpenes)}")

    # Download and parse the PDF for full test data
    pdf_url = (payload.get("coaCard", {}).get("fileLink") or [None])[0]
    print(f"[1A4] pdf_url={pdf_url!r}")
    pdf_values = {}
    if pdf_url:
        try:
            pdf_resp = await client.get(pdf_url, headers={"User-Agent": MOBILE_UA})
            pdf_resp.raise_for_status()
            text = extract_text_from_pdf(pdf_resp.content)
            pdf_values = extract_coa_values(text)
            # Use table extraction for terpenes (more reliable than text parsing)
            table_terpenes = extract_terpenes_from_pdf(pdf_resp.content)
            if table_terpenes:
                pdf_values["terpenes"] = table_terpenes
            print(f"[PDF] parsed: thc={pdf_values.get('thc')} terpenes={len(pdf_values.get('terpenes',[]))}")
        except Exception as e:
            print(f"[PDF] failed: {e}")

    # Terpenes: prefer JSON, fall back to PDF table extraction
    terpenes = json_terpenes or pdf_values.get("terpenes", [])

    result = {
        "product_name":   strain or pdf_values.get("product_name"),
        "cultivator":     pdf_values.get("cultivator"),
        "lab_name":       lab_name or pdf_values.get("lab_name"),
        "batch_number":   batch or pdf_values.get("batch_number"),
        "thc":            float(thc) if thc is not None else pdf_values.get("thc"),
        "cbd":            float(cbd) if cbd is not None else pdf_values.get("cbd"),
        "terpenes":       terpenes,
        "total_terpenes": round(sum(t["percentage"] for t in terpenes), 3) if terpenes else None,
        "heavy_metals":   pdf_values.get("heavy_metals", []),
        "pesticides":     pdf_values.get("pesticides"),
        "microbials":     pdf_values.get("microbials"),
        "mycotoxins":     pdf_values.get("mycotoxins"),
        "moisture":       pdf_values.get("moisture"),
        "water_activity": pdf_values.get("water_activity"),
    }
    print(f"[RESULT] {result}")
    return result


# ── Confident LIMS platform ───────────────────────────────────────────────────

async def parse_confident_lims(url: str, client: httpx.AsyncClient) -> dict:
    """Parse COA from Confident LIMS share URL."""
    # Extract UUID from URL
    uuid = url.rstrip("/").split("/")[-1]
    print(f"[CONFIDENT] uuid={uuid!r}")

    # Fetch the share page for meta tags
    resp = await client.get(url, headers={"User-Agent": MOBILE_UA})
    html = resp.text

    # Parse og:description for THC/CBD/Safety: "THC: 17.8% CBD: 0.1% Safety: Pass."
    thc, cbd = None, None
    safety_pass = None
    desc_m = re.search(r'og:description.*?content="([^"]+)"', html)
    if not desc_m:
        desc_m = re.search(r'name="description".*?content="([^"]+)"', html)
    if desc_m:
        desc = desc_m.group(1)
        thc_m = re.search(r'THC:\s*([\d.]+)%', desc)
        cbd_m = re.search(r'CBD:\s*([\d.]+)%', desc)
        safe_m = re.search(r'Safety:\s*(\w+)', desc)
        thc = float(thc_m.group(1)) if thc_m else None
        cbd = float(cbd_m.group(1)) if cbd_m else None
        safety_pass = safe_m.group(1) if safe_m else None

    # Parse og:title for product/cultivator: "METRC: Flower-StrainName by Cultivator"
    product_name, cultivator = None, None
    title_m = re.search(r'og:title.*?content="([^"]+)"', html)
    if title_m:
        title = title_m.group(1)
        # Format 1: "ID: Strain Flower by Cultivator"
        by_m = re.search(r':\s*(.+?)\s+(?:Flower|Concentrate|Edible|Vape|Pre-Roll|Infused|Extract)\s+by\s+(.+)', title, re.IGNORECASE)
        if by_m:
            product_name = by_m.group(1).strip()
            cultivator = by_m.group(2).strip()
        else:
            # Format 2: "Flower-StrainName by Cultivator"
            by_m = re.search(r'Flower-(.+?) by (.+)', title)
            if by_m:
                product_name = by_m.group(1).strip()
                cultivator = by_m.group(2).strip()
            else:
                # Fallback: anything " by Cultivator"
                by_m = re.search(r'(.+?) by (.+)', title)
                if by_m:
                    product_name = by_m.group(1).strip()
                    cultivator = by_m.group(2).strip()

    # Try to find PDF link in HTML
    pdf_url = None
    pdf_m = re.search(r'(https://[^\s"\']+\.pdf[^\s"\']*)', html)
    if pdf_m:
        pdf_url = pdf_m.group(1)

    # Extract sample ID from og:image CDN URL (e.g. /samples/2606NCTL2568.22116/images/...)
    sample_id = None
    img_m = re.search(r'confident[^"\']+/samples/([^/]+)/', html)
    if img_m:
        sample_id = img_m.group(1)
        print(f"[CONFIDENT] sample_id={sample_id!r}")

    # Also try common Confident LIMS PDF patterns
    if not pdf_url:
        patterns = [
            f"https://app.confidentlims.com/report/public/sample/{uuid}.pdf",
            f"https://share.confidentlims.com/samples/public/share/{uuid}/download",
        ]
        if sample_id:
            patterns += [
                f"https://confident-lims-production.b-cdn.net/samples/{sample_id}/coa.pdf",
                f"https://confident-lims-production.b-cdn.net/samples/{sample_id}/report.pdf",
                f"https://confident-lims-production.b-cdn.net/samples/{sample_id}/certificate.pdf",
                f"https://confident-lims-production.b-cdn.net/samples/{sample_id}/{sample_id}.pdf",
                f"https://app.confidentlims.com/report/public/sample/{sample_id}.pdf",
            ]
        referer_headers = {
            "User-Agent": MOBILE_UA,
            "Referer": url,
            "Origin": "https://share.confidentlims.com",
        }
        for pattern in patterns:
            try:
                r = await client.head(pattern, headers=referer_headers)
                print(f"[CONFIDENT PDF PROBE] {r.status_code} {pattern}")
                if r.status_code in (200, 302):
                    pdf_url = pattern
                    break
            except Exception as e:
                print(f"[CONFIDENT PDF PROBE] error {pattern}: {e}")

    # Try Confident LIMS JSON API for terpenes
    confident_terpenes = []
    if not confident_terpenes and uuid:
        api_patterns = [
            f"https://app.confidentlims.com/api/v1/samples/public/{uuid}",
            f"https://app.confidentlims.com/api/v2/samples/public/{uuid}",
            f"https://share.confidentlims.com/api/samples/public/share/{uuid}",
        ]
        for api_url in api_patterns:
            try:
                r = await client.get(api_url, headers={"User-Agent": MOBILE_UA, "Accept": "application/json", "Referer": url})
                print(f"[CONFIDENT API] {r.status_code} {api_url} body={r.text[:300]}")
                if r.status_code == 200:
                    try:
                        data = r.json()
                        # Look for terpenes in common response shapes
                        for key in ("terpenes", "terpenoids", "results"):
                            val = data.get(key)
                            if isinstance(val, list) and val:
                                confident_terpenes = [{"name": t.get("name",""), "percentage": t.get("percentage") or t.get("result") or t.get("value")} for t in val if t.get("name")]
                                break
                        if confident_terpenes:
                            break
                    except Exception:
                        pass
            except Exception as e:
                print(f"[CONFIDENT API] error {api_url}: {e}")

    print(f"[CONFIDENT] product={product_name!r} cultivator={cultivator!r} thc={thc} cbd={cbd} safety={safety_pass} pdf={pdf_url!r}")

    # Parse PDF if found
    pdf_values = {}
    if pdf_url:
        try:
            pdf_resp = await client.get(pdf_url, headers={"User-Agent": MOBILE_UA})
            pdf_resp.raise_for_status()
            text = extract_text_from_pdf(pdf_resp.content)
            pdf_values = extract_coa_values(text)
            table_terpenes = extract_terpenes_from_pdf(pdf_resp.content)
            if table_terpenes:
                pdf_values["terpenes"] = table_terpenes
            print(f"[CONFIDENT PDF] thc={pdf_values.get('thc')} terpenes={len(pdf_values.get('terpenes', []))}")
        except Exception as e:
            print(f"[CONFIDENT PDF] failed: {e}")

    terpenes = pdf_values.get("terpenes", []) or confident_terpenes
    safety = {"status": safety_pass} if safety_pass else None

    return {
        "product_name":   product_name or pdf_values.get("product_name"),
        "cultivator":     cultivator or pdf_values.get("cultivator"),
        "lab_name":       pdf_values.get("lab_name"),
        "batch_number":   pdf_values.get("batch_number"),
        "thc":            thc or pdf_values.get("thc"),
        "cbd":            cbd or pdf_values.get("cbd"),
        "terpenes":       terpenes,
        "total_terpenes": round(sum(t["percentage"] for t in terpenes), 3) if terpenes else None,
        "heavy_metals":   pdf_values.get("heavy_metals", []),
        "pesticides":     pdf_values.get("pesticides") or safety,
        "microbials":     pdf_values.get("microbials") or safety,
        "mycotoxins":     pdf_values.get("mycotoxins") or safety,
        "moisture":       pdf_values.get("moisture"),
        "water_activity": pdf_values.get("water_activity"),
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@app.post("/parse-coa", response_model=COAResponse)
async def parse_coa(req: COARequest):
    url = str(req.url)
    print(f"[PARSE-COA] received url={url!r}")

    # 1A4 platform
    if "1a4.com" in url:
        try:
            async with httpx.AsyncClient(follow_redirects=True, timeout=30) as http:
                values = await parse_1a4_landing(url, http)
            await save_scan_to_supabase(values, user_id=req.user_id)
            return COAResponse(**values)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"1A4 API error: {e}")

    # Confident LIMS platform
    if "confidentlims.com" in url:
        try:
            async with httpx.AsyncClient(follow_redirects=True, timeout=30) as http:
                values = await parse_confident_lims(url, http)
            await save_scan_to_supabase(values, user_id=req.user_id)
            return COAResponse(**values)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Confident LIMS error: {e}")

    # Direct PDF / DOCX
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=30) as http:
            resp = await http.get(url, headers={"User-Agent": MOBILE_UA})
            resp.raise_for_status()
            data         = resp.content
            content_type = resp.headers.get("content-type", "")
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"Could not fetch document: {e}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))

    if "pdf" in content_type or url.lower().endswith(".pdf") or "blob.core.windows.net" in url:
        text = extract_text_from_pdf(data)
    elif "word" in content_type or "docx" in content_type or url.lower().endswith(".docx"):
        text = extract_text_from_docx(data)
    else:
        raise HTTPException(status_code=415, detail=f"Unsupported document type: {content_type}.")

    if not text.strip():
        raise HTTPException(status_code=422, detail="Could not extract text from document.")

    try:
        values = extract_coa_values(text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Extraction failed: {e}")

    await save_scan_to_supabase(values, user_id=req.user_id)
    return COAResponse(**values)


@app.post("/submit-review")
async def submit_review(req: ReviewRequest):
    await save_review_to_supabase(req.dict())
    return {"status": "ok"}

@app.get("/get-reviews")
async def get_reviews(strain: str, cultivator: str):
    reviews = await get_reviews_from_supabase(strain, cultivator)
    return reviews

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/debug-parse")
async def debug_parse(url: str):
    """Run the full COA parse and return the result."""
    async with httpx.AsyncClient(follow_redirects=True, timeout=30) as http:
        values = await parse_1a4_landing(url, http)
    return values


@app.get("/debug-1a4")
async def debug_1a4(url: str):
    """Return raw 1A4 API response for debugging."""
    parts = url.rstrip("/").split("/")
    package_id = parts[-2]
    index = parts[-1]
    api_url = f"https://app.1a4.com/api/landingpage/data?id={package_id}&index={index}"
    async with httpx.AsyncClient(follow_redirects=True, timeout=30) as http:
        resp = await http.get(api_url, headers={"User-Agent": MOBILE_UA})
        return resp.json()
