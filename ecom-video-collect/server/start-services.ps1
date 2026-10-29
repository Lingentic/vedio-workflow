param([switch]$CheckOnly, [switch]$NoBrowser, [switch]$Stop)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$runtimeDir = Join-Path $PSScriptRoot '.local/launcher'
$stateFile = Join-Path $runtimeDir 'processes.json'
$workbenchUrl = 'http://127.0.0.1:4186'
$collectUrl = 'http://127.0.0.1:8765'
$started = @()

function Expand-OwnedRecords($records) {
    foreach ($record in @($records)) {
        if ($null -eq $record) { continue }
        if ($record.id) { $record }
        elseif ($null -ne $record.value) { Expand-OwnedRecords $record.value }
        elseif ($record -is [array]) { Expand-OwnedRecords $record }
    }
}

function Read-OwnedRecords {
    if (Test-Path -LiteralPath $stateFile) {
        Expand-OwnedRecords (Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json)
    }
}

function Stop-OwnedProcess($record) {
    $process = Get-Process -Id $record.id -ErrorAction SilentlyContinue
    if ($process -and $process.StartTime.ToUniversalTime().Ticks.ToString() -eq [string]$record.startedAt) {
        Stop-Process -Id $process.Id -ErrorAction Stop
        Write-Host "已停止 $($record.name)（PID $($record.id)）"
    }
}

function Test-Ready($url, $kind) {
    try {
        $result = Invoke-RestMethod -Uri $url -TimeoutSec 2 -UseBasicParsing
        if ($kind -eq 'workbench') {
            if ($null -eq $result.products -or $null -eq $result.assets) { return $false }
            $runtime = Invoke-RestMethod -Uri "$workbenchUrl/api/runtime" -TimeoutSec 2 -UseBasicParsing
            return ($runtime.interfaceVersion -eq 'online-collection-preview-v5')
        }
        return ($result.ok -eq $true -and $null -ne $result.platforms -and $null -ne $result.mediaDir -and $result.interfaceVersion -eq 'online-preview-v4')
    } catch { return $false }
}

function Resolve-Tool($configured, $name, $fallbacks) {
    $candidates = @($configured)
    $candidates += @(Get-Command $name -All -CommandType Application -ErrorAction SilentlyContinue | ForEach-Object { $_.Source })
    $candidates += @($fallbacks)
    foreach ($candidate in $candidates) {
        if ($candidate -and -not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            $command = Get-Command $candidate -CommandType Application -ErrorAction SilentlyContinue
            if ($command) { $candidate = $command.Source }
        }
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            try {
                & $candidate -version *> $null
                if ($LASTEXITCODE -eq 0) { return $candidate }
            } catch { }
        }
    }
    throw "未找到可运行的 $name。请运行 winget install --id Gyan.FFmpeg --exact --force 后重新打开脚本，或设置 FFMPEG_PATH / FFPROBE_PATH。"
}

function Start-ServiceProcess($name, $executable, $arguments, $workingDirectory, $url, $kind, $port) {
    if (Test-Ready $url $kind) { Write-Host "[复用] $name 已运行"; return }
    if ($kind -eq 'workbench') {
        $legacy = $null
        try { $legacy = Invoke-RestMethod -Uri $url -TimeoutSec 2 -UseBasicParsing } catch { }
        if ($null -ne $legacy -and $null -ne $legacy.products -and $null -ne $legacy.assets) {
            if ($legacy.activeExecution -or $legacy.libraryBusy) { throw '旧版工作台有任务运行，请等待任务结束后重新启动。' }
            $owned = @(Read-OwnedRecords | Where-Object { $_.name -eq $name })
            foreach ($record in $owned) { Stop-OwnedProcess $record }
            try {
                $stillRunning = Invoke-RestMethod -Uri $url -TimeoutSec 2 -UseBasicParsing
                if ($null -ne $stillRunning.products) { throw '旧版工作台仍在运行，且不属于本脚本。请关闭旧的工作台进程后重新启动。' }
            } catch {
                if ($_.Exception.Message -like '旧版工作台仍在运行*') { throw }
            }
        }
    }
    if ($kind -eq 'collect') {
        $legacy = $null
        try { $legacy = Invoke-RestMethod -Uri $url -TimeoutSec 2 -UseBasicParsing } catch { }
        if ($null -ne $legacy -and $legacy.ok -eq $true -and $null -ne $legacy.platforms) {
            $owned = @(Read-OwnedRecords | Where-Object { $_.name -eq $name })
            foreach ($record in $owned) { Stop-OwnedProcess $record }
            try {
                $stillRunning = Invoke-RestMethod -Uri $url -TimeoutSec 2 -UseBasicParsing
                if ($stillRunning.ok -eq $true) { throw '旧版采集服务仍在运行，且不属于本脚本。请关闭旧进程后重新启动。' }
            } catch {
                if ($_.Exception.Message -like '旧版采集服务仍在运行*') { throw }
            }
        }
    }
    $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($listener) { throw "端口 $port 已被其他程序占用或服务尚未就绪，请检查后重试。" }
    $outLog = Join-Path $runtimeDir "$kind.stdout.log"
    $errLog = Join-Path $runtimeDir "$kind.stderr.log"
    $process = Start-Process -FilePath $executable -ArgumentList $arguments -WorkingDirectory $workingDirectory -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
    $record = [pscustomobject]@{ name = $name; id = $process.Id; startedAt = $process.StartTime.ToUniversalTime().Ticks.ToString() }
    $script:started += $record
    $records = @()
    $records = @(Read-OwnedRecords | Where-Object { $_.name -ne $name })
    ConvertTo-Json -Depth 8 -InputObject @($records + $record) | Set-Content -LiteralPath $stateFile -Encoding UTF8
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
        if (Test-Ready $url $kind) { Write-Host "[就绪] $name"; return }
        $process.Refresh()
        if ($process.HasExited) { throw "$name 启动退出，查看日志：$errLog" }
        Start-Sleep -Milliseconds 500
    }
    throw "$name 在 30 秒内未就绪，查看日志：$errLog"
}

try {
    if ($Stop) {
        if (Test-Path -LiteralPath $stateFile) {
            Read-OwnedRecords | ForEach-Object { Stop-OwnedProcess $_ }
            Remove-Item -LiteralPath $stateFile
        } else { Write-Host '没有本脚本启动的服务记录。' }
        exit 0
    }

    $nodeCandidates = @($env:NODE_PATH_EXE)
    $nodeCandidates += @(Get-Command node -All -CommandType Application -ErrorAction SilentlyContinue | ForEach-Object { $_.Source })
    $nodeCandidates += Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
    $nodeExe = $null
    foreach ($candidate in $nodeCandidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            try {
                $version = & $candidate --version 2>$null
                if ($LASTEXITCODE -eq 0 -and $version -match '^v(\d+)\.' -and [int]$Matches[1] -ge 24) { $nodeExe = $candidate; break }
            } catch { }
        }
    }
    if (-not $nodeExe) { throw '需要 Node.js 24 或更新版本。安装后重新打开脚本，或设置 NODE_PATH_EXE 为 node.exe 的完整路径。' }
    Write-Host "[OK] Node：$nodeExe"

    $pythonExe = $null
    $pythonCandidates = @($env:COLLECT_PYTHON)
    $pythonCandidates += @(Get-Command python -All -CommandType Application -ErrorAction SilentlyContinue | ForEach-Object { $_.Source })
    foreach ($candidate in $pythonCandidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            try {
                & $candidate -c 'import sys, curl_cffi; assert sys.version_info >= (3, 10)' *> $null
                if ($LASTEXITCODE -eq 0) { $pythonExe = $candidate; break }
            } catch { }
        }
    }
    if (-not $pythonExe) { throw '需要 Python 3.10+ 和 curl_cffi。请运行 python -m pip install curl_cffi，或设置 COLLECT_PYTHON 为已安装依赖的 python.exe。' }
    Write-Host "[OK] Python：$pythonExe"

    $profile = @{}
    $profileFile = Join-Path $repoRoot 'demo/.local/settings.json'
    if (Test-Path -LiteralPath $profileFile) { $profile = Get-Content -LiteralPath $profileFile -Raw -Encoding UTF8 | ConvertFrom-Json }
    $wingetDir = Join-Path $env:LOCALAPPDATA 'Microsoft/WinGet/Packages'
    $ffCandidates = @(Get-ChildItem -Path (Join-Path $wingetDir 'Gyan.FFmpeg*') -Filter ffmpeg.exe -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
    $env:FFMPEG_PATH = Resolve-Tool $profile.ffmpeg 'ffmpeg.exe' (@($env:FFMPEG_PATH) + $ffCandidates)
    $probeBeside = Join-Path (Split-Path $env:FFMPEG_PATH -Parent) 'ffprobe.exe'
    $env:FFPROBE_PATH = Resolve-Tool $profile.ffprobe 'ffprobe.exe' @($env:FFPROBE_PATH, $probeBeside)
    Write-Host "[OK] FFmpeg：$env:FFMPEG_PATH"
    Write-Host "[OK] FFprobe：$env:FFPROBE_PATH"
    $env:PATH = (Split-Path $nodeExe -Parent) + ';' + (Split-Path $env:FFMPEG_PATH -Parent) + ';' + (Split-Path $env:FFPROBE_PATH -Parent) + ';' + $env:PATH
    $env:PORT = '4186'
    $env:WORKBENCH_URL = $workbenchUrl
    $env:COLLECT_SERVICE_URL = $collectUrl
    $env:PYTHONUNBUFFERED = '1'
    $env:PYTHONIOENCODING = 'utf-8'
    if ($CheckOnly) { Write-Host '依赖检查通过；未启动服务。'; exit 0 }

    New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
    Write-Host '正在启动视频工作台和采集服务…'
    Start-ServiceProcess '视频工作台' $nodeExe @('server.ts') (Join-Path $repoRoot 'demo') "$workbenchUrl/api/state" 'workbench' 4186
    Start-ServiceProcess '采集服务' $pythonExe @('collect_service.py', '--port', '8765') $PSScriptRoot "$collectUrl/api/health" 'collect' 8765
    Write-Host "视频工作台：$workbenchUrl"
    Write-Host "商品获取：$workbenchUrl/?page=collection"
    Write-Host "运行日志：$runtimeDir"
    Write-Host '服务在后台运行。需要停止时，双击同目录的“停止采集服务.bat”。'
    if (-not $NoBrowser) { Start-Process $workbenchUrl }
    exit 0
} catch {
    foreach ($record in $started) { Stop-OwnedProcess $record }
    Write-Host "启动失败：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
