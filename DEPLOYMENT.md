# Inkrypt 部署指南

Inkrypt 是一款基于 Passkey 的端到端加密笔记应用——你的笔记，只有你能看。

本指南用于自部署 Inkrypt（基于 Cloudflare 技术栈）：

| 组件 | 技术 | 部署目标 |
|------|------|----------|
| 前端 | Vite + React | Cloudflare Workers Static Assets |
| 后端 | Hono | Cloudflare Workers（同一个 Worker 内） |
| 存储 | D1 | Cloudflare D1 |
| 限流 | Durable Objects | Cloudflare DO |

---

## 部署前必读

### 1. 域名定了就别改

后端用 `RP_ID`（域名）和 `ORIGIN`（完整地址）验证 Passkey。上线后改域名会导致已有 Passkey 失效。

### 2. 不支持跨站部署

前后端不在同一站点会被 CSRF 保护拦截，不支持。

---

## 准备工作

**Cloudflare 侧**：
- Cloudflare 账号
- 一个域名（已托管到 Cloudflare）
- 开通 Workers、D1、Durable Objects

**本地**：
- Node.js 20+
- Git

---

## 一键部署（无需本地）

本仓库内置 GitHub Actions 工作流：`.github/workflows/deploy.yml`，可在 GitHub 上一键完成：

- Worker 部署（包含静态资源 + API，含 D1/DO）
- D1 创建与 migrations
- DNS 记录自动配置（Worker-only）
- Worker Routes 自动配置（`/*`，内部仅 `/api/*`、`/auth/*`、`/healthz*` 走代码）

### 你需要准备

- `DOMAIN`：例如 `notes.example.com`（必须在 Cloudflare 托管的 Zone 内）
- GitHub 仓库 Secret：`CLOUDFLARE_API_TOKEN`
- （可选）GitHub 仓库 Secret：`INKRYPT_SESSION_SECRET`（不填则自动生成）

### Token 权限建议（最小集）

- Zone：`Zone:Read`、`DNS:Edit`、`Workers Routes:Edit`
- Account：`Workers Scripts:Edit`、`D1:Edit`

### Durable Objects（SQLite 后端）

- 新部署默认使用 SQLite 后端的 Durable Objects（`new_sqlite_classes`），对免费账号/新账号更兼容
- 已部署旧版本（`new_classes`）无需改动现有配置；保持你的 `wrangler.toml` 即可

### 使用步骤

1. 在 GitHub 点击 **Use this template** 创建你的仓库
2. 进入仓库 → Settings → Secrets and variables → Actions：
   - 新增 Repository secret：`CLOUDFLARE_API_TOKEN`
   - （可选）新增 Repository secret：`INKRYPT_SESSION_SECRET`
3. 进入仓库 → Actions → `Deploy Inkrypt` → Run workflow：
   - 填写必填项：`domain`
   - 其余选填（默认即可）

### 高级参数（避免“一键事故”）

- `force_takeover_dns=true`：当 `DOMAIN` 已存在 DNS 记录但不匹配时，允许覆盖
- `force_takeover_routes=true`：当目标路由已绑定其他 Worker 时，允许接管

---

## 步骤 1：拉代码

```bash
git clone https://github.com/YourRepo/Inkrypt.git
cd Inkrypt
npm install
npx wrangler login  # 登录 Cloudflare
```

---

## 步骤 2：配置后端

编辑 `apps/worker/wrangler.toml`，修改 `[vars]` 部分：

```toml
RP_NAME = "Inkrypt"
RP_ID = "notes.example.com"           # 你的域名，不带 https://
ORIGIN = "https://notes.example.com"  # 完整地址，不带路径
CORS_ORIGIN = "https://notes.example.com"
COOKIE_SAMESITE = "Lax"
```

---

## 步骤 3：创建数据库

```bash
cd apps/worker

# 创建 D1 数据库
npx wrangler d1 create inkrypt
# 把输出的 database_id 填入 wrangler.toml

# 执行迁移
npx wrangler d1 migrations apply inkrypt --remote
```

---

## 步骤 4：部署后端

```bash
cd apps/worker

# 部署 Worker
npx wrangler deploy

# 设置会话密钥（必须，至少 32 字节）
npx wrangler secret put SESSION_SECRET
# 输入一个强随机字符串

# 再部署一次确保生效
npx wrangler deploy
```

---

## 步骤 5：部署前端

前端静态资源会随 Worker 一起部署（Workers Static Assets），无需创建 Pages 项目。

---

## 步骤 6：配置路由

### 给 Worker 添加路由

Worker → Triggers → Routes → 添加：
- `notes.example.com/*`

这样整个站点都由同一个 Worker 提供：静态资源由 Static Assets 返回，`/api`、`/auth` 等路径由 Hono 代码处理。

---

## 验证部署

1. 访问 `https://notes.example.com`
2. 创建保险库，完成 Passkey 注册
3. 退出后重新解锁
4. 新建笔记并上传
5. 从云端同步，确认数据正常
6. 用另一台设备测试「添加新设备」

---

## 本地开发

```bash
# 创建 apps/worker/.dev.vars
RP_NAME="Inkrypt (Local)"
RP_ID="localhost"
ORIGIN="http://localhost:5173"
CORS_ORIGIN="http://localhost:5173"
COOKIE_SAMESITE="Lax"
SESSION_SECRET="your-32-byte-random-secret-here"

# 初始化本地数据库
cd apps/worker
npx wrangler d1 migrations apply inkrypt --local

# 启动开发服务器
cd ../..
npm run dev
```

Vite 会自动代理 `/api` 和 `/auth` 到 Worker。

---

## 常见问题

### MISCONFIGURED (500)

`SESSION_SECRET` 没设置或太短。用 `npx wrangler secret put SESSION_SECRET` 设置后重新部署。

### VERIFY_FAILED / NOT_VERIFIED

检查 `RP_ID` 和 `ORIGIN` 是否与访问地址完全匹配。改过域名的话，旧 Passkey 会失效。

### CSRF_BLOCKED (403)

前后端不在同一站点。按本指南用同域路径路由部署。

### Cookie 不生效 / 一直 401

- Passkey 验证可能没通过，先检查 `RP_ID`/`ORIGIN`
- 浏览器可能禁用了 Cookie
- 跨站部署会触发 Cookie 限制

### D1 表不存在

确认 `wrangler.toml` 里的 `database_id` 正确，然后重新执行迁移。

### 不支持 PRF 扩展

更新浏览器，或换一个支持 PRF 的平台。

---

## 安全建议

| 建议 | 说明 |
|------|------|
| SESSION_SECRET 用 secret 存储 | 不要写在 wrangler.toml 里 |
| 定期轮换 SESSION_SECRET | 会让现有会话失效，但不影响数据 |
| 严格 CSP | 保持 `script-src 'self'`，`connect-src` 只放行必要 origin |
| 同域部署 | 减少跨域和 Cookie 风险 |
| 了解恢复码的重要性 | 丢了就真没了 |
