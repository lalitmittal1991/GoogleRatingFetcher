// Hotel Rating Fetcher Content Script
(function() {
  'use strict';

  // Allowed websites
  const ALLOWED_SITES = ['booking.com', 'agoda.com', 'makemytrip.com', 'goibibo.com'];
  
  let isProcessing = false;
  let fetchButtons = new Set();

  // Check if current site is allowed
  function isAllowedSite() {
    const hostname = window.location.hostname.toLowerCase();
    return ALLOWED_SITES.some(site => hostname.includes(site));
  }

  // Initialize the content script
  function init() {
    // Only run on allowed sites
    if (!isAllowedSite()) {
      return;
    }

    // Load settings and initialize
    chrome.storage.sync.get(['geminiApiKey'], function(result) {
      const apiKey = result.geminiApiKey || '';
      
      if (apiKey) {
        enableRatingFetcher();
      } else {
        console.log('Hotel Rating Fetcher: API key not configured');
      }
    });

    // Listen for API key changes
    chrome.storage.onChanged.addListener(function(changes, namespace) {
      if (changes.geminiApiKey) {
        const apiKey = changes.geminiApiKey?.newValue || '';
        if (apiKey) {
          enableRatingFetcher();
        } else {
          disableRatingFetcher();
        }
      }
    });
  }

  function enableRatingFetcher() {
    console.log('Hotel Rating Fetcher enabled');
    
    // Add fetch buttons to listings and detail pages
    addFetchButtons();
    
    // Watch for page changes (for SPAs)
    const observer = new MutationObserver(function(mutations) {
      addFetchButtons();
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function disableRatingFetcher() {
    console.log('Hotel Rating Fetcher disabled');
    
    // Remove existing rating widgets
    const existingWidgets = document.querySelectorAll('.hotel-rating-widget');
    existingWidgets.forEach(widget => widget.remove());
    
    // Remove fetch buttons
    removeFetchButtons();
  }
  
  function addFetchButtons() {
    // Add buttons to hotel listings on list pages
    addButtonsToListings();
    
    // Add button to hotel detail pages
    addButtonToDetailPage();
  }
  
  function addButtonsToListings() {
    // Common selectors for hotel listings on different sites
    const listingSelectors = {
      'booking.com': [
        '[data-testid="property-card"]',
        '.sr_property_block',
        '.property-card'
      ],
      'agoda.com': [
        '.PropertyCardItem',
        '[data-selenium="hotel-item"]',
        '.hotel-item'
      ],
      'makemytrip.com': [
        '.hotelCard',
        '.listingCard',
        '[data-testid="hotel-card"]'
      ],
      'goibibo.com': [
        '.hotelCard',
        '.hotel-card',
        '[data-testid="hotel-card"]'
      ]
    };
    
    const hostname = window.location.hostname.toLowerCase();
    let selectors = [];
    
    for (const [site, siteSelectors] of Object.entries(listingSelectors)) {
      if (hostname.includes(site)) {
        selectors = siteSelectors;
        break;
      }
    }
    
    selectors.forEach(selector => {
      const listings = document.querySelectorAll(selector);
      listings.forEach(listing => {
        // Check if button already exists
        if (listing.querySelector('.hotel-fetch-rating-btn')) {
          return;
        }
        
        // Extract hotel name from listing
        const hotelName = extractHotelNameFromListing(listing);
        if (!hotelName) return;
        
        // Create fetch button
        const fetchBtn = createFetchButton(hotelName);
        listing.appendChild(fetchBtn);
        fetchButtons.add(fetchBtn);
      });
    });
  }
  
  function addButtonToDetailPage() {
    // Check if we're on a detail page
    const hotelName = extractHotelName();
    if (!hotelName) return;
    
    // Check if button already exists
    if (document.querySelector('.hotel-fetch-rating-btn-detail')) {
      return;
    }
    
    // Common locations for detail page buttons
    const buttonLocations = [
      'h1', // Usually near the hotel name
      '.hotel-header',
      '.property-header',
      '[data-testid="hotel-name"]',
      '.hotel-title'
    ];
    
    for (const selector of buttonLocations) {
      const element = document.querySelector(selector);
      if (element) {
        const fetchBtn = createFetchButton(hotelName, 'detail');
        // Insert after the element
        element.parentNode.insertBefore(fetchBtn, element.nextSibling);
        fetchButtons.add(fetchBtn);
        break;
      }
    }
  }
  
  function createFetchButton(hotelName, type = 'listing') {
    const btn = document.createElement('button');
    btn.className = `hotel-fetch-rating-btn ${type === 'detail' ? 'hotel-fetch-rating-btn-detail' : ''}`;
    btn.textContent = 'Fetch Ratings';
    btn.dataset.hotelName = hotelName;
    
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      e.preventDefault();
      processHotel(hotelName);
    });
    
    return btn;
  }
  
  function removeFetchButtons() {
    fetchButtons.forEach(btn => {
      if (btn.parentNode) {
        btn.parentNode.removeChild(btn);
      }
    });
    fetchButtons.clear();
  }
  
  function extractHotelNameFromListing(listing) {
    // Try to find hotel name within the listing element
    const nameSelectors = [
      'h3',
      'h2',
      '.hotel-name',
      '.property-name',
      '[data-testid*="name"]',
      '.title',
      'a[href*="hotel"]'
    ];
    
    for (const selector of nameSelectors) {
      const element = listing.querySelector(selector);
      if (element) {
        const text = element.textContent?.trim();
        if (text && isValidHotelName(text)) {
          return text;
        }
      }
    }
    
    return null;
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

  function extractLocation() {
    // Try to extract city and country from the page
    const locationSelectors = [
      '[data-testid*="location"]',
      '[data-testid*="address"]',
      '.location',
      '.address',
      '.city',
      '.country',
      '[class*="location"]',
      '[class*="address"]',
      '[class*="city"]',
      '[class*="country"]'
    ];
    
    let city = null;
    let country = null;
    
    // Try to find location elements
    for (const selector of locationSelectors) {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        const text = el.textContent?.trim().toLowerCase();
        if (text) {
          // Try to extract city and country from text
          const parts = text.split(',').map(p => p.trim());
          if (parts.length >= 2) {
            city = parts[0];
            country = parts[parts.length - 1];
            break;
          }
        }
      }
      if (city && country) break;
    }
    
    // Fallback: try to extract from URL or page title
    if (!city || !country) {
      const url = window.location.href.toLowerCase();
      const title = document.title.toLowerCase();
      
      // Common patterns
      const cityPatterns = [
        /in\s+([a-z\s]+?)(?:,|$)/i,
        /at\s+([a-z\s]+?)(?:,|$)/i
      ];
      
      const countryPatterns = [
        /,\s*([a-z\s]+?)(?:-|$)/i
      ];
      
      for (const pattern of cityPatterns) {
        const match = (url + ' ' + title).match(pattern);
        if (match && match[1]) {
          city = match[1].trim();
          break;
        }
      }
    }
    
    return { city, country };
  }
  
  function promptForLocation(hotelName, callback) {
    // Show a prompt widget to ask for location
    const promptWidget = createWidget();
    promptWidget.innerHTML = `
      <div class="prompt-content">
        <div class="header">
          <h3>📍 Location Required</h3>
          <button class="close-btn">&times;</button>
        </div>
        <div class="prompt-body">
          <p>To find accurate ratings, please provide the location:</p>
          <div class="location-inputs">
            <input type="text" id="locationCity" class="location-input" placeholder="City (e.g., Paris)">
            <input type="text" id="locationCountry" class="location-input" placeholder="Country (e.g., France)">
          </div>
          <div class="prompt-buttons">
            <button class="prompt-btn cancel-btn">Cancel</button>
            <button class="prompt-btn submit-btn">Fetch Ratings</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(promptWidget);
    
    const closeBtn = promptWidget.querySelector('.close-btn');
    const cancelBtn = promptWidget.querySelector('.cancel-btn');
    const submitBtn = promptWidget.querySelector('.submit-btn');
    const cityInput = promptWidget.querySelector('#locationCity');
    const countryInput = promptWidget.querySelector('#locationCountry');
    
    const close = () => {
      promptWidget.remove();
      isProcessing = false;
    };
    
    closeBtn.addEventListener('click', close);
    cancelBtn.addEventListener('click', close);
    
    submitBtn.addEventListener('click', () => {
      const city = cityInput.value.trim();
      const country = countryInput.value.trim();
      
      if (!city || !country) {
        alert('Please provide both city and country');
        return;
      }
      
      promptWidget.remove();
      callback({ city, country });
    });
    
    // Focus on city input
    setTimeout(() => cityInput.focus(), 100);
  }

  function processHotel(hotelName, location = null) {
    if (isProcessing) return;
    
    isProcessing = true;
    console.log('Processing hotel:', hotelName, location);

    // Remove existing rating widgets
    const existingWidgets = document.querySelectorAll('.hotel-rating-widget');
    existingWidgets.forEach(widget => widget.remove());

    // Extract location if not provided
    if (!location) {
      location = extractLocation();
    }
    
    // If location is missing, prompt user
    if (!location.city || !location.country) {
      isProcessing = false;
      promptForLocation(hotelName, (providedLocation) => {
        processHotel(hotelName, providedLocation);
      });
      return;
    }
    
    // Show loading widget
    showLoadingWidget();

    // Detect current website and exclude it from sources
    const currentHost = window.location.hostname.toLowerCase();
    const excludeSources = [];
    
    if (currentHost.includes('booking.com')) {
      excludeSources.push('booking.com');
    } else if (currentHost.includes('agoda.com')) {
      excludeSources.push('agoda');
    } else if (currentHost.includes('makemytrip.com')) {
      excludeSources.push('makemytrip');
    } else if (currentHost.includes('goibibo.com')) {
      excludeSources.push('goibibo');
    }
    // Google is always included, so we don't exclude it

    // Send message to background script with location
    chrome.runtime.sendMessage({
      action: 'fetchHotelRating',
      hotelName: hotelName,
      location: location,
      excludeSources: excludeSources
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
        <p>Fetching ratings from multiple sources...</p>
      </div>
    `;
    document.body.appendChild(widget);
  }

  function showRatingWidget(data) {
    const widget = createWidget();
    
    // Build sources tabs/content
    const sources = data.sources || [];
    const hasMultipleSources = sources.length > 1;
    
    let sourcesHTML = '';
    let sourcesContentHTML = '';
    
    if (sources.length > 0) {
      sources.forEach((source, index) => {
        // For single source, always show as active. For multiple, only first is active
        const isActive = (hasMultipleSources && index === 0) || !hasMultipleSources ? 'active' : '';
        const sourceIcon = getSourceIcon(source.source);
        
        if (hasMultipleSources) {
          sourcesHTML += `
            <button class="source-tab ${isActive}" data-source-index="${index}">
              ${sourceIcon} ${source.source}
            </button>
          `;
        }
        
        const hasRating = source.rating > 0 && source.totalReviews > 0;
        const hasReviews = source.recentReviews && source.recentReviews.length > 0;
        
        sourcesContentHTML += `
          <div class="source-content ${isActive}" data-content-index="${index}">
          ${hasRating ? `
          <div class="rating-score">
              <span class="rating-number">${source.rating.toFixed(1)}</span>
              <span class="rating-stars">${generateStars(source.rating)}</span>
              <span class="rating-count">(${source.totalReviews.toLocaleString()} reviews)</span>
          </div>
          ` : `
          <div class="rating-score no-rating">
              <p class="no-data-message">⚠️ No ratings found on ${source.source}</p>
              <p class="no-data-reason">This hotel may not be listed on ${source.source}, or the search criteria didn't match.</p>
          </div>
          `}
          <div class="recent-reviews">
            <h4>Recent Reviews:</h4>
            <div class="reviews-list">
                ${hasReviews ? source.recentReviews.map(review => {
                  // Check if this is an error message
                  if (review.text && (review.text.includes('not found') || review.text.includes('No reviews') || review.text.includes('unavailable'))) {
                    return `<div class="review-item error-message"><p class="review-text">${review.text}</p></div>`;
                  }
                  return `
                <div class="review-item">
                  <div class="review-header">
                    <span class="reviewer-name">${review.author}</span>
                    <span class="review-rating">${generateStars(review.rating)}</span>
                    <span class="review-date">${review.date}</span>
                  </div>
                  <p class="review-text">${review.text}</p>
                </div>
                `;
                }).join('') : '<p class="no-reviews">No recent reviews available for this source.</p>'}
              </div>
            </div>
          </div>
        `;
      });
    } else {
      sourcesContentHTML = '<div class="no-sources"><p>No ratings found for this hotel.</p></div>';
    }
    
    // Build summary section
    const summary = data.summary || { pros: [], cons: [] };
    let summaryHTML = '';
    
    if (summary.pros.length > 0 || summary.cons.length > 0) {
      summaryHTML = `
        <div class="summary-section">
          <h4>📊 Summary from All Sources</h4>
          ${summary.pros.length > 0 ? `
            <div class="summary-pros">
              <h5>✅ Pros:</h5>
              <ul>
                ${summary.pros.map(pro => `<li>${pro}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
          ${summary.cons.length > 0 ? `
            <div class="summary-cons">
              <h5>❌ Cons:</h5>
              <ul>
                ${summary.cons.map(con => `<li>${con}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
        </div>
      `;
    }
    
    widget.innerHTML = `
      <div class="rating-content">
        <div class="header">
          <h3>🏨 ${data.hotelName}</h3>
          <button class="close-btn">&times;</button>
        </div>
        ${hasMultipleSources ? `
          <div class="sources-tabs">
            ${sourcesHTML}
          </div>
        ` : ''}
        <div class="rating-info">
          ${sourcesContentHTML}
          ${summaryHTML}
        </div>
      </div>
    `;
    
    // Add close button functionality
    widget.querySelector('.close-btn').addEventListener('click', () => {
      widget.remove();
    });
    
    // Add tab switching functionality
    if (hasMultipleSources) {
      const tabs = widget.querySelectorAll('.source-tab');
      const contents = widget.querySelectorAll('.source-content');
      
      tabs.forEach(tab => {
        tab.addEventListener('click', () => {
          const index = parseInt(tab.getAttribute('data-source-index'));
          
          // Remove active class from all tabs and contents
          tabs.forEach(t => t.classList.remove('active'));
          contents.forEach(c => c.classList.remove('active'));
          
          // Add active class to clicked tab and corresponding content
          tab.classList.add('active');
          contents[index].classList.add('active');
        });
      });
    }
    
    document.body.appendChild(widget);
  }
  
  function getSourceIcon(sourceName) {
    const icons = {
      'Google': '🔍',
      'Booking.com': '📅',
      'Agoda': '🏨',
      'MakeMyTrip': '✈️',
      'GoIbibo': '✈️'
    };
    return icons[sourceName] || '⭐';
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
    widget.className = 'hotel-rating-widget rating-popup';
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
