// Popup script for Form Autofill Saver

let currentUrl = '';
let currentFormData = [];

// DOM elements
const currentSiteUrl = document.getElementById('currentSiteUrl');
const statusMessage = document.getElementById('statusMessage');
const openDashboardBtn = document.getElementById('openDashboardBtn');
const globalProfileStatus = document.getElementById('globalProfileStatus');
const globalProfileContainer = document.getElementById('globalProfileContainer');
const globalProfileInfo = document.getElementById('globalProfileInfo');
const saveGlobalBtn = document.getElementById('saveGlobalBtn');
const useGlobalBtn = document.getElementById('useGlobalBtn');
const deleteGlobalBtn = document.getElementById('deleteGlobalBtn');
const formDetectionStatus = document.getElementById('formDetectionStatus');
const saveFormContainer = document.getElementById('saveFormContainer');
const profileLabel = document.getElementById('profileLabel');
const additionalUrls = document.getElementById('additionalUrls');
const formFieldsCount = document.getElementById('formFieldsCount');
const saveFormBtn = document.getElementById('saveFormBtn');
const savedProfiles = document.getElementById('savedProfiles');

// Initialize popup
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  getCurrentTabInfo();
});

// Setup event listeners
function setupEventListeners() {
  openDashboardBtn.addEventListener('click', openDashboard);
  saveGlobalBtn.addEventListener('click', saveGlobalProfile);
  useGlobalBtn.addEventListener('click', useGlobalProfile);
  deleteGlobalBtn.addEventListener('click', deleteGlobalProfile);
  saveFormBtn.addEventListener('click', saveCurrentForm);
  profileLabel.addEventListener('input', validateSaveForm);
}

// Open dashboard
function openDashboard() {
  chrome.tabs.create({
    url: chrome.runtime.getURL('dashboard.html')
  });
}

// Get current tab information
function getCurrentTabInfo() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      currentUrl = tabs[0].url;
      const urlObj = new URL(currentUrl);
      currentSiteUrl.textContent = urlObj.hostname + urlObj.pathname;
      
      // Load global profile status
      loadGlobalProfile();
      
      // Get form data from current tab
      getFormDataFromCurrentTab(tabs[0].id);
      
      // Load saved profiles for this site
      loadSavedProfiles();
    }
  });
}

// Get form data from current tab
function getFormDataFromCurrentTab(tabId) {
  chrome.runtime.sendMessage({
    action: 'getFormData',
    tabId: tabId
  }, (response) => {
    if (response && response.success) {
      currentFormData = response.formData || [];
      updateFormStatus();
    } else {
      formDetectionStatus.textContent = 'No forms detected';
      formDetectionStatus.className = 'error';
    }
  });
}

// Update form status and enable/disable buttons
function updateFormStatus() {
  const fieldCount = currentFormData.length;
  
  if (fieldCount > 0) {
    formDetectionStatus.textContent = `${fieldCount} form fields detected`;
    formDetectionStatus.className = 'success';
    formFieldsCount.textContent = `${fieldCount} form fields detected`;
    saveFormContainer.style.display = 'block';
    globalProfileContainer.style.display = 'block';
    
    // Enable global save button if form data exists
    saveGlobalBtn.disabled = false;
    
    validateSaveForm();
  } else {
    formDetectionStatus.textContent = 'No filled form fields detected';
    formDetectionStatus.className = 'error';
    saveFormContainer.style.display = 'none';
    
    // Disable global save button if no form data
    saveGlobalBtn.disabled = true;
  }
}

// Validate save form inputs
function validateSaveForm() {
  const label = profileLabel.value.trim();
  const hasFormData = currentFormData.length > 0;
  
  saveFormBtn.disabled = !label || !hasFormData;
}

// Load global profile status
function loadGlobalProfile() {
  chrome.runtime.sendMessage({
    action: 'getGlobalProfile'
  }, (response) => {
    if (response && response.success && response.profile) {
      // Global profile exists
      globalProfileStatus.style.display = 'none';
      globalProfileContainer.style.display = 'block';
      
      const profile = response.profile;
      globalProfileInfo.innerHTML = `
        <strong>Global Profile:</strong> ${profile.label}<br>
        <small>${profile.fields.length} fields saved on ${new Date(profile.createdAt).toLocaleDateString()}</small>
      `;
      
      useGlobalBtn.style.display = 'inline-block';
      deleteGlobalBtn.style.display = 'inline-block';
      saveGlobalBtn.textContent = 'Update Global Profile';
    } else {
      // No global profile
      globalProfileStatus.textContent = 'No global profile saved';
      globalProfileStatus.className = 'info';
      globalProfileContainer.style.display = 'block';
      
      globalProfileInfo.innerHTML = '<em>Save your form data as a global profile to use it on any site.</em>';
      
      useGlobalBtn.style.display = 'none';
      deleteGlobalBtn.style.display = 'none';
      saveGlobalBtn.textContent = 'Save as Global Profile';
    }
  });
}

// Save global profile
function saveGlobalProfile() {
  if (currentFormData.length === 0) {
    showStatus('No form data to save', 'error');
    return;
  }
  
  saveGlobalBtn.disabled = true;
  saveGlobalBtn.textContent = 'Saving...';
  
  chrome.runtime.sendMessage({
    action: 'saveGlobalProfile',
    formData: currentFormData
  }, (response) => {
    saveGlobalBtn.disabled = false;
    
    if (response && response.success) {
      showStatus(response.message, 'success');
      loadGlobalProfile(); // Refresh global profile display
    } else {
      showStatus('Error saving global profile: ' + (response?.error || 'Unknown error'), 'error');
      saveGlobalBtn.textContent = 'Save as Global Profile';
    }
  });
}

// Use global profile to autofill current form
function useGlobalProfile() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.runtime.sendMessage({
        action: 'useGlobalProfile',
        tabId: tabs[0].id
      }, (response) => {
        if (response && response.success) {
          showStatus(`Autofilled ${response.filledCount} fields using global profile`, 'success');
          
          if (response.errors && response.errors.length > 0) {
            console.warn('Autofill errors:', response.errors);
          }
        } else {
          showStatus('Error using global profile: ' + (response?.error || 'Unknown error'), 'error');
        }
      });
    }
  });
}

// Delete global profile
function deleteGlobalProfile() {
  if (!confirm('Are you sure you want to delete the global profile?')) {
    return;
  }
  
  chrome.runtime.sendMessage({
    action: 'deleteGlobalProfile'
  }, (response) => {
    if (response && response.success) {
      showStatus(response.message, 'success');
      loadGlobalProfile(); // Refresh global profile display
    } else {
      showStatus('Error deleting global profile: ' + (response?.error || 'Unknown error'), 'error');
    }
  });
}

// Save current form data
function saveCurrentForm() {
  const label = profileLabel.value.trim();
  const additionalUrlsText = additionalUrls.value.trim();
  
  if (!label) {
    showStatus('Please enter a profile name', 'error');
    return;
  }
  
  if (currentFormData.length === 0) {
    showStatus('No form data to save', 'error');
    return;
  }
  
  // Parse additional URLs
  const urls = [currentUrl]; // Always include current URL
  if (additionalUrlsText) {
    const additionalUrlsList = additionalUrlsText.split('\n')
      .map(url => url.trim())
      .filter(url => url.length > 0);
    urls.push(...additionalUrlsList);
  }
  
  saveFormBtn.disabled = true;
  saveFormBtn.textContent = 'Saving...';
  
  chrome.runtime.sendMessage({
    action: 'saveFormProfile',
    label: label,
    urls: urls,
    formData: currentFormData
  }, (response) => {
    saveFormBtn.disabled = false;
    saveFormBtn.textContent = 'Save Form Data';
    
    if (response && response.success) {
      showStatus(response.message, 'success');
      profileLabel.value = '';
      additionalUrls.value = '';
      validateSaveForm();
      loadSavedProfiles(); // Refresh the profiles list
    } else {
      showStatus('Error saving profile: ' + (response?.error || 'Unknown error'), 'error');
    }
  });
}

// Load saved profiles for current site
function loadSavedProfiles() {
  chrome.runtime.sendMessage({
    action: 'getProfilesForSite',
    url: currentUrl
  }, (response) => {
    if (response && response.profiles) {
      renderSavedProfiles(response.profiles);
    } else {
      savedProfiles.innerHTML = '<div class="error">Error loading profiles</div>';
    }
  });
}

// Render saved profiles list
function renderSavedProfiles(profiles) {
  if (profiles.length === 0) {
    savedProfiles.innerHTML = '<div class="empty-state">No saved profiles for this site</div>';
    return;
  }
  
  savedProfiles.innerHTML = '';
  
  profiles.forEach(profile => {
    const profileItem = document.createElement('div');
    profileItem.className = 'profile-item';
    
    const profileInfo = document.createElement('div');
    profileInfo.className = 'profile-name';
    profileInfo.textContent = profile.label;
    
    const fieldCount = document.createElement('div');
    fieldCount.className = 'form-count';
    fieldCount.textContent = `${profile.fieldCount} fields, ${profile.urlCount} URLs`;
    
    const profileActions = document.createElement('div');
    profileActions.className = 'profile-actions';
    
    const autofillBtn = document.createElement('button');
    autofillBtn.className = 'btn btn-primary btn-small';
    autofillBtn.textContent = 'Autofill';
    autofillBtn.addEventListener('click', () => autofillWithProfile(profile.id));
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-danger btn-small';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => deleteProfile(profile.id));
    
    profileActions.appendChild(autofillBtn);
    profileActions.appendChild(deleteBtn);
    
    const profileContent = document.createElement('div');
    profileContent.style.flex = '1';
    profileContent.appendChild(profileInfo);
    profileContent.appendChild(fieldCount);
    
    profileItem.appendChild(profileContent);
    profileItem.appendChild(profileActions);
    
    savedProfiles.appendChild(profileItem);
  });
}

// Autofill form with selected profile
function autofillWithProfile(profileId) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      // First get the full profile data
      chrome.runtime.sendMessage({
        action: 'getFullProfileData',
        profileId: profileId
      }, (response) => {
        if (response && response.success) {
          // Now trigger autofill with dynamic site addition
          chrome.runtime.sendMessage({
            action: 'autofillFormAndAddSite',
            tabId: tabs[0].id,
            profileId: profileId,
            currentUrl: currentUrl,
            profileData: response.profile
          }, (autofillResponse) => {
            if (autofillResponse && autofillResponse.success) {
              let message = `Autofilled ${autofillResponse.filledCount} fields`;
              if (autofillResponse.siteAdded) {
                message += ` and added this site to the profile`;
              }
              showStatus(message, 'success');
              
              if (autofillResponse.errors && autofillResponse.errors.length > 0) {
                console.warn('Autofill errors:', autofillResponse.errors);
              }
              
              // Refresh the profiles list to show updated URL count
              loadSavedProfiles();
            } else {
              showStatus('Error during autofill: ' + (autofillResponse?.error || 'Unknown error'), 'error');
            }
          });
        } else {
          showStatus('Error loading profile data: ' + (response?.error || 'Unknown error'), 'error');
        }
      });
    }
  });
}

// Delete a saved profile
function deleteProfile(profileId) {
  if (!confirm(`Are you sure you want to delete this profile?`)) {
    return;
  }
  
  chrome.runtime.sendMessage({
    action: 'deleteProfile',
    profileId: profileId
  }, (response) => {
    if (response && response.success) {
      showStatus(response.message, 'success');
      loadSavedProfiles(); // Refresh the profiles list
    } else {
      showStatus('Error deleting profile: ' + (response?.error || 'Unknown error'), 'error');
    }
  });
}

// Show status message
function showStatus(message, type) {
  statusMessage.textContent = message;
  statusMessage.className = `status ${type}`;
  statusMessage.style.display = 'block';
  
  // Hide after 3 seconds
  setTimeout(() => {
    statusMessage.style.display = 'none';
  }, 3000);
}

