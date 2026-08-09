@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title 酒馆角色卡管理器

if not exist "node_modules" (
  echo 首次运行，正在准备本地环境，请稍候……
  call npm.cmd ci
  if errorlevel 1 (
    echo.
    echo 准备失败，请确认电脑已经安装 Node.js 22 或更高版本。
    pause
    exit /b 1
  )
)

echo 正在启动酒馆角色卡管理器……
echo 启动后会使用系统默认浏览器打开，不会通过 GPT 打开。
echo 关闭本窗口即可停止程序。

start "" /b powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 3; Start-Process 'http://localhost:3000'"
call npm.cmd run dev

endlocal
