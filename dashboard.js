// Dashboard script for Form Autofill Saver
// Supports multi-entry profiles with per-entry tab editing

let globalProfile  = null;
let siteProfiles   = {};
let saveTimeout    = null;

// DOM
const refreshBtn            = document.getElementById('refreshBtn');
const statusMessage         = document.getElementById('statusMessage');
const saveIndicator         = document.getElementById('saveIndicator');
const globalProfileLoading  = document.getElementById('globalProfileLoading');
const globalProfileContent  = document.getElementById('globalProfileContent');
const siteProfilesLoading   = document.getElementById('siteProfilesLoading');
const siteProfilesContent   = document.getElementById('siteProfilesContent');

document.addEventListener('DOMContentLoaded', () => {
  refreshBtn.addEventListener('click', loadAllProfiles);
  loadAllProfiles();
});

// ─────────────────────────────────────────────────────────────────────────────
// Load
// ─────────────────────────────────────────────────────────────────────────────
function loadAllProfiles() {
  showStatus('Loading profiles...', 'info');
  loadGlobalProfile();
  loadSiteProfiles();
}

function loadGlobalProfile() {
  globalProfileLoading.style.display = 'block';
  globalProfileContent.style.display = 'none';
  chrome.runtime.sendMessage({ action: 'getGlobalProfile' }, (response) => {
    globalProfileLoading.style.display = 'none';
    globalProfileContent.style.display = 'block';
    globalProfile = (response && response.success) ? response.profile : null;
    renderGlobalProfile(globalProfile);
  });
}

function loadSiteProfiles() {
  siteProfilesLoading.style.display = 'block';
  siteProfilesContent.style.display = 'none';
  chrome.runtime.sendMessage({ action: 'getAllSiteProfiles' }, (response) => {
    siteProfilesLoading.style.display = 'none';
    siteProfilesContent.style.display = 'block';
    siteProfiles = (response && response.success) ? (response.profiles || {}) : {};
    renderSiteProfiles(siteProfiles);
    hideStatus();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Render global profile
// ─────────────────────────────────────────────────────────────────────────────
function renderGlobalProfile(profile) {
  if (!profile) {
    globalProfileContent.innerHTML = '<div class="empty-state">No global profile saved<br><small>Create one from the extension popup</small></div>';
    return;
  }

  globalProfileContent.innerHTML = `
    <div class="profile-card" data-profile-type="global">
      <div class="profile-header">
        <div class="profile-name">
          <input type="text" value="${esc(profile.label)}" readonly style="cursor:not-allowed;opacity:0.7;">
          <small style="color:#718096;font-size:11px;">Global profile label cannot be changed</small>
        </div>
        <div class="profile-actions">
          <button class="btn btn-danger btn-small" onclick="deleteGlobalProfile()">🗑️ Delete</button>
        </div>
      </div>
      <div class="profile-details">
        <div class="detail-item"><div class="detail-label">Fields</div><div class="detail-value">${profile.fields.length} saved</div></div>
        <div class="detail-item"><div class="detail-label">Created</div><div class="detail-value">${fmtDate(profile.createdAt)}</div></div>
        <div class="detail-item"><div class="detail-label">Updated</div><div class="detail-value">${fmtDate(profile.updatedAt)}</div></div>
      </div>
      <div class="fields-section">
        <div class="fields-title">
          Form Fields
          <button class="add-field" onclick="addField('global', null, null)">+ Add Field</button>
        </div>
        ${renderFieldList(profile.fields, 'global', null, null)}
      </div>
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Render site profiles
// ─────────────────────────────────────────────────────────────────────────────
function renderSiteProfiles(profiles) {
  const list = Object.values(profiles);
  if (!list.length) {
    siteProfilesContent.innerHTML = '<div class="empty-state">No site-specific profiles saved<br><small>Create profiles from the extension popup</small></div>';
    return;
  }

  siteProfilesContent.innerHTML = list.map(profile => renderProfileCard(profile)).join('');
}

function renderProfileCard(profile) {
  const isMulti  = profile.multiEntry && Array.isArray(profile.entries) && profile.entries.length > 1;
  const entryCount = isMulti ? profile.entries.length : 1;
  const badgeHtml = isMulti ? `<span class="entry-badge">${entryCount} entries</span>` : '';

  return `
  <div class="profile-card" data-profile-id="${profile.id}">
    <div class="profile-header">
      <div class="profile-name">
        <input type="text" value="${esc(profile.label)}"
               onchange="updateProfileLabel('${profile.id}', this.value)"
               placeholder="Profile name">
        ${badgeHtml}
      </div>
      <div class="profile-actions">
        <button class="btn btn-danger btn-small" onclick="deleteSiteProfile('${profile.id}')">🗑️ Delete</button>
      </div>
    </div>

    <div class="profile-details">
      <div class="detail-item"><div class="detail-label">Fields</div><div class="detail-value">${profile.fields ? profile.fields.length : 0} total</div></div>
      ${isMulti ? `<div class="detail-item"><div class="detail-label">Entries</div><div class="detail-value">${entryCount} job entries</div></div>` : ''}
      <div class="detail-item"><div class="detail-label">URLs</div><div class="detail-value">${profile.urls.length} sites</div></div>
      <div class="detail-item"><div class="detail-label">Created</div><div class="detail-value">${fmtDate(profile.createdAt)}</div></div>
      <div class="detail-item"><div class="detail-label">Updated</div><div class="detail-value">${fmtDate(profile.updatedAt)}</div></div>
    </div>

    <div class="urls-section">
      <div class="urls-title">Associated URLs</div>
      <div class="url-list">${renderUrls(profile.urls, profile.id)}</div>
      <button class="add-url" onclick="addUrl('${profile.id}')">+ Add URL</button>
    </div>

    <div class="fields-section">
      <div class="fields-title">
        Form Fields
        ${isMulti ? '' : `<button class="add-field" onclick="addField('site','${profile.id}',null)">+ Add Field</button>`}
      </div>
      ${isMulti
      ? renderMultiEntryTabs(profile)
      : renderFieldList(profile.fields, 'site', profile.id, null)
  }
    </div>
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-entry tab rendering
// ─────────────────────────────────────────────────────────────────────────────
function renderMultiEntryTabs(profile) {
  const tabs = profile.entries.map((_, i) =>
      `<button class="entry-tab${i === 0 ? ' active' : ''}"
             onclick="switchEntryTab('${profile.id}', ${i}, this)">
       Entry ${i + 1}
     </button>`
  ).join('');

  const panels = profile.entries.map((fields, i) =>
      `<div class="entry-panel" id="entry-panel-${profile.id}-${i}" style="${i === 0 ? '' : 'display:none;'}">
       <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
         <span style="font-size:13px;font-weight:600;color:#4a5568;">Entry ${i+1} Fields</span>
         <button class="add-field" onclick="addField('site','${profile.id}',${i})">+ Add Field</button>
       </div>
       ${renderFieldList(fields, 'site', profile.id, i)}
     </div>`
  ).join('');

  return `
    <div class="entry-tabs">${tabs}</div>
    ${panels}`;
}

function switchEntryTab(profileId, entryIndex, tabEl) {
  // deactivate all tabs for this profile
  const card = tabEl.closest('.profile-card');
  card.querySelectorAll('.entry-tab').forEach(t => t.classList.remove('active'));
  tabEl.classList.add('active');

  // hide all panels, show selected
  card.querySelectorAll('.entry-panel').forEach(p => p.style.display = 'none');
  const panel = document.getElementById(`entry-panel-${profileId}-${entryIndex}`);
  if (panel) panel.style.display = 'block';
}

// ─────────────────────────────────────────────────────────────────────────────
// Render field rows
// entryIndex = null → flat profile fields array
// entryIndex = 0,1,… → profile.entries[entryIndex]
// ─────────────────────────────────────────────────────────────────────────────
function renderFieldList(fields, profileType, profileId, entryIndex) {
  if (!fields || !fields.length) {
    return '<div class="empty-state" style="padding:20px;margin:0;">No fields saved</div>';
  }

  const eiStr = entryIndex !== null ? entryIndex : 'null';
  const rows = fields.map((field, idx) => `
    <div class="field-item">
      <input class="field-input" type="text" value="${esc(field.selector || '')}"
             onchange="updateField('${profileType}','${profileId}',${eiStr},${idx},'selector',this.value)"
             placeholder="CSS selector" title="${esc(field.selector || '')}">
      <input class="field-input" type="text" value="${esc(String(field.value ?? ''))}"
             onchange="updateField('${profileType}','${profileId}',${eiStr},${idx},'value',this.value)"
             placeholder="Field value">
      <input class="field-input" type="text" value="${esc(field.type || '')}"
             onchange="updateField('${profileType}','${profileId}',${eiStr},${idx},'type',this.value)"
             placeholder="Type">
      <button class="remove-field" onclick="removeField('${profileType}','${profileId}',${eiStr},${idx})">×</button>
    </div>`).join('');

  return `
    <div class="field-header-row">
      <div>Selector</div><div>Value</div><div>Type</div><div></div>
    </div>
    ${rows}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// URL helpers
// ─────────────────────────────────────────────────────────────────────────────
function renderUrls(urls, profileId) {
  return urls.map((url, i) => `
    <div class="url-item">
      <input class="url-input" type="text" value="${esc(url)}"
             onchange="updateUrl('${profileId}',${i},this.value)" placeholder="Enter URL">
      <button class="remove-url" onclick="removeUrl('${profileId}',${i})">×</button>
    </div>`).join('');
}

function addUrl(profileId) {
  const p = siteProfiles[profileId]; if (!p) return;
  p.urls.push('');
  renderSiteProfiles(siteProfiles);
}

function removeUrl(profileId, idx) {
  const p = siteProfiles[profileId]; if (!p) return;
  if (p.urls.length <= 1) { showStatus('Profile must have at least one URL', 'error'); return; }
  p.urls.splice(idx, 1);
  debouncedSave(() => saveSiteProfile(profileId));
  renderSiteProfiles(siteProfiles);
}

function updateUrl(profileId, idx, value) {
  const p = siteProfiles[profileId]; if (!p) return;
  p.urls[idx] = value.trim();
  debouncedSave(() => saveSiteProfile(profileId));
}

// ─────────────────────────────────────────────────────────────────────────────
// Field edit helpers
// ─────────────────────────────────────────────────────────────────────────────
function getFieldArray(profileType, profileId, entryIndex) {
  if (profileType === 'global') return globalProfile ? globalProfile.fields : null;
  const p = siteProfiles[profileId]; if (!p) return null;
  if (entryIndex !== null && entryIndex !== undefined && p.multiEntry && p.entries) {
    return p.entries[entryIndex];
  }
  return p.fields;
}

function updateField(profileType, profileId, entryIndex, fieldIdx, prop, value) {
  const arr = getFieldArray(profileType, profileId, entryIndex);
  if (!arr || !arr[fieldIdx]) return;
  arr[fieldIdx][prop] = value;

  // keep flat fields in sync for multi-entry profiles
  if (profileType === 'site') {
    const p = siteProfiles[profileId];
    if (p && p.multiEntry) p.fields = p.entries.flat();
  }

  debouncedSave(() => profileType === 'global' ? saveGlobalProfileData() : saveSiteProfile(profileId));
}

function addField(profileType, profileId, entryIndex) {
  const arr = getFieldArray(profileType, profileId, entryIndex);
  if (!arr) return;
  arr.push({ selector: '', value: '', type: 'text' });

  if (profileType === 'site') {
    const p = siteProfiles[profileId];
    if (p && p.multiEntry) p.fields = p.entries.flat();
  }

  if (profileType === 'global') renderGlobalProfile(globalProfile);
  else renderSiteProfiles(siteProfiles);
}

function removeField(profileType, profileId, entryIndex, fieldIdx) {
  const arr = getFieldArray(profileType, profileId, entryIndex);
  if (!arr) return;
  arr.splice(fieldIdx, 1);

  if (profileType === 'site') {
    const p = siteProfiles[profileId];
    if (p && p.multiEntry) p.fields = p.entries.flat();
  }

  debouncedSave(() => profileType === 'global' ? saveGlobalProfileData() : saveSiteProfile(profileId));
  if (profileType === 'global') renderGlobalProfile(globalProfile);
  else renderSiteProfiles(siteProfiles);
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile label
// ─────────────────────────────────────────────────────────────────────────────
function updateProfileLabel(profileId, newLabel) {
  if (!newLabel.trim()) return;
  const p = siteProfiles[profileId]; if (!p) return;
  p.label = newLabel.trim();
  debouncedSave(() => saveSiteProfile(profileId));
}

// ─────────────────────────────────────────────────────────────────────────────
// Persist helpers
// ─────────────────────────────────────────────────────────────────────────────
function saveSiteProfile(profileId) {
  const p = siteProfiles[profileId]; if (!p) return;
  chrome.runtime.sendMessage({
    action: 'updateSiteProfile',
    profileId,
    label: p.label,
    urls:  p.urls,
    fields: p.fields,
    updatedAt: new Date().toISOString()
  }, handleSaveResponse);
}

function saveGlobalProfileData() {
  if (!globalProfile) return;
  chrome.runtime.sendMessage({
    action: 'updateGlobalProfile',
    label:  globalProfile.label,
    fields: globalProfile.fields,
    updatedAt: new Date().toISOString()
  }, handleSaveResponse);
}

function handleSaveResponse(response) {
  if (response && response.success) showSaveIndicator();
  else showStatus('Error saving: ' + (response?.error || 'Unknown'), 'error');
}

function debouncedSave(fn) {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(fn, 1000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete
// ─────────────────────────────────────────────────────────────────────────────
function deleteGlobalProfile() {
  if (!confirm('Delete the global profile? This cannot be undone.')) return;
  chrome.runtime.sendMessage({ action: 'deleteGlobalProfile' }, (r) => {
    if (r && r.success) { showStatus(r.message, 'success'); loadGlobalProfile(); }
    else showStatus('Error: ' + (r?.error || 'Unknown'), 'error');
  });
}

function deleteSiteProfile(profileId) {
  const p = siteProfiles[profileId]; if (!p) return;
  if (!confirm(`Delete "${p.label}"? This cannot be undone.`)) return;
  chrome.runtime.sendMessage({ action: 'deleteProfile', profileId }, (r) => {
    if (r && r.success) { showStatus(r.message, 'success'); loadSiteProfiles(); }
    else showStatus('Error: ' + (r?.error || 'Unknown'), 'error');
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// UI helpers
// ─────────────────────────────────────────────────────────────────────────────
function showSaveIndicator() {
  saveIndicator.classList.add('show');
  setTimeout(() => saveIndicator.classList.remove('show'), 2000);
}

function showStatus(message, type) {
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type}`;
  statusMessage.style.display = 'block';
  if (type !== 'info') setTimeout(hideStatus, 5000);
}

function hideStatus() { statusMessage.style.display = 'none'; }

function fmtDate(iso) {
  try { return new Date(iso).toLocaleDateString(); } catch { return '—'; }
}

function esc(str) {
  return String(str)
      .replace(/&/g,'&amp;')
      .replace(/"/g,'&quot;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;');
}