# VibeCast Remote

[English](README.md)

VibeCast Remote 是一个局域网手机语音输入桥接工具。它在 Mac 或 Windows 电脑上启动一个本地服务，让手机浏览器通过同一 Wi-Fi 连接，然后把手机上输入或语音识别出的文字发送到电脑当前聚焦的输入框。

手机端不需要安装 App。打开网页后，点输入框，用 iOS、安卓输入法、微信输入法、豆包等工具自带的麦克风语音输入，再点发送即可。

## 安装与启动

```bash
npm install
npm start
```

macOS 也可以双击 `start.command`。Windows 可以双击 `start.bat`。

日常使用时，macOS 更建议用后台脚本：

- 双击 `start-background.command`：以 macOS `launchd` 后台服务方式启动。
- 双击 `status.command`：查看服务是否在运行、检查 `/health`、显示最近日志。
- 双击 `stop.command`：停止后台服务。

后台日志会写入 `~/Library/Logs/VibeCast Remote/vibecast.log`，错误日志会写入 `~/Library/Logs/VibeCast Remote/vibecast.error.log`。

服务启动后会打印：

- 带 `token` 参数的手机同 Wi-Fi 访问地址
- 电脑本机访问地址，例如 `http://127.0.0.1:8765`
- 4 位 PIN 备用手动配对码

手机和电脑必须在同一个 Wi-Fi 下。优先打开带 `token` 的手机地址，页面会自动配对；如果 token 过期或复制了不带 token 的地址，再输入 PIN。手机地址要使用 `http://`，不是 `https://`。

在电脑本机打开 `http://127.0.0.1:8765/desktop`，可以查看当前 PIN、token 手机地址、LAN 地址、版本号、目标配置和权限提示，也可以直接编辑、排序、导入、导出和恢复默认目标卡与快捷按钮。这个诊断页只允许电脑本机访问，局域网里的手机打不开。

iPhone 上建议把 VibeCast Remote 保持在 Safari 或 Edge 的普通标签页里使用，或者保存为浏览器书签。iOS 主屏幕 Web App 容器在部分第三方语音输入法打开时可能黑屏。Android Chrome 在输入法表现正常时仍然可以添加到主屏幕。

## macOS 权限

macOS 默认会阻止程序模拟键盘输入。首次使用需要开启辅助功能权限：

系统设置 -> 隐私与安全性 -> 辅助功能

勾选运行本服务的终端、编辑器或 `node` 进程。如果授权后仍然不能输入，重启一次 `npm start`。

Windows 首次启动时，如果系统弹出 Windows Defender 防火墙提示，请允许 Node.js 访问本地网络。如果要往“以管理员身份运行”的目标应用输入，也需要用管理员权限启动本服务。

## 使用方式

- 手机页面现在可以切换多个目标草稿卡，例如 Current Focus、Codex、Notion、Hermes、Claude Code、Obsidian。
- 这个版本里的目标卡主要用于手机端分开保存草稿；实际发送仍然进入电脑上当前聚焦的输入框。
- 每个目标可以设置默认发送动作。例如 Codex 和 Claude Code 默认 `Send + Enter`，Notion 默认普通 `Send`。
- `Send`：把文本发送到当前聚焦的输入框。
- `Send + Enter`：先发送文本，短暂等待后再按 Enter。
- 快捷按钮：发送 `继续`、`y`、`n`、`/compact` 等常用短语，并跟随当前目标的默认发送动作。
- 手机页面会在 WebSocket 断开后自动重连，并且不会清空当前输入框内容。
- 手机页面会保存最近 10 条成功发送的文本，点击发送历史可以重新填入输入框。
- 键位按钮：发送 Enter、Backspace、Tab、Esc。

中文、emoji 和混合文本会通过系统剪贴板写入，再模拟粘贴。macOS 使用 `pbcopy` / `pbpaste` 和 `Cmd+V`，Windows 使用 PowerShell 剪贴板命令和 `Ctrl+V`。程序会尽量在粘贴后恢复原来的剪贴板内容。

## 当前限制

- 目前支持 macOS 和 Windows 的基础输入链路。
- Windows 前台应用识别使用当前窗口标题，后续还可以继续补进程名、图标和更精确的目标绑定。
- 手机网页依赖手机输入法或第三方输入法做语音识别，项目本身不做语音识别。
- 目标输入框以“当前聚焦”为准，不会深入读取每个 App 的内部输入框结构。

## 配置

- `PORT=9000 npm start` 可以修改端口。
- `PORT=9000 ./start-background.command` 可以用指定端口后台启动。
- `LABEL=com.vibecast.remote.test ./start-background.command` 可以用不同的 macOS 服务名测试。
- `config.json` 可以修改应用名、目标草稿卡和快捷按钮。
- 目标草稿卡支持 `sendMode: "type"` 或 `sendMode: "sendEnter"`。
- 本机专用的 `/api/config` 会给桌面诊断页保存配置，并写回 `config.json`。

## 更新记录

见 [CHANGELOG.md](CHANGELOG.md)。

## 安全说明

这个工具面向可信局域网使用。每次启动都会生成新的 4 位 PIN，PIN 不会写入磁盘。

服务也会生成一次性 token URL。手机首次打开后会把 token 存在浏览器 localStorage，并从地址栏移除 token。重启服务会生成新的 token。

`/desktop` 本机诊断页会显示当前 PIN 和 token URL。面向局域网排查的 `/health` 不会显示 PIN 或 token。

手机页面现在会避开 iOS 的主屏幕独立 Web App 模式，因为这个模式可能和第三方语音输入法冲突。

不要把端口暴露到公网。

## 故障排查

如果手机打不开网页：

- 确认手机和 Mac 在同一个 Wi-Fi。
- 确认地址是 `http://192.168.x.x:8765`。
- 在 Mac 上打开 `http://127.0.0.1:8765/health` 查看当前真实手机访问地址。
- 如果 Mac 的 IP 变了，重启 `npm start` 读取新地址。

如果输入没有进入目标应用：

- 确认目标输入框已经聚焦。
- 检查 macOS 辅助功能权限。
- 重新启动服务后再试。

如果服务刚才还在、后来没了：

- 双击 `status.command` 查看当前状态和最近日志。
- 也可以打开 `~/Library/Logs/VibeCast Remote/vibecast.log` 查看退出前输出。
- 用 `start-background.command` 启动后，关闭终端窗口不会直接结束服务。

## 致谢与参考

- 产品流程、手机输入面板思路和界面方向受到 `Pls-1q43/VibeCast` 启发：

https://github.com/Pls-1q43/VibeCast

- 本地 HTTP/WebSocket 桥接和剪贴板粘贴输入方式受到 MIT 协议项目 `phone-web-remote` 启发：

https://github.com/hello-claude/phone-web-remote

本项目保持轻量、跨平台实现：Node.js 服务、手机浏览器 UI、本地配对，以及通过系统剪贴板和模拟粘贴完成文本注入。
