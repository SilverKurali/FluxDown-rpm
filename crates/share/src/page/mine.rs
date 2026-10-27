//! 「我的分享」页签：分享列表、行内操作（复制链接 / 二维码 / 停止）。

use std::ops::Range;

use fluxdown_protocol::{ShareDto, ShareStatus};
use fluxdown_ui_components::{ButtonVariant, FluxIcon, icon_button, tabular_numbers};
use fluxdown_ui_i18n::Translator;
use fluxdown_ui_theme::active_theme;
use gpui::{
    App, ClipboardItem, Context, Div, ElementId, Hsla, InteractiveElement as _, IntoElement,
    ParentElement as _, Pixels, SharedString, StatefulInteractiveElement as _, Styled as _, Window,
    div, uniform_list,
};
use gpui_component::{Icon, WindowExt as _, h_flex, notification::Notification, v_flex};

use super::{
    ShareView,
    table::{columns, or_placeholder, row_height},
};
use crate::{
    actions::notify_error,
    cloud_ui::{confirm_delete_cloud_copy, open_convert_dialog},
    errors::error_text,
    manage_ui::{
        body_text, chip, clipped, empty_state, meta_text, text, text_with, tooltip_builder,
    },
    model::{
        PanelTarget, claimed_summary,
        cloud::{CloudPhase, cloud_actions, method_label},
        format_bytes, format_datetime, format_percent, is_editable, ordered_shares, share_headline,
        share_status_key,
    },
    qr::open_share_qr,
};

pub(super) fn share_status_tone(status: ShareStatus, cx: &App) -> Option<Hsla> {
    let colors = active_theme(cx).extended().colors;
    match status {
        ShareStatus::Active => Some(colors.success),
        ShareStatus::Expired | ShareStatus::Stopped | ShareStatus::Unknown => None,
    }
}

impl ShareView {
    pub(super) fn open_share(&self, share_id: &str, window: &mut Window, cx: &mut App) {
        let open = self.hub.read(cx).host().open_panel.clone();
        if let Some(open) = open {
            open(PanelTarget::Share(share_id.to_owned()), window, cx);
        }
    }

    pub(super) fn copy_link(&self, url: String, window: &mut Window, cx: &mut Context<Self>) {
        cx.write_to_clipboard(ClipboardItem::new_string(url));
        let message = text(self.translator.read(cx), "shareLinkCopied");
        window.push_notification(Notification::success(message), cx);
    }

    /// 确认后停止分享（仍有效的分享才可停止）。
    pub(super) fn confirm_stop(
        &mut self,
        share_id: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let translator = self.translator.read(cx).clone();
        let title = text(&translator, "shareStop");
        let description = text(&translator, "shareStopConfirm");
        let cancel = text(&translator, "cancel");
        let view = cx.weak_entity();
        window.open_alert_dialog(cx, move |alert, _, cx| {
            let view = view.clone();
            let share_id = share_id.clone();
            alert
                .title(fluxdown_ui_components::dialog_title(title.clone(), cx))
                .description(description.clone())
                .footer(fluxdown_ui_components::dialog_footer(
                    Some(cancel.clone()),
                    title.clone(),
                    fluxdown_ui_components::DialogIntent::Destructive,
                    cx,
                ))
                .on_ok(move |_, window, cx| {
                    view.update(cx, |this, cx| this.stop_share(share_id.clone(), window, cx))
                        .is_ok()
                })
        });
    }

    pub(super) fn stop_share(&mut self, share_id: String, window: &Window, cx: &mut Context<Self>) {
        if !self.stopping.insert(share_id.clone()) {
            return;
        }
        let handle = window.window_handle();
        let translator = self.translator.read(cx).clone();
        let future = self.hub.read(cx).api().stop(&share_id);
        cx.spawn(async move |this, cx| {
            let result = future.await;
            let Ok(()) = this.update(cx, |this, cx| {
                this.stopping.remove(&share_id);
                cx.notify();
            }) else {
                return;
            };
            if let Err(error) = result {
                notify_error(handle, cx, error_text(&translator, &error));
            }
        })
        .detach();
        cx.notify();
    }

    pub(super) fn render_mine(&self, translator: &Translator, cx: &mut Context<Self>) -> Div {
        let count = self.hub.read(cx).state().shares.len();
        let container = v_flex().flex_1().min_h_0().w_full();
        if count == 0 {
            return container.child(empty_state(
                FluxIcon::Share2,
                None,
                text(translator, "shareMineEmpty"),
                None,
                cx,
            ));
        }
        let cols = columns(cx);
        container
            .child(self.header_row(
                vec![
                    (text(translator, "shareColFile"), None),
                    (text(translator, "shareColMethod"), Some(cols.method)),
                    (text(translator, "shareColExpiry"), Some(cols.expiry)),
                    (text(translator, "shareColClaims"), Some(cols.claims)),
                    (text(translator, "shareColLastAccess"), Some(cols.access)),
                    (text(translator, "shareColStatus"), Some(cols.status)),
                ],
                cols.actions,
                cx,
            ))
            .child(
                uniform_list(
                    "share-mine",
                    count,
                    cx.processor(move |this, range: Range<usize>, _, cx| {
                        // 只复制可见行，行渲染需要可变 `cx`（监听器），不能同时借着 hub 状态。
                        let rows: Vec<ShareDto> = {
                            let state = this.hub.read(cx).state();
                            ordered_shares(&state.shares)
                                .into_iter()
                                .skip(range.start)
                                .take(range.len())
                                .cloned()
                                .collect()
                        };
                        let translator = this.translator.read(cx).clone();
                        rows.into_iter()
                            .enumerate()
                            .map(|(offset, share)| {
                                this.render_share_row(range.start + offset, share, &translator, cx)
                            })
                            .collect::<Vec<_>>()
                    }),
                )
                .flex_1()
                .min_h_0()
                .w_full(),
            )
    }

    pub(super) fn render_share_row(
        &self,
        index: usize,
        share: ShareDto,
        translator: &Translator,
        cx: &mut Context<Self>,
    ) -> impl IntoElement + use<> {
        let theme = active_theme(cx);
        let tokens = theme.tokens().clone();
        let colors = tokens.colors;
        let cols = columns(cx);
        let stale = self.hub.read(cx).is_stale();
        let editable = is_editable(&share);
        let stopping = self.stopping.contains(&share.id);
        let headline = or_placeholder(share_headline(&share));
        let row_id = |part: &str| {
            ElementId::NamedInteger(
                SharedString::from(format!("share-mine-{part}")),
                index as u64,
            )
        };

        let files = text_with(
            translator,
            "shareFilesCount",
            &[("count", &share.files.len().to_string())],
        );
        let mut meta = vec![files.to_string(), format_bytes(share.total_bytes)];
        if !share.active_receivers.is_empty() {
            meta.push(
                text_with(
                    translator,
                    "shareActiveReceivers",
                    &[("count", &share.active_receivers.len().to_string())],
                )
                .to_string(),
            );
        }
        let label = method_label(&share);
        let mut method_text = translator.text(label.mode_key).to_owned();
        if let Some(key) = label.state_key {
            method_text.push_str(" · ");
            method_text.push_str(translator.text(key));
        }
        if let Some(percent) = label.percent {
            method_text.push(' ');
            method_text.push_str(&format_percent(f64::from(percent) / 100.));
        }
        let method = SharedString::from(method_text);
        let (claimed_key, claimed, max) = claimed_summary(share.claim_count, share.max_claims);
        let claims = text_with(
            translator,
            claimed_key,
            &[("count", &claimed.to_string()), ("max", &max.to_string())],
        );
        let last_access = share.last_accessed_at.as_deref().map_or_else(
            || text(translator, "shareNever"),
            |at| SharedString::from(format_datetime(at)),
        );
        let expires = or_placeholder(&format_datetime(&share.expires_at));
        let status = chip(
            row_id("status"),
            text(translator, share_status_key(share.status)),
            share_status_tone(share.status, cx),
            cx,
        );

        let icon_size = theme.extended().icon.md;
        let copy_label = text(translator, "shareCopyLink");
        let qr_label = text(translator, "shareShowQr");
        let stop_label = text(translator, "shareStop");
        let (copy_url, qr_url, qr_title) = (share.url.clone(), share.url.clone(), headline.clone());
        let (open_id, stop_id) = (share.id.clone(), share.id.clone());
        let hub_translator = self.translator.clone();
        let cloud = {
            let hub = self.hub.read(cx);
            cloud_actions(
                &share,
                &hub.state().policy_summary,
                hub.signed_in(),
                hub.can_send(),
            )
        };
        let cloud_button = if let Some(block) = cloud.convert {
            let label = text(
                translator,
                if cloud.phase == CloudPhase::Failed {
                    "shareStageRetry"
                } else {
                    "shareStageConvert"
                },
            );
            let tip = block.map_or_else(|| label.clone(), |block| text(translator, block.key()));
            let (hub_entity, id) = (self.hub.clone(), share.id.clone());
            icon_button(
                row_id("cloud"),
                label,
                Icon::new(FluxIcon::CloudUpload).size(icon_size),
                ButtonVariant::Ghost,
                cx,
            )
            .tooltip(tooltip_builder(tip))
            .disabled(block.is_some() || stale)
            .on_click(move |_, window, cx| {
                cx.stop_propagation();
                open_convert_dialog(&hub_entity, id.clone(), window, cx);
            })
            .into_any_element()
        } else if cloud.delete {
            let uploading = cloud.phase.has_upload();
            let label = text(
                translator,
                if uploading {
                    "shareStageCancelUpload"
                } else {
                    "shareStageDelete"
                },
            );
            let (hub_entity, id) = (self.hub.clone(), share.id.clone());
            icon_button(
                row_id("cloud"),
                label.clone(),
                Icon::new(FluxIcon::Trash2).size(icon_size),
                ButtonVariant::Ghost,
                cx,
            )
            .tooltip(tooltip_builder(label))
            .disabled(stale)
            .on_click(move |_, window, cx| {
                cx.stop_propagation();
                confirm_delete_cloud_copy(&hub_entity, id.clone(), uploading, window, cx);
            })
            .into_any_element()
        } else {
            // 没有云端动作时留出按钮位，保持图标列对齐。
            div()
                .w(theme.density().control)
                .flex_none()
                .into_any_element()
        };

        let cell = |width: Pixels, value: SharedString, id: ElementId| {
            body_text(cx)
                .w(width)
                .flex_none()
                .font_features(tabular_numbers())
                .child(clipped(id, value))
        };

        h_flex()
            .id(row_id("row"))
            .w_full()
            .h(row_height(cx))
            .flex_none()
            .items_center()
            .gap(tokens.spacing.md)
            .px(tokens.spacing.sm)
            .rounded(tokens.radius.md)
            .cursor_pointer()
            .hover(move |style| style.bg(theme.extended().colors.row_hover))
            .on_click(cx.listener(move |this, _, window, cx| {
                this.open_share(&open_id, window, cx);
            }))
            .child(
                v_flex()
                    .flex_1()
                    .min_w_0()
                    .child(body_text(cx).child(clipped(row_id("title"), headline)))
                    .child(meta_text(cx).child(clipped(row_id("meta"), meta.join(" · ")))),
            )
            .child(cell(cols.method, method, row_id("method")))
            .child(cell(
                cols.expiry,
                SharedString::from(expires),
                row_id("expiry"),
            ))
            .child(cell(cols.claims, claims, row_id("claims")))
            .child(cell(cols.access, last_access, row_id("access")))
            .child(h_flex().w(cols.status).flex_none().min_w_0().child(status))
            .child(
                h_flex()
                    .w(cols.actions)
                    .flex_none()
                    .justify_end()
                    .gap(tokens.spacing.xxs)
                    .child(
                        icon_button(
                            row_id("copy"),
                            copy_label.clone(),
                            Icon::new(FluxIcon::Copy).size(icon_size),
                            ButtonVariant::Ghost,
                            cx,
                        )
                        .tooltip(tooltip_builder(copy_label))
                        .disabled(!editable)
                        .on_click(cx.listener(
                            move |this, _, window, cx| {
                                cx.stop_propagation();
                                this.copy_link(copy_url.clone(), window, cx);
                            },
                        )),
                    )
                    .child(
                        icon_button(
                            row_id("qr"),
                            qr_label.clone(),
                            Icon::new(FluxIcon::QrCode).size(icon_size),
                            ButtonVariant::Ghost,
                            cx,
                        )
                        .tooltip(tooltip_builder(qr_label))
                        .disabled(!editable)
                        .on_click(move |_, window, cx| {
                            cx.stop_propagation();
                            open_share_qr(&hub_translator, &qr_title, &qr_url, window, cx);
                        }),
                    )
                    .child(cloud_button)
                    .child(
                        icon_button(
                            row_id("stop"),
                            stop_label.clone(),
                            Icon::new(FluxIcon::X)
                                .size(icon_size)
                                .text_color(if editable {
                                    colors.destructive
                                } else {
                                    colors.muted_foreground
                                }),
                            ButtonVariant::Ghost,
                            cx,
                        )
                        .tooltip(tooltip_builder(stop_label))
                        .disabled(!editable || stale || stopping)
                        .on_click(cx.listener(
                            move |this, _, window, cx| {
                                cx.stop_propagation();
                                this.confirm_stop(stop_id.clone(), window, cx);
                            },
                        )),
                    ),
            )
    }
}
