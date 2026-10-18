(() => {
  'use strict';

  // There is deliberately no persistent in-page collector panel. Only a modal
  // prompt appears when a lesson asset is detected and automatic prompts are ON.
  if (window.__finalsOSCollectorInstance) return;

  const TRANSCRIPT_HOST = 'nkb-backend-ccbp-media-static.s3.amazonaws.com';
  const TRANSCRIPT_SELECTOR = /\/media\/transcripts\/[^/]+\.srt$/i;
  const QUESTION_SELECTOR = '[class*="TutorialContentMcqQuestionWrapper"]';
  const FEEDBACK_SELECTOR = '[class*="SubmitFeedbackButtonWrapper"]';
  const ROOT_SELECTOR = '.tutorial-content-container, [data-testid="text-learning-card"]';
  const OPTION_SELECTOR = 'input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"], [role="option"], button, [class*="OptionWrapper"], [class*="AnswerOption"], [class*="McqOption"]';

  const transcriptCandidates = new Map();
  const promptedTokens = new Set();
  let activeSessionId = 0;
  let activePageSignature = '';
  let readingPromptedForSession = false;
  let currentPrompt = null;
  let promptQueue = [];
  let scanTimer = 0;
  let featureEnabled = true;
  let settingsReady = false;

  const host = document.createElement('div');
  host.id = 'finalsos-course-collector-prompt';
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;display:none;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      * { box-sizing: border-box; }
      [hidden] { display: none !important; }
      button,input { font:inherit; }
      button { cursor:pointer; }
      .backdrop { position:fixed; inset:0; display:grid; place-items:center; padding:18px; background:rgba(12,20,36,.48); }
      .card { width:min(560px,calc(100vw - 32px)); max-height:calc(100vh - 32px); overflow:auto; color:#172033; background:#fff; border:1px solid #dbe3f0; border-radius:18px; box-shadow:0 24px 80px rgba(0,0,0,.28); padding:24px; }
      .eyebrow { color:#245eea; text-transform:uppercase; letter-spacing:.08em; font-size:12px; font-weight:850; margin-bottom:8px; }
      h2 { margin:0 0 10px; font-size:23px; line-height:1.25; letter-spacing:-.4px; }
      p { color:#64748b; line-height:1.55; font-size:15px; margin:0 0 18px; overflow-wrap:anywhere; }
      label { display:block; color:#475569; font-size:14px; font-weight:750; margin:0 0 7px; }
      input { display:block; width:100%; color:#172033; background:#fff; border:1px solid #cbd5e1; border-radius:11px; padding:13px 14px; font-size:16px; outline:none; margin-bottom:18px; }
      input:focus { border-color:#7096ff; box-shadow:0 0 0 4px rgba(36,94,234,.13); }
      .actions { display:flex; gap:10px; }
      .actions button { flex:1; border-radius:11px; padding:12px 14px; font-size:14px; font-weight:800; }
      .later { border:1px solid #d5deeb; background:white; color:#475569; }
      .save { border:1px solid #245eea; background:#245eea; color:white; }
      .save:hover { background:#1d4ed8; }
      button:disabled { opacity:.6; cursor:wait; }
      .note { margin-top:14px; color:#8490a3; font-size:12px; line-height:1.45; overflow-wrap:anywhere; }
      .error { color:#a12828; background:#fff0f0; padding:9px 10px; border-radius:9px; }
      .success { color:#166534; background:#e8f8ef; padding:9px 10px; border-radius:9px; }
      @media(max-width:480px) { .card { padding:19px; } h2 { font-size:20px; } .actions { flex-direction:column-reverse; } }
    </style>
    <div class="backdrop" id="backdrop">
      <section class="card" role="dialog" aria-modal="true" aria-labelledby="title" aria-describedby="desc">
        <div class="eyebrow" id="eyebrow">Lesson detected</div>
        <h2 id="title">Save this lesson?</h2>
        <p id="desc">A lesson is ready to capture. Would you like to save it now?</p>
        <label for="filename">File name</label>
        <input id="filename" maxlength="120" autocomplete="off" value="Lesson">
        <div class="actions">
          <button class="later" id="later" type="button">Not now</button>
          <button class="save" id="save" type="button">Save</button>
        </div>
        <div class="note" id="note">Nothing is saved unless you confirm.</div>
      </section>
    </div>
  `;
  document.documentElement.appendChild(host);

  const $ = (selector) => shadow.querySelector(selector);
  const filenameInput = $('#filename');
  const titleNode = $('#title');
  const descNode = $('#desc');
  const eyebrowNode = $('#eyebrow');
  const saveButton = $('#save');
  const laterButton = $('#later');
  const noteNode = $('#note');

  function cleanText(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[\t ]+\n/g, '\n')
      .replace(/\n[\t ]+/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function safeStem(value, fallback = 'Lesson') {
    const result = String(value || '')
      .normalize('NFKC')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/[. ]+$/g, '')
      .trim()
      .slice(0, 110);
    return result || fallback;
  }

  function getReadingRoot() {
    const roots = Array.from(document.querySelectorAll(ROOT_SELECTOR)).filter(isVisibleElement);
    // Prefer the known tutorial container when present; some course lessons use
    // a separate TextLearningCard/Markdown layout instead.
    return roots.find((element) => element.matches('.tutorial-content-container'))
      || roots.find((element) => element.matches('[data-testid="text-learning-card"]'))
      || null;
  }

  function guessedTopicName() {
    const root = getReadingRoot();
    const inRoot = root?.querySelector('h1, h2, h3, [data-testid="markdown-h2"]');
    const visibleHeading = inRoot?.innerText || document.querySelector('main h1, h1')?.innerText;
    const title = cleanText(visibleHeading || document.title || 'Lesson');
    // Preserve meaningful hyphens (e.g. "Array Session - 6 Part 1"). Only trim
    // breadcrumb-style suffixes separated by a vertical bar.
    return safeStem(title.replace(/\s*\|\s*.*$/, ''), 'Lesson');
  }

  function isVisibleElement(element) {
    if (!(element instanceof Element)) return true;
    if (element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.contentVisibility !== 'hidden' && style.opacity !== '0';
  }

  function isExtractorNoise(element) {
    return element.matches([
      `${FEEDBACK_SELECTOR}`,
      'script', 'style', 'noscript', 'iframe', 'template', 'svg',
      '.ace_gutter', '.ace_scrollbar', '.ace_cursor-layer', '.ace_marker-layer',
      '.ace_print-margin-layer', '.ace_text-input', '.ace_fold-widget',
      '.markdown-index-list', '.collapse-expand-icon-container',
      '[data-testid="markdown-codeblock"] textarea'
    ].join(','));
  }

  function inlineText(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[\t\r\n]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function extractAceCode(node) {
    const editor = node.matches?.('.ace_editor') ? node : node.querySelector?.('.ace_editor');
    const textLayer = editor?.querySelector('.ace_text-layer');
    if (textLayer) {
      // Read only Ace's rendered source lines. Avoid the gutter, hidden textarea,
      // scrollbars, caret layers, and off-screen measurement nodes (which can
      // contain repeated filler strings rather than lesson content).
      const lines = Array.from(textLayer.querySelectorAll(':scope > .ace_line'));
      if (lines.length) {
        return lines.map((line) => (line.textContent || '').replace(/[\u200b\ufeff]/g, '').replace(/\r/g, '')).join('\n').replace(/\n+$/, '');
      }
    }
    const pre = node.querySelector?.('pre');
    if (pre) return (pre.innerText || pre.textContent || '').replace(/\r/g, '').trimEnd();
    const code = node.querySelector?.('code');
    if (code) return (code.innerText || code.textContent || '').replace(/\r/g, '').trimEnd();
    return '';
  }

  function extractLanguageLabel(wrapper) {
    const selector = wrapper.querySelector('[id="markdown-content-drop-down-button"]');
    if (!selector) return '';
    const text = inlineText(selector.firstChild?.textContent || selector.textContent || '');
    return text.split(/\s+/)[0].replace(/[^a-z0-9+#.-]/gi, '').slice(0, 20);
  }

  function renderCodeBlock(node, language = '') {
    const code = extractAceCode(node);
    if (!code.trim()) return '\n\n[Code block present, but its source was not available in the rendered page.]\n\n';
    const lang = String(language || '').toLowerCase();
    const fence = '```';
    const codeBody = code.replace(/```/g, '`\u200b``');
    return `\n\n${fence}${lang}\n${codeBody}\n${fence}\n\n`;
  }

  function plainTextFromNode(rootNode, options = {}) {
    const excludeQuestionBlocks = options.excludeQuestionBlocks !== false;
    const excludeOptions = options.excludeOptions === true;
    const skipControls = options.skipControls !== false;

    function renderChildren(element, listDepth = 0) {
      return Array.from(element.childNodes)
        .map((child) => walk(child, listDepth))
        .join('');
    }

    function walk(current, listDepth = 0) {
      if (current.nodeType === Node.TEXT_NODE) return current.nodeValue || '';
      if (current.nodeType !== Node.ELEMENT_NODE) return '';
      const element = current;
      if (!isVisibleElement(element) || isExtractorNoise(element)) return '';
      if (excludeQuestionBlocks && element !== rootNode && element.matches(QUESTION_SELECTOR)) return '';
      if (excludeOptions && element !== rootNode && element.matches(OPTION_SELECTOR)) return '';

      const tag = element.tagName;
      const testId = element.getAttribute('data-testid') || '';

      // These course lessons render examples with Ace instead of <pre><code>.
      // The enclosing wrapper holds both the selected language and the code.
      if (element.classList.contains('markdown-code-block-language-wrapper')) {
        const language = extractLanguageLabel(element);
        return renderCodeBlock(element, language || '');
      }
      if (testId === 'markdown-codeblock' || element.classList.contains('ace_editor')) {
        return renderCodeBlock(element, '');
      }
      if (testId === 'markdown-highlighted-code') {
        return `\`${inlineText(element.innerText || element.textContent || '')}\``;
      }
      if (element.matches('.markdown-drop-down-content, .markdown-drop-down-option')) return '';
      if (skipControls && ['INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'OPTION'].includes(tag)) return '';
      if (tag === 'BR') return '\n';
      if (tag === 'IMG') return element.alt ? `[Image: ${inlineText(element.alt)}]` : '';
      if (tag === 'HR') return '\n\n------------------------------------------------------------\n\n';

      if (tag === 'PRE') {
        const code = (element.innerText || element.textContent || '').replace(/\r/g, '').trimEnd();
        return `\n\n\`\`\`\n${code}\n\`\`\`\n\n`;
      }
      if (tag === 'CODE') return `\`${inlineText(element.innerText || element.textContent || '')}\``;

      if (tag === 'TR') {
        const cells = Array.from(element.children).filter((child) => ['TD', 'TH'].includes(child.tagName));
        return `\n| ${cells.map((cell) => inlineText(walk(cell))).join(' | ')} |\n`;
      }
      if (tag === 'TABLE') {
        const rows = Array.from(element.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tr'));
        const rendered = rows.map((row) => walk(row)).join('');
        return `\n\n${rendered}\n`;
      }
      if (/^H[1-6]$/.test(tag)) {
        const level = Number(tag.slice(1));
        const title = inlineText(renderChildren(element, listDepth));
        return title ? `\n\n${'#'.repeat(level)} ${title}\n\n` : '';
      }
      if (tag === 'LI') {
        const parentIsOrdered = element.parentElement?.tagName === 'OL';
        const siblingIndex = element.parentElement ? Array.from(element.parentElement.children).indexOf(element) : 0;
        const number = Number(element.parentElement?.getAttribute('start') || 1) + siblingIndex;
        const prefix = parentIsOrdered ? `${number}. ` : `${'  '.repeat(Math.max(0, listDepth - 1))}- `;
        const inner = renderChildren(element, listDepth + (element.parentElement?.tagName === 'UL' || element.parentElement?.tagName === 'OL' ? 1 : 0)).trim();
        if (!inner) return '';
        // Preserve nested lists and any fenced code that belongs inside an item.
        const formatted = inner.replace(/^\n+|\n+$/g, '').replace(/\n{3,}/g, '\n\n');
        return `\n${prefix}${formatted.replace(/\n(?!\n)/g, '\n  ')}\n`;
      }
      if (tag === 'UL' || tag === 'OL') return `\n${renderChildren(element, listDepth + 1)}\n`;
      if (tag === 'BLOCKQUOTE') {
        const content = renderChildren(element, listDepth).trim();
        return content ? `\n\n${content.split('\n').map((line) => line ? `> ${line}` : '>').join('\n')}\n\n` : '';
      }
      if (element.matches('[data-testid="NOTE"], [data-testid="TIP"], [data-testid="WARNING"]')) {
        const label = inlineText(element.querySelector('.markdown-alert-header-container')?.innerText || testId);
        const contentRoot = element.querySelector('.markdown-alert-description-container') || element;
        const content = renderChildren(contentRoot, listDepth).trim();
        return `\n\n${label.toUpperCase()}\n${content}\n\n`;
      }
      if (tag === 'P') {
        const content = inlineText(renderChildren(element, listDepth));
        return content ? `\n\n${content}\n\n` : '';
      }
      if (tag === 'TD' || tag === 'TH' || tag === 'A' || tag === 'SPAN' || tag === 'LABEL') {
        return renderChildren(element, listDepth);
      }
      const inner = renderChildren(element, listDepth);
      const isBlock = ['DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'ASIDE', 'MAIN', 'FIGURE', 'DETAILS'].includes(tag);
      if (isBlock) {
        const trimmed = inner.replace(/^\n+|\n+$/g, '');
        return trimmed ? `\n\n${trimmed}\n\n` : '';
      }
      return inner;
    }

    return walk(rootNode)
      .replace(/\r/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  async function expandReadingCodeBlocks(root) {
    // The platform clips some code examples behind an "Expand" control. Once
    // the user has asked to save the lesson, expand those code viewers so Ace can
    // render the full visible source before extracting the lines.
    let expanded = false;
    for (const control of Array.from(root.querySelectorAll('.collapse-expand-code-block'))) {
      if (!isVisibleElement(control)) continue;
      const label = inlineText(control.innerText || control.textContent || '');
      if (/^expand$/i.test(label)) {
        control.click();
        expanded = true;
      }
    }
    if (expanded) await new Promise((resolve) => window.setTimeout(resolve, 250));
  }

  function pageTopicSignature() {
    return `${location.pathname}|${cleanText(document.title)}|${guessedTopicName()}`;
  }

  function showPrompt(type, token, extras = {}) {
    if (!settingsReady || !featureEnabled || !token || promptedTokens.has(token)) return;
    promptedTokens.add(token);
    const prompt = { type, token, ...extras, done: false };
    if (currentPrompt) {
      promptQueue.push(prompt);
      return;
    }
    openPrompt(prompt);
  }

  function openPrompt(prompt) {
    if (!featureEnabled) return;
    currentPrompt = prompt;
    host.style.display = 'block';
    const topic = guessedTopicName();
    filenameInput.value = prompt.type === 'reading' ? `${safeStem(topic, 'Lesson')} Notes` : safeStem(topic, 'Lesson');
    filenameInput.disabled = false;
    saveButton.disabled = false;
    laterButton.disabled = false;
    laterButton.hidden = false;
    saveButton.textContent = prompt.type === 'transcript' ? 'Save transcript (.srt)' : 'Save reading (.txt)';
    noteNode.className = 'note';
    noteNode.textContent = 'Nothing is saved unless you confirm. Choose a destination in the save dialog when available.';

    if (prompt.type === 'transcript') {
      eyebrowNode.textContent = 'Video lesson detected';
      titleNode.textContent = 'Save this video transcript?';
      descNode.textContent = `A transcript request was detected for “${topic}”. Choose a filename and save the original subtitle file.`;
    } else {
      eyebrowNode.textContent = 'Reading lesson detected';
      titleNode.textContent = 'Save this reading material?';
      descNode.textContent = `Reading material from “${topic}” is ready. The .txt file will contain the lesson text and a separate MCQ section.`;
    }
    window.setTimeout(() => filenameInput.focus(), 25);
  }

  function closePrompt() {
    host.style.display = 'none';
    currentPrompt = null;
    filenameInput.disabled = false;
    if (featureEnabled && promptQueue.length) openPrompt(promptQueue.shift());
    else promptQueue = [];
  }

  function showPromptError(message) {
    noteNode.textContent = message;
    noteNode.className = 'note error';
    saveButton.disabled = false;
    laterButton.disabled = false;
    saveButton.textContent = currentPrompt?.type === 'transcript' ? 'Try saving again (.srt)' : 'Try saving again (.txt)';
  }

  function showPromptSuccess(filename) {
    if (!currentPrompt) return;
    currentPrompt.done = true;
    titleNode.textContent = 'Saved successfully';
    descNode.textContent = `Your file was saved as “${filename}”.`;
    filenameInput.disabled = true;
    saveButton.disabled = false;
    saveButton.textContent = 'Done';
    laterButton.hidden = true;
    noteNode.textContent = 'Click Done to continue.';
    noteNode.className = 'note success';
  }

  function setTranscriptDetected(rawUrl, pathName) {
    if (!settingsReady || !featureEnabled) return;
    let parsed;
    try { parsed = new URL(rawUrl); } catch { return; }
    if (parsed.protocol !== 'https:' || parsed.hostname !== TRANSCRIPT_HOST || !TRANSCRIPT_SELECTOR.test(parsed.pathname)) return;

    // Use the path only as an in-memory identity. Never persist signed query parameters.
    const key = parsed.pathname;
    let label = pathName || parsed.pathname.split('/').pop() || 'transcript.srt';
    try { label = decodeURIComponent(label); } catch { /* Keep original label. */ }
    transcriptCandidates.set(key, { key, url: rawUrl, label });
    const promptToken = `transcript:${activeSessionId}:${key}`;
    showPrompt('transcript', promptToken, { key });
  }

  function rescanLoadedRequests() {
    if (!settingsReady || !featureEnabled) return;
    for (const entry of performance.getEntriesByType('resource')) {
      if (!entry.name) continue;
      try {
        const url = new URL(entry.name);
        if (url.hostname === TRANSCRIPT_HOST && TRANSCRIPT_SELECTOR.test(url.pathname)) {
          setTranscriptDetected(entry.name, url.pathname.split('/').pop());
        }
      } catch { /* Ignore non-URL resource entries. */ }
    }
  }

  function beginSavePicker(suggestedName, description, mimeType, extensions) {
    if (typeof window.showSaveFilePicker !== 'function') return null;
    return window.showSaveFilePicker({
      suggestedName,
      types: [{ description, accept: { [mimeType]: extensions } }]
    });
  }

  async function writeToHandle(handle, blob) {
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
  }

  function triggerBlobDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.documentElement.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async function saveTranscript(key, nameOverride) {
    if (!featureEnabled) throw new Error('Automatic capture is turned off. Turn it back on from the extension menu to save.');
    const current = transcriptCandidates.get(key);
    if (!current) throw new Error('This transcript request is no longer available. Replay the video to request it again.');

    const stem = safeStem(nameOverride, guessedTopicName()).replace(/\.(?:srt|txt)$/i, '');
    const outputName = `${stem}.srt`;
    let pickerPromise = null;
    try { pickerPromise = beginSavePicker(outputName, 'SubRip subtitles', 'application/x-subrip', ['.srt']); }
    catch (error) { pickerPromise = Promise.reject(error); }

    let handle = null;
    if (pickerPromise) {
      try { handle = await pickerPromise; }
      catch (error) {
        if (error?.name === 'AbortError') throw new Error('Save cancelled. You can try again or choose Not now.');
        // Fall back to a Blob download if the native picker is unavailable.
      }
    }

    const response = await chrome.runtime.sendMessage({ type: 'FINALSOS_FETCH_TRANSCRIPT', url: current.url });
    if (!response?.ok) throw new Error(response?.error || 'Could not retrieve the transcript. Reload the lesson if the signed link expired.');
    const blob = new Blob([response.text], { type: 'application/x-subrip;charset=utf-8' });
    if (handle) await writeToHandle(handle, blob);
    else triggerBlobDownload(blob, outputName);
    transcriptCandidates.delete(key);
    return outputName;
  }

  function findQuestionChoices(wrapper) {
    const candidates = Array.from(wrapper.querySelectorAll(OPTION_SELECTOR)).filter(isVisibleElement);
    const choices = [];
    const seen = new Set();
    for (const element of candidates) {
      if (element.tagName === 'BUTTON' && /^(submit|next|previous|check answer|show answer|hint|explanation)$/i.test(cleanText(element.innerText))) continue;
      let container = element.closest('label, [role="radio"], [role="checkbox"], [class*="OptionWrapper"], [class*="AnswerOption"], [class*="McqOption"]');
      if (!container) container = element.parentElement;
      const text = plainTextFromNode(container || element, { excludeQuestionBlocks: false, skipControls: false });
      if (text && !seen.has(text)) {
        seen.add(text);
        choices.push(text);
      }
    }
    return choices;
  }

  function extractQuestion(wrapper, index) {
    const statement = plainTextFromNode(wrapper, { excludeQuestionBlocks: false, excludeOptions: true, skipControls: true });
    const fullVisibleText = plainTextFromNode(wrapper, { excludeQuestionBlocks: false, skipControls: false });
    return {
      number: index + 1,
      question_text: statement || fullVisibleText,
      choices: findQuestionChoices(wrapper)
    };
  }

  function makeQuestionsText(questions) {
    if (!questions.length) return 'No matching MCQ question blocks were found on this page. Open the relevant quiz or practice section and save again.';
    return questions.map((question) => {
      const choices = question.choices.length
        ? `\n\nOPTIONS\n${question.choices.map((choice, index) => `${String.fromCharCode(65 + (index % 26))}. ${choice}`).join('\n')}`
        : '\n\nOptions were not detected as separate elements; check the question text above.';
      return `QUESTION ${question.number}\n${question.question_text || '(No visible question text found)'}${choices}\n\nAnswer key: not captured`;
    }).join('\n\n----------------------------------------\n\n');
  }

  function collectReadingDocument() {
    const root = getReadingRoot();
    if (!root) throw new Error(`Could not find a supported reading container (${ROOT_SELECTOR}). Open a reading lesson first.`);
    const title = guessedTopicName();
    const pageUrl = `${location.origin}${location.pathname}`;
    const capturedAt = new Date().toLocaleString();
    const readingText = plainTextFromNode(root, { excludeQuestionBlocks: true, skipControls: true });
    const questionNodes = Array.from(root.querySelectorAll(QUESTION_SELECTOR)).filter(isVisibleElement);
    const questions = questionNodes.map(extractQuestion);
    const divider = '============================================================';
    const text = [
      'FINALSOS COURSE NOTES',
      `Title: ${title}`,
      `Source: ${pageUrl}`,
      `Captured: ${capturedAt}`,
      '', divider, 'READING MATERIAL', divider,
      readingText || '(No visible reading text was found.)',
      '', divider, `MCQ PRACTICE QUESTIONS (${questions.length})`, divider,
      makeQuestionsText(questions), '',
      'Note: Answers are not guessed or inferred by this exporter.', ''
    ].join('\n');
    return { title, questions, text };
  }

  async function exportReadingText(nameOverride) {
    if (!featureEnabled) throw new Error('Automatic capture is turned off. Turn it back on from the extension menu to save.');
    const stem = safeStem(nameOverride, `${guessedTopicName()} Notes`).replace(/\.(?:srt|txt)$/i, '');
    const outputName = `${stem}.txt`;
    let pickerPromise = null;
    try { pickerPromise = beginSavePicker(outputName, 'Plain text study notes', 'text/plain', ['.txt']); }
    catch (error) { pickerPromise = Promise.reject(error); }

    let handle = null;
    if (pickerPromise) {
      try { handle = await pickerPromise; }
      catch (error) {
        if (error?.name === 'AbortError') throw new Error('Save cancelled. You can try again or choose Not now.');
        // Fall back to a normal .txt download if the native picker is unavailable.
      }
    }

    const readingRoot = getReadingRoot();
    if (!readingRoot) throw new Error('Could not find the reading material on this page.');
    await expandReadingCodeBlocks(readingRoot);
    const captured = collectReadingDocument();
    const blob = new Blob(['\uFEFF', captured.text], { type: 'text/plain;charset=utf-8' });
    if (handle) await writeToHandle(handle, blob);
    else triggerBlobDownload(blob, outputName);
    return outputName;
  }

  async function saveFromPrompt() {
    if (!currentPrompt || !featureEnabled) return;
    if (currentPrompt.done) {
      closePrompt();
      return;
    }

    const prompt = currentPrompt;
    const stem = safeStem(filenameInput.value, guessedTopicName());
    saveButton.disabled = true;
    laterButton.disabled = true;
    saveButton.textContent = 'Saving…';
    noteNode.textContent = 'Preparing the file…';
    noteNode.className = 'note';

    try {
      const filename = prompt.type === 'transcript'
        ? await saveTranscript(prompt.key, stem)
        : await exportReadingText(stem);
      if (currentPrompt === prompt) showPromptSuccess(filename);
    } catch (error) {
      if (currentPrompt === prompt && featureEnabled) showPromptError(error?.message || 'Could not save this lesson.');
    }
  }

  function scanForNewSession() {
    if (!settingsReady || !featureEnabled) return;
    const signature = pageTopicSignature();
    if (signature !== activePageSignature) {
      activePageSignature = signature;
      activeSessionId += 1;
      readingPromptedForSession = false;
    }

    const root = getReadingRoot();
    if (root && isVisibleElement(root)) {
      const rawText = plainTextFromNode(root, { excludeQuestionBlocks: true, skipControls: true });
      const heading = root.querySelector('h1, h2, h3');
      const topic = cleanText(heading?.innerText || guessedTopicName());
      if (rawText.length >= 40 && topic && !readingPromptedForSession) {
        readingPromptedForSession = true;
        const token = `reading:${activeSessionId}:${location.pathname}:${topic}`;
        showPrompt('reading', token);
      }
    } else {
      readingPromptedForSession = false;
    }
  }

  function scheduleSessionScan() {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scanForNewSession, 850);
  }

  saveButton.addEventListener('click', saveFromPrompt);
  laterButton.addEventListener('click', closePrompt);
  filenameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') saveFromPrompt();
    if (event.key === 'Escape') closePrompt();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'FINALSOS_TRANSCRIPT_DETECTED' && typeof message.url === 'string') {
      setTranscriptDetected(message.url, message.pathName);
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes.finalsosEnabled) return;
    const enabled = changes.finalsosEnabled.newValue !== false;
    featureEnabled = enabled;
    if (!enabled) {
      host.style.display = 'none';
      currentPrompt = null;
      promptQueue = [];
      return;
    }
    // Force a new session scan on enable, then pick up any SRT requests already loaded.
    activePageSignature = '';
    readingPromptedForSession = false;
    scanForNewSession();
    rescanLoadedRequests();
  });

  window.__finalsOSCollectorInstance = { active: true };

  chrome.storage.local.get({ finalsosEnabled: true }, (settings) => {
    featureEnabled = settings.finalsosEnabled !== false;
    settingsReady = true;
    scanForNewSession();
    rescanLoadedRequests();

    // Keep observers alive even if capture starts OFF, so switching it ON from
    // the toolbar works without requiring a page reload. Their callbacks check
    // settingsReady/featureEnabled before showing any prompts.
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.name) continue;
          try {
            const url = new URL(entry.name);
            if (url.hostname === TRANSCRIPT_HOST && TRANSCRIPT_SELECTOR.test(url.pathname)) {
              setTranscriptDetected(entry.name, url.pathname.split('/').pop());
            }
          } catch { /* Ignore malformed resource entries. */ }
        }
      });
      observer.observe({ type: 'resource', buffered: true });
    } catch { /* Background webRequest detection remains available. */ }

    const pageObserver = new MutationObserver(scheduleSessionScan);
    pageObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    scheduleSessionScan();
  });
})();
