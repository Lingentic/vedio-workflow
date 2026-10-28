@echo off
title 电商视频素材采集 - 一键启动
cd /d "%~dp0"
set "REPO=%~dp0..\.."
for %%I in ("%REPO%") do set "REPO=%%~fI"

echo ============================================
echo   电商视频素材采集 + 视频工作台 一键启动
echo ============================================
echo.

where node >nul 2>nul || (echo [缺少] node 未安装或不在 PATH & pause & exit /b 1)
where python >nul 2>nul || (echo [缺少] python 未安装或不在 PATH & pause & exit /b 1)

rem 工作台经 FFMPEG_PATH 识别 ffmpeg；PATH 未刷新时回退探测 winget 安装目录
if not defined FFMPEG_PATH for /f "delims=" %%F in ('where /r "%LOCALAPPDATA%\Microsoft\WinGet\Packages" ffmpeg.exe 2^>nul') do set "FFMPEG_PATH=%%~fF"
where ffmpeg >nul 2>nul && (echo [OK] ffmpeg 在 PATH 中) || if defined FFMPEG_PATH (echo [OK] 已通过 FFMPEG_PATH 使用 ffmpeg) else (echo [提示] 未找到 ffmpeg/ffprobe —— 视频导入工作台会失败，执行 winget install Gyan.FFmpeg 后重开本脚本)
echo.

echo [1/2] 启动视频工作台  http://127.0.0.1:4186 ...
start "视频工作台 :4186" /D "%REPO%\demo" cmd /k node server.ts

echo [2/2] 启动采集服务    http://127.0.0.1:8765 ...
start "素材采集服务 :8765" cmd /k python "%~dp0collect_service.py" --port 8765

echo.
echo 两个服务已在新窗口启动：
echo   视频工作台  http://127.0.0.1:4186            素材库 / 视频制作 / 生成记录，侧栏「商品获取」
echo   采集页面    http://127.0.0.1:8765/index.html 需在装了「快手商品信息采集器-接入版」扩展的 Chrome 中打开
echo.
echo 关闭本窗口不会停止服务；到对应服务窗口按 Ctrl+C 或直接关窗即停止。
ping -n 4 127.0.0.1 >nul
start "" "http://127.0.0.1:4186"
pause