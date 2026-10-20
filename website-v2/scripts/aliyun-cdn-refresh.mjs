#!/usr/bin/env node
/**
 * aliyun-cdn-refresh.mjs — 刷新阿里云 CDN 上官网的缓存（零运行时依赖）。
 *
 * 官网页面在 CDN 边缘缓存 1 天，部署后旧 HTML 引用的 /_astro 哈希资源在新镜像中已不存在，
 * deploy.sh 在新容器就绪后调用本脚本按目录刷新 fluxdown.com 与 www.fluxdown.com。
 *
 * 凭据：环境变量 ALIYUN_CDN_ACCESS_KEY_ID / ALIYUN_CDN_ACCESS_KEY_SECRET（RAM 子账号，只需
 * cdn:RefreshObjectCaches）。用法：`node scripts/aliyun-cdn-refresh.mjs [URL 前缀 ...]`，
 * 缺省刷新两个官网域名的根目录。失败以非零码退出，由调用方决定是否中止部署。
 * 接口：https://help.aliyun.com/zh/cdn/developer-reference/api-cdn-2018-05-10-refreshobjectcaches
 * 签名：RPC 风格 HMAC-SHA1（SignatureVersion 1.0）。
 */
import { createHmac, randomUUID } from "node:crypto";

const DEFAULT_PATHS = ["https://fluxdown.com/", "https://www.fluxdown.com/"];
const ENDPOINT = "https://cdn.aliyuncs.com/";

const id = process.env.ALIYUN_CDN_ACCESS_KEY_ID;
const secret = process.env.ALIYUN_CDN_ACCESS_KEY_SECRET;
if (!id || !secret) {
  console.error("[cdn-refresh] 缺少 ALIYUN_CDN_ACCESS_KEY_ID / ALIYUN_CDN_ACCESS_KEY_SECRET");
  process.exit(1);
}

/** RFC 3986 编码：encodeURIComponent 不编码 !'()*，阿里云签名要求编码。 */
function percentEncode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

const paths = process.argv.slice(2);
const params = {
  Action: "RefreshObjectCaches",
  Version: "2018-05-10",
  Format: "JSON",
  AccessKeyId: id,
  SignatureMethod: "HMAC-SHA1",
  SignatureVersion: "1.0",
  SignatureNonce: randomUUID(),
  Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  ObjectType: "Directory",
  ObjectPath: (paths.length ? paths : DEFAULT_PATHS).join("\n"),
};
const canonical = Object.keys(params).sort()
  .map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`)
  .join("&");
const signature = createHmac("sha1", `${secret}&`)
  .update(`GET&${percentEncode("/")}&${percentEncode(canonical)}`)
  .digest("base64");

try {
  const res = await fetch(`${ENDPOINT}?${canonical}&Signature=${percentEncode(signature)}`, {
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.RefreshTaskId) {
    console.error(`[cdn-refresh] 失败 HTTP ${res.status}: ${JSON.stringify(body)}`);
    process.exit(1);
  }
  console.log(`[cdn-refresh] 已提交刷新任务 ${body.RefreshTaskId}: ${params.ObjectPath.replace(/\n/g, " ")}`);
} catch (err) {
  console.error(`[cdn-refresh] 错误: ${err?.message ?? err}`);
  process.exit(1);
}
