// PluginManager.js - discovers, loads, and tracks plugins.
//
// DISCOVERY
// Browsers cannot list folder contents over HTTP. So plugins are discovered
// through /plugins/index.json, which lists plugin folder names.
//
// ISOLATION MODEL
// - Plugins never import engine modules. They receive one frozen "context"
//   object in activate(context), exposing only on/off/trigger/resolve/log.
// - Every listener a plugin registers is tagged with its id, so disabling
//   the plugin removes all of its hooks in one call (AppAPI.offAll).
// - All plugin calls are wrapped in try/catch.
// This is isolation, NOT a security sandbox: plugin code still runs in the
// page and can reach `window`. A true sandbox would need an iframe or Worker.
//
// ASSET OVERRIDE PRECOMPUTATION
// Instead of asking every plugin on every asset load, the manager builds one
// Map (assetPath -> override URL) whenever the set of active plugins changes.
// loadAsset() then does a single O(1) Map lookup.
// Conflict rule: sort by manifest.priority, then load order. Later writes win.

import { AppAPI } from './AppAPI.js';

const REQUIRED_FIELDS = ['id', 'name', 'version', 'main'];
const STATE_KEY = 'rpgDemo.pluginState'; // enabled/disabled flags in localStorage

export class PluginManager {
  constructor({ pluginRoot = './plugins/', api = AppAPI } = {}) {
    this.pluginRoot = pluginRoot;
    this.api = api;
    this.registry = new Map();       // id -> { manifest, baseUrl, module, context, enabled, loadOrder }
    this.assetOverrides = new Map(); // normalized asset path -> { pluginId, url }
    this.conflicts = [];             // [{ asset, loser, winner }] for debugging
    this.loadCounter = 0;
  }

  /** Read the registry file and every listed manifest.json. */
  async scanPlugins() {
    let folders = [];
    try {
      const res = await fetch(`${this.pluginRoot}index.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      folders = (await res.json()).plugins ?? [];
    } catch (err) {
      console.warn('No plugin registry found. Running without plugins.', err.message);
      return [];
    }

    for (const folder of folders) {
      const baseUrl = `${this.pluginRoot}${folder}/`;
      try {
        const res = await fetch(`${baseUrl}manifest.json`);
        if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
        const manifest = await res.json();
        this.validateManifest(manifest);
        if (this.registry.has(manifest.id)) throw new Error(`duplicate id "${manifest.id}"`);
        this.registry.set(manifest.id, {
          manifest, baseUrl, module: null, context: null, enabled: false, loadOrder: -1,
        });
      } catch (err) {
        // One bad plugin folder must not stop the others.
        console.error(`Skipping plugin folder "${folder}":`, err.message);
      }
    }
    return this.list();
  }

  validateManifest(manifest) {
    for (const field of REQUIRED_FIELDS) {
      if (!manifest[field]) throw new Error(`manifest missing "${field}"`);
    }
  }

  /** Load every discovered plugin the user has not disabled. */
  async loadAll() {
    const saved = this.readState();
    for (const id of this.registry.keys()) {
      if (saved[id] === false) continue;
      try { await this.loadPlugin(id); }
      catch (err) { console.error(`Failed to load "${id}":`, err); }
    }
  }

  /** Load dependencies, import the entry script, and call activate(context). */
  async loadPlugin(id, _chain = []) {
    const entry = this.registry.get(id);
    if (!entry) throw new Error(`Unknown plugin "${id}"`);
    if (entry.enabled) return;
    if (_chain.includes(id)) {
      throw new Error(`Circular dependency: ${[..._chain, id].join(' -> ')}`);
    }

    for (const dep of entry.manifest.dependencies ?? []) {
      await this.loadPlugin(dep, [..._chain, id]);
    }

    const scriptUrl = new URL(entry.manifest.main, new URL(entry.baseUrl, location.href)).href;
    entry.module = await import(scriptUrl);
    entry.context = this.createContext(id);
    entry.loadOrder = this.loadCounter++;

    try {
      await entry.module.activate?.(entry.context);
    } catch (err) {
      this.api.offAll(id); // roll back half-registered listeners
      throw err;
    }

    entry.enabled = true;
    this.rebuildOverrideTable();
    await this.api.trigger('onPluginLoaded', { id, manifest: entry.manifest });
  }

  /**
   * Remove a plugin's effects. ES modules cannot be un-imported,
   * so the code stays in memory until the page reloads.
   */
  async unloadPlugin(id) {
    const entry = this.registry.get(id);
    if (!entry?.enabled) return;
    try { await entry.module.deactivate?.(entry.context); }
    catch (err) { console.error(`[${id}] deactivate failed:`, err); }
    this.api.offAll(id);
    entry.enabled = false;
    this.rebuildOverrideTable();
  }

  async enablePlugin(id)  { await this.loadPlugin(id);   this.saveState(id, true);  }
  async disablePlugin(id) { await this.unloadPlugin(id); this.saveState(id, false); }

  list() {
    return [...this.registry.values()].map(({ manifest, enabled }) => ({ ...manifest, enabled }));
  }

  /** Precompute the override Map. Runs only when the active plugin set changes. */
  rebuildOverrideTable() {
    this.assetOverrides.clear();
    this.conflicts = [];

    const active = [...this.registry.entries()]
      .filter(([, e]) => e.enabled)
      .sort(([, a], [, b]) =>
        (a.manifest.priority ?? 0) - (b.manifest.priority ?? 0) || a.loadOrder - b.loadOrder);

    for (const [pluginId, entry] of active) {
      for (const [assetPath, file] of Object.entries(entry.manifest.overrides ?? {})) {
        const key = normalizePath(assetPath);
        const previous = this.assetOverrides.get(key);
        if (previous) this.conflicts.push({ asset: key, loser: previous.pluginId, winner: pluginId });
        this.assetOverrides.set(key, { pluginId, url: entry.baseUrl + file });
      }
    }
    this.api.triggerSync('onOverridesChanged', { count: this.assetOverrides.size });
  }

  /** O(1) lookup. Returns the override URL, or null to use the default asset. */
  getAssetPath(path) {
    return this.assetOverrides.get(normalizePath(path))?.url ?? null;
  }

  /** Build the frozen context object handed to a plugin. */
  createContext(id) {
    const api = this.api;
    const entry = this.registry.get(id);
    return Object.freeze({
      id,
      manifest: entry.manifest,
      on: (eventName, cb, opts = {}) => api.on(eventName, cb, { ...opts, owner: id }),
      off: (eventName, cb) => api.off(eventName, cb),
      trigger: (eventName, data) => api.trigger(eventName, data),
      resolve: (file) => entry.baseUrl + file, // URL of a file inside this plugin's folder
      log: (...args) => console.log(`[${id}]`, ...args),
    });
  }

  readState() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY)) ?? {}; }
    catch { return {}; }
  }

  saveState(id, enabled) {
    const state = this.readState();
    state[id] = enabled;
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  }
}

/** "assets/asset_sprites/enemy_1.png" and "asset_sprites/enemy_1.png" map to the same key. */
export function normalizePath(path) {
  return path.replace(/^\.?\/?assets\//, '').replace(/^\/+/, '');
}
