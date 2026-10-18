import { describe, expect, test } from "bun:test";
import cases from "./fixtures/engine-cases.json";
import {
  BUILTIN_PACK,
  BUNDLED_OFFICIAL_PACK,
  compileBundled,
  compileRules,
  effectiveOfficialPack,
  type CompiledRules,
} from "./engine";
import type { RuleOverrides, RulePack, RevocationDoc } from "./schema";
import { TIER_RANK } from "./schema";
import { validatePack } from "./validate";

interface Setup {
  packs?: RulePack[];
  overrides?: RuleOverrides;
  revocations?: RevocationDoc | null;
  options?: { sniffImages?: boolean; communityEnabled?: boolean; now?: number };
}

interface Case {
  name: string;
  setup?: Setup;
  call: Exclude<keyof CompiledRules, "listRules" | "knownExtensions">;
  args: unknown[];
  expect: unknown;
}

const DEFAULT_NOW = Date.parse("2026-01-01T00:00:00Z");

function build(setup: Setup = {}): CompiledRules {
  return compileRules({
    packs: [BUILTIN_PACK, BUNDLED_OFFICIAL_PACK, ...(setup.packs ?? [])],
    overrides: setup.overrides ?? {},
    revocations: setup.revocations ?? null,
    options: {
      sniffImages: setup.options?.sniffImages ?? false,
      communityEnabled: setup.options?.communityEnabled ?? true,
      now: setup.options?.now ?? DEFAULT_NOW,
    },
  });
}

describe("engine fixtures", () => {
  for (const c of cases as unknown as Case[]) {
    test(c.name, () => {
      const engine = build(c.setup);
      const fn = engine[c.call] as (...a: unknown[]) => unknown;
      const actual = fn.apply(engine, c.args);
      if (c.expect !== null && typeof c.expect === "object") {
        expect(actual).toMatchObject(c.expect as object);
      } else {
        expect(actual).toEqual(c.expect);
      }
    });
  }
});

describe("随包规则", () => {
  test("builtin 与官方包快照自身通过校验且无剔除", () => {
    for (const pack of [BUILTIN_PACK, BUNDLED_OFFICIAL_PACK]) {
      const { rejected, pack: checked } = validatePack(pack, pack.packId);
      expect(rejected).toEqual([]);
      expect(checked.rules.length).toBe(pack.rules.length);
    }
  });

  test("compileBundled 全部规则生效", () => {
    const list = compileBundled().listRules();
    expect(list.length).toBe(BUILTIN_PACK.rules.length + BUNDLED_OFFICIAL_PACK.rules.length);
    expect(list.every((e) => e.status === "active")).toBe(true);
  });

  test("knownExtensions 含 mp4 与 jpg", () => {
    const known = compileBundled().knownExtensions();
    expect(known.has("mp4")).toBe(true);
    expect(known.has("jpg")).toBe(true);
  });

  test("远程官方包只有 sequence 不低于快照时才取代快照", () => {
    const at = (sequence: number): RulePack => ({ ...BUNDLED_OFFICIAL_PACK, sequence, rules: [] });
    expect(effectiveOfficialPack(undefined)).toBe(BUNDLED_OFFICIAL_PACK);
    const older = at(BUNDLED_OFFICIAL_PACK.sequence - 1);
    expect(effectiveOfficialPack(older)).toBe(BUNDLED_OFFICIAL_PACK);
    const same = at(BUNDLED_OFFICIAL_PACK.sequence);
    expect(effectiveOfficialPack(same)).toBe(same);
    const newer = at(BUNDLED_OFFICIAL_PACK.sequence + 1);
    expect(effectiveOfficialPack(newer)).toBe(newer);
  });
});

describe("listRules 状态", () => {
  test("engine 过新的包整包标记 engine-too-new", () => {
    const pack = {
      ...BUILTIN_PACK,
      packId: "official",
      engine: 99,
      rules: [{ ...BUILTIN_PACK.rules[0], id: "official.future", tier: "official" }],
    } as unknown as RulePack;
    const list = compileRules({
      packs: [pack],
      overrides: {},
      revocations: null,
      options: { sniffImages: false, communityEnabled: true, now: DEFAULT_NOW },
    }).listRules();
    expect(list.map((e) => e.status)).toEqual(["engine-too-new"]);
  });
});

describe("plugin 层级", () => {
  test("优先级：local < official < plugin < community < builtin", () => {
    expect(TIER_RANK.local).toBeLessThan(TIER_RANK.official);
    expect(TIER_RANK.official).toBeLessThan(TIER_RANK.plugin);
    expect(TIER_RANK.plugin).toBeLessThan(TIER_RANK.community);
    expect(TIER_RANK.community).toBeLessThan(TIER_RANK.builtin);
  });

  test("plugin 包规则可编译并生效", () => {
    const pack = {
      format: "fluxdown-sniff-pack",
      packId: "plugin",
      sequence: 1,
      engine: 1,
      issuedAt: "2026-01-01T00:00:00Z",
      rules: [
        { id: "plugin.a.b.r1", version: 1, tier: "plugin", stage: "response", match: { host: ["x.com"], ext: ["abc"] }, action: { kind: "resource", type: "other" } },
      ],
    } as unknown as RulePack;
    const list = build({ packs: [pack] }).listRules();
    const entry = list.find((e) => e.rule.id === "plugin.a.b.r1");
    expect(entry?.status).toBe("active");
  });
});

describe("page / request / mirror / manifest 规则", () => {
  const local = (rules: unknown[]): RulePack =>
    ({ format: "fluxdown-sniff-pack", packId: "local", sequence: 1, engine: 1, issuedAt: "2026-01-01T00:00:00Z", rules }) as RulePack;
  const engine = build({
    packs: [local([
      { id: "local.title", version: 1, tier: "local", stage: "page", match: { pageHost: ["v.example.com"] }, action: { kind: "title", selector: ".t", attr: "data-name" } },
      { id: "local.ad", version: 1, tier: "local", stage: "page", match: { pageHost: ["v.example.com"] }, action: { kind: "player", selector: ".ad", float: "hide" } },
      { id: "local.ref", version: 1, tier: "local", stage: "request", match: { host: ["cdn.example.com"] }, action: { kind: "headers", set: { Referer: "https://v.example.com/" } } },
      { id: "local.mirror", version: 1, tier: "local", stage: "normalize", match: {}, action: { kind: "mirror", hosts: ["cdn.example.com", "bak.example.net"] } },
      { id: "local.api", version: 1, tier: "local", stage: "body", match: { url: ["*/api/play*"] }, action: { kind: "manifest", path: "data.streams" } },
    ])],
  });

  test("pageHints 只在匹配的页面生效", () => {
    expect(engine.pageHints("https://v.example.com/watch/1")).toEqual({
      titles: [{ selector: ".t", attr: "data-name" }],
      players: [{ selector: ".ad" }],
    });
    expect(engine.pageHints("https://other.example.org/")).toEqual({ titles: [], players: [] });
  });

  test("requestHeaders 按 URL host 匹配，名字小写", () => {
    expect(engine.requestHeaders("https://cdn.example.com/a.mp4", "https://v.example.com/")).toEqual({ referer: "https://v.example.com/" });
    expect(engine.requestHeaders("https://elsewhere.com/a.mp4", "https://v.example.com/")).toEqual({});
  });

  test("mirrorGroups 与 manifestsFromBody", () => {
    expect(engine.mirrorGroups()).toEqual([["cdn.example.com", "bak.example.net"]]);
    const body = { data: { streams: { video: [{ baseUrl: "https://cdn.example.com/1.mp4" }] } } };
    expect(engine.manifestsFromBody("https://v.example.com/api/play?id=1", "https://v.example.com/", body)).toEqual([
      body.data.streams,
    ]);
    expect(engine.bodyWatchers("https://v.example.com/").some((w) => w.rule.id === "local.api")).toBe(true);
  });
});

describe("社区规则的站点范围", () => {
  const community = (rules: unknown[]): RulePack =>
    ({ format: "fluxdown-sniff-pack", packId: "community", sequence: 1, engine: 1, issuedAt: "2026-01-01T00:00:00Z", expiresAt: "2027-01-01T00:00:00Z", rules }) as RulePack;
  const revocations = { format: "fluxdown-sniff-revocations", sequence: 1, issuedAt: "2026-01-01T00:00:00Z", expiresAt: "2027-01-01T00:00:00Z", entries: [] } as RevocationDoc;
  const engine = build({
    revocations,
    packs: [community([
      { id: "community.a.api", version: 1, tier: "community", stage: "body", match: { host: ["example.com", "example-cdn.net"] }, action: { kind: "extract", fields: { u: "u" }, emit: { mode: "resource", url: "${u}" } } },
      { id: "community.a.link", version: 1, tier: "community", stage: "dom", match: { pageHost: ["example.com"] }, action: { kind: "dom", selector: "a", attr: "href", emit: { mode: "resource", url: "${value}" } } },
    ])],
  });

  test("extract 只产出作用站点内的地址", () => {
    const urls = (u: string) =>
      engine.extractFromBody("https://example.com/api", "https://example.com/", { u }).flatMap((x) => x.emits.map((e) => e.url));
    expect(urls("https://dl.example-cdn.net/a.zip")).toEqual(["https://dl.example-cdn.net/a.zip"]);
    expect(urls("https://evil.test/a.zip")).toEqual([]);
  });

  test("dom 规则同样受限", () => {
    const rule = engine.domRules("https://example.com/p")[0];
    const render = (value: string) => engine.renderDomEmit(rule.rule, rule.emit, { value, text: "", page: "https://example.com/p" });
    expect(render("https://www.example.com/a.zip")?.url).toBe("https://www.example.com/a.zip");
    expect(render("https://evil.test/a.zip")).toBeNull();
  });
});
