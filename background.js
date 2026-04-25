// Background service worker for Form Autofill Saver

const STORAGE_CONFIG = {
  MAX_ITEM_SIZE: 7000,
  CHUNK_PREFIX: 'chunk_',
  GLOBAL_PROFILE_KEY: 'globalFormProfile',
  SITE_PROFILES_KEY: 'formProfiles',
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get([STORAGE_CONFIG.SITE_PROFILES_KEY], (result) => {
    if (!result[STORAGE_CONFIG.SITE_PROFILES_KEY]) {
      chrome.storage.local.set({ [STORAGE_CONFIG.SITE_PROFILES_KEY]: {} });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Message Router
// ─────────────────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'getFormData':              getFormDataFromTab(request.tabId, sendResponse);                               return true;
    case 'getGroupedFormData':       getGroupedFormDataFromTab(request.tabId, sendResponse);                        return true;
    case 'saveFormProfile':          saveFormProfile(request.label, request.urls, request.formData, sendResponse);  return true;
    case 'saveMultiEntryProfile':    saveMultiEntryProfile(request, sendResponse);                                  return true;
    case 'getProfilesForSite':       getProfilesForSite(request.url, sendResponse);                                return true;
    case 'deleteProfile':            deleteProfile(request.profileId, sendResponse);                               return true;
    case 'getFullProfileData':       getFullProfileData(request.profileId, sendResponse);                          return true;
    case 'activateMultiEntry':       activateMultiEntryInTab(request.tabId, request.profileId, sendResponse);      return true;
    case 'getGlobalProfile':         getGlobalProfile(sendResponse);                                               return true;
    case 'saveGlobalProfile':        saveGlobalProfile(request.formData, sendResponse);                            return true;
    case 'useGlobalProfile':         useGlobalProfile(request.tabId, sendResponse);                                return true;
    case 'deleteGlobalProfile':      deleteGlobalProfile(sendResponse);                                            return true;
    case 'getAllSiteProfiles':        getAllSiteProfiles(sendResponse);                                             return true;
    case 'updateGlobalProfile':      updateGlobalProfile(request, sendResponse);                                   return true;
    case 'updateSiteProfile':        updateSiteProfile(request.profileId, request, sendResponse);                  return true;
    case 'autofillFormAndAddSite':   autofillFormAndAddSite(request.tabId, request.profileId, request.currentUrl, request.profileData, sendResponse); return true;
    default: sendResponse({ error: 'Unknown action' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Safe tab messaging
// ─────────────────────────────────────────────────────────────────────────────
function sendToTab(tabId, message, callback) {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) { callback({ error: 'Tab not found' }); return; }
    if (!tab.url || (!tab.url.startsWith('http://') && !tab.url.startsWith('https://'))) {
      callback({ error: 'Content script not available on this page' }); return;
    }
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) callback({ error: chrome.runtime.lastError.message });
      else callback(response || { success: true });
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Capture
// ─────────────────────────────────────────────────────────────────────────────
function getFormDataFromTab(tabId, sendResponse) {
  sendToTab(tabId, { action: 'captureFormData' }, sendResponse);
}

function getGroupedFormDataFromTab(tabId, sendResponse) {
  sendToTab(tabId, { action: 'captureGroupedFormData' }, sendResponse);
}

// ─────────────────────────────────────────────────────────────────────────────
// Activate multi-entry intercept in tab
// This hooks the ADD MORE button so every click auto-fills the new section
// ─────────────────────────────────────────────────────────────────────────────
async function activateMultiEntryInTab(tabId, profileId, sendResponse) {
  try {
    const profiles = await retrieveChunkedData(STORAGE_CONFIG.SITE_PROFILES_KEY) || {};
    const profile  = profiles[profileId];
    if (!profile) { sendResponse({ success: false, error: 'Profile not found' }); return; }

    if (!profile.multiEntry || !Array.isArray(profile.entries)) {
      // Single entry — just flat fill
      sendToTab(tabId, { action: 'autofillForm', formData: profile.fields }, sendResponse);
      return;
    }

    // Send profile data to content script to activate intercept
    sendToTab(tabId, {
      action: 'activateMultiEntryIntercept',
      entries:        profile.entries,
      nonArrayFields: profile.nonArrayFields || [],
      arrayPrefix:    profile.arrayPrefix    || null,
    }, sendResponse);

  } catch(e) { sendResponse({ success: false, error: e.message }); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Save profiles
// ─────────────────────────────────────────────────────────────────────────────
async function saveFormProfile(label, urls, formData, sendResponse) {
  try {
    const profiles = await retrieveChunkedData(STORAGE_CONFIG.SITE_PROFILES_KEY) || {};
    const id = generateProfileId();
    profiles[id] = { id, label, urls, multiEntry: false, fields: formData,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await storeChunkedData(STORAGE_CONFIG.SITE_PROFILES_KEY, profiles);
    sendResponse({ success: true, message: 'Profile saved', profileId: id });
  } catch(e) { sendResponse({ error: e.message }); }
}

async function saveMultiEntryProfile(req, sendResponse) {
  try {
    const profiles = await retrieveChunkedData(STORAGE_CONFIG.SITE_PROFILES_KEY) || {};
    const id = generateProfileId();
    profiles[id] = {
      id, label: req.label, urls: req.urls,
      multiEntry: true,
      entries:        req.entries,
      nonArrayFields: req.nonArrayFields || [],
      arrayPrefix:    req.arrayPrefix    || null,
      fields: [...(req.nonArrayFields||[]), ...req.entries.flat()],
      groupConfig: req.groupConfig || {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await storeChunkedData(STORAGE_CONFIG.SITE_PROFILES_KEY, profiles);
    sendResponse({ success: true, message: `Saved ${req.entries.length} entries`, profileId: id });
  } catch(e) { sendResponse({ error: e.message }); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Standard autofill + add site URL
// ─────────────────────────────────────────────────────────────────────────────
async function autofillFormAndAddSite(tabId, profileId, currentUrl, profileData, sendResponse) {
  sendToTab(tabId, { action: 'autofillForm', formData: profileData.fields }, async (r) => {
    try {
      const normCurrent = normalizeUrl(currentUrl);
      const already = profileData.urls.some(u => normalizeUrl(u) === normCurrent);
      if (!already) {
        const profiles = await retrieveChunkedData(STORAGE_CONFIG.SITE_PROFILES_KEY) || {};
        if (profiles[profileId]) {
          profiles[profileId].urls.push(currentUrl);
          profiles[profileId].updatedAt = new Date().toISOString();
          await storeChunkedData(STORAGE_CONFIG.SITE_PROFILES_KEY, profiles);
        }
        sendResponse({ ...r, siteAdded: true });
      } else {
        sendResponse({ ...r, siteAdded: false });
      }
    } catch(e) { sendResponse({ ...r, siteAdded: false, error: e.message }); }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile CRUD
// ─────────────────────────────────────────────────────────────────────────────
async function getProfilesForSite(url, sendResponse) {
  try {
    const profiles = await retrieveChunkedData(STORAGE_CONFIG.SITE_PROFILES_KEY) || {};
    const matching = Object.values(profiles)
        .filter(p => p.urls && p.urls.some(u => urlMatches(url, u)))
        .map(p => ({ id: p.id, label: p.label, multiEntry: p.multiEntry||false,
          fieldCount: (p.fields||[]).length, entryCount: p.multiEntry ? (p.entries||[]).length : 1,
          urlCount: p.urls.length }));
    sendResponse({ success: true, profiles: matching });
  } catch(e) { sendResponse({ error: e.message }); }
}

async function deleteProfile(profileId, sendResponse) {
  try {
    const profiles = await retrieveChunkedData(STORAGE_CONFIG.SITE_PROFILES_KEY) || {};
    delete profiles[profileId];
    await storeChunkedData(STORAGE_CONFIG.SITE_PROFILES_KEY, profiles);
    sendResponse({ success: true, message: 'Profile deleted' });
  } catch(e) { sendResponse({ error: e.message }); }
}

async function getFullProfileData(profileId, sendResponse) {
  try {
    const profiles = await retrieveChunkedData(STORAGE_CONFIG.SITE_PROFILES_KEY) || {};
    const p = profiles[profileId];
    p ? sendResponse({ success: true, profile: p }) : sendResponse({ success: false, error: 'Not found' });
  } catch(e) { sendResponse({ error: e.message }); }
}

async function getGlobalProfile(sendResponse) {
  try {
    const p = await retrieveChunkedData(STORAGE_CONFIG.GLOBAL_PROFILE_KEY);
    p ? sendResponse({ success: true, profile: p }) : sendResponse({ success: false });
  } catch(e) { sendResponse({ error: e.message }); }
}

async function saveGlobalProfile(formData, sendResponse) {
  try {
    await storeChunkedData(STORAGE_CONFIG.GLOBAL_PROFILE_KEY, {
      label: 'Global Autofill Profile', fields: formData,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    sendResponse({ success: true, message: 'Global profile saved' });
  } catch(e) { sendResponse({ error: e.message }); }
}

async function useGlobalProfile(tabId, sendResponse) {
  try {
    const p = await retrieveChunkedData(STORAGE_CONFIG.GLOBAL_PROFILE_KEY);
    if (!p) { sendResponse({ success: false, error: 'No global profile' }); return; }
    sendToTab(tabId, { action: 'autofillForm', formData: p.fields }, sendResponse);
  } catch(e) { sendResponse({ error: e.message }); }
}

async function deleteGlobalProfile(sendResponse) {
  try {
    await removeChunkedData(STORAGE_CONFIG.GLOBAL_PROFILE_KEY);
    sendResponse({ success: true, message: 'Global profile deleted' });
  } catch(e) { sendResponse({ error: e.message }); }
}

async function getAllSiteProfiles(sendResponse) {
  try {
    const profiles = await retrieveChunkedData(STORAGE_CONFIG.SITE_PROFILES_KEY) || {};
    sendResponse({ success: true, profiles });
  } catch(e) { sendResponse({ error: e.message }); }
}

async function updateGlobalProfile(updateData, sendResponse) {
  try {
    const cur = await retrieveChunkedData(STORAGE_CONFIG.GLOBAL_PROFILE_KEY);
    if (!cur) { sendResponse({ success: false, error: 'Not found' }); return; }
    await storeChunkedData(STORAGE_CONFIG.GLOBAL_PROFILE_KEY, {
      ...cur, label: updateData.label||cur.label, fields: updateData.fields||cur.fields,
      updatedAt: updateData.updatedAt||new Date().toISOString() });
    sendResponse({ success: true });
  } catch(e) { sendResponse({ success: false, error: e.message }); }
}

async function updateSiteProfile(profileId, updateData, sendResponse) {
  try {
    const profiles = await retrieveChunkedData(STORAGE_CONFIG.SITE_PROFILES_KEY) || {};
    if (!profiles[profileId]) { sendResponse({ success: false, error: 'Not found' }); return; }
    profiles[profileId] = { ...profiles[profileId],
      label:  updateData.label  || profiles[profileId].label,
      urls:   updateData.urls   || profiles[profileId].urls,
      fields: updateData.fields || profiles[profileId].fields,
      updatedAt: updateData.updatedAt || new Date().toISOString() };
    await storeChunkedData(STORAGE_CONFIG.SITE_PROFILES_KEY, profiles);
    sendResponse({ success: true });
  } catch(e) { sendResponse({ success: false, error: e.message }); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage utilities
// ─────────────────────────────────────────────────────────────────────────────
function chunkData(data, maxSize = STORAGE_CONFIG.MAX_ITEM_SIZE) {
  const str = JSON.stringify(data).replace(/\s+/g,' ').trim();
  const chunks = [];
  for (let i = 0; i < str.length; i += maxSize) chunks.push(str.slice(i, i+maxSize));
  return chunks;
}

function reconstructData(chunks) { try { return JSON.parse(chunks.join('')); } catch { return null; } }

async function storeChunkedData(keyPrefix, data) {
  return new Promise((resolve, reject) => {
    const chunks = chunkData(data), storageObj = {}, chunkKeys = [];
    chrome.storage.local.get(null, (allItems) => {
      const toRemove = Object.keys(allItems).filter(k => k.startsWith(STORAGE_CONFIG.CHUNK_PREFIX + keyPrefix));
      const store = () => {
        chunks.forEach((chunk, idx) => { const key = `${STORAGE_CONFIG.CHUNK_PREFIX}${keyPrefix}_${idx}`; chunkKeys.push(key); storageObj[key] = chunk; });
        storageObj[`${keyPrefix}_meta`] = { chunkKeys, totalChunks: chunks.length, timestamp: Date.now() };
        chrome.storage.local.set(storageObj, () => chrome.runtime.lastError ? reject(chrome.runtime.lastError) : resolve());
      };
      toRemove.length ? chrome.storage.local.remove(toRemove, () => chrome.runtime.lastError ? reject(chrome.runtime.lastError) : store()) : store();
    });
  });
}

async function retrieveChunkedData(keyPrefix) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get([`${keyPrefix}_meta`], (result) => {
      if (chrome.runtime.lastError) { reject(chrome.runtime.lastError); return; }
      const meta = result[`${keyPrefix}_meta`];
      if (!meta) { resolve(null); return; }
      chrome.storage.local.get(meta.chunkKeys, (chunkData) => {
        if (chrome.runtime.lastError) { reject(chrome.runtime.lastError); return; }
        const chunks = [];
        for (let i = 0; i < meta.totalChunks; i++) { const v = chunkData[meta.chunkKeys[i]]; if (!v) { reject(new Error('Missing chunk')); return; } chunks.push(v); }
        resolve(reconstructData(chunks));
      });
    });
  });
}

async function removeChunkedData(keyPrefix) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get([`${keyPrefix}_meta`], (result) => {
      if (chrome.runtime.lastError) { reject(chrome.runtime.lastError); return; }
      const meta = result[`${keyPrefix}_meta`];
      if (!meta) { resolve(); return; }
      chrome.storage.local.remove([...meta.chunkKeys, `${keyPrefix}_meta`], () => chrome.runtime.lastError ? reject(chrome.runtime.lastError) : resolve());
    });
  });
}

function generateProfileId() { return 'profile_' + Date.now() + '_' + Math.random().toString(36).substr(2,9); }
function normalizeUrl(url) { try { const u = new URL(url); return u.hostname + u.pathname; } catch { return url; } }
function urlMatches(current, profileUrl) {
  try {
    const c = new URL(current), p = new URL(profileUrl);
    if (current === profileUrl) return true;
    if (c.hostname === p.hostname && c.pathname === p.pathname) return true;
    if (c.hostname === p.hostname && c.pathname.startsWith(p.pathname)) return true;
    return false;
  } catch { return false; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Page load: auto-fill entry 0 AND load multi-entry intercept
// ─────────────────────────────────────────────────────────────────────────────
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url || (!tab.url.startsWith('http://') && !tab.url.startsWith('https://'))) return;
  setTimeout(() => checkAndAutoFill(tabId, tab.url), 1500);
});

async function checkAndAutoFill(tabId, url) {
  try {
    const global = await retrieveChunkedData(STORAGE_CONFIG.GLOBAL_PROFILE_KEY);
    if (global) {
      sendToTab(tabId, { action: 'autofillForm', formData: global.fields, isAutomatic: true }, () => {});
      return;
    }

    const profiles = await retrieveChunkedData(STORAGE_CONFIG.SITE_PROFILES_KEY) || {};
    const match = Object.values(profiles).find(p => p.urls && p.urls.some(u => urlMatches(url, u)));
    if (!match) return;

    if (match.multiEntry && Array.isArray(match.entries)) {
      // Step 1: Fill entry 0 + non-array fields immediately
      const entry0Fields = [...(match.nonArrayFields||[]), ...(match.entries[0]||[])];
      sendToTab(tabId, { action: 'autofillForm', formData: entry0Fields, isAutomatic: true }, () => {});

      // Step 2: Load the intercept so ADD MORE clicks auto-fill subsequent entries
      await sleep(500);
      sendToTab(tabId, {
        action: 'loadMultiEntryProfile',
        entries:        match.entries,
        nonArrayFields: match.nonArrayFields || [],
        arrayPrefix:    match.arrayPrefix    || null,
      }, () => {});
    } else {
      sendToTab(tabId, { action: 'autofillForm', formData: match.fields, isAutomatic: true }, () => {});
    }
  } catch(e) { console.error('[Autofill] checkAndAutoFill:', e); }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }