document.addEventListener('DOMContentLoaded', function() {
  const apiKeyInput = document.getElementById('apiKey');
  const statusDiv = document.getElementById('status');
  const testAndSaveBtn = document.getElementById('testAndSaveBtn');

  // Load saved settings
  loadSettings();

  // Add event listener for test and save button
  testAndSaveBtn.addEventListener('click', testAndSaveApiKey);

  function loadSettings() {
    chrome.storage.sync.get(['geminiApiKey'], function(result) {
      const apiKey = result.geminiApiKey || '';
      
      // Set API key if it exists
      if (apiKey) {
        apiKeyInput.value = apiKey;
        showStatus('API key loaded. Click "Test & Save" to verify it still works.', 'success');
      }
    });
  }

  async function testAndSaveApiKey() {
    const apiKey = apiKeyInput.value.trim();
    
    if (!apiKey) {
      showStatus('Please enter your Gemini API key', 'error');
      return;
    }

    // Disable button and show testing state
    testAndSaveBtn.disabled = true;
    testAndSaveBtn.textContent = 'Testing...';
    testAndSaveBtn.classList.add('testing');
    showStatus('Testing API key...', 'success');

    try {
      // Test the API key with a simple request
      const testResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: 'Say "OK" if you can read this.'
            }]
          }],
          generationConfig: {
            maxOutputTokens: 10,
          }
        })
      });

      if (!testResponse.ok) {
        const errorData = await testResponse.json();
        throw new Error(errorData.error?.message || 'API key validation failed');
      }

      // API key is valid, save it
      chrome.storage.sync.set({
        geminiApiKey: apiKey
      }, function() {
        showStatus('✅ API key validated and saved successfully!', 'success');
        testAndSaveBtn.textContent = 'Test & Save API Key';
        testAndSaveBtn.classList.remove('testing');
        testAndSaveBtn.disabled = false;
      });

    } catch (error) {
      showStatus(`❌ API key test failed: ${error.message}`, 'error');
      testAndSaveBtn.textContent = 'Test & Save API Key';
      testAndSaveBtn.classList.remove('testing');
      testAndSaveBtn.disabled = false;
    }
  }

  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.style.display = 'block';
    
    // Keep success messages longer, error messages shorter
    const timeout = type === 'success' ? 5000 : 4000;
    setTimeout(() => {
      statusDiv.style.display = 'none';
    }, timeout);
  }
});
