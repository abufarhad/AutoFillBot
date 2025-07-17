# Form Autofill Saver - Chrome Extension

A Chrome extension that allows you to save filled form data with custom labels and automatically autofill forms on subsequent visits to the same site. This extension works exactly like Lightning Autofill but with enhanced features including automatic form filling and multi-site support.

## Features

- **Manual Form Data Capture**: Fill out forms manually, then save the data with a custom label
- **🆕 Global Profile Support**: Save a single global profile that works on any site
- **🆕 Dashboard Management**: View and edit all saved profiles (global and site-specific) in a dedicated dashboard
- **🆕 Automatic Form Filling**: Automatically fills forms when visiting matching sites (no need to click the extension)
- **🆕 Multi-Site Support**: Associate a single form profile with multiple URLs for broader compatibility
- **🆕 Dynamic Site Addition**: Click any saved profile to autofill AND automatically add the current site to that profile
- **Site-Specific Storage**: Form data is automatically associated with the current website
- **Multiple Profiles per Site**: Save multiple form profiles for the same website with different labels
- **Smart Element Matching**: Automatically finds form elements using multiple strategies (ID, name, placeholder, CSS selector)
- **Chrome Sync Storage**: Your saved form profiles sync across all your Chrome browsers
- **One-Click Manual Autofill**: Easily autofill forms with previously saved data via the popup
- **Profile Management**: Edit and delete saved profiles as needed
- **Real-time Form Detection**: Automatically detects filled form fields on the current page

## How It Works

### Saving Form Data

1. **Fill out a form manually** on any website
2. **Click the extension icon** in the Chrome toolbar
3. **Enter a label/name** for this form profile (e.g., "Personal Info", "Work Application")
4. **🆕 Optionally add additional URLs** where this profile should work (one per line)
5. **Click "Save Form Data"** to store the filled form data
6. The extension automatically captures all filled form fields and associates them with the specified URLs

### Dashboard Management (New!)

1. **Click the extension icon**
2. **Click "Manage Profiles"** button in the popup
3. **View all saved profiles** in a dedicated dashboard tab
4. **Edit any profile** by clicking the "Edit" button
5. **Modify profile details**:
   - Change profile label
   - Add/remove URLs (for site-specific profiles)
   - Edit individual form field values
   - Add or remove form fields
6. **Delete profiles** you no longer need

**Dashboard Features:**
- Clean, organized view of all profiles
- Separate sections for global and site-specific profiles
- Real-time editing with immediate save
- Field-by-field editing capabilities
- URL management for site-specific profiles

### Global Profile (New!)

1. **Fill out any form** on any website with your standard information
2. **Click the extension icon**
3. **Click "Save as Global Profile"** in the Global Profile section
4. **Visit any other site** with forms
5. **Forms automatically fill** using your global profile data
6. **Or click "Use Global Profile"** to manually trigger autofill

**Benefits of Global Profile:**
- Works on any site without configuration
- No need to manage site-specific profiles for basic information
- Perfect for personal details like name, email, phone, address
- Automatically prioritized over site-specific profiles

### Automatic Form Filling (New!)

1. **Visit any website** where you have saved form profiles
2. **The extension automatically detects** if you have matching profiles for the current site
3. **Forms are automatically filled** within 1 second of page load
4. **A notification appears** showing how many fields were auto-filled

### Dynamic Site Addition (New!)

1. **Visit a new site** where you want to use an existing form profile
2. **Click the extension icon** to see your saved profiles
3. **Click "Autofill"** next to any existing profile
4. **The extension will**:
   - Fill the form with the saved data
   - Automatically add the current site to that profile's URL list
   - Show a message confirming both actions
5. **Future visits** to this site will now automatically use this profile

This feature is perfect for:
- Using your "Personal Info" profile on a new job application site
- Applying your "Government Forms" profile to a new government portal
- Extending any existing profile to work on similar sites

### Multi-Site Support (New!)

When saving a form profile, you can specify additional URLs where the same profile should work:

```
https://example.com/login
https://sub.example.com/signin
https://another-site.com/auth
```

The extension will automatically fill forms on all these sites using the same saved data.

## Installation

1. Download or clone this extension
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked" and select the extension directory
5. The Form Autofill Saver extension should now appear in your extensions list

## Usage Examples

### Example 1: Job Application Form with Multi-Site Support
1. Fill out a job application form with your personal details
2. Save it with the label "Job Application - Software Engineer"
3. Add additional URLs like:
   - `https://careers.company1.com/apply`
   - `https://jobs.company2.com/application`
   - `https://company3.com/careers/apply`
4. The extension will automatically fill similar forms on all these sites

### Example 2: Registration Forms
1. Fill out a registration form with your standard information
2. Save it with the label "Standard Registration"
3. Add common registration URLs for sites you frequently use
4. Forms will be automatically filled when you visit these sites

### Example 3: Government Forms
1. Fill out a government application form
2. Save it with the label "Government Application"
3. Add URLs for different government portals that use similar forms
4. Automatically fill forms across multiple government websites

## Supported Form Elements

The extension works with all common form input types:

- **Text inputs** (text, email, password, tel, url, search, number)
- **Date/time inputs** (date, datetime-local, month, time, week)
- **Checkboxes and radio buttons**
- **Select dropdowns**
- **Textareas**

## File Structure

```
form-autofill-extension/
├── manifest.json          # Extension manifest (Manifest V3)
├── popup.html             # Extension popup UI
├── popup.js               # Popup functionality
├── background.js          # Background service worker with auto-fill
├── content_script.js      # Content script for form interaction
├── icon16.png            # 16x16 extension icon
├── icon48.png            # 48x48 extension icon
├── icon128.png           # 128x128 extension icon
└── README.md             # This file
```

## Technical Details

### Permissions

- `storage`: For saving form profiles to Chrome storage
- `activeTab`: For interacting with the current active tab
- `scripting`: For injecting content scripts
- `tabs`: For listening to tab updates for automatic autofill
- `<all_urls>`: For running content scripts on all websites

### Storage Structure

Form profiles are stored in Chrome's sync storage with the following structure:

```javascript
{
  "formProfiles": {
    "profile_1234567890_abc123": {
      "id": "profile_1234567890_abc123",
      "label": "My Login Profile",
      "urls": [
        "https://example.com/login.html",
        "https://sub.example.com/signin",
        "https://another-site.com/auth"
      ],
      "fields": [
        {
          "selector": "#username",
          "value": "myusername",
          "type": "text",
          "name": "username",
          "id": "username"
        }
      ],
      "createdAt": "2025-01-01T00:00:00.000Z",
      "updatedAt": "2025-01-01T00:00:00.000Z"
    }
  }
}
```

### Automatic Autofill Logic

1. **Tab Update Detection**: The extension listens for `chrome.tabs.onUpdated` events
2. **URL Matching**: When a page loads, it checks if any saved profile URLs match the current page
3. **Automatic Filling**: If a match is found, the extension automatically fills the form after a 1-second delay
4. **User Notification**: A notification appears showing the number of fields filled

### URL Matching Strategy

The extension uses flexible URL matching:

1. **Exact URL match**: `https://example.com/login` matches exactly
2. **Domain + path match**: `https://example.com/login` matches `https://example.com/login?param=value`
3. **Path prefix match**: `https://example.com/app` matches `https://example.com/app/login`

### Element Matching Strategy

The extension uses a multi-layered approach to find form elements:

1. **Primary selector** (ID, name, or generated CSS selector)
2. **Name attribute** matching
3. **ID attribute** matching
4. **Placeholder attribute** matching

This ensures maximum compatibility across different websites and form structures.

### Event Triggering

After filling form fields, the extension triggers appropriate DOM events:
- `input` events for text inputs and textareas
- `change` events for all form elements
- `click` events for checkboxes and radio buttons

This ensures that dynamic forms and JavaScript validation work correctly.

## Privacy & Security

- **No data tracking**: The extension does not track your browsing or send data to external servers
- **Local storage only**: All form data is stored locally in Chrome's storage
- **Chrome Sync**: Data syncs across your Chrome browsers when signed in to Chrome
- **No password encryption**: Form data is stored as plain text, so use caution with sensitive information

## Troubleshooting

### Forms not auto-filling
- Check if you have saved profiles for the current site
- Verify that the URL patterns in your saved profiles match the current site
- Try refreshing the page if auto-fill doesn't work immediately

### Form fields not being detected
- Make sure the form fields have values before clicking the extension icon
- The extension only captures fields that contain data

### Manual autofill not working
- Check if the form structure has changed since you saved the profile
- Try deleting and re-saving the profile if the website has been updated
- Some dynamic forms may require manual interaction after autofill

### Extension not appearing
- Make sure Developer mode is enabled in Chrome extensions
- Check that the extension is enabled in the extensions list
- Try reloading the extension if you made any changes

## What's New in This Version

### 🆕 Dashboard Management
- Dedicated dashboard to view and edit all saved profiles
- Clean, organized interface with separate sections for global and site-specific profiles
- Edit profile labels, URLs, and individual form field values
- Add or remove form fields from existing profiles
- Delete profiles you no longer need
- Access via "Manage Profiles" button in the popup

### 🆕 Global Profile Support
- Save a single "Global Profile" that works on any website
- Perfect for personal information like name, email, phone, address
- Automatically prioritized over site-specific profiles during autofill
- No need to configure URLs - works everywhere
- One-click manual autofill with "Use Global Profile" button

### 🆕 Dynamic Site Addition
- Click any saved profile to autofill the current form AND add the current site to that profile
- Perfect for extending existing profiles to work on new, similar sites
- Automatically updates the profile's URL list for future automatic autofill
- Shows confirmation message when a site is added to a profile

### 🆕 Automatic Form Filling
- Forms are now automatically filled when you visit matching sites
- No need to click the extension icon for basic autofill
- 1-second delay ensures pages are fully loaded before filling

### 🆕 Multi-Site Support
- Associate a single form profile with multiple URLs
- Perfect for sites with similar forms across different domains
- Supports government portals, job sites, and corporate applications

### 🆕 Enhanced URL Matching
- Flexible URL matching supports various URL patterns
- Works with query parameters and path variations
- Better compatibility across different site structures

### 🆕 Improved User Experience
- Clear notifications for automatic vs manual autofill
- Better error handling and user feedback
- Enhanced popup UI with URL count display

## Development

To modify or extend this extension:

1. Make changes to the source files
2. Reload the extension in `chrome://extensions/`
3. Test the changes on various websites

## License

This project is open source and available under the MIT License.

## Support

For issues, questions, or feature requests, please refer to the extension's documentation or create an issue in the project repository.

