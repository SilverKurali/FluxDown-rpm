/** 本地规则（storage.local `fluxdown_local_rules`）的解析、导入 / 导出打包与合并。纯函数。 */
import { RULE_ENGINE_VERSION, type RulePack, type RuleOverrides, type SniffRuleV1 } from "@/rules/schema";
import { PackRejectedError, validatePack } from "@/rules/validate";
import { isRecord } from "./guards";

export const LOCAL_RULES_KEY = "fluxdown_local_rules";
export const RULE_OVERRIDES_KEY = "fluxdown_rule_overrides";

/** 宽松读取存储值：非数组 → []；只保留 tier=local 且带字符串 id 的对象（字段合法性由 validatePack 把关）。 */
export function parseLocalRules(raw: unknown): SniffRuleV1[] {
  if (!Array.isArray(raw)) return [];
  const rules: SniffRuleV1[] = [];
  for (const item of raw) {
    if (isRecord(item) && item.tier === "local" && typeof item.id === "string") {
      // 形状已按 tier / id 收窄，其余字段交给 validatePack。
      const rule = item as unknown as SniffRuleV1;
      rules.push(rule);
    }
  }
  return rules;
}

export function parseOverrides(raw: unknown): RuleOverrides {
  const out: RuleOverrides = {};
  if (!isRecord(raw)) return out;
  for (const [id, value] of Object.entries(raw)) {
    if (!isRecord(value) || typeof value.enabled !== "boolean") continue;
    const ack = value.ackRevocation;
    out[id] =
      typeof ack === "number" && Number.isInteger(ack)
        ? { enabled: value.enabled, ackRevocation: ack }
        : { enabled: value.enabled };
  }
  return out;
}

export function buildLocalPack(rules: SniffRuleV1[], now: number): RulePack {
  return {
    format: "fluxdown-sniff-pack",
    packId: "local",
    sequence: 0,
    engine: RULE_ENGINE_VERSION,
    issuedAt: new Date(now).toISOString(),
    rules,
  };
}

export type ImportParse =
  | { ok: true; accepted: SniffRuleV1[]; rejected: { id: string; reason: string }[] }
  | { ok: false; error: string };

/** 解析并校验导入文件（local 包）；整包不合格返回 error，单条不合格进 rejected。 */
export function parseLocalPack(text: string): ImportParse {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  try {
    // validatePack 自身对非对象 / 缺字段整包拒绝，入参形状在其内部检查。
    const pack = json as RulePack;
    const checked = validatePack(pack, "local");
    return { ok: true, accepted: checked.pack.rules, rejected: checked.rejected };
  } catch (e) {
    if (e instanceof PackRejectedError) return { ok: false, error: e.message };
    throw e;
  }
}

/** 同 id 覆盖（version 取 max(导入版本, 原版本+1)，保证后台能感知变化），新 id 追加。 */
export function mergeImported(
  existing: SniffRuleV1[],
  accepted: SniffRuleV1[],
): { rules: SniffRuleV1[]; added: number; replaced: number } {
  const rules = [...existing];
  let added = 0;
  let replaced = 0;
  for (const incoming of accepted) {
    const at = rules.findIndex((r) => r.id === incoming.id);
    if (at === -1) {
      rules.push(incoming);
      added++;
    } else {
      rules[at] = { ...incoming, version: Math.max(incoming.version, rules[at].version + 1) };
      replaced++;
    }
  }
  return { rules, added, replaced };
}

/** 嗅探规则仓（官方 / 社区规则源，Issue 表单提交入口）。 */
export const SNIFF_RULES_REPO = "https://github.com/zerx-lab/fluxdown-sniff-rules";
/** GitHub 预填地址的安全长度；超出时规则改走剪贴板，由用户粘贴进表单。 */
const MAX_PREFILL_URL = 8000;

export type CommunitySubmission =
  | { ok: true; url: string; prefilled: boolean; json: string }
  | { ok: false; reason: string };

/**
 * 本地规则 → 社区规则提交：`local.x` 改写为 `community.misc.x`（规则仓托管的 misc 命名空间；
 * 长期维护者改为在自己的仓库发布并登记）、version 从 1 开始，按社区层校验（必须限定站点、
 * 不能用 preempt 等），再生成预填好的「提交社区规则」Issue 表单地址。
 * 规则仓的机器人会做同样的改写与校验，这里提前拦下注定失败的提交。
 */
export function communitySubmission(rule: SniffRuleV1): CommunitySubmission {
  const candidate: SniffRuleV1 = {
    ...rule,
    id: `community.misc.${rule.id.slice(rule.id.indexOf(".") + 1)}`,
    tier: "community",
    version: 1,
  };
  try {
    const { rejected } = validatePack({ ...buildLocalPack([candidate], 0), packId: "community" }, "community");
    if (rejected.length > 0) return { ok: false, reason: rejected[0].reason };
  } catch (e) {
    if (e instanceof PackRejectedError) return { ok: false, reason: e.message };
    throw e;
  }
  const json = JSON.stringify(candidate, null, 2);
  const params = new URLSearchParams({ template: "community-rule.yml", title: rule.title || candidate.id });
  const base = `${SNIFF_RULES_REPO}/issues/new?${params}`;
  const full = `${base}&${new URLSearchParams({ rule: json })}`;
  return full.length <= MAX_PREFILL_URL
    ? { ok: true, url: full, prefilled: true, json }
    : { ok: true, url: base, prefilled: false, json };
}
