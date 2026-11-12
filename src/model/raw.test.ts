// Phase 1 acceptance: RAW import -> database model -> RAW export is lossless. Run with `npm test`.
// Against the mock 17-bus case; the same test should be pointed at a real v30 file once one is available.
import { describe, expect, it } from 'vitest'
import { applyCosts, applyVolts, readRaw, tokens, writeCosts, writeRaw, writeVolts } from './raw'
import { seedCase } from './seed'

describe('RAW round trip', () => {
  const seed = seedCase()
  const text = writeRaw(seed)

  it('export -> import gives the same case (all RAW fields)', () => {
    const back = readRaw(text)
    // voltage limits and costs are not RAW fields; they travel in the side files
    const strip = (c: typeof seed) => ({
      ...c,
      buses: c.buses.map(({ vn: _a, vx: _b, vl: _c, vh: _d, ...b }) => b),
      generators: c.generators.map(({ cost1: _a, cost2: _b, ...g }) => g),
    })
    expect(strip(back)).toEqual(strip(seed))
  })

  it('import -> export gives the same text, byte for byte', () => {
    expect(writeRaw(readRaw(text))).toBe(text)
  })

  it('side files restore voltage limits and costs', () => {
    let back = readRaw(text)
    back = applyVolts(back, writeVolts(seed)).data
    back = applyCosts(back, writeCosts(seed)).data
    expect(back).toEqual(seed)
  })

  it('keeps sections it does not model, verbatim', () => {
    const withDc = text.replace('0 / END OF AREA DATA, BEGIN TWO-TERMINAL DC DATA\n',
      "0 / END OF AREA DATA, BEGIN TWO-TERMINAL DC DATA\n1,1,100,500,1,1,1,'I'\n")
    const back = readRaw(withDc)
    expect(back.rawExtras?.['TWO-TERMINAL DC']).toEqual(["1,1,100,500,1,1,1,'I'"])
    expect(writeRaw(back)).toBe(withDc)
  })

  it('reads the layout seen in a v30 file (padded names, blanks, comments)', () => {
    expect(tokens("  12,'Bus 12      ', 34.500000,2,   0.000,   0.000,   2,   1,1.0260197443, -13.3380893654,   0"))
      .toEqual(['12', 'Bus 12', '34.500000', '2', '0.000', '0.000', '2', '1', '1.0260197443', '-13.3380893654', '0'])
    expect(tokens("0 / END OF BUS DATA, BEGIN LOAD DATA")).toEqual(['0'])
    expect(tokens("1,,3")).toEqual(['1', '', '3'])
  })

  it('names the line and field when a number is malformed', () => {
    const bad = text.replace(/^(1,'1 ',)150\.343/m, '$1 15O.343')
    expect(() => readRaw(bad)).toThrow(/Line \d+: generator field PG is not a number/)
  })

  it('reports side-file rows that match nothing', () => {
    const r = applyCosts(seed, "99,'1',10,0\n1,'1',22,0.02\n")
    expect(r.applied).toBe(1)
    expect(r.unknown).toEqual(['generator 99-1'])
  })
})
