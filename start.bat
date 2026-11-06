@echo off
echo Starting CannaFool...

:: Get current IP address
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address"') do (
    set IP=%%a
    goto :found
)
:found
set IP=%IP: =%

echo Your IP is: %IP%

:: Update App.js with current IP
powershell -Command "(Get-Content 'C:\Users\Micha\OneDrive\Desktop\CannaFool\cf54\App.js') -replace 'http://[0-9.]+:8001', 'http://%IP%:8001' | Set-Content 'C:\Users\Micha\OneDrive\Desktop\CannaFool\cf54\App.js'"
copy /Y "C:\Users\Micha\OneDrive\Desktop\CannaFool\cf54\App.js" "C:\Projects\cf54\App.js"

echo IP updated in App.js

:: Start backend in new window
start "CannaFool Backend" cmd /k "cd C:\Users\Micha\OneDrive\Desktop\CannaFool\backend && uvicorn main:app --host 0.0.0.0 --port 8001 --reload"

:: Wait for backend to start
timeout /t 3 /nobreak

:: Start Expo in new window
start "CannaFool Expo" cmd /k "cd C:\Projects\cf54 && npx expo start --clear --go"

echo Done! Scan the QR code in the Expo window with Expo Go.