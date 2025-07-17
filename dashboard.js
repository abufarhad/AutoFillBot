// Dashboard script for Form Autofill Saver with inline editing

let globalProfile = null;
let siteProfiles = {};
let saveTimeout = null;

// DOM elements
const refreshBtn = document.getElementById('refreshBtn');
const statusMessage = document.getElementById('statusMessage');
const saveIndicator = document.getElementById('saveIndicator');
const globalProfileLoading = document.getElementById('globalProfileLoading');
const globalProfileContent = document.getElementById('globalProfileContent');
const siteProfilesLoading = document.getElementById('siteProfilesLoading');
const siteProfilesContent = document.getElementById('siteProfilesContent');

// Initialize dashboard
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  loadAllProfiles();
});

// Setup event listeners
function setupEventListeners() {
  refreshBtn.addEventListener('click', loadAllProfiles);
}

// Load all profiles
function loadAllProfiles() {
  showStatus('Loading profiles...', 'info');
  loadGlobalProfile();
  loadSiteProfiles();
}

// Load global profile
function loadGlobalProfile() {
  globalProfileLoading.style.display = 'block';
  globalProfileContent.style.display = 'none';
  
  chrome.runtime.sendMessage({
    action: 'getGlobalProfile'
  }, (response) => {
    globalProfileLoading.style.display = 'none';
    globalProfileContent.style.display = 'block';
    
    if (response && response.success && response.profile) {
      globalProfile = response.profile;
      renderGlobalProfile(globalProfile);
    } else {
      globalProfile = null;
      renderGlobalProfile(null);
    }
  });
}

// Load site-specific profiles
function loadSiteProfiles() {
  siteProfilesLoading.style.display = 'block';
  siteProfilesContent.style.display = 'none';
  
  chrome.runtime.sendMessage({
    action: 'getAllSiteProfiles'
  }, (response) => {
    siteProfilesLoading.style.display = 'none';
    siteProfilesContent.style.display = 'block';
    
    if (response && response.success) {
      siteProfiles = response.profiles || {};
      renderSiteProfiles(siteProfiles);
    } else {
      siteProfiles = {};
      renderSiteProfiles({});
    }
    
    hideStatus();
  });
}

// Render global profile
function renderGlobalProfile(profile) {
  if (!profile) {
    globalProfileContent.innerHTML = '<div class="empty-state">No global profile saved<br><small>Create a global profile from the extension popup</small></div>';
    return;
  }
  
  const createdDate = new Date(profile.createdAt).toLocaleDateString();
  const updatedDate = new Date(profile.updatedAt).toLocaleDateString();
  
  globalProfileContent.innerHTML = `
    <div class="profile-card" data-profile-type="global">
      <div class="profile-header">
        <div class="profile-name">
          <input type="text" value="${profile.label}" readonly style="cursor: not-allowed; opacity: 0.7;">
          <small style="display: block; color: #718096; margin-top: 4px;">Global profile label cannot be changed</small>
        </div>
        <div class="profile-actions">
          <button class="btn btn-danger btn-small" onclick="deleteGlobalProfile()">🗑️ Delete</button>
        </div>
      </div>
      
      <div class="profile-details">
        <div class="detail-item">
          <div class="detail-label">Fields</div>
          <div class="detail-value">${profile.fields.length} saved</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Created</div>
          <div class="detail-value">${createdDate}</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Updated</div>
          <div class="detail-value">${updatedDate}</div>
        </div>
      </div>
      
      <div class="fields-section">
        <div class="fields-title">
          Form Fields
          <button class="add-field" onclick="addField('global', null)">+ Add Field</button>
        </div>
        <div class="field-list">
          ${renderFields(profile.fields, 'global', null)}
        </div>
      </div>
    </div>
  `;
}

// Render site-specific profiles
function renderSiteProfiles(profiles) {
  if (Object.keys(profiles).length === 0) {
    siteProfilesContent.innerHTML = '<div class="empty-state">No site-specific profiles saved<br><small>Create profiles from the extension popup</small></div>';
    return;
  }
  
  let html = '';
  Object.values(profiles).forEach(profile => {
    const createdDate = new Date(profile.createdAt).toLocaleDateString();
    const updatedDate = new Date(profile.updatedAt).toLocaleDateString();
    
    html += `
      <div class="profile-card" data-profile-type="site" data-profile-id="${profile.id}">
        <div class="profile-header">
          <div class="profile-name">
            <input type="text" value="${profile.label}" onchange="updateProfileLabel('${profile.id}', this.value)" placeholder="Profile name">
          </div>
          <div class="profile-actions">
            <button class="btn btn-danger btn-small" onclick="deleteSiteProfile('${profile.id}')">🗑️ Delete</button>
          </div>
        </div>
        
        <div class="profile-details">
          <div class="detail-item">
            <div class="detail-label">Fields</div>
            <div class="detail-value">${profile.fields.length} saved</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">URLs</div>
            <div class="detail-value">${profile.urls.length} sites</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Created</div>
            <div class="detail-value">${createdDate}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Updated</div>
            <div class="detail-value">${updatedDate}</div>
          </div>
        </div>
        
        <div class="urls-section">
          <div class="urls-title">Associated URLs</div>
          <div class="url-list">
            ${renderUrls(profile.urls, profile.id)}
          </div>
          <button class="add-url" onclick="addUrl('${profile.id}')">+ Add URL</button>
        </div>
        
        <div class="fields-section">
          <div class="fields-title">
            Form Fields
            <button class="add-field" onclick="addField('site', '${profile.id}')">+ Add Field</button>
          </div>
          <div class="field-list">
            ${renderFields(profile.fields, 'site', profile.id)}
          </div>
        </div>
      </div>
    `;
  });
  
  siteProfilesContent.innerHTML = html;
}

// Render URLs for a site profile
function renderUrls(urls, profileId) {
  return urls.map((url, index) => `
    <div class="url-item">
      <input type="text" class="url-input" value="${url}" 
             onchange="updateUrl('${profileId}', ${index}, this.value)" 
             placeholder="Enter URL">
      <button class="remove-url" onclick="removeUrl('${profileId}', ${index})">×</button>
    </div>
  `).join('');
}

// Render fields for a profile
function renderFields(fields, profileType, profileId) {
  if (!fields || fields.length === 0) {
    return '<div class="empty-state" style="margin: 20px 0;">No fields saved</div>';
  }
  
  return `
    <div style="display: grid; grid-template-columns: 1fr 2fr 100px 40px; gap: 12px; margin-bottom: 10px; padding: 0 15px; font-size: 12px; font-weight: 600; color: #718096;">
      <div class="field-label">Selector</div>
      <div class="field-label">Value</div>
      <div class="field-label">Type</div>
      <div class="field-label"></div>
    </div>
    ${fields.map((field, index) => `
      <div class="field-item">
        <input type="text" class="field-input" value="${field.selector || ''}" 
               onchange="updateField('${profileType}', '${profileId}', ${index}, 'selector', this.value)" 
               placeholder="CSS selector">
        <input type="text" class="field-input" value="${field.value || ''}" 
               onchange="updateField('${profileType}', '${profileId}', ${index}, 'value', this.value)" 
               placeholder="Field value">
        <input type="text" class="field-input" value="${field.type || ''}" 
               onchange="updateField('${profileType}', '${profileId}', ${index}, 'type', this.value)" 
               placeholder="Field type">
        <button class="remove-field" onclick="removeField('${profileType}', '${profileId}', ${index})">×</button>
      </div>
    `).join('')}
  `;
}

// Update profile label
function updateProfileLabel(profileId, newLabel) {
  if (!newLabel.trim()) return;
  
  const profile = siteProfiles[profileId];
  if (!profile) return;
  
  profile.label = newLabel.trim();
  debouncedSave(() => {
    chrome.runtime.sendMessage({
      action: 'updateSiteProfile',
      profileId: profileId,
      label: profile.label,
      urls: profile.urls,
      fields: profile.fields,
      updatedAt: new Date().toISOString()
    }, handleSaveResponse);
  });
}

// Update URL
function updateUrl(profileId, urlIndex, newUrl) {
  const profile = siteProfiles[profileId];
  if (!profile || !profile.urls[urlIndex]) return;
  
  profile.urls[urlIndex] = newUrl.trim();
  debouncedSave(() => {
    chrome.runtime.sendMessage({
      action: 'updateSiteProfile',
      profileId: profileId,
      label: profile.label,
      urls: profile.urls,
      fields: profile.fields,
      updatedAt: new Date().toISOString()
    }, handleSaveResponse);
  });
}

// Add URL
function addUrl(profileId) {
  const profile = siteProfiles[profileId];
  if (!profile) return;
  
  profile.urls.push('');
  renderSiteProfiles(siteProfiles);
}

// Remove URL
function removeUrl(profileId, urlIndex) {
  const profile = siteProfiles[profileId];
  if (!profile || profile.urls.length <= 1) {
    showStatus('Profile must have at least one URL', 'error');
    return;
  }
  
  profile.urls.splice(urlIndex, 1);
  debouncedSave(() => {
    chrome.runtime.sendMessage({
      action: 'updateSiteProfile',
      profileId: profileId,
      label: profile.label,
      urls: profile.urls,
      fields: profile.fields,
      updatedAt: new Date().toISOString()
    }, handleSaveResponse);
  });
  renderSiteProfiles(siteProfiles);
}

// Update field
function updateField(profileType, profileId, fieldIndex, fieldProperty, newValue) {
  let profile;
  if (profileType === 'global') {
    profile = globalProfile;
  } else {
    profile = siteProfiles[profileId];
  }
  
  if (!profile || !profile.fields[fieldIndex]) return;
  
  profile.fields[fieldIndex][fieldProperty] = newValue;
  
  debouncedSave(() => {
    if (profileType === 'global') {
      chrome.runtime.sendMessage({
        action: 'updateGlobalProfile',
        label: profile.label,
        fields: profile.fields,
        updatedAt: new Date().toISOString()
      }, handleSaveResponse);
    } else {
      chrome.runtime.sendMessage({
        action: 'updateSiteProfile',
        profileId: profileId,
        label: profile.label,
        urls: profile.urls,
        fields: profile.fields,
        updatedAt: new Date().toISOString()
      }, handleSaveResponse);
    }
  });
}

// Add field
function addField(profileType, profileId) {
  let profile;
  if (profileType === 'global') {
    profile = globalProfile;
  } else {
    profile = siteProfiles[profileId];
  }
  
  if (!profile) return;
  
  profile.fields.push({
    selector: '',
    value: '',
    type: 'text'
  });
  
  if (profileType === 'global') {
    renderGlobalProfile(globalProfile);
  } else {
    renderSiteProfiles(siteProfiles);
  }
}

// Remove field
function removeField(profileType, profileId, fieldIndex) {
  let profile;
  if (profileType === 'global') {
    profile = globalProfile;
  } else {
    profile = siteProfiles[profileId];
  }
  
  if (!profile) return;
  
  profile.fields.splice(fieldIndex, 1);
  
  debouncedSave(() => {
    if (profileType === 'global') {
      chrome.runtime.sendMessage({
        action: 'updateGlobalProfile',
        label: profile.label,
        fields: profile.fields,
        updatedAt: new Date().toISOString()
      }, handleSaveResponse);
    } else {
      chrome.runtime.sendMessage({
        action: 'updateSiteProfile',
        profileId: profileId,
        label: profile.label,
        urls: profile.urls,
        fields: profile.fields,
        updatedAt: new Date().toISOString()
      }, handleSaveResponse);
    }
  });
  
  if (profileType === 'global') {
    renderGlobalProfile(globalProfile);
  } else {
    renderSiteProfiles(siteProfiles);
  }
}

// Delete global profile
function deleteGlobalProfile() {
  if (!confirm('Are you sure you want to delete the global profile? This action cannot be undone.')) {
    return;
  }
  
  chrome.runtime.sendMessage({
    action: 'deleteGlobalProfile'
  }, (response) => {
    if (response && response.success) {
      showStatus(response.message, 'success');
      loadGlobalProfile();
    } else {
      showStatus('Error deleting global profile: ' + (response?.error || 'Unknown error'), 'error');
    }
  });
}

// Delete site profile
function deleteSiteProfile(profileId) {
  const profile = siteProfiles[profileId];
  if (!profile) return;
  
  if (!confirm(`Are you sure you want to delete "${profile.label}"? This action cannot be undone.`)) {
    return;
  }
  
  chrome.runtime.sendMessage({
    action: 'deleteProfile',
    profileId: profileId
  }, (response) => {
    if (response && response.success) {
      showStatus(response.message, 'success');
      loadSiteProfiles();
    } else {
      showStatus('Error deleting profile: ' + (response?.error || 'Unknown error'), 'error');
    }
  });
}

// Debounced save function
function debouncedSave(saveFunction) {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  
  saveTimeout = setTimeout(() => {
    saveFunction();
  }, 1000); // Save after 1 second of inactivity
}

// Handle save response
function handleSaveResponse(response) {
  if (response && response.success) {
    showSaveIndicator();
  } else {
    showStatus('Error saving: ' + (response?.error || 'Unknown error'), 'error');
  }
}

// Show save indicator
function showSaveIndicator() {
  saveIndicator.classList.add('show');
  setTimeout(() => {
    saveIndicator.classList.remove('show');
  }, 2000);
}

// Show status message
function showStatus(message, type) {
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type}`;
  statusMessage.style.display = 'block';
  
  if (type !== 'info') {
    setTimeout(() => {
      hideStatus();
    }, 5000);
  }
}

// Hide status message
function hideStatus() {
  statusMessage.style.display = 'none';
}

