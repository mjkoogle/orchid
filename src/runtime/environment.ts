import { OrchidValue, orchidNull } from './values';

/**
 * Lexical scope environment for variable bindings.
 * Each scope has a parent, forming a scope chain.
 */
export class Environment {
  private bindings: Map<string, OrchidValue> = new Map();
  private parent: Environment | null;

  constructor(parent: Environment | null = null) {
    this.parent = parent;
  }

  get(name: string): OrchidValue {
    if (this.bindings.has(name)) {
      return this.bindings.get(name)!;
    }
    if (this.parent) {
      return this.parent.get(name);
    }
    return orchidNull();
  }

  set(name: string, value: OrchidValue): void {
    this.bindings.set(name, value);
  }

  /**
   * Set a variable in the nearest scope where it's already defined,
   * or in the current scope if not found anywhere.
   */
  assign(name: string, value: OrchidValue): void {
    if (this.bindings.has(name)) {
      this.bindings.set(name, value);
      return;
    }
    if (this.parent && this.parent.has(name)) {
      this.parent.assign(name, value);
      return;
    }
    this.bindings.set(name, value);
  }

  has(name: string): boolean {
    if (this.bindings.has(name)) return true;
    if (this.parent) return this.parent.has(name);
    return false;
  }

  child(): Environment {
    return new Environment(this);
  }

  /**
   * Copy all bindings from this scope into the parent (used for atomic block commit).
   */
  commitToParent(): void {
    if (!this.parent) return;
    for (const [key, value] of this.bindings) {
      this.parent.set(key, value);
    }
  }

  /**
   * Get all bindings in this scope (not including parent).
   */
  getOwnBindings(): Map<string, OrchidValue> {
    return new Map(this.bindings);
  }
}
