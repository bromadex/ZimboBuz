// Device-side queue of actions taken while offline (issue #24, §12.8).
// Each action gets a client operation id when queued; uploads send it to
// public.apply_offline_operation(), which applies it exactly once. Network
// errors leave the action queued for the next attempt; refusals (permissions,
// "not enough stock") are removed from the queue and reported to the user.

export interface QueuedOperation {
  clientOpId: string;
  companyId: string;
  deviceId: string;
  type: "insert" | "submit";
  target: string;
  payload: Record<string, unknown>;
  queuedAt: string;
  attempts: number;
}

export interface OperationOutcome {
  status: "applied" | "rejected";
  result: { id?: string; number?: string } | null;
  error: string | null;
  duplicate: boolean;
}

/** Persistent storage for the queue (IndexedDB in the app, memory in tests). */
export interface QueueStorage {
  list(): Promise<QueuedOperation[]>;
  put(op: QueuedOperation): Promise<void>;
  remove(clientOpId: string): Promise<void>;
}

export type Uploader = (op: QueuedOperation) => Promise<OperationOutcome>;

export interface FlushReport {
  applied: Array<{ op: QueuedOperation; outcome: OperationOutcome }>;
  rejected: Array<{ op: QueuedOperation; outcome: OperationOutcome }>;
  /** True when the upload stopped early because the network failed. */
  interrupted: boolean;
  remaining: number;
}

export class OfflineQueue {
  private flushing: Promise<FlushReport> | null = null;

  constructor(
    private readonly storage: QueueStorage,
    private readonly newId: () => string = () => crypto.randomUUID(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async enqueue(op: Omit<QueuedOperation, "clientOpId" | "queuedAt" | "attempts">): Promise<QueuedOperation> {
    const queued: QueuedOperation = { ...op, clientOpId: this.newId(), queuedAt: this.now().toISOString(), attempts: 0 };
    await this.storage.put(queued);
    return queued;
  }

  async pending(): Promise<number> {
    return (await this.storage.list()).length;
  }

  /**
   * Uploads queued actions in the order they were taken. Only one flush runs
   * at a time; a second call while one is running gets the same result.
   */
  flush(upload: Uploader): Promise<FlushReport> {
    if (!this.flushing) {
      this.flushing = this.run(upload).finally(() => {
        this.flushing = null;
      });
    }
    return this.flushing;
  }

  private async run(upload: Uploader): Promise<FlushReport> {
    const report: FlushReport = { applied: [], rejected: [], interrupted: false, remaining: 0 };
    const ops = (await this.storage.list()).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
    for (const [index, op] of ops.entries()) {
      let outcome: OperationOutcome;
      try {
        outcome = await upload(op);
      } catch {
        // Network or server unavailable: keep this and later actions, in order.
        await this.storage.put({ ...op, attempts: op.attempts + 1 });
        report.interrupted = true;
        report.remaining = ops.length - index;
        return report;
      }
      await this.storage.remove(op.clientOpId);
      (outcome.status === "applied" ? report.applied : report.rejected).push({ op, outcome });
    }
    return report;
  }
}

export class MemoryQueueStorage implements QueueStorage {
  private readonly ops = new Map<string, QueuedOperation>();
  async list() {
    return [...this.ops.values()];
  }
  async put(op: QueuedOperation) {
    this.ops.set(op.clientOpId, op);
  }
  async remove(clientOpId: string) {
    this.ops.delete(clientOpId);
  }
}
