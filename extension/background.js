import { createController } from './controller.js';
const controller = createController(chrome);
async function status(text, error = false) {
  await chrome.storage.session.set({ status: text });
  await chrome.action.setBadgeText({ text: error ? '!' : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#b42318' });
  await chrome.action.setTitle({ title: text });
}
chrome.commands.onCommand.addListener(async slot => {
  try {
    const result = await controller.select(slot);
    await status(`Stream ${result.number} selected.${result.missing ? ' Another selected tab is closed or changed.' : ''}`);
  } catch (error) { await status(error.message, true); }
});

// Accept setup changes only from this extension's popup, never from websites.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup.html')) return;
  (async () => {
    if (message?.op === 'save') {
      const count = await controller.configure(message.ids);
      await status(`${count} streams saved. Press a shortcut to choose which one you hear.`);
    } else if (message?.op === 'pause') {
      await controller.pause();
      await status('Audio control paused. Stop the Windows tray script to release F7 through F10.');
    } else throw Error('Unknown request.');
    respond({ ok: true });
  })().catch(error => respond({ ok: false, error: error.message }));
  return true;
});
