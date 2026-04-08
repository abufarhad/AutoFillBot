// Content script for Form Autofill Saver (Fixed with CSS.escape support)

// Listen for messages from background script and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'captureFormData':
      const formData = captureCurrentFormData();
      sendResponse({ success: true, formData: formData, fieldCount: formData.length });
      break;

    case 'autofillForm':
      autofillFormFields(request.formData, request.isAutomatic).then(result => {
        sendResponse({ success: true, filledCount: result.filledCount, errors: result.errors });
      });
      return true; // Keep channel open for async response

    default:
      sendResponse({ error: 'Unknown action' });
  }
});

function captureCurrentFormData() {
  const formData = [];
  const formElements = document.querySelectorAll('input, select, textarea');

  formElements.forEach(element => {
    if (!isElementVisible(element) || element.disabled) return;
    if (["submit", "button", "reset", "image"].includes(element.type)) return;

    const value = getValue(element);
    if (value !== null && value !== '' && value !== undefined) {
      formData.push({
        selector: generateSelector(element),
        value: value,
        type: element.type || element.tagName.toLowerCase(),
        name: element.name || '',
        id: element.id || '',
        placeholder: element.placeholder || '',
        tagName: element.tagName.toLowerCase()
      });
    }
  });

  return formData;
}

function getValue(element) {
  const tagName = element.tagName.toLowerCase();
  const type = element.type ? element.type.toLowerCase() : '';

  if (tagName === 'input') {
    return (type === 'checkbox' || type === 'radio') ? element.checked : element.value;
  }
  if (tagName === 'select' || tagName === 'textarea') return element.value;
  return element.value || element.textContent;
}

function generateSelector(element) {
  if (element.id) return `#${CSS.escape(element.id)}`;
  if (element.name) return `[name="${CSS.escape(element.name)}"]`;
  if (element.placeholder) return `[placeholder="${CSS.escape(element.placeholder)}"]`;
  return generateCSSSelector(element);
}

function generateCSSSelector(element) {
  let selector = element.tagName.toLowerCase();
  if (element.className) {
    const classes = element.className.split(' ').filter(c => c.trim());
    if (classes.length > 0) selector += '.' + classes.join('.');
  }
  if (element.tagName.toLowerCase() === 'input' && element.type) {
    selector += `[type="${element.type}"]`;
  }
  const parent = element.parentElement;
  if (parent) {
    const siblings = Array.from(parent.children).filter(child => child.tagName === element.tagName && child.type === element.type);
    if (siblings.length > 1) {
      const index = siblings.indexOf(element);
      selector += `:nth-of-type(${index + 1})`;
    }
  }
  return selector;
}

function isElementVisible(element) {
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && element.offsetWidth > 0 && element.offsetHeight > 0;
}

// Parse a field name like "job[0][employment_type]" into its components.
// Returns null if the name does not match the pattern.
function parseIndexedName(name) {
  const match = name && name.match(/^(.+?)\[(\d+)\]\[(.+)\]$/);
  if (match) {
    return { prefix: match[1], index: parseInt(match[2]), field: match[3] };
  }
  return null;
}

// Group form fields by their repeating section prefix and index.
// Fields that don't match the pattern go into nonRepeating.
function groupRepeatingFields(formData) {
  const groups = {}; // { prefix: { index: [fields] } }
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

// Escape a string for use as a CSS attribute value (inside double quotes).
// Only backslash and double-quote are special inside CSS quoted strings.
function escapeAttrValue(str) {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Find the "Add more" button for a given repeating section prefix.
// Walks up the DOM from an existing index-0 field looking for a button
// whose text, value, id, or onclick suggests it adds new entries.
// Falls back to a page-wide search if nothing is found while walking up.
function findAddMoreButton(namePrefix) {
  const firstField = document.querySelector(`[name^="${escapeAttrValue(namePrefix)}[0]["]`);
  if (!firstField) {
    console.warn(`[AutoFill] findAddMoreButton: no field found for prefix "${namePrefix}"`);
    return null;
  }

  const ADD_RE = /add|more|\+/i;

  function isAddButton(el) {
    const text = (el.textContent || el.value || '').trim();
    const id = (el.id || '').toLowerCase();
    const cls = (el.className || '').toLowerCase();
    const onclick = el.getAttribute('onclick') || '';
    return ADD_RE.test(text) || ADD_RE.test(id) || ADD_RE.test(cls) || /add/i.test(onclick);
  }

  // Walk up the DOM tree from the field's parent
  let container = firstField.parentElement;
  while (container && container !== document.body) {
    const candidates = container.querySelectorAll(
      'button, input[type="button"], input[type="submit"], a[href], a[onclick], [onclick]'
    );
    for (const el of candidates) {
      // Skip actual submit buttons unless they look like "add more"
      if (el.type === 'submit' && !isAddButton(el)) continue;
      if (isAddButton(el)) {
        console.log(`[AutoFill] Found "Add more" button for "${namePrefix}":`, el);
        return el;
      }
    }
    container = container.parentElement;
  }

  // Page-wide fallback
  const allCandidates = document.querySelectorAll(
    'button, input[type="button"], a[href], a[onclick], [onclick]'
  );
  for (const el of allCandidates) {
    if (isAddButton(el)) {
      console.log(`[AutoFill] Found "Add more" button (page-wide fallback) for "${namePrefix}":`, el);
      return el;
    }
  }

  console.warn(`[AutoFill] "Add more" button not found for prefix "${namePrefix}"`);
  return null;
}

// Wait for a section with the given prefix and index to appear in the DOM.
// Resolves immediately if already present, otherwise uses MutationObserver.
function waitForNewSection(namePrefix, index, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const selector = `[name^="${escapeAttrValue(namePrefix)}[${index}]["]`;

    if (document.querySelector(selector)) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timeout waiting for ${namePrefix}[${index}] to appear`));
    }, timeout);

    const observer = new MutationObserver(() => {
      if (document.querySelector(selector)) {
        observer.disconnect();
        clearTimeout(timer);
        resolve();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  });
}

async function autofillFormFields(formData, isAutomatic = false) {
  let filledCount = 0;
  const errors = [];

  console.log(`[AutoFill] Starting autofill with ${formData.length} fields`);

  const { groups, nonRepeating } = groupRepeatingFields(formData);

  console.log(`[AutoFill] Non-repeating fields: ${nonRepeating.length}`);
  console.log(`[AutoFill] Indexed groups:`, Object.keys(groups).map(k => `${k}: indices [${Object.keys(groups[k]).join(',')}]`));

  // Prefixes that have at least one index > 0 are truly repeating sections.
  const repeatingPrefixes = Object.keys(groups).filter(prefix => {
    const maxIndex = Math.max(...Object.keys(groups[prefix]).map(Number));
    return maxIndex > 0;
  });

  console.log(`[AutoFill] Repeating prefixes detected:`, repeatingPrefixes);

  // Fields to fill in the normal (synchronous) path:
  // non-indexed fields plus any indexed groups that never exceed index 0.
  const normalFields = [...nonRepeating];
  Object.keys(groups).forEach(prefix => {
    if (!repeatingPrefixes.includes(prefix)) {
      Object.values(groups[prefix]).forEach(fields => fields.forEach(f => normalFields.push(f)));
    }
  });

  // Fill normal fields
  for (const fieldData of normalFields) {
    try {
      const elements = findElementsBySelector(fieldData);
      if (elements.length === 0) {
        errors.push(`Field not found: ${fieldData.selector}`);
        continue;
      }
      elements.forEach(element => {
        if (fillElement(element, fieldData)) filledCount++;
      });
    } catch (error) {
      errors.push(`Error filling field ${fieldData.selector}: ${error.message}`);
    }
  }

  // Fill repeating sections one index at a time.
  // For index 0, the section already exists so we fill immediately.
  // For index > 0, click "Add more", wait for the DOM to update, then fill.
  for (const prefix of repeatingPrefixes) {
    const indexedFields = groups[prefix];
    const sortedIndices = Object.keys(indexedFields).map(Number).sort((a, b) => a - b);

    console.log(`[AutoFill] Processing repeating section "${prefix}", indices:`, sortedIndices);

    for (const index of sortedIndices) {
      if (index > 0) {
        const addBtn = findAddMoreButton(prefix);
        if (!addBtn) {
          const msg = `"Add more" button not found for section: ${prefix}`;
          console.error(`[AutoFill] ${msg}`);
          errors.push(msg);
          continue;
        }
        console.log(`[AutoFill] Clicking "Add more" for "${prefix}[${index}]"`);
        addBtn.click();
        try {
          await waitForNewSection(prefix, index);
          console.log(`[AutoFill] Section "${prefix}[${index}]" appeared in DOM`);
        } catch (err) {
          console.error(`[AutoFill] ${err.message}`);
          errors.push(err.message);
          continue;
        }
      }

      for (const fieldData of indexedFields[index]) {
        try {
          const elements = findElementsBySelector(fieldData);
          if (elements.length === 0) {
            errors.push(`Field not found: ${fieldData.selector}`);
            continue;
          }
          elements.forEach(element => {
            if (fillElement(element, fieldData)) filledCount++;
          });
        } catch (error) {
          errors.push(`Error filling field ${fieldData.selector}: ${error.message}`);
        }
      }
    }
  }

  if (filledCount > 0) {
    showNotification(`Autofilled ${filledCount} fields`, errors.length > 0 ? 'warning' : 'success');
  }
  return { filledCount, errors };
}

function findElementsBySelector(fieldData) {
  const elements = [];

  // Try the stored CSS selector first
  if (fieldData.selector) {
    try {
      const selectorElements = document.querySelectorAll(fieldData.selector);
      if (selectorElements.length > 0) {
        elements.push(...selectorElements);
        return elements;
      }
    } catch (e) {
      console.warn(`[AutoFill] Bad selector "${fieldData.selector}":`, e.message);
    }
  }

  // Fallback: match by name attribute (escaping only " and \ for the CSS string)
  if (fieldData.name) {
    try {
      const nameElements = document.querySelectorAll(`[name="${escapeAttrValue(fieldData.name)}"]`);
      if (nameElements.length > 0) {
        elements.push(...nameElements);
        return elements;
      }
    } catch (e) {}
  }

  // Fallback: match by id
  if (fieldData.id) {
    const idElement = document.getElementById(fieldData.id);
    if (idElement) {
      elements.push(idElement);
      return elements;
    }
  }

  // Fallback: match by placeholder
  if (fieldData.placeholder) {
    try {
      const placeholderElements = document.querySelectorAll(`[placeholder="${escapeAttrValue(fieldData.placeholder)}"]`);
      if (placeholderElements.length > 0) {
        elements.push(...placeholderElements);
        return elements;
      }
    } catch (e) {}
  }

  return elements;
}

function fillElement(element, fieldData) {
  const tagName = element.tagName.toLowerCase();
  const type = element.type ? element.type.toLowerCase() : '';

  try {
    switch (tagName) {
      case 'input':
        return fillInputElement(element, fieldData, type);
      case 'select':
        return fillSelectElement(element, fieldData);
      case 'textarea':
        return fillTextareaElement(element, fieldData);
      default:
        return false;
    }
  } catch (error) {
    console.error('Error filling element:', error);
    return false;
  }
}

function fillInputElement(element, fieldData, type) {
  switch (type) {
    case 'checkbox':
    case 'radio':
      element.checked = fieldData.value === true || fieldData.value === 'true';
      triggerEvents(element, ['change', 'click']);
      return true;
    default:
      element.value = fieldData.value;
      triggerEvents(element, ['input', 'change']);
      return true;
  }
}

function fillSelectElement(element, fieldData) {
  element.value = fieldData.value;
  if (element.value !== fieldData.value) {
    const options = element.querySelectorAll('option');
    for (const option of options) {
      if (option.textContent.trim() === fieldData.value) {
        element.value = option.value;
        break;
      }
    }
  }
  triggerEvents(element, ['change']);
  return true;
}

function fillTextareaElement(element, fieldData) {
  element.value = fieldData.value;
  triggerEvents(element, ['input', 'change']);
  return true;
}

function triggerEvents(element, eventTypes) {
  eventTypes.forEach(eventType => {
    const event = new Event(eventType, { bubbles: true, cancelable: true });
    element.dispatchEvent(event);
  });
}

function showNotification(message, type = 'success') {
  document.querySelectorAll('.form-autofill-notification').forEach(n => n.remove());
  const notification = document.createElement('div');
  notification.className = 'form-autofill-notification';
  notification.textContent = message;

  const backgroundColor = type === 'success' ? '#28a745' : type === 'warning' ? '#ffc107' : '#dc3545';
  const textColor = type === 'warning' ? '#212529' : 'white';

  notification.style.cssText = `
    position: fixed; top: 20px; right: 20px; background-color: ${backgroundColor}; color: ${textColor};
    padding: 12px 20px; border-radius: 4px; font-family: sans-serif; font-size: 14px; font-weight: 500;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15); z-index: 10000; transition: opacity 0.3s ease; max-width: 300px;
  `;

  document.body.appendChild(notification);
  setTimeout(() => {
    notification.style.opacity = '0';
    setTimeout(() => notification.remove(), 300);
  }, 4000);
}

console.log('Form Autofill Saver content script loaded');
