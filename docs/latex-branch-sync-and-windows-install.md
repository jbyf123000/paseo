# LaTeX 分支同步 main、构建并覆盖 Windows 安装

此流程只用于 `feature/latex-support`：先检查远端 `origin/main` 是否有新提交；有则合并到当前分支；随后构建 x64 Windows NSIS 安装包并覆盖当前用户的 Paseo 安装。

## 前提

- 当前分支必须是 `feature/latex-support`。
- LaTeX 改动必须已经提交；脚本拒绝在工作区有未提交文件时运行，避免把构建输出或未完成修改混入 merge。
- 先正常关闭所有 Paseo 窗口。脚本不会强制终止 `Paseo.exe`，因为桌面应用可能管理本地 Agent/daemon。
- Windows 构建使用本机 HTTP 代理 `http://127.0.0.1:7890` 下载 Electron/electron-builder 依赖。

## 一次性执行

从仓库根目录以 PowerShell 运行以下命令：

```powershell
$ErrorActionPreference = "Stop"

$expectedBranch = "feature/latex-support"
$currentBranch = (git branch --show-current).Trim()
if ($currentBranch -ne $expectedBranch) {
  throw "Expected branch '$expectedBranch', got '$currentBranch'."
}

if (git status --porcelain) {
  throw "Working tree is not clean. Commit or stash changes before syncing main."
}

git fetch origin main
if ($LASTEXITCODE -ne 0) {
  throw "Unable to fetch origin/main."
}

$mainCommitsToMerge = [int](git rev-list --count "HEAD..origin/main")
if ($mainCommitsToMerge -gt 0) {
  git merge --no-ff origin/main
  if ($LASTEXITCODE -ne 0) {
    throw "Merge conflict or merge failure. Resolve it, commit the merge, then rerun this procedure."
  }
} else {
  Write-Host "origin/main has no commits missing from $expectedBranch; merge skipped."
}

$env:npm_config_proxy = "http://127.0.0.1:7890"
$env:npm_config_https_proxy = "http://127.0.0.1:7890"

# --publish never keeps this local build from attempting a GitHub Release.
# signAndEditExecutable=false avoids electron-builder's winCodeSign symlink
# extraction on Windows machines without Developer Mode or symlink privilege.
npm run build:desktop -- --win nsis --x64 --publish never -c.win.signAndEditExecutable=false
if ($LASTEXITCODE -ne 0) {
  throw "Windows installer build failed."
}

$installer = Get-ChildItem "packages/desktop/release/Paseo-Setup-*-x64.exe" |
  Sort-Object LastWriteTimeUtc -Descending |
  Select-Object -First 1
if (-not $installer) {
  throw "Windows installer was not produced."
}

if (Get-Process -Name Paseo -ErrorAction SilentlyContinue) {
  throw "Close all Paseo windows before installing; no process was terminated."
}

$installDirectory = Join-Path $env:LOCALAPPDATA "Programs/Paseo"
$installResult = Start-Process -FilePath $installer.FullName `
  -ArgumentList @("/S", "/D=$installDirectory") `
  -Wait -PassThru
if ($installResult.ExitCode -ne 0) {
  throw "Installer failed with exit code $($installResult.ExitCode)."
}

$installedExecutable = Join-Path $installDirectory "Paseo.exe"
$uninstaller = Join-Path $installDirectory "Uninstall Paseo.exe"
if (-not (Test-Path $installedExecutable) -or -not (Test-Path $uninstaller)) {
  throw "Installer exited successfully but the expected installation files are missing."
}

Get-Item $installer.FullName, $installedExecutable, $uninstaller |
  Select-Object FullName, Length, LastWriteTime
Get-FileHash $installer.FullName -Algorithm SHA256
```

`/D=...` 必须是 NSIS 安装程序的最后一个参数。它明确指定当前用户安装位置：

```text
%LOCALAPPDATA%\Programs\Paseo
```

## 合并冲突处理

脚本在 `git merge` 失败时停止，不会构建或安装。处理冲突后执行：

```powershell
git add <resolved-files>
git commit
git status --short
```

确认工作区重新干净后，从“**一次性执行**”的开头重新运行。

## 本机构建限制

`-c.win.signAndEditExecutable=false` 是本机无符号链接权限时的构建规避项。它跳过 Windows EXE 的签名、图标和版本元数据资源编辑；适合本地验证和覆盖安装，不适合正式发布。正式发布应在具备 Windows Developer Mode/符号链接权限及签名环境的构建机上运行常规发布流程。

该流程只覆盖当前用户的安装目录；它不会删除独立的系统级安装，例如 `C:\Program Files\Paseo`。
