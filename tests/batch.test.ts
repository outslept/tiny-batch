import { describe, it, expect, vi } from "vitest";
import { batch } from "../src/batch.js";

describe("batch (last mode)", () => {
  it("batches multiple calls into one with last args", async () => {
    let calls = 0;
    let seen: any[] | undefined;
    const fn = (x: number) => {
      calls++;
      seen = [x];
      return x * 2;
    };
    const b = batch(fn);
    const p1 = b(1);
    const p2 = b(2);
    const p3 = b(3);
    expect(calls).toBe(0);
    const out = await Promise.all([p1, p2, p3]);
    expect(calls).toBe(1);
    expect(seen![0]).toBe(3);
    expect(out).toEqual([6, 6, 6]);
  });

  it("awaits async result", async () => {
    const fn = async (x: number) => {
      await Promise.resolve();
      return x + 1;
    };
    const b = batch(fn);
    const p1 = b(10);
    const p2 = b(20);
    const res = await Promise.all([p1, p2]);
    expect(res).toEqual([21, 21]);
  });

  it("supports thenable results", async () => {
    const thenable = {
      then(resolve: (v: number) => void, _reject?: (e: unknown) => void) {
        resolve(42);
      },
    };
    const fn = () => thenable;
    const b = batch(fn);
    const [a, c] = await Promise.all([b(), b()]);
    expect(a).toBe(42);
    expect(c).toBe(42);
  });

  it("flush boundaries separate batches", async () => {
    let calls = 0;
    const b = batch((x: number) => {
      calls++;
      return x;
    });
    const a = b(1);
    const c = b(2);
    b.flush();
    const first = await Promise.all([a, c]);
    expect(first).toEqual([2, 2]);
    expect(calls).toBe(1);

    const d = b(3);
    const e = b(4);
    b.flush();
    const second = await Promise.all([d, e]);
    expect(second).toEqual([4, 4]);
    expect(calls).toBe(2);
  });
});

describe("errors and cancellation", () => {
  it("sync throw rejects all and allows recovery for next batch", async () => {
    let calls = 0;
    let thrown = false;
    const fn = () => {
      calls++;
      if (!thrown) {
        thrown = true;
        throw new Error("boom");
      }
      return 123;
    };
    const b = batch(fn);
    const p1 = b();
    const p2 = b();
    const r = await Promise.allSettled([p1, p2]);
    expect(r[0].status).toBe("rejected");
    expect(r[1].status).toBe("rejected");
    expect(calls).toBe(1);

    const ok = await b();
    expect(ok).toBe(123);
    expect(calls).toBe(2);
  });

  it("async rejection rejects all and allows recovery for next batch", async () => {
    let calls = 0;
    let first = true;
    const fn = () => {
      calls++;
      if (first) {
        first = false;
        return Promise.reject(new Error("nope"));
      }
      return Promise.resolve("ok");
    };
    const b = batch(fn);
    const p1 = b();
    const p2 = b();
    const r = await Promise.allSettled([p1, p2]);
    expect(r.map((x) => x.status)).toEqual(["rejected", "rejected"]);
    expect(calls).toBe(1);

    const ok = await b();
    expect(ok).toBe("ok");
    expect(calls).toBe(2);
  });

  it("cancel rejects all pending with custom reason and is idempotent", async () => {
    const fn = (x: number) => x;
    const b = batch(fn);
    const p1 = b(1);
    const p2 = b(2);
    b.cancel("reason-x");
    b.cancel("ignored-second-cancel");

    await expect(p1).rejects.toBe("reason-x");
    await expect(p2).rejects.toBe("reason-x");
    expect(b.pending()).toBe(false);

    const v = await b(3);
    expect(v).toBe(3);
  });

  it("cancel followed by flush does not call the function", async () => {
    const fn = vi.fn((x: number) => x);
    const b = batch(fn);
    const p = b(123);
    b.cancel();
    b.flush();
    await expect(p).rejects.toBeInstanceOf(Error);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("pending and flush semantics", () => {
  const deferred = <T>() => {
    let resolve!: (v: T | PromiseLike<T>) => void;
    let reject!: (e?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  it("pending true before flush, false immediately after flush even if result is unresolved", async () => {
    const gate = deferred<void>();
    const fn = vi.fn(async (x: number) => {
      await gate.promise;
      return x;
    });
    const b = batch(fn);
    const p = b(42);
    expect(b.pending()).toBe(true);
    b.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(b.pending()).toBe(false);

    gate.resolve();
    const v = await p;
    expect(v).toBe(42);
  });

  it("flush is a no-op when nothing is pending", () => {
    const fn = vi.fn((x: number) => x);
    const b = batch(fn);
    b.flush();
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("batch (merge mode)", () => {
  it("merges args via reducer", async () => {
    let calls = 0;
    const fn = (n: number) => {
      calls++;
      return n;
    };
    const b = batch(fn, {
      mode: "merge",
      reducer: (acc, args) => [acc[0]! + args[0]!],
    });
    const a = b(1);
    const bb = b(2);
    const c = b(3);
    const out = await Promise.all([a, bb, c]);
    expect(calls).toBe(1);
    expect(out).toEqual([6, 6, 6]);
  });

  it("isolates batches across flush boundaries", async () => {
    const fn = vi.fn((n: number) => n);
    const b = batch(fn, {
      mode: "merge",
      reducer: (acc, args) => [acc[0]! + args[0]!],
    });

    const p1 = b(1);
    const p2 = b(2);
    b.flush();
    const first = await Promise.all([p1, p2]);
    expect(first).toEqual([3, 3]);

    const p3 = b(3);
    const p4 = b(4);
    b.flush();
    const second = await Promise.all([p3, p4]);
    expect(second).toEqual([7, 7]);

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("works with multi-arg functions", async () => {
    const fn = (a: number, b: number) => a - b;
    const bfn = batch(fn, {
      mode: "merge",
      reducer: (acc, args) => [acc[0]! + args[0]!, acc[1]! + args[1]!],
    });
    const r = await Promise.all([bfn(1, 2), bfn(3, 4)]);
    // (4, 6) => 4 - 6 = -2
    expect(r).toEqual([-2, -2]);
  });

  it("throws at creation when reducer is missing", () => {
    expect(() => {
      batch((n: number) => n, { mode: "merge" });
    }).toThrow(/reducer/);
  });
});
