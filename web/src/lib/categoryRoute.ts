// 分类目录路由（移植 native/protocol/src/agent.rs `CategoryRouteDto`）：
// from_categories / follows / base_dir。分类列表解析复用下载页的 `categoriesFromPreference`。

import { categoriesFromPreference } from '../pages/downloads/model/categories'
import type { CategoryRouteDto, CustomCategoryDto } from './rpc'

/** 由分类列表（已按 position 排序）构建路由；没有任何分类配置目录时为 null。 */
export function routeFromCategories(categories: readonly CustomCategoryDto[]): CategoryRouteDto | null {
  const visible = categories.filter((category) => category.visible)
  const otherDir = visible.find((category) => category.builtinType === 'other')?.saveDir.trim() ?? ''
  const rules = visible
    .filter((category) => category.builtinType !== 'all' && category.builtinType !== 'other' && (otherDir !== '' || category.saveDir.trim() !== ''))
    .map((category) => {
      const rule: NonNullable<CategoryRouteDto['rules']>[number] = { matchMode: category.matchMode }
      if (category.extensions.length > 0) rule.extensions = category.extensions
      if (category.regexPattern !== '') rule.regexPattern = category.regexPattern
      const dir = category.saveDir.trim()
      if (dir !== '') rule.saveDir = dir
      return rule
    })
  const routes = otherDir !== '' || rules.some((rule) => (rule.saveDir ?? '') !== '')
  if (!routes) return null
  return otherDir !== '' ? { rules, otherDir } : { rules }
}

/** 由 `custom_categories` 偏好值构建路由。 */
export function routeFromPreference(value: unknown): CategoryRouteDto | null {
  return routeFromCategories(categoriesFromPreference(value))
}

/** 提交目录为空、等于提供目录，或是某个分类目录时，认为用户没有手选目录。 */
export function routeFollows(route: CategoryRouteDto, submitted: string, offered: string): boolean {
  const dir = submitted.trim()
  if (dir === '') return true
  const base = offered.trim()
  if (base !== '' && dir === base) return true
  if (route.otherDir && dir === route.otherDir) return true
  return route.rules.some((rule) => !!rule.saveDir && rule.saveDir === dir)
}

/** following 时作为 `saveDir` 下发的基准目录（无分类命中时使用）。 */
export function routeBaseDir(route: CategoryRouteDto, submitted: string, offered: string): string {
  const dir = submitted.trim()
  if (dir === '') return offered.trim()
  const isCategoryDir = (!!route.otherDir && dir === route.otherDir) || route.rules.some((rule) => !!rule.saveDir && rule.saveDir === dir)
  return isCategoryDir ? offered.trim() : dir
}
