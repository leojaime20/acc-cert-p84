declare module 'archiver' {
  import type { Readable, Transform } from 'node:stream';

  interface ArchiveEntry {
    name: string;
  }

  export class ZipArchive extends Transform {
    constructor(options?: { zlib?: { level?: number } });
    append(source: Readable | Buffer | string, entry: ArchiveEntry): this;
    finalize(): Promise<void>;
    on(event: 'error', listener: (error: Error) => void): this;
  }
}
