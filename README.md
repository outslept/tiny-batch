# tiny-batch

Coalesce bursts of calls into a single run per scheduling window.

## About

`tiny-batch` collects calls to a function made in the same scheduling window and runs it just once. By default, the last call's arguments win, but you can use `mode: "merge"` with a reducer if you need to combine partial updates instead.

It flushes in a microtask by default, though you can provide a custom scheduler for debouncing or animation frames. Every batched call returns a Promise that resolves or rejects with that single run's result, and batches don't block each other—a new one can start even if an async run from the previous batch is still going.

## Usage

```ts
import { batch } from "tiny-batch";

const times2 = batch((n: number) => n * 2);

const p1 = times2(1);
const p2 = times2(2);

console.log(await Promise.all([p1, p2])); // [4, 4]
```

## License

MIT
