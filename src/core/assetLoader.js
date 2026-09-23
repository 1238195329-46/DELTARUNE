// assetLoader.js - asset loading with plugin override support.

// ================================================================
// BEFORE: always loads from /assets/
// ================================================================
/*
const cache = new Map();

export async function loadAsset(path) {
  if (cache.has(path)) return cache.get(path);
  const asset = await fetchByType(`./assets/${path}`);
  cache.set(path, asset);
  return asset;
}
*/

// ================================================================
// AFTER: checks PluginManager.getAssetPath() first, then falls back
// ================================================================
import { normalizePath } from './PluginManager.js';

const cache = new Map();
let pluginManager = null;

/** Wire in the manager once at startup. */
export function setPluginManager(manager) {
  pluginManager = manager;
  // If plugins are enabled/disabled, cached assets may now be wrong.
  manager.api.on('onOverridesChanged', () => cache.clear());
}

export async function loadAsset(path) {
  const key = normalizePath(path);
  if (cache.has(key)) return cache.get(key);

  const defaultUrl = `./assets/${key}`;
  const overrideUrl = pluginManager?.getAssetPath(key); // single O(1) Map lookup

  let asset;
  if (overrideUrl) {
    try {
      asset = await fetchByType(overrideUrl);
    } catch (err) {
      // A missing override file should never break the game.
      console.warn(`Override failed for "${key}". Using default.`, err.message);
    }
  }
  asset ??= await fetchByType(defaultUrl);

  cache.set(key, asset);
  return asset;
}

/** Choose how to load a file from its extension. */
async function fetchByType(url) {
  const ext = url.split('.').pop().toLowerCase();

  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
    const img = new Image();
    img.src = url;
    await img.decode(); // rejects on load failure
    return img;
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);

  if (ext === 'json') return res.json();
  if (['mp3', 'ogg', 'wav'].includes(ext)) return res.arrayBuffer(); // decode with AudioContext
  return res.text();
}
