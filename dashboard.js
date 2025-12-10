// Content script for Form Autofill Saver with Array Field Support

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
  return match ? match[1] : null;
}

function extractAllArrayIndices(name) {
  if (!name) return [];
  // Extract all numeric indices from "job[3][details][2]" -> ["3", "2"]
  const matches = name.matchAll(/\[(\d+)\]/g);
  return Array.from(matches, m => m[1]);
}

function matchesArrayPattern(currentName, savedName) {
  if (!currentName || !savedName) return false;

  // Exact match
  if (currentName === savedName) return true;

  // Both must be array fields or both must not be
  const currentIsArray = isArrayField(currentName);
  const savedIsArray = isArrayField(savedName);

  if (currentIsArray !== savedIsArray) return false;
  if (!currentIsArray) return false;

  // Check if patterns match
  const currentPattern = normalizeArrayPattern(currentName);
  const savedPattern = normalizeArrayPattern(savedName);

  if (currentPattern !== savedPattern) return false;

  // Check if all array indices match
  const currentIndices = extractAllArrayIndices(currentName);
  const savedIndices = extractAllArrayIndices(savedName);

  if (currentIndices.length !== savedIndices.length) return false;

  return currentIndices.every((idx, i) => idx === savedIndices[i]);
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

  console.log(`Starting autofill with ${formData.length} fields`);

  // Group fields by array pattern for intelligent matching
  const groupedFields = groupFieldsByArrayPattern(formData);
  const currentPageFields = getCurrentPageFields();

  // Match and fill fields
  groupedFields.forEach(group => {
    if (group.isArray) {
      // Handle array fields with flexible index matching
      filledCount += fillArrayFieldGroup(group, currentPageFields, errors);
    } else {
      // Handle regular fields normally
      group.fields.forEach((fieldData, index) => {
        try {
          console.log(`[${index}] Trying to fill:`, {
            name: fieldData.name,
            selector: fieldData.selector,
            value: fieldData.value
          });

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
    }
  });

  console.log(`Autofill complete: ${filledCount} fields filled, ${errors.length} errors`);

  if (filledCount > 0 && !isAutomatic) {
    showNotification(`Autofilled ${filledCount} fields`, errors.length > 0 ? 'warning' : 'success');
  }

  return { filledCount, errors };
}

// Group fields by array pattern for intelligent matching
function groupFieldsByArrayPattern(fields) {
  const groups = [];
  const arrayGroups = {};
  const regularFields = [];

  fields.forEach(field => {
    if (field.isArrayField || isArrayField(field.name)) {
      const pattern = normalizeArrayPattern(field.name);
      if (!arrayGroups[pattern]) {
        arrayGroups[pattern] = [];
      }
      arrayGroups[pattern].push(field);
    } else {
      regularFields.push(field);
    }
  });

  // Add regular fields as a group
  if (regularFields.length > 0) {
    groups.push({
      isArray: false,
      fields: regularFields
    });
  }

  // Add array field groups
  Object.keys(arrayGroups).forEach(pattern => {
    groups.push({
      isArray: true,
      pattern: pattern,
      fields: arrayGroups[pattern].sort((a, b) => {
        const indexA = parseInt(extractArrayIndex(a.name) || '0');
        const indexB = parseInt(extractArrayIndex(b.name) || '0');
        return indexA - indexB;
      })
    });
  });

  return groups;
}

// Get all fields currently on the page
function getCurrentPageFields() {
  const fields = [];
  document.querySelectorAll('input, select, textarea').forEach(element => {
    if (element.name) {
      fields.push({
        element: element,
        name: element.name,
        isArrayField: isArrayField(element.name),
        pattern: isArrayField(element.name) ? normalizeArrayPattern(element.name) : null,
        index: isArrayField(element.name) ? parseInt(extractArrayIndex(element.name) || '0') : null
      });
    }
  });
  return fields;
}

// Fill array field group with flexible index matching
function fillArrayFieldGroup(group, currentPageFields, errors) {
  let filledCount = 0;

  console.log(`Filling array group with pattern: ${group.pattern}`);

  // Get current page fields that match this pattern
  const matchingPageFields = currentPageFields.filter(f =>
      f.pattern === group.pattern
  ).sort((a, b) => a.index - b.index);

  if (matchingPageFields.length === 0) {
    console.warn(`No fields found on page matching pattern: ${group.pattern}`);
    return 0;
  }

  // Group saved fields by index
  const savedByIndex = {};
  group.fields.forEach(field => {
    const index = parseInt(extractArrayIndex(field.name) || '0');
    if (!savedByIndex[index]) {
      savedByIndex[index] = [];
    }
    savedByIndex[index].push(field);
  });

  // Group page fields by index
  const pageByIndex = {};
  matchingPageFields.forEach(pageField => {
    if (!pageByIndex[pageField.index]) {
      pageByIndex[pageField.index] = [];
    }
    pageByIndex[pageField.index].push(pageField);
  });

  // Get sorted indices
  const savedIndices = Object.keys(savedByIndex).map(Number).sort((a, b) => a - b);
  const pageIndices = Object.keys(pageByIndex).map(Number).sort((a, b) => a - b);

  console.log(`Saved indices: [${savedIndices}], Page indices: [${pageIndices}]`);

  // Map saved indices to page indices (in order)
  savedIndices.forEach((savedIndex, position) => {
    if (position >= pageIndices.length) {
      console.warn(`No page field available for saved index ${savedIndex} (position ${position})`);
      return;
    }

    const pageIndex = pageIndices[position];
    const savedFields = savedByIndex[savedIndex];

    console.log(`Mapping saved index [${savedIndex}] to page index [${pageIndex}]`);

    savedFields.forEach(savedField => {
      // Find the corresponding field on the page
      const basePattern = savedField.name.replace(/\[\d+\]/, `[${pageIndex}]`);
      const pageField = pageByIndex[pageIndex].find(pf => pf.name === basePattern);

      if (pageField) {
        try {
          if (fillElement(pageField.element, savedField)) {
            filledCount++;
            console.log(`✓ Filled ${pageField.name} with value from ${savedField.name}`);
          }
        } catch (error) {
          const errorMsg = `Error filling ${pageField.name}: ${error.message}`;
          console.error(errorMsg);
          errors.push(errorMsg);
        }
      } else {
        console.warn(`Could not find page field matching pattern: ${basePattern}`);
      }
    });
  });

  return filledCount;
}

function findElementsByFieldData(fieldData) {
  const elements = [];

  // Strategy 1: Try exact name match first (most reliable for array fields)
  if (fieldData.name) {
    try {
      const nameElements = document.querySelectorAll(`[name="${CSS.escape(fieldData.name)}"]`);
      if (nameElements.length > 0) {
        console.log(`Found by exact name: ${fieldData.name}`);
        elements.push(...nameElements);
        return elements;
      }
    } catch (e) {
      console.warn('Name selector failed:', e);
    }
  }

  // Strategy 2: For array fields, try pattern matching
  if (fieldData.isArrayField || isArrayField(fieldData.name)) {
    const patternMatchedElements = findElementsByArrayPattern(fieldData);
    if (patternMatchedElements.length > 0) {
      console.log(`Found by array pattern: ${fieldData.name}`);
      elements.push(...patternMatchedElements);
      return elements;
    }
  }

  // Strategy 3: Try the saved selector
  if (fieldData.selector) {
    try {
      const selectorElements = document.querySelectorAll(fieldData.selector);
      if (selectorElements.length > 0) {
        console.log(`Found by selector: ${fieldData.selector}`);
        elements.push(...selectorElements);
        return elements;
      }
    } catch (e) {
      console.warn('Selector failed:', e);
    }
  }

  // Strategy 4: Try ID
  if (fieldData.id) {
    try {
      const idElement = document.getElementById(fieldData.id);
      if (idElement) {
        console.log(`Found by ID: ${fieldData.id}`);
        elements.push(idElement);
        return elements;
      }
    } catch (e) {
      console.warn('ID selector failed:', e);
    }
  }

  // Strategy 5: Try placeholder
  if (fieldData.placeholder) {
    try {
      const placeholderElements = document.querySelectorAll(`[placeholder="${CSS.escape(fieldData.placeholder)}"]`);
      if (placeholderElements.length > 0) {
        console.log(`Found by placeholder: ${fieldData.placeholder}`);
        elements.push(...placeholderElements);
        return elements;
      }
    } catch (e) {
      console.warn('Placeholder selector failed:', e);
    }
  }

  console.warn(`No element found for field:`, fieldData);
  return elements;
}

function findElementsByArrayPattern(fieldData) {
  const elements = [];
  const savedName = fieldData.name;

  if (!savedName || !isArrayField(savedName)) {
    return elements;
  }

  // Get all input elements on the page
  const allInputs = document.querySelectorAll('input, select, textarea');

  allInputs.forEach(input => {
    const currentName = input.name;

    if (matchesArrayPattern(currentName, savedName)) {
      elements.push(input);
    }
  });

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

console.log('Form Autofill Saver content script loaded with array field support');