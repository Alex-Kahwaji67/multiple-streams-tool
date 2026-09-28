import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createController, slots, shortcuts } from './extension/controller.js';

function fixture(count = 4) {
  const tabs = new Map(Array.from({ length: 5 }, (_, i) => [i + 1, {
    id: i + 1, windowId: i + 1, url: `https://example.test/stream-${i + 1}`,
    mutedInfo: { muted: false }, incognito: false
  }]));
  const storage = { enabled: true, bindings: Object.fromEntries(slots.slice(0, count).map((slot, i) => [slot, { id: i + 1, url: tabs.get(i + 1).url }])) };
  const history = [];
  const windowStates = new Map([...tabs.keys()].map(id => [id, 'fullscreen']));
  const failures = { focus: false, mute: null, ignoreMute: null };
  const commands = slots.map((name, i) => ({ name, shortcut: shortcuts[i] }));
  const browser = {
    storage: { session: {
      get: async () => structuredClone(storage),
      set: async value => Object.assign(storage, structuredClone(value))
    } },
    commands: { getAll: async () => commands },
    tabs: {
      get: async id => {
        if (!tabs.has(id)) throw Error('Closed tab');
        return structuredClone(tabs.get(id));
      },
      update: async (id, change) => {
        // Yield between writes so concurrent requests expose interleaving bugs.
        await new Promise(resolve => setTimeout(resolve, 1));
        if (!tabs.has(id)) throw Error('Closed tab');
        if (change.muted && failures.mute === id) throw Error('Mute failed');
        history.push({ id, ...change });
        if ('muted' in change && failures.ignoreMute !== id) tabs.get(id).mutedInfo.muted = change.muted;
        return structuredClone(tabs.get(id));
      }
    },
    windows: { update: async (id, change) => {
      if (failures.focus) throw Error('Window closed');
      if ('state' in change) windowStates.set(id, change.state);
    } }
  };
  function state(selected, size = count) {
    for (let id = 1; id <= size; id++) assert.equal(tabs.get(id).mutedInfo.muted, id !== selected);
    assert.equal(tabs.get(5).mutedInfo.muted, false, 'unrelated tab changed');
    for (const value of windowStates.values()) assert.equal(value, 'fullscreen');
  }
  return { ...createController(browser), tabs, storage, history, failures, commands, state };
}
for (const count of [2, 3, 4]) {
  const f = fixture(count);
  await f.configure(Array.from({ length: count }, (_, i) => i + 1));
  for (let i = 0; i < count; i++) {
    await f.select(slots[i]); f.state(i + 1);
    await f.select(slots[i]); f.state(i + 1);
  }
  await Promise.all(Array.from({ length: 24 }, (_, i) => f.select(slots[i % count])));
  f.state(24 % count || count);
  const firstUnmute = f.history.findIndex(entry => entry.muted === false);
  assert.equal(firstUnmute, count - 1, 'target unmuted before others were muted');
}
{
  const f = fixture(); f.tabs.delete(1);
  await assert.rejects(f.select('stream1'), /closed or changed/);
  assert.equal(f.history.length, 0);
}
{
  const f = fixture(); f.tabs.delete(2);
  assert.equal((await f.select('stream1')).missing, 1);
  assert.equal(f.tabs.get(1).mutedInfo.muted, false);
  assert.equal(f.tabs.get(3).mutedInfo.muted, true);
}
{
  const f = fixture(); f.tabs.get(1).url += '/changed';
  await assert.rejects(f.select('stream1'), /closed or changed/);
  assert.equal(f.history.length, 0);
}
{
  const f = fixture(); f.tabs.get(2).url += '/changed';
  assert.equal((await f.select('stream1')).missing, 1);
  assert.equal(f.tabs.get(2).mutedInfo.muted, false, 'navigated tab changed');
}
{
  const f = fixture(); f.tabs.get(2).windowId = 1;
  await assert.rejects(f.select('stream1'), /separate/);
  assert.equal(f.history.length, 0);
}
for (const failure of ['focus', 'mute', 'ignoreMute']) {
  const f = fixture(); f.failures[failure] = failure === 'focus' ? true : 3;
  await assert.rejects(f.select('stream1'));
  for (const tab of f.tabs.values()) assert.equal(tab.mutedInfo.muted, false, 'rollback failed');
  f.failures[failure] = false;
  await f.select('stream2'); f.state(2);
}
for (const ids of [null, [], [1], [1, 2, 3, 4, 5], [1, '2'], [1, -1], [1, 1], [1, 99]]) {
  const f = fixture(); const before = structuredClone(f.storage);
  await assert.rejects(f.configure(ids)); assert.deepEqual(f.storage, before);
}
for (const url of ['file:///test', 'chrome://settings', 'javascript:alert(1)']) {
  const f = fixture(); f.tabs.get(2).url = url;
  await assert.rejects(f.configure([1, 2]), /regular web/);
}
{
  const f = fixture(); f.tabs.get(2).incognito = true;
  await assert.rejects(f.configure([1, 2]), /private/);
}
{
  const f = fixture(); f.commands[0].shortcut = '';
  await assert.rejects(f.configure([1, 2]), /Ctrl\+Shift\+7/);
}
{
  const f = fixture();
  await assert.rejects(f.select('unknown'), /Unknown/);
  await Promise.all([f.select('stream1'), f.pause()]);
  await assert.rejects(f.select('stream2'), /save your streams/);
  f.state(1);
  await f.configure([1, 2]); await f.select('stream2');
  assert.equal(f.tabs.get(2).mutedInfo.muted, false);
}
// Keep the public keyboard mapping and permissions in sync across both halves.
const manifest = JSON.parse(await readFile(new URL('./extension/manifest.json', import.meta.url), 'utf8'));
const ahk = await readFile(new URL('./Multiple-Streams.ahk', import.meta.url), 'utf8');
assert.deepEqual(manifest.permissions, ['tabs', 'storage']);
assert.equal(manifest.host_permissions, undefined);
for (let i = 0; i < slots.length; i++) {
  assert.equal(manifest.commands[slots[i]].suggested_key.default, shortcuts[i]);
  assert.equal(manifest.commands[slots[i]].global, true);
  assert.ok(ahk.includes(`Hotkey("F${i + 7}", (*) => Choose(${i + 1}, "${[7, 8, 9, 0][i]}", "F${i + 7}"))`));
}
assert.ok(!ahk.includes('SoundSetMute'));
console.log('PASS: 2/3/4 streams, repeated and queued selection, mute ordering, fullscreen preservation, unrelated tabs, missing or changed tabs, rollback, setup validation, pause and keyboard mappings.');
console.log('Mock tests do not verify physical sound, browser-global shortcuts or Windows desktop transitions.');
