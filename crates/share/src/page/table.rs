//! 「我的分享」与「接收记录」两张表共用的列宽、行高与表头。

use fluxdown_ui_theme::active_theme;
use gpui::{
    App, Div, FontWeight, ParentElement as _, Pixels, SharedString, Styled as _, div,
    prelude::FluentBuilder as _,
};
use gpui_component::h_flex;

use super::ShareView;
use crate::manage_ui::meta_text;

/// 列宽（默认字号下的 px，随字体缩放）。
pub(super) const COL_METHOD: f32 = 152.;
pub(super) const COL_EXPIRY: f32 = 128.;
pub(super) const COL_CLAIMS: f32 = 112.;
pub(super) const COL_ACCESS: f32 = 128.;
pub(super) const COL_STATUS: f32 = 92.;
pub(super) const COL_SENDER: f32 = 144.;
pub(super) const COL_FILES: f32 = 80.;
pub(super) const COL_SIZE: f32 = 88.;
pub(super) const COL_STARTED: f32 = 128.;

/// 列宽集合。
pub(super) struct Columns {
    pub(super) method: Pixels,
    pub(super) expiry: Pixels,
    pub(super) claims: Pixels,
    pub(super) access: Pixels,
    pub(super) status: Pixels,
    pub(super) sender: Pixels,
    pub(super) files: Pixels,
    pub(super) size: Pixels,
    pub(super) started: Pixels,
    /// 四个行内图标按钮 + 间距。
    pub(super) actions: Pixels,
}

pub(super) fn columns(cx: &App) -> Columns {
    let theme = active_theme(cx);
    let spacing = theme.tokens().spacing;
    Columns {
        method: theme.text_extent(COL_METHOD),
        expiry: theme.text_extent(COL_EXPIRY),
        claims: theme.text_extent(COL_CLAIMS),
        access: theme.text_extent(COL_ACCESS),
        status: theme.text_extent(COL_STATUS),
        sender: theme.text_extent(COL_SENDER),
        files: theme.text_extent(COL_FILES),
        size: theme.text_extent(COL_SIZE),
        started: theme.text_extent(COL_STARTED),
        actions: theme.density().control * 4. + spacing.xxs * 3.,
    }
}

/// 列表行高：两行文字（标题 + 元信息）加上下内边距。
pub(super) fn row_height(cx: &App) -> Pixels {
    let theme = active_theme(cx);
    let tokens = theme.tokens();
    (tokens.typography.sm.line_height + tokens.typography.xs.line_height + tokens.spacing.xxs)
        .max(theme.density().task_row)
        + tokens.spacing.sm
}

/// 文本非空则原样返回，否则占位。
pub(super) fn or_placeholder(value: &str) -> String {
    if value.trim().is_empty() {
        crate::model::diagnostics::PLACEHOLDER.to_owned()
    } else {
        value.to_owned()
    }
}

impl ShareView {
    /// 表头行：与数据行共用同一组列宽，左右内边距一致。
    pub(super) fn header_row(
        &self,
        cells: Vec<(SharedString, Option<Pixels>)>,
        trailing: Pixels,
        cx: &App,
    ) -> Div {
        let theme = active_theme(cx);
        let tokens = theme.tokens();
        let mut row = h_flex()
            .w_full()
            .flex_none()
            .items_center()
            .gap(tokens.spacing.md)
            .px(tokens.spacing.sm)
            .pb(tokens.spacing.xs)
            .border_b_1()
            .border_color(theme.extended().colors.hairline);
        for (label, width) in cells {
            row = row.child(
                meta_text(cx)
                    .truncate()
                    .font_weight(FontWeight::MEDIUM)
                    .map(|cell| match width {
                        Some(width) => cell.w(width).flex_none(),
                        None => cell.flex_1().min_w_0(),
                    })
                    .child(label),
            );
        }
        row.child(div().w(trailing).flex_none())
    }
}
