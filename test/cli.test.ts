import { describe, test, expect } from 'bun:test'
import { parseArgs } from '../src/cli'

describe('parseArgs', () => {
  test('parses --user', () => {
    const cfg = parseArgs(['bun', 'test', '--user', 'testuser'])
    expect(cfg.user).toBe('testuser')
  })

  test('strips leading @ from user', () => {
    const cfg = parseArgs(['bun', 'test', '--user', '@testuser'])
    expect(cfg.user).toBe('testuser')
  })

  test('parses --output', () => {
    const cfg = parseArgs(['bun', 'test', '--user', 'u', '--output', '/videos'])
    expect(cfg.outputDir).toBe('/videos')
  })

  test('parses --interval', () => {
    const cfg = parseArgs(['bun', 'test', '--user', 'u', '--interval', '10'])
    expect(cfg.interval).toBe(10)
  })

  test('parses --duration', () => {
    const cfg = parseArgs(['bun', 'test', '--user', 'u', '--duration', '300'])
    expect(cfg.duration).toBe(300)
  })

  test('parses --proxy', () => {
    const cfg = parseArgs(['bun', 'test', '--user', 'u', '--proxy', 'http://proxy:8080'])
    expect(cfg.proxy).toBe('http://proxy:8080')
  })

  test('parses --log-level', () => {
    const cfg = parseArgs(['bun', 'test', '--user', 'u', '--log-level', 'debug'])
    expect(cfg.logLevel).toBe('debug')
  })

  test('throws on missing --user', () => {
    expect(() => parseArgs(['bun', 'test'])).toThrow()
  })

  test('throws on invalid --interval', () => {
    expect(() => parseArgs(['bun', 'test', '--user', 'u', '--interval', '0'])).toThrow()
    expect(() => parseArgs(['bun', 'test', '--user', 'u', '--interval', '-1'])).toThrow()
  })

  test('throws on invalid --duration', () => {
    expect(() => parseArgs(['bun', 'test', '--user', 'u', '--duration', '-1'])).toThrow()
  })

  test('throws on invalid --log-level', () => {
    expect(() => parseArgs(['bun', 'test', '--user', 'u', '--log-level', 'verbose'])).toThrow()
  })
})
