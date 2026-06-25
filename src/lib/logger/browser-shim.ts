/**
 * Browser / edge no-op shim for winston and winston-daily-rotate-file.
 *
 * Turbopack replaces those packages with this module when bundling for
 * browser targets (resolveAlias in next.config.ts). The runtime-aware
 * logger in index.ts never actually calls buildWinstonLogger() in
 * browser/edge context, so no real API surface is needed here — the shim
 * just has to be resolvable without pulling in Node.js `fs`.
 */

const noop = () => {};
const noopObj = { format: noop };

const shim = {
  // createLogger
  createLogger: () => ({
    error: noop, warn: noop, info: noop,
    http: noop, debug: noop, verbose: noop, log: noop,
  }),
  // format helpers
  format: {
    combine: () => noopObj,
    timestamp: () => noopObj,
    errors: () => noopObj,
    json: () => noopObj,
    printf: () => noopObj,
    colorize: () => noopObj,
  },
  transports: {
    Console: class { constructor() {} },
    File: class { constructor() {} },
  },
  config: { npm: { levels: {} } },
};

module.exports = shim;
export default shim;
