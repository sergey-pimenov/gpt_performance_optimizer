(function() {
  'use strict';

  const tailInput = document.getElementById('tailCount');
  const enableToggle = document.getElementById('enableToggle');
  const logToggle = document.getElementById('logToggle');
  const pageToggleGroup = document.getElementById('pageToggleGroup');
  const pageEnableToggle = document.getElementById('pageEnableToggle');
  const saveBtn = document.getElementById('saveBtn');
  const statusMsg = document.getElementById('statusMsg');
  let activeTabId = null;
  let activeConvId = null;

  // Load current settings
  function loadSettings() {
    chrome.storage.sync.get(['defaultTail', 'optimizerEnabled', 'logVerbose'], (result) => {
      const defaultTail = result.defaultTail || 10;
      const enabled = result.optimizerEnabled !== false; // default: true
      const verbose = result.logVerbose === true;

      tailInput.value = defaultTail;
      
      const tailCountGroup = document.getElementById('tailCountGroup');
      if (enabled) {
        enableToggle.classList.add('active');
        tailCountGroup.classList.remove('disabled-overlay');
        tailInput.disabled = false;
      } else {
        enableToggle.classList.remove('active');
        tailCountGroup.classList.add('disabled-overlay');
        tailInput.disabled = true;
      }

      // Set verbose toggle
      if (verbose) logToggle.classList.add('active');
      else logToggle.classList.remove('active');
    });

    // Initialize per-page toggle (only when a conversation tab is active)
    initPerPageToggle();
  }

  // Save settings
  function saveSettings() {
    const tailCount = parseInt(tailInput.value, 10);
    
    // Validate input
    if (isNaN(tailCount) || tailCount < 10 || tailCount > 800) {
      showStatus('Please enter a number between 10 and 800', false);
      return;
    }

    const enabled = enableToggle.classList.contains('active');
    const verbose = logToggle.classList.contains('active');

    chrome.storage.sync.set({
      defaultTail: tailCount,
      optimizerEnabled: enabled,
      logVerbose: verbose
    }, () => {
      showStatus('Settings saved! Reloading ChatGPT tabs...', true);
      
      // Notify all ChatGPT tabs about settings change
      chrome.tabs.query({url: ['https://chatgpt.com/*', 'https://chat.openai.com/*']}, (tabs) => {
        const settings = { defaultTail: tailCount, optimizerEnabled: enabled, logVerbose: verbose };
        
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, {
            type: 'settings-updated',
            settings: settings
          }).catch(() => {
            // Ignore errors - some tabs may not have loaded yet
          });
        });
        
        // Close popup after a short delay
        setTimeout(() => {
          window.close();
        }, 1500);
      });
    });
  }

  // Show status message
  function showStatus(message, isSuccess) {
    statusMsg.textContent = message;
    statusMsg.className = 'status-message ' + (isSuccess ? 'success' : 'error');
    statusMsg.style.display = 'block';
    
    setTimeout(() => {
      statusMsg.style.display = 'none';
    }, 3000);
  }

  // Toggle switch click handler
  enableToggle.addEventListener('click', () => {
    enableToggle.classList.toggle('active');
    
    // Disable/enable tail count input based on optimizer state
    const tailCountGroup = document.getElementById('tailCountGroup');
    if (!enableToggle.classList.contains('active')) {
      tailCountGroup.classList.add('disabled-overlay');
      tailInput.disabled = true;
    } else {
      tailCountGroup.classList.remove('disabled-overlay');
      tailInput.disabled = false;
    }
  });

  // Verbose logs toggle handler
  logToggle.addEventListener('click', () => {
    logToggle.classList.toggle('active');
  });

  // Per-page toggle handler
  pageEnableToggle?.addEventListener('click', () => {
    if (!activeTabId) return;
    const turnOn = !pageEnableToggle.classList.contains('active');
    chrome.tabs.sendMessage(activeTabId, {
      type: 'override:set',
      convId: activeConvId,
      value: turnOn ? 'on' : 'off'
    }, () => {
      // Ignore errors; content script will reload page if present
      const err = chrome.runtime.lastError; // eslint-disable-line no-unused-vars
      showStatus('Applied to this chat. Reloading…', true);
      setTimeout(() => { try { chrome.tabs.reload(activeTabId); } catch(e){} window.close(); }, 600);
    });
  });

  function initPerPageToggle(){
    try {
      pageToggleGroup.style.display = 'none';
    } catch{}
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id || !tab.url) return;
      const url = tab.url;
      // Only show for conversation routes
      const m = url.match(/\/(?:c|share)\/([0-9a-f-]{36})/i);
      if (!m) return;
      activeTabId = tab.id;
      activeConvId = m[1];

      chrome.tabs.sendMessage(activeTabId, { type: 'override:get', convId: activeConvId }, (resp) => {
        if (chrome.runtime.lastError || !resp || resp.ok !== true) {
          // If no receiver (e.g., content script not injected), keep hidden
          return;
        }
        pageToggleGroup.style.display = 'block';
        if (resp.effective) pageEnableToggle.classList.add('active');
        else pageEnableToggle.classList.remove('active');
      });
    });
  }

  // Save button click handler
  saveBtn.addEventListener('click', saveSettings);

  // Load settings on popup open
  loadSettings();
})();
