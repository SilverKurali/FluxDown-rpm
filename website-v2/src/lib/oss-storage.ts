/**
 * 发布资产在 OSS 中的实际存储键。
 *
 * 阿里云 OSS 禁止经默认域名（*.aliyuncs.com）分发 `.apk` / `.ipa`（400 ApkDownloadForbidden），
 * 而 bucket 未绑定备案域名，所以这两类对象在桶内追加 `.bin` 存储。OSS 同时按对象名、
 * 对象 Content-Type 元数据与 response-content-* 覆盖参数拦截，因此桶内对象的 Content-Type
 * 必须是 application/octet-stream，也不能靠预签名参数改回 apk 类型。对外 URL、GitHub 资产名
 * 与 SHA256SUMS 仍是原名：阿里云 CDN 回源时把 URI 改写到 `.bin`，并由规则引擎覆盖 APK 的
 * Content-Type / Content-Disposition（配置见 .omp/knowledge/ops.md「阿里云 CDN」）。
 * 同一规则在 .github/actions/oss-upload/action.yml 的 bash 里复刻，改一处须同步另一处。
 */

const STORAGE_SUFFIX = ".bin";
const BLOCKED_EXTENSIONS = [".apk", ".ipa"];

/** 对外对象键 → 桶内存储键。 */
export function ossStorageKey(key: string): string {
  const lower = key.toLowerCase();
  return BLOCKED_EXTENSIONS.some((ext) => lower.endsWith(ext)) ? `${key}${STORAGE_SUFFIX}` : key;
}
