import type { CaniasSession, SessionStore } from "./types.js";

/**
 * Default session store: keeps a single session in memory for the lifetime
 * of the client.
 */
export class MemorySessionStore implements SessionStore {
  #session: CaniasSession | null = null;

  get(): CaniasSession | null {
    return this.#session;
  }

  set(session: CaniasSession): void {
    this.#session = session;
  }

  clear(): void {
    this.#session = null;
  }
}
