declare module '../../dist/worker.mjs' {
  export type WorkerHandler = (payload: unknown) => Promise<unknown>;
  export const handler: WorkerHandler | undefined;
  const mod: {
    handler?: WorkerHandler;
    default?: {
      handler?: WorkerHandler;
    };
  };
  export default mod;
}

declare module '../../dist/worker.js' {
  export type WorkerHandler = (payload: unknown) => Promise<unknown>;
  export const handler: WorkerHandler | undefined;
  const mod: {
    handler?: WorkerHandler;
    default?: {
      handler?: WorkerHandler;
    };
  };
  export default mod;
}
