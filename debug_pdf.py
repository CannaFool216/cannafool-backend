"""
Run this after scanning a QR code to see the raw PDF text.
Usage: python debug_pdf.py <pdf_url>
The PDF URL appears in your backend terminal as [1A4] pdf_url=...
"""
import sys
import httpx
import pdfplumber
import io

UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"

url = sys.argv[1]
print(f"Fetching {url[:80]}...")
data = httpx.get(url, headers={"User-Agent": UA}, follow_redirects=True).content
print(f"Downloaded {len(data)} bytes\n")

with pdfplumber.open(io.BytesIO(data)) as pdf:
    for i, page in enumerate(pdf.pages):
        text = page.extract_text() or ""
        print(f"\n{'='*60}")
        print(f"PAGE {i+1}")
        print('='*60)
        print(repr(text))
