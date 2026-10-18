// Injected into a shared tab's isolated world. Idempotent: the library and its
// ref table live for the lifetime of the document, so refs survive between
// commands and die on navigation.
(() => {
  const KEY = '__tabsteer_' + chrome.runtime.getManifest().version.replace(/\W/g, '_');
  if (globalThis[KEY]) return;

  // ---------------------------------------------------------------- refs
  // A ref looks like @kqzbwr12: a random per-document prefix plus a counter, so
  // a ref taken on a previous page cannot resolve to an element on this one.
  const NONCE = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => String.fromCharCode(97 + (b % 26))).join('');
  const byId = new Map();
  const idOf = new WeakMap();
  let nextId = 1;

  function refFor(el) {
    let id = idOf.get(el);
    if (!id) {
      id = nextId++;
      idOf.set(el, id);
      byId.set(id, new WeakRef(el));
    }
    return `@${NONCE}${id}`;
  }

  function fromRef(ref) {
    const m = /^@([a-z]{6})(\d+)$/.exec(ref);
    if (!m) throw new Error(`"${ref}" is not a valid ref.`);
    const el = m[1] === NONCE ? byId.get(Number(m[2]))?.deref() : null;
    if (!el || !el.isConnected) {
      throw new Error(`Ref ${ref} is stale: the page changed since it was read. Run "tabsteer read" again.`);
    }
    return el;
  }

  // ------------------------------------------------------------- helpers
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const styleOf = (el) => el.ownerDocument.defaultView.getComputedStyle(el);

  const STRICT =
    'a[href],button,input:not([type="hidden"]),textarea,select,summary,' +
    '[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]';
  const LOOSE =
    '[role="button"],[role="link"],[role="tab"],[role="checkbox"],[role="radio"],' +
    '[role="menuitem"],[role="option"],[role="switch"],[onclick]';
  const SKIP = new Set(['script', 'style', 'noscript', 'template', 'svg', 'head', 'option', 'canvas', 'video', 'audio']);

  function isInteractive(el) {
    if (el.matches(STRICT)) return true;
    // Generic clickable wrappers only count when they don't wrap real controls.
    return el.matches(LOOSE) && !el.querySelector(STRICT);
  }

  function rendered(el) {
    if (el.checkVisibility && !el.checkVisibility({ checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  const SENSITIVE_NAME = /(^|[^a-z])(cc|cvv|cvc|csc|card|pan|otp|totp|mfa|2fa|pin|ssn|password|passcode|secret)([^a-z]|$)|cardnumber|securitycode|verificationcode/i;
  function isSensitive(el) {
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    if ((el.type || '').toLowerCase() === 'password') return true;
    if (/password|cc-|one-time-code/.test(ac)) return true;
    const names = [el.name, el.id, el.getAttribute('aria-label'), el.getAttribute('data-testid')].filter(Boolean).join(' ');
    return SENSITIVE_NAME.test(names.replace(/([a-z])([A-Z])/g, '$1 $2'));
  }

  function shownValue(el) {
    if (isSensitive(el)) return el.value ? '[hidden]' : '';
    return clean(el.value).slice(0, 200);
  }

  function labelOf(el) {
    const tag = el.localName;
    const aria = el.getAttribute('aria-label');
    if (aria) return clean(aria);
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const root = el.getRootNode();
      const text = labelledBy
        .split(/\s+/)
        .map((id) => (root.getElementById ? root.getElementById(id) : null))
        .filter(Boolean)
        .map((n) => n.innerText)
        .join(' ');
      if (clean(text)) return clean(text);
    }
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      const type = (el.type || '').toLowerCase();
      if (tag === 'input' && ['button', 'submit', 'reset'].includes(type)) return clean(el.value) || type;
      const label = el.labels && el.labels[0];
      if (label) {
        // A label that wraps its control would otherwise include the control's own text.
        const copy = label.cloneNode(true);
        copy.querySelectorAll('select,textarea,input,button').forEach((n) => n.remove());
        if (clean(copy.textContent)) return clean(copy.textContent);
      }
      return clean(el.placeholder || el.title || el.name || '');
    }
    return (
      clean(el.innerText) ||
      clean(el.title) ||
      clean(el.querySelector('img[alt]')?.alt) ||
      clean(el.value) ||
      ''
    );
  }

  function kindOf(el) {
    const tag = el.localName;
    const role = el.getAttribute('role');
    if (tag === 'input') {
      const type = (el.type || 'text').toLowerCase();
      if (type === 'checkbox' || type === 'radio') return type;
      if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
      return 'input';
    }
    if (tag === 'textarea' || tag === 'select') return tag;
    if (el.isContentEditable) return 'editable';
    if (tag === 'a' || role === 'link') return 'link';
    if (role === 'checkbox' || role === 'radio' || role === 'switch') return role;
    return 'button';
  }

  // One-line description of a control, as it appears in `read` output.
  function describe(el) {
    const ref = refFor(el);
    const kind = kindOf(el);
    const label = labelOf(el).slice(0, 120);
    const off = el.disabled || el.getAttribute('aria-disabled') === 'true' ? ' disabled' : '';
    switch (kind) {
      case 'link': {
        let href = el.getAttribute('href') || '';
        if (href.length > 150) href = href.slice(0, 150) + '…';
        return `[${label}](${href}) ${ref}`;
      }
      case 'input':
        return `[input:${(el.type || 'text').toLowerCase()} "${label}" value="${shownValue(el)}"${off} ${ref}]`;
      case 'textarea':
        return `[textarea "${label}" value="${shownValue(el)}"${off} ${ref}]`;
      case 'select': {
        const chosen = el.selectedOptions && el.selectedOptions[0];
        const shown = isSensitive(el) ? (chosen && el.value ? '[hidden]' : '') : clean(chosen ? chosen.text : '');
        return `[select "${label}" value="${shown}"${off} ${ref}]`;
      }
      case 'checkbox':
      case 'radio':
      case 'switch': {
        const on = el.checked || el.getAttribute('aria-checked') === 'true';
        return `[${kind} "${label}"${on ? ' checked' : ''}${off} ${ref}]`;
      }
      case 'editable':
        return `[editable "${clean(el.getAttribute('aria-label') || el.getAttribute('placeholder') || '')}" ${ref}]`;
      default:
        return `[button "${label}"${off} ${ref}]`;
    }
  }

  // querySelectorAll that also descends into open shadow roots and
  // same-origin iframes.
  function deepAll(selector, root = document, out = []) {
    out.push(...root.querySelectorAll(selector));
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) {
        deepAll(selector, el.shadowRoot, out);
      } else if (el.localName === 'iframe' || el.localName === 'frame') {
        let doc = null;
        try {
          doc = el.contentDocument;
        } catch (e) {}
        if (doc) deepAll(selector, doc, out);
      }
    }
    return out;
  }

  function findByText(text) {
    const needle = clean(text).toLowerCase();
    if (!needle) throw new Error('Empty target.');
    const labelled = deepAll(`${STRICT},${LOOSE}`)
      .filter((el) => isInteractive(el) && rendered(el))
      .map((el) => ({ el, label: labelOf(el).toLowerCase() }))
      .filter((x) => x.label);

    let hits = labelled.filter((x) => x.label === needle).map((x) => x.el);
    if (!hits.length) hits = labelled.filter((x) => x.label.includes(needle)).map((x) => x.el);
    // Prefer the innermost control when matches are nested.
    hits = hits.filter((el) => !hits.some((other) => other !== el && el.contains(other)));

    if (!hits.length) {
      // Fall back to plain text that is exactly the target.
      const seen = new Set();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const parent = n.parentElement;
        if (parent && clean(n.nodeValue).toLowerCase() === needle && rendered(parent)) seen.add(parent);
      }
      hits = [...seen];
    }

    if (hits.length === 1) return hits[0];
    if (!hits.length) {
      throw new Error(`No element with text "${text}" found. Run "tabsteer read" to see the page.`);
    }
    const list = hits.slice(0, 8).map((el) => '  ' + (isInteractive(el) ? describe(el) : `"${clean(el.innerText).slice(0, 80)}" ${refFor(el)}`));
    const more = hits.length > 8 ? `\n  …and ${hits.length - 8} more` : '';
    throw new Error(`"${text}" matches ${hits.length} elements. Use one of these refs instead:\n${list.join('\n')}${more}`);
  }

  // A selector like input[value^="a"] would let an agent guess a field's value
  // one character at a time, so selectors may not look at values.
  function checkSelector(sel) {
    if (/\[\s*value\b|:placeholder-shown|:valid|:invalid|:in-range|:out-of-range/i.test(sel)) {
      throw new Error('CSS selectors may not test field values. Use a ref from "tabsteer read" instead.');
    }
  }

  function resolve(target) {
    if (target.startsWith('@')) return fromRef(target);
    if (target.startsWith('css=')) {
      checkSelector(target.slice(4));
      let found;
      try {
        found = deepAll(target.slice(4));
      } catch (e) {
        throw new Error(`Invalid CSS selector: ${target.slice(4)}`);
      }
      if (!found.length) throw new Error(`No element matches selector ${target.slice(4)}`);
      return found[0];
    }
    return findByText(target);
  }

  function activeElement() {
    let a = document.activeElement;
    for (;;) {
      if (a && a.shadowRoot && a.shadowRoot.activeElement) {
        a = a.shadowRoot.activeElement;
      } else if (a && a.localName === 'iframe') {
        let inner = null;
        try {
          inner = a.contentDocument && a.contentDocument.activeElement;
        } catch (e) {}
        if (!inner) break;
        a = inner;
      } else {
        break;
      }
    }
    return a;
  }

  const isEditableField = (el) =>
    el && (el.localName === 'textarea' || el.localName === 'select' || el.isContentEditable ||
      (el.localName === 'input' && !['checkbox', 'radio', 'file', 'button', 'submit', 'reset', 'image', 'range', 'color'].includes((el.type || '').toLowerCase())));

  // ------------------------------------------------------------ commands
  function read({ offset, limit }) {
    offset = offset || 0;
    limit = limit || 12000;
    const lines = [];
    let cur = [];
    const flush = (prefix = '') => {
      const s = clean(cur.join(' '));
      cur = [];
      if (s && s !== '-' && s !== '|') lines.push(prefix + s);
    };

    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = clean(node.nodeValue);
        if (t) cur.push(t);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node;
      const tag = el.localName;
      if (SKIP.has(tag) || el.getAttribute('aria-hidden') === 'true') return;
      const cs = styleOf(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      const cell = cs.display === 'table-cell';
      const block = !(cs.display.startsWith('inline') || cs.display === 'contents' || cell);

      if (tag === 'br' || tag === 'hr') return flush();
      if (tag === 'img') {
        const alt = clean(el.alt);
        if (alt) cur.push(`![${alt.slice(0, 80)}]`);
        return;
      }
      if (tag === 'iframe' || tag === 'frame') {
        flush();
        let doc = null;
        try {
          doc = el.contentDocument;
        } catch (e) {}
        if (doc && doc.body) {
          walk(doc.body);
          flush();
        } else {
          lines.push(`[iframe ${(el.getAttribute('src') || '').slice(0, 150)}]`);
        }
        return;
      }
      if (isInteractive(el)) {
        const kind = kindOf(el);
        if (kind === 'link' && !labelOf(el)) return;
        if (block) flush();
        cur.push(describe(el));
        if (kind === 'editable') {
          const t = clean(el.innerText).slice(0, 500);
          if (t) cur.push(t);
        }
        if (block) flush();
        return;
      }

      const heading = /^h[1-6]$/.test(tag);
      if (block || heading) flush();
      if (tag === 'li') cur.push('-');
      if (tag === 'slot' && el.assignedNodes({ flatten: true }).length) {
        for (const n of el.assignedNodes({ flatten: true })) walk(n);
      } else {
        for (const child of (el.shadowRoot || el).childNodes) walk(child);
      }
      if (cell) cur.push('|');
      if (heading) return flush('#'.repeat(Number(tag[1])) + ' ');
      if (block) flush();
    }

    walk(document.body);
    flush();
    const body = lines.join('\n');
    const end = Math.min(body.length, offset + limit);
    let content = `# ${document.title}\nURL: ${location.href}\n\n${body.slice(offset, end)}`;
    if (end < body.length) {
      content += `\n\n[truncated: showing characters ${offset}-${end} of ${body.length}. Continue with --offset ${end}]`;
    }
    return { title: document.title, url: location.href, content, total: body.length, offset, end };
  }

  function click({ target }) {
    const el = resolve(target);
    if (el.disabled) throw new Error(`Element ${refFor(el)} is disabled.`);
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const top = el.ownerDocument.elementFromPoint(x, y);
    const covered = !!top && top !== el && !el.contains(top) && !top.contains(el);

    const view = el.ownerDocument.defaultView;
    const base = { bubbles: true, cancelable: true, composed: true, view, clientX: x, clientY: y, button: 0 };
    const pointer = { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, buttons: 1 }));
    el.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));
    if (typeof el.focus === 'function') el.focus({ preventScroll: true });
    el.dispatchEvent(new PointerEvent('pointerup', pointer));
    el.dispatchEvent(new MouseEvent('mouseup', base));
    // Exactly one click event.
    if (typeof el.click === 'function') el.click();
    else el.dispatchEvent(new MouseEvent('click', base));

    return { ref: refFor(el), kind: kindOf(el), label: labelOf(el).slice(0, 80), covered };
  }

  function type({ text, into }) {
    const el = into ? resolve(into) : activeElement();
    if (!isEditableField(el)) {
      throw new Error(into ? `${into} is not a text field.` : 'No text field is focused. Pass --into <ref> (get refs from "tabsteer read").');
    }
    if (el.disabled || el.readOnly) throw new Error(`Field ${refFor(el)} is disabled or read-only.`);
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    el.focus({ preventScroll: true });
    const view = el.ownerDocument.defaultView;

    if (el.localName === 'select') {
      const want = clean(text).toLowerCase();
      const option = [...el.options].find((o) => clean(o.text).toLowerCase() === want || o.value.toLowerCase() === want);
      if (!option) {
        throw new Error(`No option "${text}". Options: ${[...el.options].map((o) => clean(o.text)).slice(0, 30).join(' | ')}`);
      }
      el.value = option.value;
      el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ref: refFor(el), value: isSensitive(el) ? '[hidden]' : clean(option.text) };
    }

    if (el.isContentEditable) {
      const sel = view.getSelection();
      const range = el.ownerDocument.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      // insertText goes through the editor's own input handling.
      if (!el.ownerDocument.execCommand('insertText', false, text)) {
        el.textContent = text;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
      }
      return { ref: refFor(el), value: text.slice(0, 200) };
    }

    const proto = el.localName === 'textarea' ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ref: refFor(el), value: isSensitive(el) ? '[hidden]' : text.slice(0, 200) };
  }

  const KEY_CODES = {
    Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46, ' ': 32,
    ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
    Home: 36, End: 35, PageUp: 33, PageDown: 34,
  };

  function press({ key, into }) {
    if (key === 'Space') key = ' ';
    if (key === 'Esc') key = 'Escape';
    const el = (into ? resolve(into) : activeElement()) || document.body;
    if (into && typeof el.focus === 'function') el.focus({ preventScroll: true });
    const keyCode = KEY_CODES[key] || (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
    const code = key === ' ' ? 'Space' : key.length === 1 ? (/[a-z]/i.test(key) ? 'Key' + key.toUpperCase() : /\d/.test(key) ? 'Digit' + key : '') : key;
    const init = { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true, composed: true, view: el.ownerDocument.defaultView };
    const proceed = el.dispatchEvent(new KeyboardEvent('keydown', init));

    // Synthetic key events don't trigger browser defaults, so do the common ones.
    let did = null;
    if (proceed) {
      const tag = el.localName;
      const clickable = tag === 'button' || tag === 'a' || tag === 'summary' || el.getAttribute('role') === 'button' ||
        (tag === 'input' && ['button', 'submit', 'reset', 'checkbox', 'radio'].includes((el.type || '').toLowerCase()));
      if (key === 'Enter' && clickable && !['checkbox', 'radio'].includes(el.type)) {
        el.click();
        did = 'clicked';
      } else if (key === ' ' && clickable && tag !== 'a') {
        el.click();
        did = 'clicked';
      } else if (key === 'Enter' && tag === 'input' && el.form) {
        const submitter = el.form.querySelector('button:not([type]),button[type="submit"],input[type="submit"],input[type="image"]');
        if (submitter && !submitter.disabled) el.form.requestSubmit(submitter);
        else el.form.requestSubmit();
        did = 'submitted form';
      }
    }
    el.dispatchEvent(new KeyboardEvent('keyup', init));
    const result = { pressed: key === ' ' ? 'Space' : key, on: el === document.body ? 'page' : refFor(el), did };
    // Password managers often cancel Enter on login forms. Say so instead of
    // failing silently, and point at the submit button.
    if (!proceed && key === 'Enter' && el.localName === 'input' && el.form) {
      result.cancelled = true;
      const submitter = el.form.querySelector('button:not([type]),button[type="submit"],input[type="submit"],input[type="image"]');
      if (submitter) result.submitter = refFor(submitter);
    }
    return result;
  }

  function scroll({ direction, amount }) {
    const max = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    const step = amount || Math.floor(innerHeight * 0.8);
    if (direction === 'top') scrollTo({ top: 0, behavior: 'instant' });
    else if (direction === 'bottom') scrollTo({ top: max, behavior: 'instant' });
    else if (direction === 'up') scrollBy({ top: -step, behavior: 'instant' });
    else if (direction === 'down') scrollBy({ top: step, behavior: 'instant' });
    else throw new Error('Direction must be up, down, top or bottom.');
    return { scrollY: Math.round(scrollY), maxY: Math.round(max) };
  }

  function wait({ target, timeout, gone }) {
    const present = () => {
      if (target.startsWith('@')) {
        try {
          return rendered(fromRef(target));
        } catch (e) {
          return false;
        }
      }
      if (target.startsWith('css=')) return deepAll(target.slice(4)).some(rendered);
      return clean(document.body.innerText).toLowerCase().includes(clean(target).toLowerCase());
    };
    if (target.startsWith('css=')) {
      checkSelector(target.slice(4));
      try {
        document.querySelector(target.slice(4));
      } catch (e) {
        throw new Error(`Invalid CSS selector: ${target.slice(4)}`);
      }
    }
    const started = Date.now();
    return new Promise((done, fail) => {
      const tick = () => {
        if (present() !== !!gone) return done({ waited: Date.now() - started });
        if (Date.now() - started >= timeout) {
          return fail(new Error(`Timed out after ${timeout} ms waiting for "${target}"${gone ? ' to disappear' : ''}.`));
        }
        setTimeout(tick, 100);
      };
      tick();
    });
  }

  const COMMANDS = { read, click, type, press, scroll, wait };

  globalThis[KEY] = {
    async run(command, args) {
      try {
        const fn = COMMANDS[command];
        if (!fn) throw new Error(`Unknown page command: ${command}`);
        return { ok: await fn(args || {}) };
      } catch (e) {
        return { error: String((e && e.message) || e) };
      }
    },
  };
})();
