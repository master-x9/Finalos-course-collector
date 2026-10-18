'use strict';

// Observe only course SRT requests on the host provided by the user.
// Signed URLs are processed in memory only and are not logged or persisted.
const TRANSCRIPT_HOST = 'nkb-backend-ccbp-media-static.s3.amazonaws.com';

function isAllowedTranscriptUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' &&
      url.hostname === TRANSCRIPT_HOST &&
      /\/media\/transcripts\/[^/]+\.srt$/i.test(url.pathname);
  } catch {
    return false;
  }
}

chrome.webRequest.onBeforeRequest.addListener((details) => {
  if (details.tabId < 0 || !isAllowedTranscriptUrl(details.url)) return;
  chrome.storage.local.get({ finalsosEnabled: true }, (settings) => {
    if (chrome.runtime.lastError || !settings.finalsosEnabled) return;
    chrome.tabs?.sendMessage(details.tabId, {
      type: 'FINALSOS_TRANSCRIPT_DETECTED',
      url: details.url,
      pathName: (() => {
        try { return new URL(details.url).pathname.split('/').pop(); }
        catch { return 'transcript.srt'; }
      })(),
      frameId: details.frameId
    }).catch(() => {
      // The lesson may have navigated away or its content script may not be ready.
    });
  });
}, { urls: [`https://${TRANSCRIPT_HOST}/*`] });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return undefined;

  if (message.type === 'FINALSOS_FETCH_TRANSCRIPT') {
    (async () => {
      const settings = await chrome.storage.local.get({ finalsosEnabled: true });
      if (!settings.finalsosEnabled) throw new Error('Automatic capture is turned off. Turn it on from the extension menu to save transcripts.');
      if (!isAllowedTranscriptUrl(message.url)) {
        throw new Error('Blocked: this URL is not a recognized course transcript URL.');
      }
      const response = await fetch(message.url, {
        method: 'GET',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'follow'
      });
      if (!response.ok) {
        throw new Error(`Transcript request failed (HTTP ${response.status}). Reload the lesson and try again if the link expired.`);
      }
      if (!response.url || new URL(response.url).hostname !== TRANSCRIPT_HOST) {
        throw new Error('Blocked: the transcript request redirected to an unexpected host.');
      }
      const text = await response.text();
      if (!text.trim()) throw new Error('The transcript response was empty.');
      if (text.length > 2_000_000) throw new Error('Transcript was unexpectedly large; export stopped.');
      return { ok: true, text };
    })().then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error?.message || 'Could not fetch the transcript.' });
    });
    return true;
  }
  return undefined;
});
