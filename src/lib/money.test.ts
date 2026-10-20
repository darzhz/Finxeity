import { describe, expect, it } from 'vitest'
import { formatMinor, formatMinorPlain, parseMajorToMinor } from './money'

describe('formatMinor', () => {
  it('formats paise as INR currency', () => {
    expect(formatMinor(45000)).toBe('₹450.00')
    expect(formatMinor(0)).toBe('₹0.00')
  })

  it('formats large amounts with Indian grouping', () => {
    expect(formatMinor(1234567800)).toContain('1,23,45,678.00')
  })

  it('formats plain amounts without a symbol', () => {
    expect(formatMinorPlain(12345)).toBe('123.45')
  })
})

describe('parseMajorToMinor', () => {
  it('parses whole rupees', () => {
    expect(parseMajorToMinor('1234')).toBe(123400)
  })

  it('parses decimals, commas and the rupee symbol', () => {
    expect(parseMajorToMinor('₹1,234.5')).toBe(123450)
    expect(parseMajorToMinor('1,234.50')).toBe(123450)
    expect(parseMajorToMinor('0.05')).toBe(5)
  })

  it('rejects invalid input', () => {
    expect(parseMajorToMinor('')).toBeNull()
    expect(parseMajorToMinor('abc')).toBeNull()
    expect(parseMajorToMinor('1.234')).toBeNull()
  })
})
