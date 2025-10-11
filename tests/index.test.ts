import { describe, it, expect } from 'vitest'
import { batch } from '../src/index.js'

describe('batch last', () => {
  it('batches multiple calls into one with last args', async () => {
    let calls = 0
    let seen: any[] | undefined
    const fn = (x: number) => { calls++; seen = [x]; return x * 2 }
    const b = batch(fn)
    const p1 = b(1)
    const p2 = b(2)
    const p3 = b(3)
    expect(calls).toBe(0)
    const out = await Promise.all([p1, p2, p3])
    expect(calls).toBe(1)
    expect(seen![0]).toBe(3)
    expect(out).toEqual([6, 6, 6])
  })
})

describe('batch merge', () => {
  it('merges args via reducer', async () => {
    let calls = 0
    const fn = (n: number) => { calls++; return n }
    const b = batch(fn, {
      mode: 'merge',
      reducer: (acc, args) => [acc[0]! + args[0]!] as [number]
    })
    const a = b(1)
    const b2 = b(2)
    const c = b(3)
    const out = await Promise.all([a, b2, c])
    expect(calls).toBe(1)
    expect(out).toEqual([6, 6, 6])
  })
})

describe('async function', () => {
  it('awaits async result', async () => {
    const fn = async (x: number) => {
      await new Promise(resolve => setTimeout(resolve, 0))
      return x + 1
    }
    const b = batch(fn)
    const p1 = b(10)
    const p2 = b(20)
    const res = await Promise.all([p1, p2])
    expect(res).toEqual([21, 21])
  })
})

describe('flush/cancel/pending', () => {
  it('flush works immediately', async () => {
    let calls = 0
    const fn = (x: number) => { calls++; return x }
    const b = batch(fn)
    const p = b(123)
    b.flush()
    const v = await p
    expect(calls).toBe(1)
    expect(v).toBe(123)
  })

  it('cancel rejects pending', async () => {
    const fn = (x: number) => x
    const b = batch(fn)
    const p = b(1)
    b.cancel()
    await expect(p).rejects.toBeInstanceOf(Error)
  })

  it('pending reflects state', async () => {
    const fn = (x: number) => x
    const b = batch(fn)
    const p = b(1)
    expect(b.pending()).toBe(true)
    await p
    expect(b.pending()).toBe(false)
  })
})
