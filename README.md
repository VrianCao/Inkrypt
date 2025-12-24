<div align="center">

# 🔐 Inkrypt

**Your notes. Your keys. Zero knowledge.**

一款基于 Passkey 的端到端加密笔记应用<br>
你的笔记，永远只属于你

[![Built with Cloudflare](https://img.shields.io/badge/Built%20with-Cloudflare-F38020?logo=cloudflare&logoColor=white)](https://www.cloudflare.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

[快速开始](#quick-start) · [部署指南](DEPLOYMENT.md) · [使用说明](USAGE_ZH.md)

</div>

---

## 为什么选择 Inkrypt？

> 💡 **问题**：想要一个能同步、能多设备、还能真正端到端加密的笔记应用，但市面上的方案要么要你信任服务商，要么用起来太折腾。

**Inkrypt 的答案**：用 Passkey 做身份验证和密钥派生，真正做到端到端加密——你的笔记只有你能看。

<table>
<tr>
<td width="50%">

### 🛡️ 真正的端到端加密
- 笔记经过 AES-256-GCM 加密
- 密钥由 WebAuthn PRF 派生，只存在你的设备上
- 没有密钥，谁也解不开

</td>
<td width="50%">

### 🔑 无密码体验
- 用 Passkey（指纹/面容/安全钥匙）登录
- 告别"又忘密码了"的烦恼
- 设备丢了？用恢复码兜底

</td>
</tr>
<tr>
<td width="50%">

### 📱 多设备同步
- 增量同步 + 本地 IndexedDB 缓存
- 乐观锁 + 冲突合并 UI
- ECDH-SAS 安全配对新设备

</td>
<td width="50%">

### ✍️ 舒适的写作体验
- Markdown 原生支持（GFM）
- 数学公式（KaTeX）+ 流程图（Mermaid）
- 附件加密同步，图片自动压缩

</td>
</tr>
</table>

---

## 🏗️ 技术架构

```
+-----------------------------------------------------------------+
|                           Your Browser                          |
|  +-------------+  +-------------+  +-------------+              |
|  |  WebAuthn   |  |  IndexedDB  |  |   React +   |              |
|  |    PRF      |  |   (cache)   |  |   Zustand   |              |
|  +------|------+  +------|------+  +------|------+              |
|         |                |                |                     |
|         +----------------+----------------+                     |
|                          |  Encrypt/decrypt happens here        |
+--------------------------+--------------------------------------+
                           | HTTPS (ciphertext)
                           v
+-----------------------------------------------------------------+
|                         Cloudflare Edge                         |
|  +-------------+  +-------------+  +-------------+              |
|  |   Workers   |  |     D1      |  |   Durable   |              |
|  |   (Hono)    |  |  (storage)  |  |   Objects   |              |
|  +-------------+  +-------------+  +-------------+              |
|                                                                 |
|                      Ciphertext stored here                     |
+-----------------------------------------------------------------+
```

| 组件 | 技术栈 | 职责 |
|------|--------|------|
| **前端** | Vite + React + Zustand | UI、加解密、本地缓存 |
| **后端** | Hono on Cloudflare Workers | 认证、同步、CRUD |
| **存储** | Cloudflare D1 | 笔记和元数据 |
| **限流** | Durable Objects | 全局请求限流 |

---

<a id="quick-start"></a>

## 🚀 快速开始

推荐使用 **GitHub Actions 一键部署（无需本地 clone）**。

**你需要准备：**

- `DOMAIN`：你的自定义域名（例如 `notes.example.com`，必须已托管到 Cloudflare）
- GitHub 仓库 Secret：`CLOUDFLARE_API_TOKEN`

### 1) 创建你的仓库

在 GitHub 点击 **Use this template**（或 Fork）创建你的仓库。

### 2) 配置 Secrets

进入仓库 → Settings → Secrets and variables → Actions：

- 新增 Repository secret：`CLOUDFLARE_API_TOKEN`
- （可选）新增 Repository secret：`INKRYPT_SESSION_SECRET`（不填会自动生成）

Token 最小权限建议：

- Zone：`Zone:Read`、`DNS:Edit`、`Workers Routes:Edit`
- Account：`Workers Scripts:Edit`、`D1:Edit`

### 3) 运行部署工作流

进入仓库 → Actions → `Deploy Inkrypt` → Run workflow：

- 必填：`domain`
- 选填：`rp_name`、`cors_origin`、`worker_name`、`d1_name`、`d1_location`

安全开关（默认谨慎）：

- `force_takeover_dns=true`：允许覆盖已存在但不匹配的 DNS 记录
- `force_takeover_routes=true`：允许接管已被其他 Worker 占用的 Routes

该工作流会自动完成：

- Worker 部署（包含静态资源 + API，含 D1/DO）
- D1 创建与 migrations
- DNS 记录自动配置（Worker-only）
- Worker Routes 自动配置（`/*`，内部仅 `/api/*`、`/auth/*`、`/healthz*` 走代码）
- Smoke test：访问 `https://<DOMAIN>/healthz`

### 4) 部署完成后

- 打开 `https://<DOMAIN>` 访问
- 建议保持域名不变：`RP_ID/ORIGIN` 依赖域名，上线后改域名会导致已注册 Passkey 失效
- 新部署默认使用 SQLite 后端的 Durable Objects（对免费账号更兼容）

👉 **完整部署说明（含排错）**：[DEPLOYMENT.md](DEPLOYMENT.md)

---

## 📖 使用指南

首次使用流程：

1. **创建保险库** — 完成 Passkey 注册，生成主密钥
2. **备份恢复码** — 这是你数据的最后保险，务必离线保管
3. **开始写作** — 支持 Markdown、数学公式、Mermaid 图
4. **同步与上传** — `Ctrl/Cmd + S` 上传，设置菜单拉取云端

👉 **详细说明**：[USAGE_ZH.md](USAGE_ZH.md)

---

## ⚠️ 安全须知

<table>
<tr>
<td>🔑</td>
<td><strong>恢复码 = 主密钥</strong></td>
<td>任何人拿到它都能解密你的所有笔记。离线保管，不要截图发给自己。</td>
</tr>
<tr>
<td>💾</td>
<td><strong>"记住解锁"有风险</strong></td>
<td>开启后会在本地缓存解密材料，XSS、恶意扩展等可能趁虚而入。</td>
</tr>
<tr>
<td>🌐</td>
<td><strong>浏览器要求</strong></td>
<td>必须支持 WebAuthn PRF 扩展和 CompressionStream API。</td>
</tr>
</table>

---

## 🤝 参与贡献

欢迎 Issue 和 PR！

---

## 📄 License

[MIT](LICENSE)

---

<div align="center">

**Made with 🔒 by [VrianCao](https://github.com/VrianCao)**

*Your data, encrypted. Your keys, yours.*

</div>
