/**
 * 广东新高考模考错题溯源器 — AI 代理（Vercel Edge Function 版）
 *
 * 使用方法：把本文件放到 Vercel 项目的 api/[...path].js 路径，
 * 环境变量在 Vercel 项目设置 → Environment Variables 中配置（加密，只写不读）。
 *
 * 环境变量与 Cloudflare 版完全一致：
 *   UPSTREAM_BASE_URL（必需）  如 https://api.deepseek.com/v1
 *   UPSTREAM_API_KEY（必需）   上游 AI 服务密钥
 *   ALLOWED_ORIGINS（可选）    如 https://uahz.github.io
 *   PROXY_TOKEN（可选）        访问口令，客户端请求头 X-Proxy-Token
 *   RATE_LIMIT_PER_MIN（可选） 每 IP 每分钟请求数上限，默认 10
 */

export const config = { runtime: "edge" };

export default async function handler(request) {
  const env = process.env;
  const allowed = String(env.ALLOWED_ORIGINS || "")
    .split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  const origin = request.headers.get("Origin") || "";

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

  const limit = Number(env.RATE_LIMIT_PER_MIN || 10);
  const ip = request.headers.get("x-real-ip") ||
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
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
  const upstream = upstreamBase + url.pathname.replace(/^\/api/, "");

  let upstreamResp;
  try {
    upstreamResp = await fetch(upstream, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + env.UPSTREAM_API_KEY
      },
      body: await request.text()
    });
  } catch (err) {
    return jsonError(502, "代理无法连接上游 AI 服务：" + err.message);
  }

  const out = new Headers();
  out.set("Content-Type", upstreamResp.headers.get("Content-Type") || "application/json");
  out.set("X-Accel-Buffering", "no");
  out.set("Cache-Control", "no-store");
  for (const k of corsHeaders()) out.set(k, corsHeaders()[k]);
  return new Response(upstreamResp.body, { status: upstreamResp.status, headers: out });
}
