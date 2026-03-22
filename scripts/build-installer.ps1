param(
    [ValidateSet('release')]
    [string]$Profile = 'release',
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

function Get-RepoRoot {
    return (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

function Require-Command {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        throw "Required command '$Name' was not found in PATH."
    }

    return $command.Source
}

function Get-IsccPath {
    if (-not [string]::IsNullOrWhiteSpace($env:ISCC_PATH) -and (Test-Path $env:ISCC_PATH)) {
        return (Resolve-Path $env:ISCC_PATH).Path
    }

    if (-not [string]::IsNullOrWhiteSpace($env:INNO_SETUP_DIR)) {
        $configuredPath = Join-Path $env:INNO_SETUP_DIR 'ISCC.exe'
        if (Test-Path $configuredPath) {
            return (Resolve-Path $configuredPath).Path
        }
    }

    $command = Get-Command 'iscc.exe' -ErrorAction SilentlyContinue
    if ($null -ne $command) {
        return $command.Source
    }

    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
        'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
        'C:\Program Files\Inno Setup 6\ISCC.exe'
    )

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    return $null
}

function Copy-DirectoryContents {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Source,
        [Parameter(Mandatory = $true)]
        [string]$Destination
    )

    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    Copy-Item -Path (Join-Path $Source '*') -Destination $Destination -Recurse -Force
}

$repoRoot = Get-RepoRoot
$webUiDir = Join-Path $repoRoot 'apps\web-ui'
$agentDir = Join-Path $repoRoot 'apps\timeline-agent'
$extensionDir = Join-Path $repoRoot 'apps\browser-extension'
$stageRoot = Join-Path $repoRoot 'target\installer\stage'
$outputRoot = Join-Path $repoRoot 'target\installer\output'
$portableRoot = Join-Path $repoRoot 'target\installer\portable'
$issPath = Join-Path $repoRoot 'packaging\windows\Timeline.iss'
$isccPath = Get-IsccPath

$cargoMetadataJson = & cargo metadata --no-deps --format-version 1 --manifest-path (Join-Path $repoRoot 'Cargo.toml')
$cargoMetadata = $cargoMetadataJson | ConvertFrom-Json
$packageVersion = ($cargoMetadata.packages | Where-Object { $_.name -eq 'timeline-agent' } | Select-Object -First 1).version

if ([string]::IsNullOrWhiteSpace($packageVersion)) {
    throw 'Failed to resolve timeline-agent version from cargo metadata.'
}

if (-not $SkipBuild) {
    Require-Command -Name 'cargo' | Out-Null
    Require-Command -Name 'npm' | Out-Null

    Write-Host 'Building web-ui...' -ForegroundColor Cyan
    Push-Location $webUiDir
    try {
        & npm run build
    }
    finally {
        Pop-Location
    }

    Write-Host 'Building timeline-agent...' -ForegroundColor Cyan
    Push-Location $repoRoot
    try {
        & cargo build --profile $Profile -p timeline-agent
    }
    finally {
        Pop-Location
    }
}

$agentBinary = Join-Path $repoRoot "target\$Profile\timeline-agent.exe"
$webUiDist = Join-Path $webUiDir 'dist'

if (-not (Test-Path $agentBinary)) {
    throw "Expected agent binary was not found: $agentBinary"
}

if (-not (Test-Path (Join-Path $webUiDist 'index.html'))) {
    throw "Expected web-ui build output was not found: $webUiDist"
}

Remove-Item -Path $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path $portableRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
New-Item -ItemType Directory -Path $portableRoot -Force | Out-Null

$appStage = Join-Path $stageRoot 'app'
$webUiStage = Join-Path $stageRoot 'web-ui\dist'
$extensionStage = Join-Path $stageRoot 'browser-extension'
$configStage = Join-Path $stageRoot 'config'
$docsStage = Join-Path $stageRoot 'docs'
$portableStage = Join-Path $portableRoot "timeline-portable-$packageVersion"
$portableWebUiStage = Join-Path $portableStage 'web-ui\dist'
$portableExtensionStage = Join-Path $portableStage 'browser-extension'
$portableConfigDir = Join-Path $portableStage 'config'
$portableDataDir = Join-Path $portableStage 'data'

New-Item -ItemType Directory -Path $appStage, $webUiStage, $extensionStage, $configStage, $docsStage, $portableStage, $portableWebUiStage, $portableExtensionStage, $portableConfigDir, $portableDataDir -Force | Out-Null

Copy-Item -Path $agentBinary -Destination (Join-Path $appStage 'timeline-agent.exe') -Force
Copy-Item -Path $agentBinary -Destination (Join-Path $portableStage 'timeline-agent.exe') -Force
Copy-DirectoryContents -Source $webUiDist -Destination $webUiStage
Copy-DirectoryContents -Source $webUiDist -Destination $portableWebUiStage
Copy-DirectoryContents -Source $extensionDir -Destination $extensionStage
Copy-DirectoryContents -Source $extensionDir -Destination $portableExtensionStage
Copy-Item -Path (Join-Path $repoRoot 'config\timeline-agent.example.toml') -Destination (Join-Path $configStage 'timeline-agent.example.toml') -Force
Copy-Item -Path (Join-Path $repoRoot 'config\timeline-agent.example.toml') -Destination (Join-Path $portableConfigDir 'timeline-agent.example.toml') -Force

$installReadme = @'
Timeline 安装包内容
====================

安装后会包含：

1. timeline-agent.exe
2. 内置的 web-ui/dist 前端静态文件
3. browser-extension 浏览器扩展目录

安装版默认把用户数据写到：
%LOCALAPPDATA%\Timeline\data

安装版默认把运行配置写到：
%LOCALAPPDATA%\Timeline\config\timeline-agent.toml

浏览器扩展安装方法
------------------

1. 打开 edge://extensions 或 chrome://extensions
2. 开启开发者模式
3. 选择“加载已解压的扩展程序”
4. 指向安装目录下的 browser-extension 文件夹
'@

Set-Content -Path (Join-Path $docsStage 'README-install.txt') -Value $installReadme -Encoding UTF8
Set-Content -Path (Join-Path $portableStage 'README-install.txt') -Value $installReadme -Encoding UTF8

$portableConfig = @'
database_path = "../data/timeline.sqlite"
lockfile_path = "../data/timeline-agent.lock"
listen_addr = "127.0.0.1:46215"
web_ui_url = "http://127.0.0.1:46215/#/stats"
idle_threshold_secs = 300
poll_interval_millis = 1000
debug = false
tray_enabled = true
record_window_titles = true
record_page_titles = true
ignored_apps = []
ignored_domains = []
'@

Set-Content -Path (Join-Path $portableConfigDir 'timeline-agent.toml') -Value $portableConfig -Encoding UTF8

$startCmd = @'
@echo off
setlocal
cd /d "%~dp0"
start "" "%~dp0timeline-agent.exe" --config "%~dp0config\timeline-agent.toml"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:46215/#/stats"
endlocal
'@

Set-Content -Path (Join-Path $portableStage 'start-timeline.cmd') -Value $startCmd -Encoding ASCII

$startVbs = @'
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.Run """" & appDir & "\timeline-agent.exe"" --config """ & appDir & "\config\timeline-agent.toml""", 0, False
WScript.Sleep 2000
shell.Run "http://127.0.0.1:46215/#/stats", 0, False
'@

Set-Content -Path (Join-Path $portableStage 'start-timeline.vbs') -Value $startVbs -Encoding ASCII

$openDashboardCmd = @'
@echo off
start "" "http://127.0.0.1:46215/#/stats"
'@

Set-Content -Path (Join-Path $portableStage 'open-dashboard.cmd') -Value $openDashboardCmd -Encoding ASCII

$openDashboardVbs = @'
Set shell = CreateObject("WScript.Shell")
shell.Run "http://127.0.0.1:46215/#/stats", 0, False
'@

Set-Content -Path (Join-Path $portableStage 'open-dashboard.vbs') -Value $openDashboardVbs -Encoding ASCII

$portableZip = Join-Path $outputRoot "timeline-portable-$packageVersion.zip"
Remove-Item -Path $portableZip -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $portableStage '*') -DestinationPath $portableZip

if ($null -ne $isccPath) {
    Write-Host "Packaging installer with Inno Setup..." -ForegroundColor Cyan
    & $isccPath `
        "/DMyAppVersion=$packageVersion" `
        "/DStageDir=$stageRoot" `
        "/DOutputDir=$outputRoot" `
        $issPath

    if ($LASTEXITCODE -ne 0) {
        throw "ISCC.exe failed with exit code $LASTEXITCODE."
    }

    $installer = Get-ChildItem -Path $outputRoot -Filter "timeline-setup-$packageVersion*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1

    if ($null -eq $installer) {
        throw 'Installer build finished but no setup executable was found.'
    }

    Write-Host "Installer ready: $($installer.FullName)" -ForegroundColor Green
}
else {
    Write-Warning 'ISCC.exe was not found. Skipping installer build and only producing the portable package.'
}

Write-Host "Portable package ready: $portableZip" -ForegroundColor Green
