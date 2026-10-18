import { describe, expect, test } from "bun:test";
import type { SniffRuleV1 } from "@/rules/schema";
import { SNIFF_RULES_REPO, communitySubmission } from "./local-rules";

const rule: SniffRuleV1 = {
  id: "local.example-video",
  version: 4,
  tier: "local",
  title: "Example video",
  stage: "response",
  match: { host: ["example.com"], ext: ["xyz"] },
  action: { kind: "resource", type: "video" },
};

describe("communitySubmission", () => {
  test("改写为社区规则并预填 Issue 表单", () => {
    const result = communitySubmission(rule);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prefilled).toBe(true);
    const url = new URL(result.url);
    expect(`${url.origin}${url.pathname}`).toBe(`${SNIFF_RULES_REPO}/issues/new`);
    expect(url.searchParams.get("template")).toBe("community-rule.yml");
    expect(url.searchParams.get("title")).toBe("Example video");
    const submitted = JSON.parse(url.searchParams.get("rule") ?? "");
    expect(submitted).toEqual({ ...rule, id: "community.misc.example-video", tier: "community", version: 1 });
  });

  test("不满足社区层约束的规则不生成提交", () => {
    const result = communitySubmission({ ...rule, match: { ext: ["xyz"] } });
    expect(result).toEqual({ ok: false, reason: "社区规则必须限定 host 或 pageHost" });
  });

  test("规则过长时不预填，改由剪贴板携带", () => {
    const long = { ...rule, exclude: [{ url: Array.from({ length: 80 }, (_, i) => `https://example.com/${"x".repeat(80)}/${i}*`) }] };
    const result = communitySubmission(long);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prefilled).toBe(false);
    expect(new URL(result.url).searchParams.has("rule")).toBe(false);
    expect(JSON.parse(result.json).id).toBe("community.misc.example-video");
  });
});
