document.addEventListener('DOMContentLoaded', function() {
  const modeRadios = document.querySelectorAll('input[name="mode"]');
  const apiKeyInput = document.getElementById('apiKey');
  const statusDiv = document.getElementById('status');

  // Load saved settings
  loadSettings();

  // Add event listeners
  modeRadios.forEach(radio => {
    radio.addEventListener('change', saveSettings);
  });

  apiKeyInput.addEventListener('input', saveSettings);

  function loadSettings() {
    chrome.storage.sync.get(['hotelRatingMode', 'geminiApiKey'], function(result) {
      const mode = result.hotelRatingMode || 'off';
      const apiKey = result.geminiApiKey || '';
      
      // Set radio button
      document.querySelector(`input[name="mode"][value="${mode}"]`).checked = true;
      
      // Set API key
      apiKeyInput.value = apiKey;
      
      // Show status if API key is missing
      if (!apiKey && mode !== 'off') {
        showStatus('Please enter your Gemini API key to use this extension', 'error');
      }
    });
  }

  function saveSettings() {
    const selectedMode = document.querySelector('input[name="mode"]:checked').value;
    const apiKey = apiKeyInput.value.trim();

    chrome.storage.sync.set({
      hotelRatingMode: selectedMode,
      geminiApiKey: apiKey
    }, function() {
      if (selectedMode === 'off') {
        showStatus('Extension disabled', 'success');
        // Disable content script
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
          chrome.scripting.executeScript({
            target: {tabId: tabs[0].id},
            function: disableRatingFetcher
          });
        });
      } else if (apiKey) {
        showStatus('Settings saved successfully', 'success');
        // Enable content script
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
          chrome.scripting.executeScript({
            target: {tabId: tabs[0].id},
            function: enableRatingFetcher
          });
        });
      } else {
        showStatus('Please enter your Gemini API key', 'error');
      }
    });
  }

  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.style.display = 'block';
    
    setTimeout(() => {
      statusDiv.style.display = 'none';
    }, 3000);
  }
});

// Functions to be injected into content script
function disableRatingFetcher() {
  // Remove any existing rating widgets
  const existingWidgets = document.querySelectorAll('.hotel-rating-widget');
  existingWidgets.forEach(widget => widget.remove());
  
  // Remove click listeners
  document.removeEventListener('click', handleHotelClick);
}

function enableRatingFetcher() {
  // This will be handled by the content script
  console.log('Hotel Rating Fetcher enabled');
}
