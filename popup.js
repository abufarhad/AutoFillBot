// Popup script for Form Autofill Saver

let currentUrl = '';
let currentFormData    = [];
let currentGroupedData = null;

const currentSiteUrl         = document.getElementById('currentSiteUrl');
const statusMessage          = document.getElementById('statusMessage');
const openDashboardBtn       = document.getElementById('openDashboardBtn');
const globalProfileStatus    = document.getElementById('globalProfileStatus');
const globalProfileContainer = document.getElementById('globalProfileContainer');
const globalProfileInfo      = document.getElementById('globalProfileInfo');
const saveGlobalBtn          = document.getElementById('saveGlobalBtn');
const useGlobalBtn           = document.getElementById('useGlobalBtn');
const deleteGlobalBtn        = document.getElementById('deleteGlobalBtn');
const formDetectionStatus    = document.getElementById('formDetectionStatus');
const saveFormContainer      = document.getElementById('saveFormContainer');
const profileLabel           = document.getElementById('profileLabel');
const additionalUrls         = document.getElementById('additionalUrls');
const formFieldsCount        = document.getElementById('formFieldsCount');
const multiEntryHint         = document.getElementById('multiEntryHint');
const saveFormBtn            = document.getElementById('saveFormBtn');
const savedProfiles          = document.getElementById('savedProfiles');

document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  getCurrentTabInfo();
});

function setupEventListeners() {
  openDashboardBtn.addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') }));
  saveGlobalBtn.addEventListener('click', saveGlobalProfile);
  useGlobalBtn.addEventListener('click', useGlobalProfile);
  deleteGlobalBtn.addEventListener('click', deleteGlobalProfile);
  saveFormBtn.addEventListener('click', saveCurrentForm);
  profileLabel.addEventListener('input', validateSaveForm);
}

function getCurrentTabInfo() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    currentUrl = tabs[0].url;
    try { currentSiteUrl.textContent = new URL(currentUrl).hostname + new URL(currentUrl).pathname; }
    catch { currentSiteUrl.textContent = currentUrl; }
    loadGlobalProfile();
    captureCurrentTab(tabs[0].id);
    loadSavedProfiles();
  });
}

function captureCurrentTab(tabId) {
  chrome.runtime.sendMessage({ action: 'getFormData', tabId }, (r) => {
    if (r && r.success) currentFormData = r.formData || [];
  });
  chrome.runtime.sendMessage({ action: 'getGroupedFormData', tabId }, (r) => {
    if (r && r.success) currentGroupedData = r;
    updateFormStatus();
  });
}

function updateFormStatus() {
  const count = currentFormData.length;
  if (count > 0) {
    const isGrouped  = currentGroupedData && currentGroupedData.grouped;
    const entryCount = isGrouped ? currentGroupedData.entries.length : 1;
    formDetectionStatus.textContent = `${count} fields detected`;
    formDetectionStatus.className = 'success';
    formFieldsCount.textContent = `${count} fields detected`;
    saveFormContainer.style.display = 'block';
    globalProfileContainer.style.display = 'block';
    saveGlobalBtn.disabled = false;
    if (isGrouped && entryCount > 1 && multiEntryHint) {
      multiEntryHint.textContent = `✓ ${entryCount} entries detected — all will be saved`;
      multiEntryHint.style.display = 'block';
      saveFormBtn.textContent = `Save ${entryCount} Entries`;
    } else {
      if (multiEntryHint) multiEntryHint.style.display = 'none';
      saveFormBtn.textContent = 'Save Form Data';
    }
    validateSaveForm();
  } else {
    formDetectionStatus.textContent = 'No filled form fields detected';
    formDetectionStatus.className = 'error';
    saveFormContainer.style.display = 'none';
    saveGlobalBtn.disabled = true;
  }
}

function validateSaveForm() {
  saveFormBtn.disabled = !profileLabel.value.trim() || currentFormData.length === 0;
}

function loadGlobalProfile() {
  chrome.runtime.sendMessage({ action: 'getGlobalProfile' }, (r) => {
    if (r && r.success && r.profile) {
      const p = r.profile;
      globalProfileStatus.style.display = 'none';
      globalProfileContainer.style.display = 'block';
      globalProfileInfo.innerHTML = `<strong>Global Profile:</strong> ${p.label}<br><small>${p.fields.length} fields · ${new Date(p.createdAt).toLocaleDateString()}</small>`;
      useGlobalBtn.style.display = 'inline-block';
      deleteGlobalBtn.style.display = 'inline-block';
      saveGlobalBtn.textContent = 'Update Global Profile';
    } else {
      globalProfileStatus.textContent = 'No global profile saved';
      globalProfileStatus.className = 'info';
      globalProfileContainer.style.display = 'block';
      globalProfileInfo.innerHTML = '<em>Save form data as a global profile to use on any site.</em>';
      useGlobalBtn.style.display = 'none';
      deleteGlobalBtn.style.display = 'none';
      saveGlobalBtn.textContent = 'Save as Global Profile';
    }
  });
}

function saveGlobalProfile() {
  if (!currentFormData.length) { showStatus('No form data to save', 'error'); return; }
  saveGlobalBtn.disabled = true; saveGlobalBtn.textContent = 'Saving...';
  chrome.runtime.sendMessage({ action: 'saveGlobalProfile', formData: currentFormData }, (r) => {
    saveGlobalBtn.disabled = false;
    if (r && r.success) { showStatus(r.message, 'success'); loadGlobalProfile(); }
    else { showStatus('Error: ' + (r?.error||'Unknown'), 'error'); saveGlobalBtn.textContent = 'Save as Global Profile'; }
  });
}

function useGlobalProfile() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    chrome.runtime.sendMessage({ action: 'useGlobalProfile', tabId: tabs[0].id }, (r) => {
      r?.success ? showStatus(`Autofilled ${r.filledCount} fields`, 'success') : showStatus('Error: ' + (r?.error||'Unknown'), 'error');
    });
  });
}

function deleteGlobalProfile() {
  if (!confirm('Delete the global profile?')) return;
  chrome.runtime.sendMessage({ action: 'deleteGlobalProfile' }, (r) => {
    if (r?.success) { showStatus(r.message, 'success'); loadGlobalProfile(); }
    else showStatus('Error: ' + (r?.error||'Unknown'), 'error');
  });
}

function saveCurrentForm() {
  const label = profileLabel.value.trim();
  if (!label) { showStatus('Please enter a profile name', 'error'); return; }
  if (!currentFormData.length) { showStatus('No form data to save', 'error'); return; }
  const urls = [currentUrl];
  const extra = additionalUrls.value.trim();
  if (extra) urls.push(...extra.split('\n').map(u => u.trim()).filter(Boolean));
  saveFormBtn.disabled = true; saveFormBtn.textContent = 'Saving...';
  const isGrouped = currentGroupedData && currentGroupedData.grouped && currentGroupedData.entries && currentGroupedData.entries.length > 1;
  if (isGrouped) {
    chrome.runtime.sendMessage({
      action: 'saveMultiEntryProfile', label, urls,
      entries: currentGroupedData.entries,
      nonArrayFields: currentGroupedData.nonArrayFields || [],
      arrayPrefix: currentGroupedData.arrayPrefix || null,
      groupConfig: {},
    }, (r) => {
      saveFormBtn.disabled = false;
      if (r && r.success) { showStatus(`✓ ${r.message}`, 'success'); resetSaveForm(); loadSavedProfiles(); }
      else { showStatus('Error: ' + (r?.error||'Unknown'), 'error'); saveFormBtn.textContent = 'Save Form Data'; }
    });
  } else {
    chrome.runtime.sendMessage({ action: 'saveFormProfile', label, urls, formData: currentFormData }, (r) => {
      saveFormBtn.disabled = false;
      if (r && r.success) { showStatus(r.message, 'success'); resetSaveForm(); loadSavedProfiles(); }
      else { showStatus('Error: ' + (r?.error||'Unknown'), 'error'); saveFormBtn.textContent = 'Save Form Data'; }
    });
  }
}

function resetSaveForm() {
  profileLabel.value = ''; additionalUrls.value = '';
  saveFormBtn.textContent = 'Save Form Data'; validateSaveForm();
}

function loadSavedProfiles() {
  chrome.runtime.sendMessage({ action: 'getProfilesForSite', url: currentUrl }, (r) => {
    if (r && r.profiles) renderSavedProfiles(r.profiles);
    else savedProfiles.innerHTML = '<div class="empty-state">Error loading profiles</div>';
  });
}

function renderSavedProfiles(profiles) {
  if (!profiles.length) { savedProfiles.innerHTML = '<div class="empty-state">No saved profiles for this site</div>'; return; }
  savedProfiles.innerHTML = '';
  profiles.forEach(profile => {
    const item = document.createElement('div');
    item.className = 'profile-item';
    const badge = profile.multiEntry ? `<span class="entry-badge">${profile.entryCount} entries</span>` : '';
    const info = document.createElement('div');
    info.style.flex = '1';
    info.innerHTML = `<div class="profile-name">${profile.label}${badge}</div><div class="profile-meta">${profile.fieldCount} fields · ${profile.urlCount} URL${profile.urlCount>1?'s':''}</div>`;
    const actions = document.createElement('div');
    actions.className = 'profile-actions';
    if (profile.multiEntry) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-primary btn-small';
      btn.textContent = '⟳ Activate';
      btn.title = `Fills entry 1 now. Each ADD MORE click will auto-fill the next entry.`;
      btn.addEventListener('click', () => activateMultiEntry(profile.id));
      actions.appendChild(btn);
    } else {
      const btn = document.createElement('button');
      btn.className = 'btn btn-primary btn-small';
      btn.textContent = 'Autofill';
      btn.addEventListener('click', () => autofillWithProfile(profile.id));
      actions.appendChild(btn);
    }
    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger btn-small';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => deleteProfile(profile.id));
    actions.appendChild(delBtn);
    item.appendChild(info); item.appendChild(actions);
    savedProfiles.appendChild(item);
  });
}

// ─── NEW: Activate multi-entry intercept ────────────────────────────────────
// Fills entry 1 immediately, then hooks ADD MORE so each click fills next entry
function activateMultiEntry(profileId) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    showStatus('Filling ALL saved entries automatically (adding sections as needed)...', 'info');
    chrome.runtime.sendMessage({
      action: 'activateMultiEntry',
      tabId: tabs[0].id,
      profileId,
    }, (r) => {
      if (r?.success) {
        showStatus(`✓ Entry 1 filled (${r.filledCount||0} fields). Now click ADD MORE for each next entry.`, 'success');
      } else {
        showStatus('Error: ' + (r?.error||'Unknown'), 'error');
      }
    });
  });
}

function autofillWithProfile(profileId) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    chrome.runtime.sendMessage({ action: 'getFullProfileData', profileId }, (r) => {
      if (!r?.success) { showStatus('Error loading profile', 'error'); return; }
      chrome.runtime.sendMessage({
        action: 'autofillFormAndAddSite',
        tabId: tabs[0].id, profileId, currentUrl, profileData: r.profile,
      }, (res) => {
        if (res?.success) { showStatus(`Autofilled ${res.filledCount} fields${res.siteAdded?' + added site':''}`, 'success'); loadSavedProfiles(); }
        else showStatus('Error: ' + (res?.error||'Unknown'), 'error');
      });
    });
  });
}

function deleteProfile(profileId) {
  if (!confirm('Delete this profile?')) return;
  chrome.runtime.sendMessage({ action: 'deleteProfile', profileId }, (r) => {
    if (r?.success) { showStatus(r.message, 'success'); loadSavedProfiles(); }
    else showStatus('Error: ' + (r?.error||'Unknown'), 'error');
  });
}

function showStatus(message, type) {
  statusMessage.textContent = message;
  statusMessage.className = `status ${type}`;
  statusMessage.style.display = 'block';
  if (type !== 'info') setTimeout(() => { statusMessage.style.display = 'none'; }, 4000);
}