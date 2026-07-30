# 同步 fork、自定义分支和 Windows Installer

此流程由 `scripts/sync-fork-build-installer.mjs` 维护。不要重复手工执行 fetch、merge、代理配置和 electron-builder 命令。

## 一键执行

在仓库根目录运行：

```powershell
npm run custom:sync-build-installer
```

脚本固定执行以下流程：

1. 拒绝未提交的工作区，配置并刷新官方远程 `https://github.com/getpaseo/paseo.git`。
2. 比较官方 `main` 与两个功能分支修改的同名文件，并用 `git merge-tree` 预检冲突。
3. 仅在能够 fast-forward 时同步 `main`，随后推送 `origin/main`；不会强推或把自定义提交放进 `main`。
4. 把 `main`、`feature/latex-support`、`feature/open-file-with-default-app` 依次合并到 `integration/custom-vnext`，随后推送该集成分支。重复运行时，已经合并的提交会自动跳过。
5. 通过 `http://127.0.0.1:7890` 执行 `npm ci`，构建 Windows x64 NSIS Installer。
6. 用 7-Zip 检查安装包完整性，并输出文件路径、字节数和 SHA-256。

默认产物：

```text
packages/desktop/release/Paseo-Setup-<version>-x64.exe
```

脚本只构建，不安装，避免覆盖正在管理 Agent/daemon 的 Paseo 实例。

## 参数

```powershell
# 使用其他 HTTP 代理
npm run custom:sync-build-installer -- --proxy http://127.0.0.1:7891

# 只同步和合并，不下载依赖或构建
npm run custom:sync-build-installer -- --sync-only

# 当前必须位于 integration/custom-vnext；只重新安装依赖和构建
npm run custom:sync-build-installer -- --build-only

# 完成本地同步和合并但不推送远程
npm run custom:sync-build-installer -- --sync-only --no-push
```

## 失败处理

- `Working tree must be clean`：提交或暂存当前工作后重试。
- `origin/main has commits not present in upstream/main`：Fork 主分支已分叉。脚本不会覆盖它；先人工确认这些提交的去向。
- `Merge preflight failed`：官方与功能分支存在文本冲突。脚本在修改 `main` 前停止。
- 实际 merge 失败：解决冲突并提交，确认工作区干净后用 `--build-only` 继续构建。
- 代理不可用：启动本机 7890 代理，或用 `--proxy` 指定其他地址。

## 本机构建限制

本机没有 electron-builder 旧版 `winCodeSign` 解压符号链接所需的权限。脚本使用 `--config.win.signAndEditExecutable=false` 和 `--publish never` 构建本地安装包：不发布 GitHub Release，也不执行 Windows EXE 的签名、图标和版本资源编辑。产物适合本地验证，不适合正式发布；正式发布继续使用 [release.md](release.md) 的签名 CI 流程。
