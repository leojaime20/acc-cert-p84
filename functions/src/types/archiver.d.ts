declare module 'archiver' {
  import type { Readable, Transform } from 'node:stream';

  interface ArchiveEntry {
    name: string;
  }

  interface Archive extends Transform {
    append(source: Readable | Buffer | string, entry: ArchiveEntry): this;
    finalize(): Promise<void>;
    on(event: 'error', listener: (error: Error) => void): this;
  }

  export default function createArchive(
    format: 'zip',
    options?: { zlib?: { level?: number } },
  ): Archive;
}
