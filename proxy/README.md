# AI 代理部署说明

浏览器直连 AI 服务有两个问题：**密钥暴露在浏览器环境**，以及部分服务**不允许跨域（CORS）**。把下面这个极小的代理部署到你自己的 Cloudflare / Vercel 账号后，密钥只存在于服务端环境变量里（Secret 为"只写不读"设计，控制台都看不到原值），浏览器端只填代理地址即可。

```
浏览器页面 ──只带代理口令(可选)──> 你的代理 ──携带真实密钥──> AI 服务
```

## 文件说明

| 文件 | 用途 |
|---|---|
| `cloudflare-worker.js` | Cloudflare Workers 版代理（推荐，免费额度足够个人使用） |
| `wrangler.toml` | Workers 的 Wrangler 配置 |
| `vercel-api.js` | Vercel Edge Function 版代理，部署时放到项目 `api/[...path].js` |

## Cloudflare Workers 部署步骤

```bash
npm install -g wrangler
wrangler login
wrangler deploy                      # 在本目录执行（读取 wrangler.toml）

# 设置敏感环境变量（Secret，写入后不可读回，不会出现在代码或本仓库中）
wrangler secret put UPSTREAM_BASE_URL    # 输入例如 https://api.deepseek.com/v1
wrangler secret put UPSTREAM_API_KEY     # 输入你的 AI 服务密钥
wrangler secret put PROXY_TOKEN          # 可选：自定义一个访问口令

# 设置允许的来源（非敏感，也可写在 wrangler.toml 的 [vars] 中）
wrangler secret put ALLOWED_ORIGINS      # 输入 https://uahz.github.io
```

部署完成后你会有类似 `https://gaokao-tracer-ai-proxy.<你的子域>.workers.dev` 的地址。

## Vercel 部署步骤

1. 新建（或复用）一个 Vercel 项目，把 `vercel-api.js` 放到 `api/[...path].js` 路径；
2. 在 Project Settings → Environment Variables 添加 `UPSTREAM_BASE_URL`、`UPSTREAM_API_KEY`（勾选 Encrypted），可选 `ALLOWED_ORIGINS`、`PROXY_TOKEN`、`RATE_LIMIT_PER_MIN`；
3. 重新部署，得到 `https://<项目名>.vercel.app` 地址。

## 在页面中配置

1. 打开溯源器，AI 问答区域的"连接方式"选择**自建代理**；
2. 代理地址填入你的代理地址（如 `https://gaokao-tracer-ai-proxy.xxx.workers.dev`）；
3. 若设置了 `PROXY_TOKEN`，在"代理访问口令"中填入同一个口令（仅保存在页面会话内存中）；
4. 点"发送提问"即可。流式输出默认开启，代理会原样透传 SSE。

## 安全机制

| 机制 | 说明 |
|---|---|
| Origin 白名单 | `ALLOWED_ORIGINS` 只允许你的网站来源调用，防止他人网页借用你的代理 |
| 访问口令 | `PROXY_TOKEN` 正确才转发；口令存于浏览器内存，不落盘 |
| 速率限制 | 每 IP 每分钟默认 10 次（近似实现）；严格限制请配合 Cloudflare WAF / Vercel 防火墙规则 |
| 密钥不可逆挖 | 密钥是 Secret：不进代码、不进仓库、控制台和 API 均不可读回，只能替换 |
| 用量告警 | 建议在云平台账单中设置告警，异常消耗第一时间发现 |

## 注意事项

- 代理地址和口令请**不要写进本仓库**；仓库只存放代理代码。
- 代理是公开端点，即使有白名单和口令，也建议使用独立的低额度密钥，便于随时吊销更换。
- `RATE_LIMIT_PER_MIN` 基于运行实例内存计数，重启或多实例时不完全精确，仅作第一道防线。
