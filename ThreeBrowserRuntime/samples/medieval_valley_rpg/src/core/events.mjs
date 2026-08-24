export class EventBus {
  #listeners = new Map();

  on(type, listener) {
    if (typeof listener !== "function") throw new TypeError("Event listener must be a function.");
    const listeners = this.#listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
    return () => this.off(type, listener);
  }

  once(type, listener) {
    let remove = null;
    remove = this.on(type, payload => {
      remove?.();
      listener(payload);
    });
    return remove;
  }

  off(type, listener) {
    const listeners = this.#listeners.get(type);
    if (!listeners) return false;
    const removed = listeners.delete(listener);
    if (listeners.size === 0) this.#listeners.delete(type);
    return removed;
  }

  emit(type, payload = {}) {
    const listeners = this.#listeners.get(type);
    let count = 0;
    if (listeners) {
      for (const listener of [...listeners]) {
        listener(payload);
        count += 1;
      }
    }
    const observers = this.#listeners.get("*");
    if (observers) {
      const event = { ...payload, type };
      for (const listener of [...observers]) {
        listener(event);
        count += 1;
      }
    }
    return count;
  }

  clear() {
    this.#listeners.clear();
  }
}

export function createEventBus() {
  return new EventBus();
}
