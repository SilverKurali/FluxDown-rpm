import { describe, expect, test } from 'bun:test'
import type { CustomCategoryDto } from './rpc'
import { routeBaseDir, routeFollows, routeFromCategories, routeFromPreference } from './categoryRoute'

const cat = (id: string, patch: Partial<CustomCategoryDto> = {}): CustomCategoryDto => ({
  id,
  name: id,
  icon: '',
  matchMode: 'extension',
  extensions: [],
  regexPattern: '',
  position: 0,
  visible: true,
  isBuiltin: false,
  builtinType: null,
  saveDir: '',
  ...patch,
})

describe('routeFromCategories', () => {
  test('没有任何目录 → null', () => {
    expect(routeFromCategories([cat('all', { builtinType: 'all' }), cat('v', { extensions: ['mp4'] })])).toBeNull()
  })

  test('other 无目录：无目录的普通分类省略，有目录的保留', () => {
    const route = routeFromCategories([
      cat('all', { builtinType: 'all', saveDir: '/ignored' }),
      cat('a', { extensions: ['zip'] }),
      cat('b', { extensions: ['mp4'], saveDir: ' /v ' }),
      cat('other', { builtinType: 'other' }),
    ])
    expect(route).toEqual({ rules: [{ matchMode: 'extension', extensions: ['mp4'], saveDir: '/v' }] })
  })

  test('other 有目录：无目录的普通分类保留以阻止兜底；隐藏分类忽略', () => {
    const route = routeFromCategories([
      cat('a', { matchMode: 'regex', regexPattern: '^x' }),
      cat('hidden', { saveDir: '/h', visible: false }),
      cat('other', { builtinType: 'other', saveDir: '/o' }),
    ])
    expect(route).toEqual({ rules: [{ matchMode: 'regex', regexPattern: '^x' }], otherDir: '/o' })
  })

  test('偏好值解析（数组 / JSON 字符串）', () => {
    const list = [cat('b', { extensions: ['mp4'], saveDir: '/v' })]
    const expected = { rules: [{ matchMode: 'extension', extensions: ['mp4'], saveDir: '/v' }] }
    expect(routeFromPreference(list)).toEqual(expected)
    expect(routeFromPreference(JSON.stringify(list))).toEqual(expected)
  })
})

describe('follows / baseDir', () => {
  const route = { rules: [{ matchMode: 'extension', saveDir: '/v' }, { matchMode: 'extension' }], otherDir: '/o' }

  test('空、等于提供目录、分类目录均视为跟随', () => {
    expect(routeFollows(route, '  ', '/d')).toBe(true)
    expect(routeFollows(route, ' /d ', '/d')).toBe(true)
    expect(routeFollows(route, '/v', '/d')).toBe(true)
    expect(routeFollows(route, '/o', '')).toBe(true)
    expect(routeFollows(route, '/custom', '/d')).toBe(false)
    expect(routeFollows(route, '/d', '')).toBe(false)
  })

  test('baseDir：空 / 分类目录 → offered，否则提交值', () => {
    expect(routeBaseDir(route, '', ' /d ')).toBe('/d')
    expect(routeBaseDir(route, '/v', '/d')).toBe('/d')
    expect(routeBaseDir(route, '/o', '/d')).toBe('/d')
    expect(routeBaseDir(route, ' /d ', '/d')).toBe('/d')
  })
})
