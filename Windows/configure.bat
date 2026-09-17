@echo off
setlocal enabledelayedexpansion

echo ===================================================
echo             Script Configuration Utility
echo ===================================================
echo.

:: --- 1. Modify Download Count ---
set /p modify_count="Do you want to modify the Download Count in windows_grabber.js? (Y/N): "
if /i "!modify_count!"=="Y" (
    set /p new_count="Enter target download count: "
    if defined new_count (
        echo Updating windows_grabber.js...
        set "TARGET_COUNT=!new_count!"
        node -e "const fs=require('fs'); let f='windows_grabber.js'; let content=fs.readFileSync(f,'utf8').replace(/const TARGET_DOWNLOAD_COUNT\s*=\s*[^;]*;/, 'const TARGET_DOWNLOAD_COUNT = ' + process.env.TARGET_COUNT + ';'); fs.writeFileSync(f, content);"
        echo [SUCCESS] Download count set to !new_count!.
    ) else (
        echo [SKIPPED] No value entered.
    )
) else (
    echo [SKIPPED] Download count unchanged.
)

echo.
echo ---------------------------------------------------
echo.

:: --- 2. Modify Cookies / Session ID ---
set /p modify_cookies="Do you want to modify the Instagram Session ID in cookies.json? (Y/N): "
if /i "!modify_cookies!"=="Y" (
    set /p new_session="Enter your new Instagram sessionid value: "
    if defined new_session (
        echo Updating cookies.json...
        set "SESSION_VAL=!new_session!"
        node -e "const fs=require('fs'); let f='cookies.json'; let data=JSON.parse(fs.readFileSync(f,'utf8')); data.forEach(item => { if(item.name==='sessionid') item.value=process.env.SESSION_VAL; }); fs.writeFileSync(f, JSON.stringify(data, null, 2));"
        echo [SUCCESS] Cookies sessionid updated.
    ) else (
        echo [SKIPPED] No session ID entered.
    )
) else (
    echo [SKIPPED] Cookies unchanged.
)

echo.
echo ===================================================
echo Configuration complete!
echo ===================================================
pause