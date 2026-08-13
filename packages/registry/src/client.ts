import { ModelEntrySchema, type ModelEntry } from './schema.js';
import { CAPABILITIES, CATEGORY_LABELS, capabilityById } from './capabilities.js';

export interface RegistryQuery {
  category?: ModelEntry['category'];
  capability?: string;
  query?: string;
}

/**
 * The loaded, validated registry. Pure data + queries - no I/O, no Node
 * APIs - so the Studio browser bundle and the desktop core share it.
 */
export class Registry {
  readonly entries: ModelEntry[];
  readonly errors: string[];

  private constructor(entries: ModelEntry[], errors: string[]) {
    this.entries = entries;
    this.errors = errors;
  }

  /** Build a registry from parsed JSON; every entry is schema-validated. */
  static fromData(data: unknown): Registry {
    if (!Array.isArray(data)) {
      return new Registry([], ['registry data must be an array of model entries']);
    }
    const entries: ModelEntry[] = [];
    const errors: string[] = [];
    data.forEach((raw, index) => {
      const result = ModelEntrySchema.safeParse(raw);
      if (result.success) {
        entries.push(result.data);
      } else {
        const issue = result.error.issues[0];
        errors.push('entry[' + index + ']: ' + (issue ? issue.path.join('.') + ' ' + issue.message : 'invalid'));
      }
    });
    const seen = new Set<string>();
    for (const entry of entries) {
      if (seen.has(entry.id)) errors.push('duplicate model id: ' + entry.id);
      seen.add(entry.id);
      for (const capability of entry.capabilities) {
        if (!capabilityById(capability)) errors.push(entry.id + ' references unknown capability ' + capability);
      }
    }
    return new Registry(entries, errors);
  }

  byId(id: string): ModelEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  search(options: RegistryQuery = {}): ModelEntry[] {
    return this.entries.filter((entry) => {
      if (options.category && entry.category !== options.category) return false;
      if (options.capability && !entry.capabilities.includes(options.capability)) return false;
      if (options.query) {
        const q = options.query.toLowerCase();
        const haystack = (entry.displayName + ' ' + entry.id + ' ' + entry.description).toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }

  byCapability(capability: string): ModelEntry[] {
    return this.search({ capability });
  }

  categories(): Array<{ id: ModelEntry['category']; label: string; count: number }> {
    const counts = new Map<ModelEntry['category'], number>();
    for (const entry of this.entries) {
      counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
    }
    return Object.entries(CATEGORY_LABELS).map(([id, label]) => ({
      id: id as ModelEntry['category'],
      label,
      count: counts.get(id as ModelEntry['category']) ?? 0,
    }));
  }

  capabilityCatalog() {
    return CAPABILITIES;
  }
}
