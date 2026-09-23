// AppAPI.js - event system that lets plugins hook into the engine lifecycle.
//
// HOW IT WORKS
// - on(eventName, callback)   subscribes a listener.
// - trigger(eventName, data)  runs listeners in priority order.
//
// A listener can do three things:
//   1. OBSERVE: read the data and return nothing.
//   2. FILTER:  return a new data object. The next listener receives it,
//               and the engine uses the final result.
//   3. CANCEL:  call event.cancel(). Remaining listeners are skipped and
//               the engine is told to abort the action.
//
// ASYNC vs SYNC TRIGGERS
// - trigger()     is async. Listeners may await (e.g. load an asset).
//                 Use it for one-time events: scene start, battle start.
// - triggerSync() never awaits. Use it for per-frame events like onUpdate
//                 and onUIRender. Awaiting inside the render loop would
//                 stall frames, so async listeners are ignored there.
//
// ERROR ISOLATION
// Every listener runs inside try/catch. A broken plugin logs an error
// but never crashes the engine or blocks other plugins.

const listeners = new Map(); // eventName -> [{ callback, priority, owner }]

function makeEvent(name, data) {
  return {
    name,
    data,
    cancelled: false,
    cancel() { this.cancelled = true; },
  };
}

export const AppAPI = {
  version: '1.0.0',

  /**
   * Subscribe to an event.
   * @param {string}   eventName
   * @param {Function} callback  (data, event) => newData | undefined
   * @param {object}   options   priority: higher runs first. owner: plugin id.
   * @returns {Function} unsubscribe
   */
  on(eventName, callback, { priority = 0, owner = 'core' } = {}) {
    if (typeof callback !== 'function') {
      throw new TypeError(`AppAPI.on("${eventName}") needs a function`);
    }
    const list = listeners.get(eventName) ?? [];
    list.push({ callback, priority, owner });
    list.sort((a, b) => b.priority - a.priority);
    listeners.set(eventName, list);
    return () => this.off(eventName, callback);
  },

  off(eventName, callback) {
    const list = listeners.get(eventName);
    if (!list) return;
    listeners.set(eventName, list.filter(l => l.callback !== callback));
  },

  /** Remove every listener owned by one plugin. Called when it is disabled. */
  offAll(owner) {
    for (const [name, list] of listeners) {
      listeners.set(name, list.filter(l => l.owner !== owner));
    }
  },

  /**
   * Async trigger for one-time events.
   * @returns {Promise<{data, cancelled}>} Engine code must use the returned data.
   */
  async trigger(eventName, data = {}) {
    const event = makeEvent(eventName, data);
    const list = listeners.get(eventName);
    if (!list) return { data: event.data, cancelled: false };

    // Copy the list: a listener may unsubscribe while we loop.
    for (const { callback, owner } of [...list]) {
      try {
        const result = await callback(event.data, event);
        if (result !== undefined) event.data = result;
      } catch (err) {
        console.error(`[${owner}] error in "${eventName}":`, err);
      }
      if (event.cancelled) break;
    }
    return { data: event.data, cancelled: event.cancelled };
  },

  /**
   * Sync trigger for per-frame events. Returned Promises are ignored.
   * @returns {{data, cancelled}}
   */
  triggerSync(eventName, data = {}) {
    const event = makeEvent(eventName, data);
    const list = listeners.get(eventName);
    if (!list) return { data: event.data, cancelled: false };

    for (const { callback, owner } of [...list]) {
      try {
        const result = callback(event.data, event);
        if (result !== undefined && !(result instanceof Promise)) event.data = result;
      } catch (err) {
        console.error(`[${owner}] error in "${eventName}":`, err);
      }
      if (event.cancelled) break;
    }
    return { data: event.data, cancelled: event.cancelled };
  },
};

// Exposed globally for console debugging only. Plugins should use their context.
window.AppAPI = AppAPI;
