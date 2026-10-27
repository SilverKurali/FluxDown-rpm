//! 管理页顶栏：取件码 / 链接输入与页签条。

use fluxdown_ui_components::{ControlExt as _, FluxIcon, field_error, segmented_tabs};
use fluxdown_ui_i18n::Translator;
use fluxdown_ui_theme::active_theme;
use gpui::{
    App, Context, Div, ParentElement as _, Styled as _, Window, div, prelude::FluentBuilder as _,
};
use gpui_component::{
    Disableable as _, Icon,
    button::{Button, ButtonVariants as _},
    h_flex,
    input::Input,
    v_flex,
};

use super::ShareView;
use crate::{
    manage_ui::text,
    model::{
        DEFAULT_PICKUP_CODE_LEN, parse_receive_input,
        records::{MANAGE_TABS, tab_from_index, tab_index, tab_key},
    },
};

/// 顶栏输入框宽度（默认字号下的 px）。
const PICKUP_INPUT_WIDTH: f32 = 360.;

impl ShareView {
    pub(super) fn code_len(&self, cx: &App) -> usize {
        match self.hub.read(cx).state().policy_summary.pickup_code_length {
            0 => DEFAULT_PICKUP_CODE_LEN,
            len => usize::from(len),
        }
    }

    pub(super) fn submit_receive(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.hub.read(cx).is_stale() {
            return;
        }
        let value = self.input.read(cx).value().to_string();
        let Some(input) = parse_receive_input(&value, self.code_len(cx)) else {
            self.input_invalid = true;
            cx.notify();
            return;
        };
        self.input_invalid = false;
        self.input
            .update(cx, |state, cx| state.set_value("", window, cx));
        let open = self.hub.read(cx).host().open_receive.clone();
        if let Some(open) = open {
            open(input.as_wire().to_owned(), window, cx);
        }
        cx.notify();
    }

    pub(super) fn render_top_bar(&self, translator: &Translator, cx: &mut Context<Self>) -> Div {
        let theme = active_theme(cx);
        let tokens = theme.tokens().clone();
        let stale = self.hub.read(cx).is_stale();
        v_flex()
            .w_full()
            .gap(tokens.spacing.xs)
            .child(
                h_flex()
                    .w_full()
                    .items_center()
                    .gap(tokens.spacing.sm)
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .max_w(theme.text_extent(PICKUP_INPUT_WIDTH))
                            .child(
                                Input::new(&self.input).control(cx).w_full().prefix(
                                    Icon::new(FluxIcon::Link)
                                        .size(theme.extended().icon.md)
                                        .text_color(theme.extended().colors.text_tertiary),
                                ),
                            ),
                    )
                    .child(
                        Button::new("share-receive")
                            .primary()
                            .label(text(translator, "shareReceive"))
                            .control(cx)
                            .disabled(stale)
                            .on_click(cx.listener(|this, _, window, cx| {
                                this.submit_receive(window, cx);
                            })),
                    ),
            )
            .when(self.input_invalid, |this| {
                this.child(field_error(text(translator, "shareInputInvalid"), cx))
            })
    }

    pub(super) fn render_tabs(&self, translator: &Translator, cx: &mut Context<Self>) -> Div {
        let view = cx.weak_entity();
        h_flex().w_full().child(segmented_tabs(
            "share-tabs",
            MANAGE_TABS
                .iter()
                .map(|tab| text(translator, tab_key(*tab))),
            tab_index(self.tab),
            move |index, _, cx| {
                let Ok(()) = view.update(cx, |this, cx| {
                    this.select_tab(tab_from_index(index), cx);
                }) else {
                    // 管理页已释放，结束这次回调而不再更新状态。
                    return;
                };
            },
            cx,
        ))
    }
}
