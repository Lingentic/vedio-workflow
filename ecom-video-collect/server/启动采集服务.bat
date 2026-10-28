@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo  电商视频素材采集 - 本地采集服务
echo  页面入口: http://127.0.0.1:8765/index.html
echo  关闭本窗口即停止服务
echo ============================================
python "%~dp0collect_service.py" --port 8765
pause
