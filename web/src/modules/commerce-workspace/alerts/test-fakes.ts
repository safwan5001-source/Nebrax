import type { ChannelLike, LockManagerLike } from './tab-coordinator';

/** قفل حصري FIFO في الذاكرة (يحاكي Web Locks) مشترك بين عدة منسّقين في اختبار واحد. */
export class FakeLocks implements LockManagerLike {
  private readonly held = new Set<string>();
  private readonly queues = new Map<string, Array<{ run: () => void; cancel: (e: Error) => void; signal?: AbortSignal }>>();

  request(name: string, options: { mode: 'exclusive'; signal?: AbortSignal }, callback: () => Promise<void>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const run = (): void => {
        this.held.add(name);
        callback()
          .catch(() => {})
          .finally(() => {
            this.held.delete(name);
            const next = this.queues.get(name)?.shift();
            next?.run();
            resolve();
          });
      };
      if (!this.held.has(name)) {
        run();
        return;
      }
      const entry = { run, cancel: (e: Error) => reject(e), signal: options.signal };
      const queue = this.queues.get(name) ?? [];
      queue.push(entry);
      this.queues.set(name, queue);
      options.signal?.addEventListener('abort', () => {
        const q = this.queues.get(name) ?? [];
        const i = q.indexOf(entry);
        if (i >= 0) q.splice(i, 1);
        reject(new DOMException('aborted', 'AbortError'));
      });
    });
  }
}

/** مركز بث يحاكي BroadcastChannel: يسلّم لكل القنوات بالاسم نفسه عدا المرسل، بشكل متزامن. */
export function createChannelHub() {
  const channels = new Map<string, Set<FakeChannel>>();

  class FakeChannel implements ChannelLike {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    constructor(private readonly name: string) {
      const set = channels.get(name) ?? new Set();
      set.add(this);
      channels.set(name, set);
    }
    postMessage(message: unknown): void {
      for (const other of channels.get(this.name) ?? []) {
        if (other !== this) other.onmessage?.({ data: JSON.parse(JSON.stringify(message)) });
      }
    }
    close(): void {
      channels.get(this.name)?.delete(this);
    }
  }

  return (name: string): ChannelLike => new FakeChannel(name);
}

export const flush = async (times = 6): Promise<void> => {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
};
