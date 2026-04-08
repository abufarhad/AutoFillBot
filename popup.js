// Popup script for Form Autofill Saver

let currentUrl = '';
let currentTabId = null;
let currentFormData = [];

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('openDashboardBtn').addEventListener('click', openDashboard);
  document.getElementById('openDashboardBtnFooter').addEventListener('click', openDashboard);
  document.getElementById('captureBtn').addEventListener('click', captureFormData);
  document.getElementById('profileLabel').addEventListener('input', validateSaveBtn);
  document.getElementById('saveFormBtn').addEventListener('click', saveCurrentForm);

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    currentTabId = tabs[0].id;
    currentUrl = tabs[0].url;

    try {
      const urlObj = new URL(currentUrl);
      document.getElementById('currentSiteUrl').textContent = urlObj.hostname + urlObj.pathname;
    } catch (_) {
      document.getElementById('currentSiteUrl').textContent = currentUrl;
    }

    captureFormData();
    loadAllProfiles();
  });
});

function openDashboard() {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
}

// ── Form capture ──────────────────────────────────────────────────────────────

function captureFormData() {
  const formStatus = document.getElementById('formStatus');
  formStatus.textContent = 'Detecting fields…';
  formStatus.className = '';

  chrome.runtime.sendMessage({ action: 'getFormData', tabId: currentTabId }, (response) => {
    if (response && response.success) {
      currentFormData = response.formData || [];
    } else {
      currentFormData = [];
    }
    updateFormStatus();
  });
}

function updateFormStatus() {
  const formStatus = document.getElementById('formStatus');
  const saveSection = document.getElementById('saveSection');
  const count = currentFormData.length;

  if (count > 0) {
    formStatus.textContent = `${count} fields captured`;
    formStatus.className = 'detected';
    saveSection.style.display = 'block';
  } else {
    formStatus.textContent = 'No filled fields detected';
    formStatus.className = 'none';
    saveSection.style.display = 'none';
  }

  validateSaveBtn();
}

// ── Load & render profiles ────────────────────────────────────────────────────

function loadAllProfiles() {
  document.getElementById('profilesList').innerHTML =
    '<div class="empty-state">Loading profiles…</div>';

  let globalProfile = null;
  let siteProfiles = {};
  let pending = 2;

  function onLoaded() {
    if (--pending === 0) renderProfilesList(globalProfile, siteProfiles);
  }

  chrome.runtime.sendMessage({ action: 'getGlobalProfile' }, (res) => {
    if (res && res.success && res.profile) globalProfile = res.profile;
    onLoaded();
  });

  chrome.runtime.sendMessage({ action: 'getAllSiteProfiles' }, (res) => {
    if (res && res.success) siteProfiles = res.profiles || {};
    onLoaded();
  });
}

function renderProfilesList(globalProfile, siteProfiles) {
  const list = document.getElementById('profilesList');
  list.innerHTML = '';

  const named = Object.values(siteProfiles);

  if (!globalProfile && named.length === 0) {
    list.innerHTML =
      '<div class="empty-state">No profiles saved yet.<br>Fill a form, then save it as a profile below.</div>';
    return;
  }

  if (globalProfile) {
    list.appendChild(buildProfileItem({
      name: globalProfile.label || 'Global Profile',
      fieldCount: globalProfile.fields ? globalProfile.fields.length : 0,
      isGlobal: true,
    }));
  }

  named.forEach(profile => {
    list.appendChild(buildProfileItem({
      name: profile.label,
      fieldCount: profile.fields ? profile.fields.length : 0,
      id: profile.id,
      isGlobal: false,
    }));
  });
}

function buildProfileItem({ name, fieldCount, id, isGlobal }) {
  const item = document.createElement('div');
  item.className = 'profile-item' + (isGlobal ? ' profile-item--global' : '');

  // Info
  const info = document.createElement('div');
  info.className = 'profile-info';

  const nameEl = document.createElement('div');
  nameEl.className = 'profile-name';

  if (isGlobal) {
    const badge = document.createElement('span');
    badge.className = 'badge-default';
    badge.textContent = 'Default';
    nameEl.appendChild(badge);
  }

  const nameText = document.createTextNode(name);
  nameEl.appendChild(nameText);

  const meta = document.createElement('div');
  meta.className = 'profile-meta';
  meta.textContent = `${fieldCount} fields`;

  info.appendChild(nameEl);
  info.appendChild(meta);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'profile-actions';

  const fillBtn = document.createElement('button');
  fillBtn.className = 'btn btn-success btn-sm';
  fillBtn.textContent = 'Fill Form';
  fillBtn.addEventListener('click', () => {
    isGlobal ? fillWithGlobal() : fillWithProfile(id);
  });

  actions.appendChild(fillBtn);

  if (!isGlobal) {
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-danger btn-sm';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => deleteProfile(id, item));
    actions.appendChild(deleteBtn);
  } else {
    const updateBtn = document.createElement('button');
    updateBtn.className = 'btn btn-secondary btn-sm';
    updateBtn.textContent = 'Update';
    updateBtn.title = 'Replace global profile with current form data';
    updateBtn.addEventListener('click', saveGlobalProfile);
    actions.appendChild(updateBtn);
  }

  item.appendChild(info);
  item.appendChild(actions);
  return item;
}

// ── Fill actions ──────────────────────────────────────────────────────────────

function fillWithGlobal() {
  chrome.runtime.sendMessage(
    { action: 'useGlobalProfile', tabId: currentTabId },
    (res) => {
      if (res && res.success) {
        showStatus(`Filled ${res.filledCount} fields using Global Profile`, 'success');
      } else {
        showStatus('Error: ' + (res?.error || 'Unknown error'), 'error');
      }
    }
  );
}

function fillWithProfile(profileId) {
  chrome.runtime.sendMessage(
    { action: 'getFullProfileData', profileId },
    (res) => {
      if (!res || !res.success) {
        showStatus('Error loading profile: ' + (res?.error || 'Unknown error'), 'error');
        return;
      }
      chrome.runtime.sendMessage(
        {
          action: 'autofillFormAndAddSite',
          tabId: currentTabId,
          profileId,
          currentUrl,
          profileData: res.profile,
        },
        (fillRes) => {
          if (fillRes && fillRes.success) {
            const extra = fillRes.siteAdded ? ' (site added to profile)' : '';
            showStatus(`Filled ${fillRes.filledCount} fields${extra}`, 'success');
            if (fillRes.siteAdded) loadAllProfiles();
          } else {
            showStatus('Error during fill: ' + (fillRes?.error || 'Unknown error'), 'error');
          }
        }
      );
    }
  );
}

// ── Save profile ──────────────────────────────────────────────────────────────

function validateSaveBtn() {
  const label = document.getElementById('profileLabel').value.trim();
  document.getElementById('saveFormBtn').disabled = !label || currentFormData.length === 0;
}

function saveCurrentForm() {
  const label = document.getElementById('profileLabel').value.trim();
  if (!label || currentFormData.length === 0) return;

  const saveBtn = document.getElementById('saveFormBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  chrome.runtime.sendMessage(
    { action: 'saveFormProfile', label, urls: [currentUrl], formData: currentFormData },
    (res) => {
      saveBtn.textContent = 'Save';
      if (res && res.success) {
        showStatus(`Profile "${label}" saved`, 'success');
        document.getElementById('profileLabel').value = '';
        validateSaveBtn();
        loadAllProfiles();
      } else {
        saveBtn.disabled = false;
        showStatus('Error saving: ' + (res?.error || 'Unknown error'), 'error');
      }
    }
  );
}

function saveGlobalProfile() {
  if (currentFormData.length === 0) {
    showStatus('Capture form data first', 'info');
    return;
  }

  chrome.runtime.sendMessage(
    { action: 'saveGlobalProfile', formData: currentFormData },
    (res) => {
      if (res && res.success) {
        showStatus('Global profile updated', 'success');
        loadAllProfiles();
      } else {
        showStatus('Error: ' + (res?.error || 'Unknown error'), 'error');
      }
    }
  );
}

function deleteProfile(profileId, itemEl) {
  if (!confirm('Delete this profile?')) return;
  chrome.runtime.sendMessage({ action: 'deleteProfile', profileId }, (res) => {
    if (res && res.success) {
      itemEl.remove();
      showStatus('Profile deleted', 'success');
      // If list is now empty, re-render to show empty state
      if (document.getElementById('profilesList').children.length === 0) {
        loadAllProfiles();
      }
    } else {
      showStatus('Error deleting: ' + (res?.error || 'Unknown error'), 'error');
    }
  });
}

// ── Status helper ─────────────────────────────────────────────────────────────

let statusTimer = null;

function showStatus(message, type) {
  const el = document.getElementById('statusMessage');
  el.textContent = message;
  el.className = `status-${type}`;
  el.style.display = 'block';

  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { el.style.display = 'none'; }, 3500);
}
