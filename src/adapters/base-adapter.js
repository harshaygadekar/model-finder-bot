const db = require('../db/database');

/**
 * Base adapter interface. All source adapters extend this.
 */
class BaseAdapter {
  constructor(name, sourceType, priority) {
    this.name = name;
    this.sourceType = sourceType;
    this.priority = priority;
  }

  /**
   * Check the source for new items.
   * @returns {Promise<Array<{title: string, description: string, url: string, sourceName: string, sourceType: string, priority: number, tags: string[]}>>}
   */
  async check() {
    throw new Error(`${this.name}: check() not implemented`);
  }

  getName() {
    return this.name;
  }

  getSourceType() {
    return this.sourceType;
  }

  getPriority() {
    return this.priority;
  }

  getStateNamespace() {
    return `${this.sourceType}:${this.name}`;
  }

  loadState(stateKey, defaultValue = null) {
    try {
      return db.getAdapterStateValue(this.getStateNamespace(), stateKey, defaultValue);
    } catch {
      return defaultValue;
    }
  }

  saveState(stateKey, value) {
    try {
      db.setAdapterStateValue(this.getStateNamespace(), stateKey, value);
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = BaseAdapter;
