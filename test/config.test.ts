import { describe, test, expect } from 'bun:test'
import { normalizeConfig, validateConfig, TikTokError } from '../src/config'

describe('normalizeConfig', () => {
  test('fills in defaults for missing fields', () => {
    const cfg = normalizeConfig({ user: 'testuser' })
    expect(cfg.user).toBe('testuser')
    expect(cfg.outputDir).toBe('./recordings')
    expect(cfg.interval).toBe(5)
    expect(cfg.duration).toBe(0)
    expect(cfg.logLevel).toBe('info')
  })

  test('preserves explicit values', () => {
    const cfg = normalizeConfig({
      user: 'testuser',
      outputDir: '/custom/path',
      interval: 10,
      duration: 300,
      logLevel: 'debug',
    })
    expect(cfg.outputDir).toBe('/custom/path')
    expect(cfg.interval).toBe(10)
    expect(cfg.duration).toBe(300)
    expect(cfg.logLevel).toBe('debug')
  })

  test('preserves cookies and proxy', () => {
    const cfg = normalizeConfig({
      user: 'testuser',
      proxy: 'http://127.0.0.1:8080',
      cookies: { sessionid_ss: 'abc123' },
    })
    expect(cfg.proxy).toBe('http://127.0.0.1:8080')
    expect(cfg.cookies?.sessionid_ss).toBe('abc123')
  })
})

describe('validateConfig', () => {
  test('throws on empty user', () => {
    expect(() => validateConfig({ user: '' })).toThrow(TikTokError)
    expect(() => validateConfig({ user: '  ' })).toThrow(TikTokError)
  })

  test('throws on interval < 1', () => {
    expect(() => validateConfig({ user: 'u', interval: 0 })).toThrow(TikTokError)
  })

  test('throws on duration < 0', () => {
    expect(() => validateConfig({ user: 'u', duration: -1 })).toThrow(TikTokError)
  })

  test('passes on valid config', () => {
    expect(() => validateConfig({ user: 'testuser' })).not.toThrow()
    expect(() => validateConfig({ user: 'testuser', interval: 1, duration: 0 })).not.toThrow()
  })
})
