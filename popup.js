'use strict';

const enabledToggle = document.getElementById('enabled');
const status = document.getElementById('status');
const description = document.getElementById('setting-desc');

function render(enabled) {
  enabledToggle.checked = Boolean(enabled);
  description.textContent = enabled
    ? 'ON · Videos and reading lessons ask before saving.'
    : 'OFF · No automatic prompts will appear.';
  status.textContent = enabled ? 'Automatic capture prompts are ON.' : 'Automatic capture prompts are OFF.';
}

chrome.storage.local.get({ finalsosEnabled: true }, (settings) => {
  render(settings.finalsosEnabled);
});

enabledToggle.addEventListener('change', () => {
  const enabled = enabledToggle.checked;
  enabledToggle.disabled = true;
  status.textContent = 'Updating…';
  chrome.storage.local.set({ finalsosEnabled: enabled }, () => {
    if (chrome.runtime.lastError) {
      render(!enabled);
      status.textContent = `Could not update setting: ${chrome.runtime.lastError.message}`;
    } else {
      render(enabled);
    }
    enabledToggle.disabled = false;
  });
});
