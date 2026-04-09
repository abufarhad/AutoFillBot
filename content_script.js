// Content script for Form Autofill Saver

// Listen for messages from background script and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'captureFormData': {
      const formData = captureCurrentFormData();
      sendResponse({ success: true, formData: formData, fieldCount: formData.length });
      break;
    }

    case 'autofillForm':
      autofillFormFields(request.formData, request.isAutomatic).then(result => {
        sendResponse({ success: true, filledCount: result.filledCount, errors: result.errors });
      });
      return true;

    default:
      sendResponse({ error: 'Unknown action' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CAPTURE
// ─────────────────────────────────────────────────────────────────────────────
function captureCurrentFormData() {
  const formData = [];
  document.querySelectorAll('input, select, textarea').forEach(element => {
    if (!isElementVisible(element) || element.disabled) return;
    if (['submit', 'button', 'reset', 'image'].includes(element.type)) return;

    const value = getValue(element);
    if (value === null || value === '' || value === undefined) return;
    if ((element.type === 'checkbox' || element.type === 'radio') && value === false) return;

    formData.push({
      // Store the raw name — NEVER CSS.escape it.
      // job[1][designation] stays as job[1][designation], clean and readable.
      selector:    generateSelector(element),
      value:       value,
      type:        element.type || element.tagName.toLowerCase(),
      name:        element.name        || '',
      id:          element.id          || '',
      placeholder: element.placeholder || '',
      tagName:     element.tagName.toLowerCase(),
    });
  });
  return formData;
}

function getValue(element) {
  const type = (element.type || '').toLowerCase();
  if (type === 'checkbox' || type === 'radio') return element.checked;
  return element.value;
}

// Generate a clean, human-readable selector string.
// For named fields we store the raw name attribute (e.g. job[1][designation]).
// Lookup is done via getElementsByName so no CSS escaping is ever needed.
function generateSelector(element) {
  if (element.name) return element.name;           // job[1][designation]  ← clean!
  if (element.id)   return '#' + element.id;
  if (element.placeholder) return '[placeholder="' + element.placeholder + '"]';
  return generateCSSSelector(element);
}

function generateCSSSelector(element) {
  let selector = element.tagName.toLowerCase();
  if (element.className) {
    const classes = element.className.split(' ').filter(c => c.trim());
    if (classes.length > 0) selector += '.' + classes.join('.');
  }
  if (element.type) selector += `[type="${element.type}"]`;
  const parent = element.parentElement;
  if (parent) {
    const siblings = Array.from(parent.children).filter(
        c => c.tagName === element.tagName && c.type === element.type
    );
    if (siblings.length > 1) selector += `:nth-of-type(${siblings.indexOf(element) + 1})`;
  }
  return selector;
}

function isElementVisible(element) {
  const s = window.getComputedStyle(element);
  return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0'
      && element.offsetWidth > 0 && element.offsetHeight > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUPING helpers
// ─────────────────────────────────────────────────────────────────────────────

// "job[0][employment_type]" → { prefix:'job', index:0, field:'employment_type' }
function parseIndexedName(name) {
  const m = name && name.match(/^(.+?)\[(\d+)\]\[(.+)\]$/);
  return m ? { prefix: m[1], index: parseInt(m[2]), field: m[3] } : null;
}

// Group form fields by their repeating section prefix and index.
// Fields that don't match the pattern go into nonRepeating.
function groupRepeatingFields(formData) {
  const groups = {};
  const nonRepeating = [];

  formData.forEach(field => {
    const parsed = parseIndexedName(field.name);
    if (parsed) {
      if (!groups[parsed.prefix]) groups[parsed.prefix] = {};
      if (!groups[parsed.prefix][parsed.index]) groups[parsed.prefix][parsed.index] = [];
      groups[parsed.prefix][parsed.index].push(field);
    } else {
      nonRepeating.push(field);
    }
  });

  return { groups, nonRepeating };
}

// ─────────────────────────────────────────────────────────────────────────────
// ADD MORE button detection
// ─────────────────────────────────────────────────────────────────────────────

// Safe escape for CSS attribute selectors (only " and \ are special inside "…")
function escapeAttrValue(str) {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function findAddMoreButton(namePrefix) {
  // 1. Known IDs — covers Teletalk/BAB and common form builders
  for (const id of ['addNewJob', 'addMoreBtn', 'add-more', 'addMore', 'addExp', 'addNewExp']) {
    const el = document.getElementById(id);
    if (el && isElementVisible(el)) return el;
  }

  const ADD_RE = /add|more|\+/i;

  // Read only direct text nodes so SVG children don't pollute the match
  function isAddButton(el) {
    const ownText = [...el.childNodes]
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent.trim())
        .join(' ');
    return ADD_RE.test(ownText)
        || ADD_RE.test(el.id || '')
        || ADD_RE.test(el.className || '')
        || /add/i.test(el.getAttribute('onclick') || '');
  }

  // 2. Walk up from an existing index-0 field of this prefix.
  //    IMPORTANT: querySelectorAll('[name^="job["]') is INVALID CSS — raw brackets
  //    are not allowed in attribute selectors. Use getElementsByTagName + filter instead.
  const prefix0 = namePrefix + '[0]';
  let firstField = null;
  for (const el of document.querySelectorAll('input, select, textarea')) {
    if ((el.name || '').startsWith(prefix0)) { firstField = el; break; }
  }

  if (firstField) {
    let container = firstField.parentElement;
    while (container && container !== document.body) {
      for (const el of container.querySelectorAll('button, input[type="button"], a[onclick], [onclick]')) {
        if (el.type === 'submit' && !isAddButton(el)) continue;
        if (isAddButton(el)) return el;
      }
      container = container.parentElement;
    }
  }

  // 3. Page-wide fallback
  for (const el of document.querySelectorAll('button, input[type="button"], a[onclick], [onclick]')) {
    if (isAddButton(el)) return el;
  }

  return null;
}

// Wait for a field belonging to prefix[index] to appear in the DOM.
// Uses startsWith on el.name — never passes brackets into querySelectorAll.
function waitForNewSection(namePrefix, index, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const prefix = namePrefix + '[' + index + ']';
    const check  = () => {
      for (const el of document.querySelectorAll('input, select, textarea')) {
        if ((el.name || '').startsWith(prefix)) return true;
      }
      return false;
    };

    if (check()) { resolve(); return; }

    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timeout waiting for ${namePrefix}[${index}] to appear`));
    }, timeout);

    const observer = new MutationObserver(() => {
      if (check()) { observer.disconnect(); clearTimeout(timer); resolve(); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTOFILL
// ─────────────────────────────────────────────────────────────────────────────
async function autofillFormFields(formData, isAutomatic = false) {
  let filledCount = 0;
  const errors = [];

  console.log(`[AutoFill] Starting autofill with ${formData.length} fields`);

  const { groups, nonRepeating } = groupRepeatingFields(formData);

  const repeatingPrefixes = Object.keys(groups).filter(prefix =>
      Math.max(...Object.keys(groups[prefix]).map(Number)) > 0
  );

  // Non-repeating + single-index groups → fill normally
  const normalFields = [...nonRepeating];
  Object.keys(groups).forEach(prefix => {
    if (!repeatingPrefixes.includes(prefix)) {
      Object.values(groups[prefix]).forEach(fields => fields.forEach(f => normalFields.push(f)));
    }
  });

  for (const fieldData of normalFields) {
    try {
      const elements = findElements(fieldData);
      if (!elements.length) { errors.push(`Not found: ${fieldData.selector}`); continue; }
      elements.forEach(el => { if (fillElement(el, fieldData)) filledCount++; });
    } catch (e) { errors.push(`Error: ${fieldData.selector}: ${e.message}`); }
  }

  // Repeating sections — click ADD MORE for each index > 0, wait, then fill
  for (const prefix of repeatingPrefixes) {
    const indexedFields = groups[prefix];
    const sortedIndices = Object.keys(indexedFields).map(Number).sort((a, b) => a - b);

    for (const index of sortedIndices) {
      if (index > 0) {
        const addBtn = findAddMoreButton(prefix);
        if (!addBtn) {
          errors.push(`"Add more" button not found for section: ${prefix}`);
          continue;
        }
        console.log(`[AutoFill] Clicking ADD MORE for ${prefix}[${index}]`);
        addBtn.click();
        try {
          await waitForNewSection(prefix, index);
          console.log(`[AutoFill] Section ${prefix}[${index}] appeared`);
        } catch (err) {
          errors.push(err.message);
          continue;
        }
      }

      for (const fieldData of indexedFields[index]) {
        try {
          const elements = findElements(fieldData);
          if (!elements.length) { errors.push(`Not found: ${fieldData.selector}`); continue; }
          elements.forEach(el => { if (fillElement(el, fieldData)) filledCount++; });
        } catch (e) { errors.push(`Error: ${fieldData.selector}: ${e.message}`); }
      }
    }
  }

  if (filledCount > 0) {
    showNotification(`Autofilled ${filledCount} fields`, errors.length > 0 ? 'warning' : 'success');
  }
  return { filledCount, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// ELEMENT LOOKUP
// Bracket-style names like job[1][x] are looked up via getElementsByName
// which handles brackets natively — no CSS escaping needed or wanted.
// ─────────────────────────────────────────────────────────────────────────────
function findElements(fieldData) {
  // 1. Raw name → getElementsByName (always works for bracket names)
  if (fieldData.name) {
    const byName = [...document.getElementsByName(fieldData.name)];
    if (byName.length) return byName;
  }

  // 2. ID
  if (fieldData.id) {
    const el = document.getElementById(fieldData.id);
    if (el) return [el];
  }

  // 3. CSS selector — only use if it's a simple selector (no raw brackets)
  //    e.g. #someId or .someClass, not job[1][x] which would need escaping
  if (fieldData.selector && !/\[\d+\]/.test(fieldData.selector)) {
    try {
      const els = [...document.querySelectorAll(fieldData.selector)];
      if (els.length) return els;
    } catch (e) { /* ignore bad selectors */ }
  }

  // 4. Placeholder fallback
  if (fieldData.placeholder) {
    try {
      const els = [...document.querySelectorAll(`[placeholder="${escapeAttrValue(fieldData.placeholder)}"]`)];
      if (els.length) return els;
    } catch (e) { /* ignore */ }
  }

  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// FILL helpers
// ─────────────────────────────────────────────────────────────────────────────
function fillElement(element, fieldData) {
  const tag  = element.tagName.toLowerCase();
  const type = (element.type || '').toLowerCase();
  try {
    if (tag === 'input') {
      if (type === 'checkbox' || type === 'radio') {
        element.checked = fieldData.value === true || fieldData.value === 'true';
        triggerEvents(element, ['change', 'click']);
      } else {
        setNativeValue(element, String(fieldData.value));
        triggerEvents(element, ['input', 'change']);
      }
      return true;
    }
    if (tag === 'select') {
      const t = String(fieldData.value);
      element.value = t;
      if (element.value !== t) {
        for (const opt of element.options) {
          if (opt.value === t || opt.textContent.trim() === t) {
            element.value = opt.value;
            break;
          }
        }
      }
      triggerEvents(element, ['change']);
      return true;
    }
    if (tag === 'textarea') {
      setNativeValue(element, String(fieldData.value));
      triggerEvents(element, ['input', 'change']);
      return true;
    }
  } catch (e) { console.error('[AutoFill] fill error', e); }
  return false;
}

// Use the native value setter so React/Vue controlled inputs notice the change
function setNativeValue(el, value) {
  const proto  = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

function triggerEvents(element, eventTypes) {
  eventTypes.forEach(type => {
    element.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
    if (type === 'input') element.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATION
// ─────────────────────────────────────────────────────────────────────────────
function showNotification(message, type = 'success') {
  document.querySelectorAll('.form-autofill-notification').forEach(n => n.remove());
  const n = document.createElement('div');
  n.className = 'form-autofill-notification';
  n.textContent = message;
  const bg = type === 'success' ? '#28a745' : type === 'warning' ? '#ffc107' : '#dc3545';
  n.style.cssText = `position:fixed;top:20px;right:20px;background:${bg};
    color:${type === 'warning' ? '#212529' : 'white'};padding:12px 20px;border-radius:4px;
    font-family:sans-serif;font-size:14px;font-weight:500;
    box-shadow:0 4px 12px rgba(0,0,0,.15);z-index:10000;
    transition:opacity .3s ease;max-width:300px;`;
  document.body.appendChild(n);
  setTimeout(() => { n.style.opacity = '0'; setTimeout(() => n.remove(), 300); }, 4000);
}

console.log('[AutoFill] Content script loaded');