// Background service worker for Form Autofill Saver with storage management

// Storage configuration
const STORAGE_CONFIG = {
  MAX_ITEM_SIZE: 7000, // Leave some buffer from 8KB limit
  CHUNK_PREFIX: 'chunk_',
  GLOBAL_PROFILE_KEY: 'globalFormProfile',
  GLOBAL_PROFILE_META_KEY: 'globalFormProfile_meta',
  SITE_PROFILES_KEY: 'formProfiles',
  SITE_PROFILES_META_KEY: 'formProfiles_meta'
};

// Initialize extension on install
chrome.runtime.onInstalled.addListener(() => {
  console.log('Form Autofill Saver installed');
  
  // Initialize storage with empty profiles if not exists
  chrome.storage.local.get([STORAGE_CONFIG.SITE_PROFILES_KEY], (result) => {
    if (!result[STORAGE_CONFIG.SITE_PROFILES_KEY]) {
      chrome.storage.local.set({ [STORAGE_CONFIG.SITE_PROFILES_KEY]: {} });
    }
  });
});

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'getFormData':
      getFormDataFromTab(request.tabId, sendResponse);
      return true;
      
    case 'saveFormProfile':
      saveFormProfile(request.label, request.urls, request.formData, sendResponse);
      return true;
      
    case 'getProfilesForSite':
      getProfilesForSite(request.url, sendResponse);
      return true;
      
    case 'autofillForm':
      autofillForm(request.tabId, request.profileData, sendResponse);
      return true;
      
    case 'deleteProfile':
      deleteProfile(request.profileId, sendResponse);
      return true;
      
    case 'getFullProfileData':
      getFullProfileData(request.profileId, sendResponse);
      return true;
      
    case 'getGlobalProfile':
      getGlobalProfile(sendResponse);
      return true;
      
    case 'saveGlobalProfile':
      saveGlobalProfile(request.formData, sendResponse);
      return true;
      
    case 'useGlobalProfile':
      useGlobalProfile(request.tabId, sendResponse);
      return true;
      
    case 'deleteGlobalProfile':
      deleteGlobalProfile(sendResponse);
      return true;
      
    case 'getAllSiteProfiles':
      getAllSiteProfiles(sendResponse);
      return true;
      
    case 'updateGlobalProfile':
      updateGlobalProfile(request, sendResponse);
      return true;
      
    case 'updateSiteProfile':
      updateSiteProfile(request.profileId, request, sendResponse);
      return true;
      
    case 'autofillFormAndAddSite':
      autofillFormAndAddSite(request.tabId, request.profileId, request.currentUrl, request.profileData, sendResponse);
      return true;
      
    default:
      sendResponse({ error: 'Unknown action' });
  }
});

// Storage utility functions
function compressData(data) {
  try {
    const jsonString = JSON.stringify(data);
    // Simple compression by removing unnecessary whitespace
    return jsonString.replace(/\s+/g, ' ').trim();
  } catch (e) {
    console.error('Error compressing data:', e);
    return JSON.stringify(data);
  }
}

function decompressData(compressedData) {
  try {
    return JSON.parse(compressedData);
  } catch (e) {
    console.error('Error decompressing data:', e);
    return null;
  }
}

function chunkData(data, maxSize = STORAGE_CONFIG.MAX_ITEM_SIZE) {
  const compressed = compressData(data);
  const chunks = [];
  
  for (let i = 0; i < compressed.length; i += maxSize) {
    chunks.push(compressed.slice(i, i + maxSize));
  }
  
  return chunks;
}

function reconstructData(chunks) {
  const combined = chunks.join('');
  return decompressData(combined);
}

async function storeChunkedData(keyPrefix, data) {
  return new Promise((resolve, reject) => {
    const chunks = chunkData(data);
    const chunkKeys = [];
    const storageObj = {};
    
    // Clear existing chunks first
    chrome.storage.local.get(null, (allItems) => {
      const keysToRemove = Object.keys(allItems).filter(key => 
        key.startsWith(STORAGE_CONFIG.CHUNK_PREFIX + keyPrefix)
      );
      
      if (keysToRemove.length > 0) {
        chrome.storage.local.remove(keysToRemove, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
            return;
          }
          storeNewChunks();
        });
      } else {
        storeNewChunks();
      }
    });
    
    function storeNewChunks() {
      chunks.forEach((chunk, index) => {
        const chunkKey = `${STORAGE_CONFIG.CHUNK_PREFIX}${keyPrefix}_${index}`;
        chunkKeys.push(chunkKey);
        storageObj[chunkKey] = chunk;
      });
      
      // Store metadata
      const metaKey = `${keyPrefix}_meta`;
      storageObj[metaKey] = {
        chunkKeys: chunkKeys,
        totalChunks: chunks.length,
        timestamp: Date.now()
      };
      
      chrome.storage.local.set(storageObj, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    }
  });
}

async function retrieveChunkedData(keyPrefix) {
  return new Promise((resolve, reject) => {
    const metaKey = `${keyPrefix}_meta`;
    
    chrome.storage.local.get([metaKey], (result) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      
      const metadata = result[metaKey];
      if (!metadata) {
        resolve(null);
        return;
      }
      
      chrome.storage.local.get(metadata.chunkKeys, (chunkData) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        
        const chunks = [];
        for (let i = 0; i < metadata.totalChunks; i++) {
          const chunkKey = metadata.chunkKeys[i];
          if (chunkData[chunkKey]) {
            chunks.push(chunkData[chunkKey]);
          }
        }
        
        if (chunks.length === metadata.totalChunks) {
          const reconstructedData = reconstructData(chunks);
          resolve(reconstructedData);
        } else {
          reject(new Error('Missing chunks'));
        }
      });
    });
  });
}

async function removeChunkedData(keyPrefix) {
  return new Promise((resolve, reject) => {
    const metaKey = `${keyPrefix}_meta`;
    
    chrome.storage.local.get([metaKey], (result) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      
      const metadata = result[metaKey];
      if (!metadata) {
        resolve();
        return;
      }
      
      const keysToRemove = [...metadata.chunkKeys, metaKey];
      chrome.storage.local.remove(keysToRemove, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  });
}

// Get form data from the specified tab
function getFormDataFromTab(tabId, sendResponse) {
  chrome.tabs.sendMessage(tabId, { action: 'captureFormData' }, (response) => {
    if (chrome.runtime.lastError) {
      sendResponse({ error: chrome.runtime.lastError.message });
    } else {
      sendResponse(response);
    }
  });
}

// Save a form profile to storage with chunking
async function saveFormProfile(label, urls, formData, sendResponse) {
  try {
    const profiles = await retrieveChunkedData(STORAGE_CONFIG.SITE_PROFILES_KEY) || {};
    
    const profileId = generateProfileId();
    const newProfile = {
      id: profileId,
      label: label,
      urls: urls,
      fields: formData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    profiles[profileId] = newProfile;
    
    await storeChunkedData(STORAGE_CONFIG.SITE_PROFILES_KEY, profiles);
    
    sendResponse({ 
      success: true, 
      message: 'Profile saved successfully',
      profileId: profileId
    });
  } catch (error) {
    sendResponse({ error: error.message });
  }
}

// Get all profiles that match a specific site
async function getProfilesForSite(url, sendResponse) {
  try {
    const profiles = await retrieveChunkedData(STORAGE_CONFIG.SITE_PROFILES_KEY) || {};
    const matchingProfiles = [];
    
    Object.values(profiles).forEach(profile => {
      if (profile.urls && profile.urls.some(profileUrl => urlMatches(url, profileUrl))) {
        matchingProfiles.push({
          id: profile.id,
          label: profile.label,
          createdAt: profile.createdAt,
          updatedAt: profile.updatedAt,
          fieldCount: profile.fields ? profile.fields.length : 0,
          urlCount: profile.urls ? profile.urls.length : 0
        });
      }
    });
    
    sendResponse({ profiles: matchingProfiles });
  } catch (error) {
    sendResponse({ error: error.message });
  }
}

// Trigger autofill on the specified tab
function autofillForm(tabId, profileData, sendResponse) {
  chrome.tabs.sendMessage(tabId, {
    action: 'autofillForm',
    formData: profileData.fields
  }, (response) => {
    if (chrome.runtime.lastError) {
      sendResponse({ error: chrome.runtime.lastError.message });
    } else {
      sendResponse(response || { success: true });
    }
  });
}

// Delete a specific profile
async function deleteProfile(profileId, sendResponse) {
  try {
    const profiles = await retrieveChunkedData(STORAGE_CONFIG.SITE_PROFILES_KEY) || {};
    
    if (profiles[profileId]) {
      delete profiles[profileId];
      await storeChunkedData(STORAGE_CONFIG.SITE_PROFILES_KEY, profiles);
      sendResponse({ 
        success: true,
        message: 'Profile deleted successfully'
      });
    } else {
      sendResponse({ success: false, message: 'Profile not found' });
    }
  } catch (error) {
    sendResponse({ error: error.message });
  }
}

// Get full profile data for autofill
async function getFullProfileData(profileId, sendResponse) {
  try {
    const profiles = await retrieveChunkedData(STORAGE_CONFIG.SITE_PROFILES_KEY) || {};
    const profile = profiles[profileId];
    
    if (profile) {
      sendResponse({ success: true, profile: profile });
    } else {
      sendResponse({ success: false, error: 'Profile not found' });
    }
  } catch (error) {
    sendResponse({ error: error.message });
  }
}

// Get global profile with chunking support
async function getGlobalProfile(sendResponse) {
  try {
    const globalProfile = await retrieveChunkedData(STORAGE_CONFIG.GLOBAL_PROFILE_KEY);
    
    if (globalProfile) {
      sendResponse({ success: true, profile: globalProfile });
    } else {
      sendResponse({ success: false, message: 'No global profile found' });
    }
  } catch (error) {
    sendResponse({ error: error.message });
  }
}

// Save global profile with chunking support
async function saveGlobalProfile(formData, sendResponse) {
  try {
    const globalProfile = {
      label: 'Global Autofill Profile',
      fields: formData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    await storeChunkedData(STORAGE_CONFIG.GLOBAL_PROFILE_KEY, globalProfile);
    
    sendResponse({ 
      success: true, 
      message: 'Global profile saved successfully'
    });
  } catch (error) {
    sendResponse({ error: error.message });
  }
}

// Use global profile to autofill
async function useGlobalProfile(tabId, sendResponse) {
  try {
    const globalProfile = await retrieveChunkedData(STORAGE_CONFIG.GLOBAL_PROFILE_KEY);
    
    if (!globalProfile) {
      sendResponse({ success: false, error: 'No global profile found' });
      return;
    }
    
    chrome.tabs.sendMessage(tabId, {
      action: 'autofillForm',
      formData: globalProfile.fields
    }, (response) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        sendResponse(response || { success: true });
      }
    });
  } catch (error) {
    sendResponse({ error: error.message });
  }
}

// Delete global profile
async function deleteGlobalProfile(sendResponse) {
  try {
    await removeChunkedData(STORAGE_CONFIG.GLOBAL_PROFILE_KEY);
    sendResponse({ 
      success: true,
      message: 'Global profile deleted successfully'
    });
  } catch (error) {
    sendResponse({ error: error.message });
  }
}

// Get all site-specific profiles
async function getAllSiteProfiles(sendResponse) {
  try {
    const profiles = await retrieveChunkedData(STORAGE_CONFIG.SITE_PROFILES_KEY) || {};
    sendResponse({ success: true, profiles: profiles });
  } catch (error) {
    sendResponse({ error: error.message });
  }
}

// Update global profile
async function updateGlobalProfile(updateData, sendResponse) {
  try {
    const currentProfile = await retrieveChunkedData(STORAGE_CONFIG.GLOBAL_PROFILE_KEY);
    
    if (!currentProfile) {
      sendResponse({ success: false, error: 'Global profile not found' });
      return;
    }
    
    const updatedProfile = {
      ...currentProfile,
      label: updateData.label || currentProfile.label,
      fields: updateData.fields || currentProfile.fields,
      updatedAt: updateData.updatedAt || new Date().toISOString()
    };
    
    await storeChunkedData(STORAGE_CONFIG.GLOBAL_PROFILE_KEY, updatedProfile);
    sendResponse({ success: true, message: 'Global profile updated successfully' });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

// Update site-specific profile
async function updateSiteProfile(profileId, updateData, sendResponse) {
  try {
    const profiles = await retrieveChunkedData(STORAGE_CONFIG.SITE_PROFILES_KEY) || {};
    
    if (!profiles[profileId]) {
      sendResponse({ success: false, error: 'Profile not found' });
      return;
    }
    
    const updatedProfile = {
      ...profiles[profileId],
      label: updateData.label || profiles[profileId].label,
      urls: updateData.urls || profiles[profileId].urls,
      fields: updateData.fields || profiles[profileId].fields,
      updatedAt: updateData.updatedAt || new Date().toISOString()
    };
    
    profiles[profileId] = updatedProfile;
    await storeChunkedData(STORAGE_CONFIG.SITE_PROFILES_KEY, profiles);
    sendResponse({ success: true, message: 'Profile updated successfully' });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

// Autofill form and add current site to profile if not already present
async function autofillFormAndAddSite(tabId, profileId, currentUrl, profileData, sendResponse) {
  chrome.tabs.sendMessage(tabId, {
    action: 'autofillForm',
    formData: profileData.fields
  }, async (autofillResponse) => {
    if (chrome.runtime.lastError) {
      sendResponse({ error: chrome.runtime.lastError.message });
      return;
    }
    
    try {
      const normalizedCurrentUrl = normalizeUrl(currentUrl);
      const isUrlAlreadyPresent = profileData.urls.some(url => normalizeUrl(url) === normalizedCurrentUrl);
      
      if (!isUrlAlreadyPresent) {
        const profiles = await retrieveChunkedData(STORAGE_CONFIG.SITE_PROFILES_KEY) || {};
        
        if (profiles[profileId]) {
          profiles[profileId].urls.push(currentUrl);
          profiles[profileId].updatedAt = new Date().toISOString();
          
          await storeChunkedData(STORAGE_CONFIG.SITE_PROFILES_KEY, profiles);
          
          sendResponse({ 
            ...autofillResponse,
            siteAdded: true,
            message: 'Site added to profile and form autofilled'
          });
        } else {
          sendResponse({ 
            ...autofillResponse,
            siteAdded: false,
            error: 'Profile not found'
          });
        }
      } else {
        sendResponse({ 
          ...autofillResponse,
          siteAdded: false
        });
      }
    } catch (error) {
      sendResponse({ 
        ...autofillResponse,
        siteAdded: false,
        error: error.message
      });
    }
  });
}

// Generate unique profile ID
function generateProfileId() {
  return 'profile_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Normalize URL for comparison
function normalizeUrl(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname + urlObj.pathname;
  } catch (e) {
    console.error('Error normalizing URL:', e);
    return url;
  }
}

// Check if a URL matches a profile URL pattern
function urlMatches(currentUrl, profileUrl) {
  try {
    const currentUrlObj = new URL(currentUrl);
    const profileUrlObj = new URL(profileUrl);
    
    if (currentUrl === profileUrl) {
      return true;
    }
    
    if (currentUrlObj.hostname === profileUrlObj.hostname && 
        currentUrlObj.pathname === profileUrlObj.pathname) {
      return true;
    }
    
    if (currentUrlObj.hostname === profileUrlObj.hostname && 
        currentUrlObj.pathname.startsWith(profileUrlObj.pathname)) {
      return true;
    }
    
    return false;
  } catch (e) {
    console.error('Error matching URLs:', e);
    return false;
  }
}

// Listen for tab updates to trigger automatic autofill
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome://')) {
    setTimeout(() => {
      checkAndAutoFill(tabId, tab.url);
    }, 1000);
  }
});

// Check if there are matching profiles and auto-fill
async function checkAndAutoFill(tabId, url) {
  try {
    // First, check for global profile
    const globalProfile = await retrieveChunkedData(STORAGE_CONFIG.GLOBAL_PROFILE_KEY);
    
    if (globalProfile) {
      console.log(`Auto-filling with global profile for URL: ${url}`);
      
      chrome.tabs.sendMessage(tabId, {
        action: 'autofillForm',
        formData: globalProfile.fields,
        isAutomatic: true
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.log('Global auto-fill failed:', chrome.runtime.lastError.message);
        } else if (response && response.success) {
          console.log(`Auto-filled ${response.filledCount} fields automatically using global profile`);
        }
      });
    } else {
      // No global profile, check for site-specific profiles
      const profiles = await retrieveChunkedData(STORAGE_CONFIG.SITE_PROFILES_KEY) || {};
      
      const matchingProfile = Object.values(profiles).find(profile => 
        profile.urls && profile.urls.some(profileUrl => urlMatches(url, profileUrl))
      );
      
      if (matchingProfile) {
        console.log(`Auto-filling with site-specific profile: ${matchingProfile.label} for URL: ${url}`);
        
        chrome.tabs.sendMessage(tabId, {
          action: 'autofillForm',
          formData: matchingProfile.fields,
          isAutomatic: true
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.log('Auto-fill failed:', chrome.runtime.lastError.message);
          } else if (response && response.success) {
            console.log(`Auto-filled ${response.filledCount} fields automatically`);
          }
        });
      }
    }
  } catch (error) {
    console.error('Error during auto-fill:', error);
  }
}