// Content script for Form Autofill Saver (Fixed with CSS.escape support)

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

function autofillFormFields(formData, isAutomatic = false) {
  let filledCount = 0;
  const errors = [];

  formData.forEach(fieldData => {
    try {
      const elements = findElementsBySelector(fieldData);
      if (elements.length === 0) {
        errors.push(`Field not found: ${fieldData.selector}`);
        return;
      }
      elements.forEach(element => {
        if (fillElement(element, fieldData)) filledCount++;
      });
    } catch (error) {
      errors.push(`Error filling field ${fieldData.selector}: ${error.message}`);
    }
  });

  if (filledCount > 0) {
    showNotification(`Autofilled ${filledCount} fields`, errors.length > 0 ? 'warning' : 'success');
  }
  return { filledCount, errors };
}

function findElementsBySelector(fieldData) {
  const elements = [];
  try {
    const selectorElements = document.querySelectorAll(fieldData.selector);
    if (selectorElements.length > 0) {
      elements.push(...selectorElements);
      return elements;
    }
  } catch (e) {}

  if (fieldData.name) {
    const nameElements = document.querySelectorAll(`[name="${CSS.escape(fieldData.name)}"]`);
    if (nameElements.length > 0) {
      elements.push(...nameElements);
      return elements;
    }
  }

  if (fieldData.id) {
    const idElement = document.getElementById(fieldData.id);
    if (idElement) {
      elements.push(idElement);
      return elements;
    }
  }

  if (fieldData.placeholder) {
    const placeholderElements = document.querySelectorAll(`[placeholder="${CSS.escape(fieldData.placeholder)}"]`);
    if (placeholderElements.length > 0) {
      elements.push(...placeholderElements);
      return elements;
    }
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
