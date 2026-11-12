@echo off
cd /d "%~dp0"
set PORT=8000
echo ==========================================
echo   Lab Navigator - local server
echo   PC:    http://localhost:%PORT%
echo   Phone: http://YOUR-LAN-IP:%PORT%
echo   (run tools/make_qr.py to see the phone URL)
echo   Press Ctrl+C to stop
echo ==========================================
start "" http://localhost:%PORT%
python -m http.server %PORT%
if errorlevel 1 py -m http.server %PORT%
pause
