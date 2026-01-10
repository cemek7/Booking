// TinyPool stub used in tests to avoid spawning real workers or requiring a
// built `dist/worker.js`. Export a minimal API surface similar to tinypool.
export class TinyPool {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_opts?: unknown) {}
  // run(task, options) -> Promise
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  run(_task?: unknown, _opts?: unknown) {
    return Promise.resolve(undefined);
  }
  destroy() {
    return Promise.resolve();
  }
}

export default { TinyPool };
