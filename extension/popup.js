import { slots } from './controller.js';
const $ = id => document.getElementById(id);
async function request(message) {
  try {
    const result = await chrome.runtime.sendMessage(message);
    if (!result?.ok) throw Error(result?.error || 'The extension did not respond. Reopen this panel.');
  } catch (error) { $('status').textContent = error.message; }
}
async function refreshAudio() {
  const { bindings = {} } = await chrome.storage.session.get('bindings');
  const lines = await Promise.all(slots.filter(slot => bindings[slot]).map(async slot => {
    const label = `Stream ${slots.indexOf(slot) + 1}`;
    try {
      const tab = await chrome.tabs.get(bindings[slot].id);
      if (tab.url !== bindings[slot].url) return `${label}: page changed; select it again`;
      return `${label}: ${tab.mutedInfo.muted ? 'muted' : 'sound allowed'}${tab.audible ? ' (audio detected)' : ''}`;
    } catch { return `${label}: closed; select it again`; }
  }));
  $('audio').textContent = lines.join('\n');
}
async function load() {
  const saved = await chrome.storage.session.get(['bindings', 'status']);
  const tabs = (await chrome.tabs.query({})).filter(tab => /^https?:\/\//.test(tab.url || '') && !tab.incognito);
  for (const slot of slots) {
    $(slot).add(new Option('Choose a tab...', ''));
    for (const tab of tabs) $(slot).add(new Option(tab.title || tab.url, String(tab.id)));
    const previous = saved.bindings?.[slot];
    if (tabs.some(tab => tab.id === previous?.id && tab.url === previous.url)) $(slot).value = String(previous.id);
  }
  $('status').textContent = saved.status || 'Choose your tabs, then save. Leave unused streams blank.';
  await refreshAudio();
}
$('streams').addEventListener('submit', async event => {
  event.preventDefault();
  const values = slots.map(slot => $(slot).value);
  if (values[3] && !values[2]) { $('status').textContent = 'Choose stream 3 before stream 4.'; return; }
  const button = event.submitter;
  if (button) button.disabled = true;
  try { await request({ op: 'save', ids: values.filter(Boolean).map(Number) }); }
  finally { if (button) button.disabled = false; }
});
$('pause').addEventListener('click', () => request({ op: 'pause' }));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session') return;
  if (changes.status) $('status').textContent = changes.status.newValue;
  refreshAudio().catch(error => { $('audio').textContent = error.message; });
});
chrome.tabs.onUpdated.addListener((_id, change) => {
  if (change.mutedInfo || 'audible' in change || 'url' in change)
    refreshAudio().catch(error => { $('audio').textContent = error.message; });
});
chrome.tabs.onRemoved.addListener(() => refreshAudio().catch(error => { $('audio').textContent = error.message; }));
load().catch(error => { $('status').textContent = error.message; });
