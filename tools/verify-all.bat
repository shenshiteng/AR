@echo off
chcp 936 >nul
setlocal
rem =========================================================================
rem  tools\verify-all.bat  --  one-click full verification
rem  Run this after taking over the project, or after any change,
rem  to confirm nothing is broken.
rem
rem  Steps:
rem    1. derive 2F/5F floor data from 3F
rem    2. corridor-network connectivity + room reachability (2F/3F/5F)
rem    3. pack single-file 3D page (nav3d\index.html)
rem    4. doors / edges / cross-floor reachability (verify_floors.js)
rem    5. 12 QR location entry points (check_locations.js)
rem    6. page smoke test (smoke.js)
rem    7. cross-floor navigation in the 3D sandbox (nav3d\tools\check_cross.js)
rem
rem  Any failure prints FAIL and stops. Read that step output to debug.
rem =========================================================================

cd /d "%~dp0.."
set PYTHONIOENCODING=utf-8
set NODE_EXE=node
where node >nul 2>nul
if errorlevel 1 set NODE_EXE=%ProgramFiles%\nodejs\node.exe

echo.
echo ==== 1/7  generate 2F / 5F floor data ====
python nav3d\tools\gen_floors.py
if errorlevel 1 goto fail

echo.
echo ==== 2/7  network connectivity 2F / 3F / 5F ====
pushd nav3d
python tools\check_grid.py 3F
if errorlevel 1 goto fail_pop
python tools\check_grid.py 2F
if errorlevel 1 goto fail_pop
python tools\check_grid.py 5F
if errorlevel 1 goto fail_pop
popd

echo.
echo ==== 3/7  pack nav3d\index.html ====
python nav3d\tools\build_single.py
if errorlevel 1 goto fail

echo.
echo ==== 4/7  doors / edges / cross-floor reachability ====
"%NODE_EXE%" tools\verify_floors.js
if errorlevel 1 goto fail

echo.
echo ==== 5/7  QR location entry points ====
"%NODE_EXE%" tools\check_locations.js
if errorlevel 1 goto fail

echo.
echo ==== 6/7  page smoke test ====
"%NODE_EXE%" tools\smoke.js
if errorlevel 1 goto fail

echo.
echo ==== 7/7  cross-floor navigation in 3D sandbox ====
"%NODE_EXE%" nav3d\tools\check_cross.js
if errorlevel 1 goto fail

echo.
echo ==========================================================
echo   PASS - data, 3D page, routing, locating, pages, cross-floor all OK
echo ==========================================================
exit /b 0

:fail_pop
popd
:fail
echo.
echo ==========================================================
echo   FAIL - see the error output above this line
echo ==========================================================
exit /b 1
