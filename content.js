// Hotel Rating Fetcher Content Script
(function() {
  'use strict';

  let isEnabled = false;
  let currentMode = 'off';
  let isProcessing = false;
  let lastProcessedHotel = '';

  // Initialize the content script
  function init() {
    // Load settings
    chrome.storage.sync.get(['hotelRatingMode', 'geminiApiKey'], function(result) {
      currentMode = result.hotelRatingMode || 'off';
      const apiKey = result.geminiApiKey || '';
      
      if (currentMode !== 'off' && apiKey) {
        enableRatingFetcher();
      } else {
        disableRatingFetcher();
      }
    });

    // Listen for settings changes
    chrome.storage.onChanged.addListener(function(changes, namespace) {
      if (changes.hotelRatingMode || changes.geminiApiKey) {
        currentMode = changes.hotelRatingMode?.newValue || currentMode;
        const apiKey = changes.geminiApiKey?.newValue || '';
        
        if (currentMode !== 'off' && apiKey) {
          enableRatingFetcher();
        } else {
          disableRatingFetcher();
        }
      }
    });
  }

  function enableRatingFetcher() {
    if (isEnabled) return;
    
    isEnabled = true;
    console.log('Hotel Rating Fetcher enabled with mode:', currentMode);

    if (currentMode === 'continuous') {
      // Auto-detect hotel names on page load and changes
      detectAndProcessHotel();
      
      // Watch for page changes (for SPAs)
      const observer = new MutationObserver(function(mutations) {
        if (!isProcessing) {
          detectAndProcessHotel();
        }
      });
      
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    } else if (currentMode === 'onclick') {
      // Add click listener for manual triggering
      document.addEventListener('click', handleHotelClick, true);
    }
  }

  function disableRatingFetcher() {
    if (!isEnabled) return;
    
    isEnabled = false;
    console.log('Hotel Rating Fetcher disabled');
    
    // Remove existing widgets
    const existingWidgets = document.querySelectorAll('.hotel-rating-widget');
    existingWidgets.forEach(widget => widget.remove());
    
    // Remove event listeners
    document.removeEventListener('click', handleHotelClick, true);
  }

  function detectAndProcessHotel() {
    if (isProcessing || currentMode !== 'continuous') return;
    
    const hotelName = extractHotelName();
    if (hotelName && hotelName !== lastProcessedHotel) {
      lastProcessedHotel = hotelName;
      processHotel(hotelName);
    }
  }

  function handleHotelClick(event) {
    if (currentMode !== 'onclick' || isProcessing) return;
    
    // Check if click is on a hotel-related element
    const hotelName = extractHotelNameFromElement(event.target);
    if (hotelName) {
      processHotel(hotelName);
    }
  }

  function extractHotelName() {
    // Common selectors for hotel names on various OTT websites
    const selectors = [
      'h1[data-testid*="hotel"]',
      'h1[class*="hotel"]',
      'h1[class*="property"]',
      'h1[class*="title"]',
      '.hotel-name',
      '.property-name',
      '.hotel-title',
      '.property-title',
      '[data-testid*="hotel-name"]',
      '[data-testid*="property-name"]',
      'h1',
      'h2[class*="hotel"]',
      'h2[class*="property"]'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent.trim()) {
        const text = element.textContent.trim();
        if (isValidHotelName(text)) {
          return text;
        }
      }
    }

    // Fallback: look for hotel-related keywords in page title
    const title = document.title;
    if (title && isHotelRelated(title)) {
      return title;
    }

    return null;
  }

  function extractHotelNameFromElement(element) {
    // Walk up the DOM tree to find hotel name
    let current = element;
    while (current && current !== document.body) {
      const text = current.textContent?.trim();
      if (text && isValidHotelName(text) && text.length < 100) {
        return text;
      }
      current = current.parentElement;
    }
    return null;
  }

  function isValidHotelName(text) {
    if (!text || text.length < 3 || text.length > 200) return false;
    
    // Check for hotel-related keywords
    const hotelKeywords = [
      'hotel', 'resort', 'inn', 'lodge', 'suite', 'villa', 'palace',
      'spa', 'boutique', 'hostel', 'guesthouse', 'bed and breakfast',
      'accommodation', 'property', 'stay', 'booking'
    ];
    
    const lowerText = text.toLowerCase();
    return hotelKeywords.some(keyword => lowerText.includes(keyword)) ||
           isHotelRelated(text);
  }

  function isHotelRelated(text) {
    const lowerText = text.toLowerCase();
    const patterns = [
      /\b(hotel|resort|inn|lodge|suite|villa|palace|spa|boutique|hostel|guesthouse)\b/i,
      /\b(accommodation|property|stay|booking)\b/i,
      /\b(rooms?|suites?|villas?)\b/i
    ];
    
    return patterns.some(pattern => pattern.test(text));
  }

  function processHotel(hotelName) {
    if (isProcessing) return;
    
    isProcessing = true;
    console.log('Processing hotel:', hotelName);

    // Remove existing widgets
    const existingWidgets = document.querySelectorAll('.hotel-rating-widget');
    existingWidgets.forEach(widget => widget.remove());

    // Show loading widget
    showLoadingWidget();

    // Send message to background script
    chrome.runtime.sendMessage({
      action: 'fetchHotelRating',
      hotelName: hotelName
    }, function(response) {
      isProcessing = false;
      
      if (response && response.success) {
        showRatingWidget(response.data);
      } else {
        showErrorWidget(response?.error || 'Failed to fetch rating');
      }
    });
  }

  function showLoadingWidget() {
    const widget = createWidget();
    widget.innerHTML = `
      <div class="loading-content">
        <div class="spinner"></div>
        <p>Fetching Google rating...</p>
      </div>
    `;
    document.body.appendChild(widget);
  }

  function showRatingWidget(data) {
    const widget = createWidget();
    widget.innerHTML = `
      <div class="rating-content">
        <div class="header">
          <h3>🏨 ${data.hotelName}</h3>
          <button class="close-btn">&times;</button>
        </div>
        <div class="rating-info">
          <div class="rating-score">
            <span class="rating-number">${data.rating}</span>
            <span class="rating-stars">${generateStars(data.rating)}</span>
            <span class="rating-count">(${data.totalReviews} reviews)</span>
          </div>
          <div class="recent-reviews">
            <h4>Recent Reviews:</h4>
            <div class="reviews-list">
              ${data.recentReviews.map(review => `
                <div class="review-item">
                  <div class="review-header">
                    <span class="reviewer-name">${review.author}</span>
                    <span class="review-rating">${generateStars(review.rating)}</span>
                    <span class="review-date">${review.date}</span>
                  </div>
                  <p class="review-text">${review.text}</p>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;
    
    // Add close button functionality
    widget.querySelector('.close-btn').addEventListener('click', () => {
      widget.remove();
    });
    
    document.body.appendChild(widget);
  }

  function showErrorWidget(error) {
    const widget = createWidget();
    widget.innerHTML = `
      <div class="error-content">
        <div class="header">
          <h3>❌ Error</h3>
          <button class="close-btn">&times;</button>
        </div>
        <p>${error}</p>
      </div>
    `;
    
    widget.querySelector('.close-btn').addEventListener('click', () => {
      widget.remove();
    });
    
    document.body.appendChild(widget);
  }

  function createWidget() {
    const widget = document.createElement('div');
    widget.className = 'hotel-rating-widget';
    return widget;
  }

  function generateStars(rating) {
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 !== 0;
    const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);
    
    return '★'.repeat(fullStars) + 
           (hasHalfStar ? '☆' : '') + 
           '☆'.repeat(emptyStars);
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
