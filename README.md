# 同频影院

一个最低可用的同步观影房间静态原型。

## 使用方式

直接打开：

`D:\Codex\tongpin-cinema\index.html`

或构建后本地预览：

```powershell
cd D:\Codex\tongpin-cinema
D:\Codex\node\node-v24.18.0-win-x64\node.exe build.js
D:\Codex\node\node-v24.18.0-win-x64\node.exe server.js
```

## 当前功能

- 播放/暂停、前进/后退、拖动进度。
- 同步按钮会把成员延迟归零到接近房主时间。
- 异地入口可复制带房间号的链接。
- 可设置昵称，并加入成员列表。
- 影片队列可新增条目，刷新后保存在浏览器本地。
- 聊天区可发送本地演示消息。
- 时间线记录播放、同步、拖动、加片等操作。

## 当前边界

当前版本支持两种互通方式：

1. GitHub Pages 静态托管 + WebRTC 点对点直连：页面访问更稳定，配对成功后播放/暂停、拖动进度、片单和聊天直接在两台设备之间互通。
2. Sites Worker 房间接口：保留为兜底方案。

## GitHub Pages

把本目录推到 GitHub 仓库后，启用 Pages 并选择 GitHub Actions。`.github/workflows/pages.yml` 会把静态页面发布出来。

GitHub Pages 只能托管前端，不能长期保存房间状态。真实互通依赖页面里的 WebRTC 直连配对。

## WebRTC 配对

1. 房主打开页面，点“我是房主”，复制配对码给对象。
2. 对象打开同一页面，粘贴配对码，点“我是观众”，复制生成的回应码。
3. 房主粘贴回应码，点“应用对方回应码”。
4. 状态显示“已直连”后，播放/暂停、拖动进度、片单和聊天会互通。

## 后续可接入

- 真实视频播放器。
- 微信邀请链接。
- 更稳定的持久化房间状态。
- WebSocket 低延迟同步。
