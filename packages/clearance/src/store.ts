import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Store } from './types.ts';

interface Data {
  receivers: Record<string, string[]>;
  codeHashes: Record<string, { hash: string; seenAt: string }>;
}

const empty = (): Data => ({ receivers: {}, codeHashes: {} });

export class MemoryStore implements Store {
  protected data: Data = empty();

  async knownReceivers(vaultId: string) {
    return new Set(this.data.receivers[vaultId] ?? []);
  }
  async rememberReceiver(vaultId: string, receiverId: string) {
    const list = (this.data.receivers[vaultId] ??= []);
    if (!list.includes(receiverId)) list.push(receiverId);
    await this.persist();
  }
  async lastCodeHash(accountId: string) {
    return this.data.codeHashes[accountId];
  }
  async saveCodeHash(accountId: string, hash: string) {
    this.data.codeHashes[accountId] = { hash, seenAt: new Date().toISOString() };
    await this.persist();
  }
  protected async persist() {}
}

/** Same as MemoryStore, persisted to a JSON file (e.g. `.sentraio/clearance.json`). */
export class JsonFileStore extends MemoryStore {
  private loaded = false;
  private readonly path: string;
  constructor(path: string) {
    super();
    this.path = path;
  }
  private async load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      this.data = { ...empty(), ...JSON.parse(await readFile(this.path, 'utf8')) };
    } catch {
      this.data = empty();
    }
  }
  override async knownReceivers(vaultId: string) {
    await this.load();
    return super.knownReceivers(vaultId);
  }
  override async lastCodeHash(accountId: string) {
    await this.load();
    return super.lastCodeHash(accountId);
  }
  override async rememberReceiver(vaultId: string, receiverId: string) {
    await this.load();
    return super.rememberReceiver(vaultId, receiverId);
  }
  override async saveCodeHash(accountId: string, hash: string) {
    await this.load();
    return super.saveCodeHash(accountId, hash);
  }
  protected override async persist() {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(this.data, null, 2));
  }
}
