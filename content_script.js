// Content script for Form Autofill Saver with Dynamic Array Field Support

// Listen for messages from background script and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'captureFormData':
      const formData = captureCurrentFormData();
      sendResponse({ success: true, formData: formData, fieldCount: formData.length });
      break;

    case 'autofillForm':
      const result = autofillFormFields(request.formData, request.isAutomatic);
      sendResponse({ success: true, filledCount: result.filledCount, errors: result.errors });
      break;

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
        tagName: element.tagName.toLowerCase(),
        // Add array field metadata
        isArrayField: isArrayField(element.name),
        arrayPattern: isArrayField(element.name) ? normalizeArrayPattern(element.name) : null,
        arrayIndex: isArrayField(element.name) ? extractArrayIndex(element.name) : null
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

// ==================== ARRAY FIELD UTILITIES ====================

function isArrayField(name) {
  if (!name) return false;
  // Check if field name contains array notation like [0], [1], etc.
  return /\[\d+\]/.test(name);
}

function normalizeArrayPattern(name) {
  if (!name) return null;
  // Convert "job[3][job_end_date]" to "job[*][job_end_date]"
  return name.replace(/\[\d+\]/g, '[*]');
}

function extractArrayIndex(name) {
  if (!name) return null;
  // Extract the first numeric index from "job[3][job_end_date]" -> "3"
  const match = name.match(/\[(\d+)\]/);
  return match ? parseInt(match[1]) : null;
}

function extractAllArrayIndices(name) {
  if (!name) return [];
  // Extract all numeric indices from "job[3][details][2]" -> ["3", "2"]
  const matches = name.matchAll(/\[(\d+)\]/g);
  return Array.from(matches, m => parseInt(m[1]));
}

function getFieldKeyAfterIndex(name) {
  if (!name) return null;
  // Extract everything after first [index]: job[0][organization] -> [organization]
  const match = name.match(/\[\d+\](.+)/);
  return match ? match[1] : null;
}

// ==================== SELECTOR GENERATION ====================

function generateSelector(element) {
  // Priority 1: ID (most specific)
  if (element.id) return `#${CSS.escape(element.id)}`;

  // Priority 2: Name attribute (especially important for array fields)
  if (element.name) {
    // For array fields, name is the most reliable identifier
    return `[name="${CSS.escape(element.name)}"]`;
  }

  // Priority 3: Placeholder
  if (element.placeholder) return `[placeholder="${CSS.escape(element.placeholder)}"]`;

  // Priority 4: Generated CSS selector
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

// ==================== AUTOFILL FUNCTIONS ====================

function autofillFormFields(formData, isAutomatic = false) {
  let filledCount = 0;
  const errors = [];
  const skippedFields = [];

  console.log(`Starting autofill with ${formData.length} saved fields`);

  // Get all currently visible fields on the page
  const currentPageFields = getCurrentPageFieldsMap();
  console.log('Current page has fields:', Array.from(currentPageFields.keys()));

  // Group saved fields by type (array vs regular)
  const { arrayFields, regularFields } = categorizeFields(formData);

  // Fill regular fields first
  regularFields.forEach((fieldData, index) => {
    try {
      const elements = findElementsByFieldData(fieldData);

      if (elements.length === 0) {
        const errorMsg = `Field not found: ${fieldData.name || fieldData.selector}`;
        console.warn(errorMsg);
        errors.push(errorMsg);
        return;
      }

      elements.forEach(element => {
        if (fillElement(element, fieldData)) {
          filledCount++;
          console.log(`✓ Filled: ${fieldData.name || fieldData.selector}`);
        }
      });
    } catch (error) {
      const errorMsg = `Error filling field ${fieldData.name || fieldData.selector}: ${error.message}`;
      console.error(errorMsg);
      errors.push(errorMsg);
    }
  });

  // Fill array fields - ONLY if they exist on the page
  arrayFields.forEach(fieldData => {
    const fieldName = fieldData.name;

    // Check if this exact field exists on the current page
    if (currentPageFields.has(fieldName)) {
      try {
        const element = currentPageFields.get(fieldName);
        if (fillElement(element, fieldData)) {
          filledCount++;
          console.log(`✓ Filled array field: ${fieldName}`);
        }
      } catch (error) {
        const errorMsg = `Error filling array field ${fieldName}: ${error.message}`;
        console.error(errorMsg);
        errors.push(errorMsg);
      }
    } else {
      // Field doesn't exist yet - user needs to click "+ ADD MORE"
      const arrayIndex = extractArrayIndex(fieldName);
      const fieldKey = getFieldKeyAfterIndex(fieldName);
      skippedFields.push({
        name: fieldName,
        index: arrayIndex,
        key: fieldKey
      });
      console.log(`⊘ Skipped (not on page): ${fieldName}`);
    }
  });

  console.log(`Autofill complete: ${filledCount} fields filled, ${errors.length} errors, ${skippedFields.length} skipped`);

  // Show notification with details
  if (!isAutomatic) {
    let message = `Filled ${filledCount} field${filledCount !== 1 ? 's' : ''}`;

    if (skippedFields.length > 0) {
      // Group skipped fields by their base pattern
      const skippedByPattern = {};
      skippedFields.forEach(field => {
        const pattern = normalizeArrayPattern(field.name);
        if (!skippedByPattern[pattern]) {
          skippedByPattern[pattern] = new Set();
        }
        skippedByPattern[pattern].add(field.index);
      });

      const skippedInfo = Object.entries(skippedByPattern).map(([pattern, indices]) => {
        const uniqueIndices = Array.from(indices).sort((a, b) => a - b);
        const patternName = pattern.match(/^([^\[]+)/)[1]; // Extract base name like "job"
        return `${patternName} entries ${uniqueIndices.join(', ')}`;
      }).join(', ');

      message += `\n\n${skippedFields.length} field${skippedFields.length !== 1 ? 's' : ''} skipped (${skippedInfo} not visible yet)`;
      message += `\n\nClick "+ ADD MORE" to add entries, then autofill again.`;
    }

    const notificationType = errors.length > 0 ? 'warning' :
        skippedFields.length > 0 ? 'info' : 'success';

    showNotification(message, notificationType);
  }

  return { filledCount, errors, skippedCount: skippedFields.length };
}

// Get a map of all fields currently on the page (name -> element)
function getCurrentPageFieldsMap() {
  const fieldsMap = new Map();
  document.querySelectorAll('input, select, textarea').forEach(element => {
    if (element.name && isElementVisible(element)) {
      fieldsMap.set(element.name, element);
    }
  });
  return fieldsMap;
}

// Categorize fields into array fields and regular fields
function categorizeFields(fields) {
  const arrayFields = [];
  const regularFields = [];

  fields.forEach(field => {
    if (field.isArrayField || isArrayField(field.name)) {
      arrayFields.push(field);
    } else {
      regularFields.push(field);
    }
  });

  return { arrayFields, regularFields };
}

function findElementsByFieldData(fieldData) {
  const elements = [];

  // Strategy 1: Try exact name match first (most reliable)
  if (fieldData.name) {
    try {
      const nameElements = document.querySelectorAll(`[name="${CSS.escape(fieldData.name)}"]`);
      const visibleElements = Array.from(nameElements).filter(el => isElementVisible(el));
      if (visibleElements.length > 0) {
        console.log(`Found by exact name: ${fieldData.name}`);
        elements.push(...visibleElements);
        return elements;
      }
    } catch (e) {
      console.warn('Name selector failed:', e);
    }
  }

  // Strategy 2: Try the saved selector
  if (fieldData.selector) {
    try {
      const selectorElements = document.querySelectorAll(fieldData.selector);
      const visibleElements = Array.from(selectorElements).filter(el => isElementVisible(el));
      if (visibleElements.length > 0) {
        console.log(`Found by selector: ${fieldData.selector}`);
        elements.push(...visibleElements);
        return elements;
      }
    } catch (e) {
      console.warn('Selector failed:', e);
    }
  }

  // Strategy 3: Try ID
  if (fieldData.id) {
    try {
      const idElement = document.getElementById(fieldData.id);
      if (idElement && isElementVisible(idElement)) {
        console.log(`Found by ID: ${fieldData.id}`);
        elements.push(idElement);
        return elements;
      }
    } catch (e) {
      console.warn('ID selector failed:', e);
    }
  }

  // Strategy 4: Try placeholder
  if (fieldData.placeholder) {
    try {
      const placeholderElements = document.querySelectorAll(`[placeholder="${CSS.escape(fieldData.placeholder)}"]`);
      const visibleElements = Array.from(placeholderElements).filter(el => isElementVisible(el));
      if (visibleElements.length > 0) {
        console.log(`Found by placeholder: ${fieldData.placeholder}`);
        elements.push(...visibleElements);
        return elements;
      }
    } catch (e) {
      console.warn('Placeholder selector failed:', e);
    }
  }

  console.warn(`No element found for field:`, fieldData);
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
    case 'date':
    case 'datetime-local':
    case 'time':
    case 'month':
    case 'week':
      // Handle date/time inputs
      element.value = fieldData.value;
      triggerEvents(element, ['input', 'change']);
      return true;
    default:
      element.value = fieldData.value;
      triggerEvents(element, ['input', 'change']);
      return true;
  }
}

function fillSelectElement(element, fieldData) {
  // Try direct value match first
  element.value = fieldData.value;

  // If that didn't work, try matching option text
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

  // Handle multi-line messages
  notification.style.whiteSpace = 'pre-line';
  notification.textContent = message;

  const backgroundColor = type === 'success' ? '#28a745' :
      type === 'warning' ? '#ffc107' :
          type === 'info' ? '#17a2b8' : '#dc3545';
  const textColor = type === 'warning' ? '#212529' : 'white';

  notification.style.cssText = `
    position: fixed; top: 20px; right: 20px; background-color: ${backgroundColor}; color: ${textColor};
    padding: 16px 20px; border-radius: 6px; font-family: sans-serif; font-size: 13px; font-weight: 500;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15); z-index: 10000; transition: opacity 0.3s ease; 
    max-width: 350px; line-height: 1.5; white-space: pre-line;
  `;

  document.body.appendChild(notification);

  const displayTime = type === 'info' ? 6000 : 4000; // Show info notifications longer

  setTimeout(() => {
    notification.style.opacity = '0';
    setTimeout(() => notification.remove(), 300);
  }, displayTime);
}

console.log('Form Autofill Saver content script loaded with dynamic array field support');