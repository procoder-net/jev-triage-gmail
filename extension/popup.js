chrome.storage.local.get('jevKey').then(({ jevKey }) => {
  document.getElementById('key').textContent = jevKey ? 'saved ✓' : 'missing — add it in Options';
});
document.getElementById('gmail').onclick = () => chrome.tabs.create({ url: 'https://mail.google.com/mail/u/0/#inbox' });
document.getElementById('opts').onclick = () => chrome.runtime.openOptionsPage();
