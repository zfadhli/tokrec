import { describe, test, expect } from 'bun:test'
import { formatFilename, sanitizeUser, bytesToHuman } from '../src/utils'

describe('formatFilename', () => {
  test('produces correct format', () => {
    const name = formatFilename('testuser')
    expect(name).toMatch(/^testuser=\d{4}\.\d{2}\.\d{2}_\d{2}-\d{2}-\d{2}\.flv$/)
  })

  test('accepts custom extension', () => {
    const name = formatFilename('u', 'mp4')
    expect(name).toMatch(/\.mp4$/)
  })

  test('includes _1 when part is provided', () => {
    const name = formatFilename('testuser', 'flv', 1)
    expect(name).toMatch(/^testuser=\d{4}\.\d{2}\.\d{2}_\d{2}-\d{2}-\d{2}_1\.flv$/)
  })

  test('increments part suffix', () => {
    const name2 = formatFilename('u', 'flv', 2)
    expect(name2).toMatch(/_2\.flv$/)
  })
})

describe('sanitizeUser', () => {
  test('strips leading @', () => {
    expect(sanitizeUser('@user')).toBe('user')
    expect(sanitizeUser('@@user')).toBe('user')
  })

  test('trims whitespace', () => {
    expect(sanitizeUser('  user  ')).toBe('user')
  })

  test('leaves clean usernames alone', () => {
    expect(sanitizeUser('user')).toBe('user')
    expect(sanitizeUser('officialgeilegisela')).toBe('officialgeilegisela')
  })
})

describe('bytesToHuman', () => {
  test('formats bytes correctly', () => {
    expect(bytesToHuman(0)).toBe('0 B')
    expect(bytesToHuman(500)).toBe('500.0 B')
    expect(bytesToHuman(1024)).toBe('1.0 KB')
    expect(bytesToHuman(1048576)).toBe('1.0 MB')
    expect(bytesToHuman(1073741824)).toBe('1.0 GB')
  })
})
