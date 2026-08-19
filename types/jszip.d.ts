declare module 'jszip' {
  export default class JSZip {
    file(path: string, data: string | ArrayBuffer | Uint8Array | Buffer): this;
    generateAsync(options: { type: 'nodebuffer' }): Promise<Buffer>;
  }
}
