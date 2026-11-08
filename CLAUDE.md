# CannaFool Project Instructions

## App Overview
Building a React Native (Expo SDK 58) app that scans QR codes linking to Cannabis COAs (Certificates of Analysis), parses lab results, and lets users review products and upload photos/videos.

- **Frontend**: `C:\Users\Micha\OneDrive\Desktop\CannaFool\cf54\App.js` (single file)
- **Backend**: `C:\Users\Micha\OneDrive\Desktop\CannaFool\backend\main.py` (FastAPI on Render)
- **Build source**: `C:\cf54\App.js` (copy from cf54 folder before EAS build)
- **GitHub**: https://github.com/CannaFool216/cannafool-backend (branch: master, root dir: backend)
- **Backend URL**: https://cannafool-backend.onrender.com
- **Supabase tables**: SCANS, REVIEWS, COMMENTS

## Behavior Rules

### Commands
- Always use **Command Prompt** syntax. Never suggest PowerShell unless it is the absolute only way.
- Always provide **full, ready-to-copy commands** with all values filled in — never make the user ask for them or fill in placeholders themselves.
- When pushing to GitHub, always provide all git commands in sequence.

### Testing
- When testing backend endpoints, always provide the full `fetch()` console command with the URL already filled in, without waiting to be asked.
- Provide one command per link being tested — never make the user swap URLs manually.

### General
- Be proactive — if a fix is made, immediately provide the commands to deploy it without waiting to be asked.
- Don't suggest steps the user has to look up or figure out; spell everything out.
