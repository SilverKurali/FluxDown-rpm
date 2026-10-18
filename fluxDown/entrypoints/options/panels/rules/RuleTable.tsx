import type { JSX } from "preact";
import { useMemo, useState } from "preact/hooks";
import type { RulesListEntry } from "@/background/protocol";
import type { RuleStatus } from "@/rules/engine";
import type { RuleOverrides, RuleTier, SniffRuleV1 } from "@/rules/schema";
import { Badge } from "@/ui/components/Badge";
import { Button } from "@/ui/components/Button";
import { EmptyState } from "@/ui/components/EmptyState";
import { IconButton } from "@/ui/components/IconButton";
import { Modal } from "@/ui/components/Modal";
import { Select } from "@/ui/components/Select";
import { TextInput } from "@/ui/components/TextInput";
import { Toggle } from "@/ui/components/Toggle";
import { useT } from "@/ui/i18n";
import { DEFAULT_PAGE_SIZE, type PageSize, paginate } from "../../lib/pagination";
import { Pagination } from "../../parts";

interface RuleTableProps {
  entries: RulesListEntry[];
  overrides: RuleOverrides;
  /** 当前吊销列表的 sequence；没有时无法确认「仍然启用」。 */
  revocationSequence: number | null;
  onOverridesChange: (next: RuleOverrides) => void;
}

type TierFilter = RuleTier | "all";

/**
 * 内置规则是否可查看原文。开发与本地构建默认可看；发布流水线（release.yml）构建时
 * 设 `WXT_HIDE_BUILTIN_RULES=1`，商店 / Release 包不展示内置规则的真实内容。
 */
const BUILTIN_RULE_PREVIEW = import.meta.env.WXT_HIDE_BUILTIN_RULES !== "1";

const TIER_TONES: Record<RuleTier, "neutral" | "accent" | "warning" | "success"> = {
  builtin: "neutral",
  official: "accent",
  plugin: "accent",
  community: "warning",
  local: "success",
};

const STATUS_TONES: Record<RuleStatus, "neutral" | "success" | "warning" | "danger"> = {
  active: "success",
  disabled: "neutral",
  "soft-revoked": "warning",
  "hard-revoked": "danger",
  expired: "warning",
  "engine-too-new": "warning",
};

/** 这些状态下开关不可操作（撤回用独立按钮，其余由包本身决定）。 */
const LOCKED_STATUSES: Record<RuleStatus, boolean> = {
  active: false,
  disabled: false,
  "soft-revoked": true,
  "hard-revoked": true,
  expired: true,
  "engine-too-new": true,
};

export function RuleTable(props: RuleTableProps): JSX.Element {
  const t = useT();
  const [tier, setTier] = useState<TierFilter>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);
  const [previewing, setPreviewing] = useState<SniffRuleV1 | null>(null);

  const tierLabels: Record<RuleTier, string> = {
    builtin: t("rules.tier.builtin"),
    official: t("rules.tier.official"),
    plugin: t("rules.tier.plugin"),
    community: t("rules.tier.community"),
    local: t("rules.tier.local"),
  };
  const statusLabels: Record<RuleStatus, string> = {
    active: t("rules.status.active"),
    disabled: t("rules.status.disabled"),
    "soft-revoked": t("rules.status.softRevoked"),
    "hard-revoked": t("rules.status.hardRevoked"),
    expired: t("rules.status.expired"),
    "engine-too-new": t("rules.status.engineTooNew"),
  };
  const stageLabels: Record<string, string> = {
    response: t("rules.stage.response"),
    normalize: t("rules.stage.normalize"),
    track: t("rules.stage.track"),
    body: t("rules.stage.body"),
    dom: t("rules.stage.dom"),
  };

  const needle = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      props.entries.filter(({ rule }) => {
        if (tier !== "all" && rule.tier !== tier) return false;
        if (!needle) return true;
        return rule.id.toLowerCase().includes(needle) || (rule.title ?? "").toLowerCase().includes(needle);
      }),
    [props.entries, tier, needle],
  );
  // 规则列表重取 / 筛选变化后页码可能越界，渲染时钳到最后一页。
  const slice = paginate(filtered.length, page, pageSize);
  const visible = filtered.slice(slice.start, slice.end);

  const setEnabled = (id: string, enabled: boolean) => {
    const previous = props.overrides[id];
    const next = { enabled, ...(previous?.ackRevocation !== undefined ? { ackRevocation: previous.ackRevocation } : {}) };
    props.onOverridesChange({ ...props.overrides, [id]: next });
  };

  const keepEnabled = (id: string) => {
    if (props.revocationSequence === null) return;
    props.onOverridesChange({
      ...props.overrides,
      [id]: { enabled: true, ackRevocation: props.revocationSequence },
    });
  };

  return (
    <div class="opt-card">
      <div class="opt-card-head">
        <h2 class="opt-card-title">{t("rules.table.title")}</h2>
        <div class="opt-filters">
          <Select<TierFilter>
            value={tier}
            onChange={(v) => {
              setTier(v);
              setPage(1);
            }}
            label={t("rules.table.filterTier")}
            options={[
              { value: "all", label: t("rules.table.allTiers") },
              { value: "builtin", label: tierLabels.builtin },
              { value: "official", label: tierLabels.official },
              { value: "plugin", label: tierLabels.plugin },
              { value: "community", label: tierLabels.community },
              { value: "local", label: tierLabels.local },
            ]}
          />
          <TextInput
            type="search"
            value={query}
            placeholder={t("rules.table.search")}
            onInput={(v) => {
              setQuery(v);
              setPage(1);
            }}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon="search" title={t("rules.table.empty")} />
      ) : (
        <div class="opt-table-wrap">
          <table class="opt-table">
            <thead>
              <tr>
                <th class="opt-col-toggle">{t("rules.table.colEnabled")}</th>
                <th>{t("rules.table.colRule")}</th>
                <th>{t("rules.table.colTier")}</th>
                <th>{t("rules.table.colStage")}</th>
                <th>{t("rules.table.colVersion")}</th>
                <th>{t("rules.table.colStatus")}</th>
                {BUILTIN_RULE_PREVIEW ? <th class="opt-col-actions">{t("options.sites.colActions")}</th> : null}
              </tr>
            </thead>
            <tbody>
              {visible.map(({ rule, status, reason }) => (
                <tr key={rule.id}>
                  <td class="opt-col-toggle">
                    <Toggle
                      checked={status === "active"}
                      disabled={LOCKED_STATUSES[status]}
                      label={rule.title || rule.id}
                      onChange={(v) => setEnabled(rule.id, v)}
                    />
                  </td>
                  <td>
                    <div class="opt-rule-title">{rule.title || rule.id}</div>
                    {rule.title ? <div class="opt-cell-mono opt-rule-id">{rule.id}</div> : null}
                  </td>
                  <td>
                    <Badge tone={TIER_TONES[rule.tier]}>{tierLabels[rule.tier]}</Badge>
                  </td>
                  <td>{stageLabels[rule.stage] ?? rule.stage}</td>
                  <td class="opt-cell-mono">{rule.version}</td>
                  <td>
                    <div class="opt-status-cell">
                      <Badge tone={STATUS_TONES[status]} title={reason}>
                        {statusLabels[status]}
                      </Badge>
                      {status === "soft-revoked" ? (
                        <Button
                          size="sm"
                          disabled={props.revocationSequence === null}
                          title={reason}
                          onClick={() => keepEnabled(rule.id)}
                        >
                          {t("rules.table.keepEnabled")}
                        </Button>
                      ) : null}
                    </div>
                  </td>
                  {BUILTIN_RULE_PREVIEW ? (
                    <td class="opt-col-actions">
                      {rule.tier === "builtin" ? (
                        <IconButton icon="eye" label={t("rules.table.viewRule")} onClick={() => setPreviewing(rule)} />
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        total={filtered.length}
        slice={slice}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />

      {previewing ? (
        <Modal title={previewing.title || previewing.id} width={640} onClose={() => setPreviewing(null)}>
          <pre class="opt-json opt-json-view">{JSON.stringify(previewing, null, 2)}</pre>
        </Modal>
      ) : null}
    </div>
  );
}
