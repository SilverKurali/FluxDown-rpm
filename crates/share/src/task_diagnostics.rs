//! 任务详情「传输诊断」页签：一个快传接收任务所属会话的路径时间线、逐路径统计与会话摘要。
//!
//! 视图嵌在详情面板 / 详情窗口里：自己滚动、紧凑、不创建窗口。空闲静默：只在视图实际渲染（可见）时
//! 取数；hub 变化经节流合并，隐藏期间不产生请求（状态机见 [`crate::model::refresh::VisibleRefresh`]）。

use std::time::Instant;

use fluxdown_protocol::{RpcErrorData, ShareDiagnosticsDto, ShareDiagnosticsParams, SharePathKind};
use fluxdown_ui_components::{ButtonVariant, ControlExt as _, FluxIcon, loading_icon_button};
use fluxdown_ui_i18n::Translator;
use fluxdown_ui_theme::active_theme;
use gpui::{
    Context, Div, Entity, IntoElement, ParentElement as _, Render, StatefulInteractiveElement as _,
    Styled as _, Window, div, prelude::FluentBuilder as _,
};
use gpui_component::{
    Disableable as _, Icon,
    button::{Button, ButtonVariants as _},
    h_flex,
    scroll::ScrollableElement as _,
    v_flex,
};

use crate::{
    hub::ShareHub,
    manage_ui::{chip, clipped, empty_state, kv_row, meta_text, text, tooltip_builder},
    model::{
        diagnostics::find_session,
        nat_key, path_kind_key,
        refresh::{GateAction, VisibleRefresh},
    },
    session_view::{path_tone, session_detail},
    switch_to_bridge,
};

/// 两次取数之间的最短间隔（毫秒）。
const MIN_REFRESH_MS: u64 = 2_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Load {
    Loading,
    Ready,
    Failed,
}

/// 任务「传输诊断」视图。
pub struct ShareDiagnosticsView {
    hub: Entity<ShareHub>,
    translator: Entity<Translator>,
    task_id: String,
    epoch: Instant,
    refresh: VisibleRefresh,
    request: u64,
    load: Load,
    /// 当前 `diagnostics` 对应的会话 ID；任务换了承载会话后丢弃旧数据重新取。
    fetched_session: Option<String>,
    diagnostics: Option<ShareDiagnosticsDto>,
}

impl ShareDiagnosticsView {
    /// 创建某个下载任务的「传输诊断」视图；任务没有快传会话时显示空状态。
    pub fn new(
        hub: Entity<ShareHub>,
        task_id: String,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let translator = hub.read(cx).translator().clone();
        cx.observe(&hub, |this, _, cx| {
            this.refresh.mark_dirty();
            cx.notify();
        })
        .detach();
        cx.observe(&translator, |_, _, cx| cx.notify()).detach();
        Self {
            hub,
            translator,
            task_id,
            epoch: Instant::now(),
            refresh: VisibleRefresh::new(MIN_REFRESH_MS),
            request: 0,
            load: Load::Loading,
            fetched_session: None,
            diagnostics: None,
        }
    }

    /// 任务详情切换到另一个任务时复用本视图。
    pub fn set_task(&mut self, task_id: String, cx: &mut Context<Self>) {
        if self.task_id == task_id {
            return;
        }
        self.task_id = task_id;
        self.diagnostics = None;
        self.fetched_session = None;
        self.load = Load::Loading;
        self.request += 1;
        self.refresh.mark_dirty();
        cx.notify();
    }

    fn now_ms(&self) -> u64 {
        u64::try_from(self.epoch.elapsed().as_millis()).unwrap_or(u64::MAX)
    }

    /// 任务当前承载的会话 ID（`task_facts[task].sessionId`）。
    fn session_id(&self, cx: &gpui::App) -> Option<String> {
        self.hub
            .read(cx)
            .task_facts(&self.task_id)
            .and_then(|facts| facts.session_id.clone())
            .filter(|id| !id.is_empty())
    }

    /// 渲染时调用：会话变化则丢弃旧数据；可见且需要时经节流取数。
    fn refresh_if_needed(&mut self, session_id: Option<&str>, cx: &mut Context<Self>) {
        if self.fetched_session.as_deref() != session_id && self.diagnostics.is_some() {
            self.diagnostics = None;
            self.fetched_session = None;
            self.load = Load::Loading;
            self.refresh.mark_dirty();
        }
        let now = self.now_ms();
        let action = self.refresh.on_render(now);
        let Some(session_id) = session_id else {
            return;
        };
        match action {
            Some(GateAction::Fetch) => self.start_fetch(session_id.to_owned(), cx),
            Some(GateAction::Wait(delay)) => {
                cx.spawn(async move |this, cx| {
                    cx.background_executor().timer(delay).await;
                    let Ok(()) = this.update(cx, |this, cx| {
                        this.refresh.timer_fired();
                        cx.notify();
                    }) else {
                        return;
                    };
                })
                .detach();
            }
            Some(GateAction::Skip) | None => {}
        }
    }

    fn start_fetch(&mut self, session_id: String, cx: &mut Context<Self>) {
        self.request += 1;
        let request = self.request;
        let future = self
            .hub
            .read(cx)
            .api()
            .diagnostics(&ShareDiagnosticsParams {
                session_id: Some(session_id.clone()),
            });
        cx.spawn(async move |this, cx| {
            let result = future.await;
            let Ok(()) = this.update(cx, |this, cx| {
                this.finish_fetch(request, session_id, result, cx)
            }) else {
                return;
            };
        })
        .detach();
    }

    fn finish_fetch(
        &mut self,
        request: u64,
        session_id: String,
        result: Result<ShareDiagnosticsDto, RpcErrorData>,
        cx: &mut Context<Self>,
    ) {
        if request != self.request {
            return;
        }
        match result {
            Ok(diagnostics) => {
                self.diagnostics = Some(diagnostics);
                self.fetched_session = Some(session_id);
                self.load = Load::Ready;
            }
            Err(_) => self.load = Load::Failed,
        }
        cx.notify();
    }

    fn refresh_now(&mut self, cx: &mut Context<Self>) {
        let Some(session_id) = self.session_id(cx) else {
            return;
        };
        self.refresh.manual_started(self.now_ms());
        self.load = if self.diagnostics.is_some() {
            self.load
        } else {
            Load::Loading
        };
        self.start_fetch(session_id, cx);
        cx.notify();
    }
}

impl Render for ShareDiagnosticsView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let session_id = self.session_id(cx);
        self.refresh_if_needed(session_id.as_deref(), cx);

        let theme = active_theme(cx);
        let tokens = theme.tokens().clone();
        let translator = self.translator.read(cx).clone();
        let stale = self.hub.read(cx).is_stale();
        let facts = self.hub.read(cx).task_facts(&self.task_id).cloned();

        let root = v_flex()
            .size_full()
            .min_h_0()
            .gap(tokens.spacing.md)
            .p(tokens.spacing.md);

        let Some(session_id) = session_id else {
            return root
                .child(empty_state(
                    FluxIcon::Network,
                    None,
                    text(&translator, "shareDiagNoSession"),
                    None,
                    cx,
                ))
                .overflow_y_scrollbar()
                .id("share-diag-scroll");
        };

        let relay_stuck = facts.as_ref().is_some_and(|facts| facts.relay_stuck);
        let loading = self.load == Load::Loading;
        let label = text(&translator, "shareNetRefresh");

        // 标题行：标题 + 当前路径徽标 + 刷新。
        let mut title = h_flex()
            .w_full()
            .items_center()
            .gap(tokens.spacing.sm)
            .child(
                div()
                    .min_w_0()
                    .truncate()
                    .text_size(tokens.typography.sm.size)
                    .line_height(tokens.typography.sm.line_height)
                    .font_weight(gpui::FontWeight::MEDIUM)
                    .text_color(tokens.colors.foreground)
                    .child(text(&translator, "shareDiagTitle")),
            );
        if let Some(facts) = facts.as_ref() {
            title = title.child(chip(
                "share-diag-kind",
                text(&translator, path_kind_key(facts.path_kind)),
                path_tone(facts.path_kind, cx),
                cx,
            ));
        }
        title = title.child(div().flex_1()).child(
            loading_icon_button(
                "share-diag-refresh",
                label.clone(),
                Icon::new(FluxIcon::RotateCw).size(theme.extended().icon.md),
                ButtonVariant::Ghost,
                loading,
                cx,
            )
            .tooltip(tooltip_builder(label))
            .disabled(stale || loading)
            .on_click(cx.listener(|this, _, _, cx| this.refresh_now(cx))),
        );
        let mut root = root.child(title);

        let can_switch = facts
            .as_ref()
            .is_some_and(|facts| facts.path_kind != SharePathKind::Bridge);
        if can_switch {
            root = root.child(self.render_switch_bridge(&translator, relay_stuck, stale, cx));
        }

        let detail = self
            .diagnostics
            .as_ref()
            .and_then(|diagnostics| find_session(diagnostics, &session_id));
        root = match (detail, self.load) {
            (Some(detail), _) => root.child(session_detail(
                detail,
                &translator,
                &format!("share-diag-{session_id}"),
                cx,
            )),
            (None, Load::Failed) => root
                .child(meta_text(cx).child(text(&translator, "shareDiagLoadFailed")))
                .child(
                    h_flex().child(
                        Button::new("share-diag-retry")
                            .outline()
                            .label(text(&translator, "shareRetry"))
                            .control(cx)
                            .disabled(stale)
                            .on_click(cx.listener(|this, _, _, cx| this.refresh_now(cx))),
                    ),
                ),
            (None, Load::Loading) => {
                root.child(meta_text(cx).child(text(&translator, "shareDiagLoading")))
            }
            (None, Load::Ready) => root
                .child(meta_text(cx).child(text(&translator, "shareDiagSessionGone")))
                .when_some(facts.as_ref(), |this, facts| {
                    let mut rows = v_flex().w_full().gap(tokens.spacing.xs).child(kv_row(
                        text(&translator, "shareDiagPeerNat"),
                        text(&translator, nat_key(facts.peer_nat_type)),
                        cx,
                    ));
                    if let Some(isp) = facts.peer_isp.as_deref().filter(|isp| !isp.is_empty()) {
                        rows = rows.child(kv_row(
                            text(&translator, "shareDiagPeerCarrier"),
                            clipped("share-diag-facts-isp", isp.to_owned()),
                            cx,
                        ));
                    }
                    this.child(rows)
                }),
        };
        root.overflow_y_scrollbar().id("share-diag-scroll")
    }
}

impl ShareDiagnosticsView {
    /// 「切换桥接」入口：仍在走中继时配说明并高亮（主按钮 + 警示框），其余路径只给普通按钮。
    fn render_switch_bridge(
        &self,
        translator: &Translator,
        relay_stuck: bool,
        stale: bool,
        cx: &mut Context<Self>,
    ) -> Div {
        let theme = active_theme(cx);
        let tokens = theme.tokens().clone();
        let hub = self.hub.clone();
        let task_id = self.task_id.clone();
        let button = Button::new("share-diag-switch-bridge")
            .label(text(translator, "shareSwitchBridge"))
            .control(cx)
            .disabled(stale)
            .on_click(move |_, window, cx| {
                switch_to_bridge(&hub, &task_id, window, cx);
            });
        if !relay_stuck {
            return h_flex().w_full().child(button.outline());
        }
        v_flex()
            .w_full()
            .gap(tokens.spacing.sm)
            .p(tokens.spacing.md)
            .rounded(tokens.radius.md)
            .border_1()
            .border_color(theme.extended().colors.warning)
            .child(
                div()
                    .text_size(tokens.typography.sm.size)
                    .line_height(tokens.typography.sm.line_height)
                    .text_color(tokens.colors.foreground)
                    .child(text(translator, "shareDiagRelayStuck")),
            )
            .child(h_flex().child(button.primary()))
    }
}
