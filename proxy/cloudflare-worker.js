/**
 * 广东新高考模考错题溯源器 — AI 代理（Cloudflare Workers 版）
 *
 * 作用：把浏览器发来的 Chat Completions 请求转发到上游 AI 服务。
 *       API 密钥只保存在本 Worker 的服务端环境变量中，浏览器端无需填密钥。
 *       支持 SSE 流式透传（不做缓冲，边收边返回）。
 *
 * 必需的环境变量（用 `wrangler secret put` 设置，均为只写不读的 Secret）：
 *   UPSTREAM_BASE_URL  上游 Chat Completions 基址，含版本号，
 *                      例如 https://api.deepseek.com/v1
 *   UPSTREAM_API_KEY   上游 AI 服务的 API 密钥
 *
 * 可选的环境变量：
 *   ALLOWED_ORIGINS    允许的来源（逗号分隔），
 *                      例如 https://uahz.github.io,http://localhost:8000
 *                      留空 = 不校验来源（仅调试用，不建议生产）
 *   PROXY_TOKEN        访问口令；设置后客户端须在请求头带 X-Proxy-Token
 *   RATE_LIMIT_PER_MIN 每个 IP 每分钟最大请求数，默认 10
 *                      （注意：这是基于 Worker 实例内存的近似限制，
 *                      严格限制请配合 Cloudflare WAF / Rate Limiting 规则）
 *
 * 客户端用法：页面上选择“自建代理”模式，代理地址填本 Worker 的地址，
 *             页面会自动向 <代理地址>/chat/completions 发送请求。
 */

export default {
  async fetch(request, env) {
    const allowed = String(env.ALLOWED_ORIGINS || "")
      .split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    const origin = request.headers.get("Origin") || "";

    // 按来源动态生成 CORS 头；未配置白名单时回显请求来源（仅调试场景）
    function corsHeaders(extra) {
      const h = Object.assign({}, extra || {});
      h["Access-Control-Allow-Origin"] =
        allowed.length === 0 ? (origin || "*")
        : (allowed.indexOf(origin) !== -1 ? origin : allowed[0]);
      h["Access-Control-Allow-Methods"] = "POST, OPTIONS";
      h["Access-Control-Allow-Headers"] = "Content-Type, X-Proxy-Token";
      h["Access-Control-Max-Age"] = "86400";
      h["Vary"] = "Origin";
      return h;
    }
    function jsonError(status, message) {
      return new Response(JSON.stringify({ error: { message: message } }), {
        status: status,
        headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders())
      });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== "POST") {
      return jsonError(405, "仅支持 POST 请求。");
    }
    if (allowed.length && allowed.indexOf(origin) === -1) {
      return jsonError(403, "来源不在 ALLOWED_ORIGINS 白名单内。");
    }
    if (env.PROXY_TOKEN && request.headers.get("X-Proxy-Token") !== env.PROXY_TOKEN) {
      return jsonError(401, "代理访问口令缺失或不正确。");
    }

    // 近似速率限制（内存窗口计数）
    const limit = Number(env.RATE_LIMIT_PER_MIN || 10);
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const nowMinute = Math.floor(Date.now() / 60000);
    if (!globalThis.__rate) globalThis.__rate = {};
    if (!globalThis.__rate[ip] || globalThis.__rate[ip].minute !== nowMinute) {
      globalThis.__rate[ip] = { minute: nowMinute, count: 0 };
    }
    globalThis.__rate[ip].count++;
    if (globalThis.__rate[ip].count > limit) {
      return jsonError(429, "请求过于频繁，请稍后再试。");
    }

    const upstreamBase = String(env.UPSTREAM_BASE_URL || "").replace(/\/+$/, "");
    if (!upstreamBase || !env.UPSTREAM_API_KEY) {
      return jsonError(500, "代理未配置 UPSTREAM_BASE_URL / UPSTREAM_API_KEY。");
    }

    const url = new URL(request.url);
    const upstream = upstreamBase + url.pathname;

    const headers = new Headers();
    headers.set("Content-Type", "application/json");
    headers.set("Authorization", "Bearer " + env.UPSTREAM_API_KEY);
    // 把上游返回的 Accept / anthropic 等自定义头透传需求可在此扩展

    let upstreamResp;
    try {
      upstreamResp = await fetch(upstream, {
        method: "POST",
        headers: headers,
        body: await request.text()
      });
    } catch (err) {
      return jsonError(502, "代理无法连接上游 AI 服务：" + err.message);
    }

    // 流式透传：不读取整个 body，直接把 ReadableStream 交给客户端
    const out = new Headers();
    out.set("Content-Type", upstreamResp.headers.get("Content-Type") || "application/json");
    out.set("X-Accel-Buffering", "no");
    out.set("Cache-Control", "no-store");
    for (const k of corsHeaders()) out.set(k, corsHeaders()[k]);
    return new Response(upstreamResp.body, { status: upstreamResp.status, headers: out });
  }
};
