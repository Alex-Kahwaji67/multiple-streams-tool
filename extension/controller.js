export const slots = ['stream1', 'stream2', 'stream3', 'stream4'];
export const shortcuts = ['Ctrl+Shift+7', 'Ctrl+Shift+8', 'Ctrl+Shift+9', 'Ctrl+Shift+0'];

// Saving, pausing and switching share a queue so their audio changes cannot interleave.
export function createController(browser) {
  let queue = Promise.resolve();
  function enqueue(task) {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  }
  async function resolve(binding) {
    if (!binding) return null;
    try {
      const tab = await browser.tabs.get(binding.id);
      return tab.url === binding.url ? tab : null;
    } catch { return null; }
  }
  return {
    configure(ids) {
      return enqueue(async () => {
        if (!Array.isArray(ids) || ids.length < 2 || ids.length > 4 ||
            ids.some(id => !Number.isInteger(id) || id < 0)) {
          throw Error('Choose two to four stream tabs, in order.');
        }
        const tabs = await Promise.all(ids.map(id => browser.tabs.get(id)));
        if (tabs.some(tab => !/^https?:\/\//.test(tab.url || '') || tab.incognito))
          throw Error('Choose regular web tabs, outside private browsing.');
        if (new Set(tabs.map(tab => tab.windowId)).size !== tabs.length)
          throw Error('Put each stream in a separate browser window.');
        const commands = await browser.commands.getAll();
        for (let i = 0; i < tabs.length; i++) {
          if (commands.find(command => command.name === slots[i])?.shortcut !== shortcuts[i])
            throw Error(`Assign ${shortcuts[i]} to Select stream ${i + 1} in extension keyboard shortcuts. Set its scope to Global.`);
        }
        const bindings = Object.fromEntries(tabs.map((tab, i) => [slots[i], { id: tab.id, url: tab.url }]));
        await browser.storage.session.set({ bindings, enabled: true });
        return tabs.length;
      });
    },
    pause() {
      return enqueue(() => browser.storage.session.set({ enabled: false }));
    },
    select(slot) {
      return enqueue(async () => {
        if (!slots.includes(slot)) throw Error('Unknown stream.');
        const { bindings = {}, enabled } = await browser.storage.session.get(['bindings', 'enabled']);
        if (!enabled) throw Error('Open the extension and save your streams first.');
        const resolved = await Promise.all(slots.map(key => resolve(bindings[key])));
        const target = resolved[slots.indexOf(slot)];
        if (!target) throw Error(`Stream ${slots.indexOf(slot) + 1} is closed or changed. Select it again in the extension.`);
        const others = resolved.filter(tab => tab && tab.id !== target.id);
        const present = resolved.filter(Boolean);
        if (new Set(present.map(tab => tab.windowId)).size !== present.length)
          throw Error('Keep each stream in a separate browser window.');
        try {
          // Finish muting every other selected tab before unmuting the target.
          for (const tab of others) await browser.tabs.update(tab.id, { muted: true });
          await browser.tabs.update(target.id, { active: true, muted: false });
          // Changing the window state to maximized would exit player fullscreen.
          await browser.windows.update(target.windowId, { focused: true });
          if ((await browser.tabs.get(target.id)).mutedInfo.muted)
            throw Error('The selected tab is still muted.');
          for (const tab of others) {
            if (!(await browser.tabs.get(tab.id)).mutedInfo.muted)
              throw Error('Another selected tab is still audible.');
          }
          return { number: slots.indexOf(slot) + 1, missing: Object.keys(bindings).length - present.length };
        } catch (error) {
          // Best effort: a tab closed during the switch may no longer be restorable.
          await Promise.allSettled(present.map(tab => browser.tabs.update(tab.id, { muted: tab.mutedInfo.muted })));
          throw error;
        }
      });
    }
  };
}
