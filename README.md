# CannaFool

QR code COA scanner app — scan a product QR code, get THC, CBD, terpenes, and batch info instantly.

---

## Project Structure

```
cannafool-app/   ← Expo (React Native) mobile app
backend/         ← Python FastAPI server
```

---

## Quick Start

### Backend

```bash
cd backend
pip install -r requirements.txt

# Copy and fill in your API key
cp .env.example .env

# Run the server
ANTHROPIC_API_KEY=your_key_here uvicorn main:app --reload
```

Server runs at http://localhost:8000

### Mobile App

```bash
cd cannafool-app
npm install
npx expo start
```

Scan the QR code in your terminal with the **Expo Go** app (iOS or Android).

> **Before running:** update `src/services/api.js` with your backend URL.
> - Local dev on a real device: use your computer's local IP (e.g. `http://192.168.1.x:8000`)
> - Deployed: use your Railway/Render URL

---

## Environment Variables

| Variable | Where | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | backend `.env` | Your Anthropic API key — get one at console.anthropic.com |

---

## How It Works

1. User scans a QR code on cannabis packaging
2. App sends the URL to the FastAPI backend
3. Backend fetches the PDF or DOCX from that URL
4. Text is extracted and sent to Claude for parsing
5. Structured values (THC, CBD, terpenes, batch #) returned to the app
6. App displays results in a clean card UI
