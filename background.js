// Hotel Rating Fetcher Background Script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchHotelRating') {
    (async () => {
      try {
        console.log('Background: fetchHotelRating request received for', request.hotelName, request.location);
        const data = await fetchHotelRating(request.hotelName, request.location, request.excludeSources || []);
        sendResponse({ success: true, data });
      } catch (error) {
        console.error('Error fetching hotel rating:', error);
        sendResponse({ success: false, error: error?.message || String(error) });
      }
    })();

    // Return true to indicate we will send a response asynchronously
    return true;
  }
});

async function fetchHotelRating(hotelName, location = null, excludeSources = []) {
  try {
    // Get API key from storage
    const getSync = (keys) => new Promise((resolve) => chrome.storage.sync.get(keys, resolve));
    const result = await getSync(['geminiApiKey']);
    const apiKey = result?.geminiApiKey;
    console.log('Background: geminiApiKey loaded?', !!apiKey);
    
    if (!apiKey || apiKey.trim() === '') {
      throw new Error('Gemini API key not configured. Please open the extension popup and enter your API key in the settings.');
    }

    // Create the prompt for Gemini
    const prompt = createGeminiPrompt(hotelName, location, excludeSources);
    console.log('Background: prompt built, length=', prompt.length);
    
    // Call Gemini API - try different models/versions
    // Using gemini-2.0-flash as primary (known to work)
    const modelsToTry = [
      { version: 'v1beta', model: 'gemini-2.0-flash' },
      { version: 'v1', model: 'gemini-pro' },
      { version: 'v1beta', model: 'gemini-1.5-pro' },
      { version: 'v1beta', model: 'gemini-1.5-flash' }
    ];
    
    let response;
    let lastError;
    
    for (const { version, model } of modelsToTry) {
      try {
        const url = `https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent?key=${apiKey}`;
        console.log('Background: calling Gemini model', model, version);
        response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.1,
          topK: 32,
          topP: 1,
              maxOutputTokens: 4096,
        }
      })
    });

        if (response.ok) {
          console.log(`Successfully using model: ${model} (${version})`);
          break; // Success, exit loop
        } else {
          let errorData = null;
          try { errorData = await response.json(); } catch (e) { /* ignore */ }
          lastError = errorData?.error?.message || `HTTP ${response.status}`;
          console.log(`Model ${model} (${version}) failed: ${lastError}`);
        }
      } catch (error) {
        lastError = error.message;
        console.log(`Model ${model} (${version}) error: ${lastError}`);
        continue; // Try next model
      }
    }
    
    if (!response || !response.ok) {
      throw new Error(`API Error: All models failed. Last error: ${lastError}. Please check your API key and available models at https://ai.google.dev/api/rest`);
    }

    const data = await response.json();
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    console.log('Background: received generatedText length=', generatedText?.length || 0);
    
    if (!generatedText) {
      throw new Error('No response from Gemini API');
    }

    // Parse the response
    return parseGeminiResponse(hotelName, generatedText);
    
  } catch (error) {
    console.error('Error in fetchHotelRating:', error);
    throw error;
  }
}

function createGeminiPrompt(hotelName, location = null, excludeSources = []) {
  // Prefer Google Maps / Business Profile (Google Listing) rating
  const sources = [
    { name: 'Google Listing', alwaysInclude: true }
  ];

  // Build location string
  let locationStr = '';
  if (location && location.city && location.country) {
    locationStr = ` located in ${location.city}, ${location.country}`;
  }

  return `You are a hotel rating assistant. I need you to find the official Google listing (Google Maps / Business Profile) rating and recent reviews for the hotel: "${hotelName}"${locationStr}. Prefer the Google Maps listing rating (the one shown on Google Maps/Business Profile) over other Google search snippets.

Please provide the information in the following JSON format:
{
  "hotelName": "exact hotel name as found",
  "googleMapsUrl": "https://www.google.com/maps/place/...",
  "googleReviewsLink": "https://www.google.com/search?q=${encodeURIComponent(hotelName)}+hotels+reviews",
  "sources": [
    {
      "source": "Google Listing",
      "rating": 4.5,
      "totalReviews": 1234,
      "recentReviews": [
        {
          "author": "Reviewer Name",
          "rating": 5,
          "date": "2024-01-15",
          "text": "Review text here..."
        }
      ]
    }
  ],
  "summary": {
    "pros": [
      "Positive aspect 1",
      "Positive aspect 2",
      "Positive aspect 3"
    ],
    "cons": [
      "Negative aspect 1",
      "Negative aspect 2"
    ]
  }
}

Instructions:
1. Search for the exact hotel name "${hotelName}"${locationStr ? ` in ${location.city}, ${location.country}` : ''} on Google Maps / Google Business Profile.
2. Use the location information (${locationStr ? `${location.city}, ${location.country}` : 'if provided'}) to ensure you find the correct hotel, especially if there are multiple hotels with the same name.
3. Find the official Google Maps listing rating and total number of reviews (prefer this value).
4. Provide 2-3 most recent reviews from the Google Maps listing (limit to 3).
5. If you cannot find the hotel on Google Maps, set rating as 0, totalReviews as 0, and include a message in recentReviews explaining why.
6. Always provide `googleMapsUrl` (direct Google Maps listing URL) if available, and also include `googleReviewsLink` (a Google search URL for reviews) as a fallback.
7. Ensure all review text is properly escaped for JSON.
8. Keep review text concise (max 200 characters per review).
9. Use realistic dates for recent reviews (within last 6 months).
10. Create a summary based on Google reviews:
   - "pros": List 3-5 most commonly mentioned positive aspects
   - "cons": List 2-4 most commonly mentioned negative aspects
11. Base the summary on actual review content, not assumptions.
12. If no reviews are found, set pros and cons as empty arrays.

Important: Only return valid JSON, no additional text or explanations.`;
}

function parseGeminiResponse(originalHotelName, responseText) {
  try {
    // Extract JSON from the response (in case there's extra text)
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No valid JSON found in response');
    }
    
    const jsonStr = jsonMatch[0];
    const data = JSON.parse(jsonStr);
    
    // Validate the response structure
    if (!data.hotelName) {
      throw new Error('Invalid response structure from Gemini');
    }
    
    // Parse sources (new format) or convert old format
    let sources = [];
    if (data.sources && Array.isArray(data.sources)) {
      sources = data.sources.map(source => ({
        source: source.source || 'Unknown',
        rating: Math.max(0, Math.min(5, source.rating || 0)),
        totalReviews: Math.max(0, source.totalReviews || 0),
        recentReviews: (source.recentReviews || []).slice(0, 3).map(review => ({
          author: review.author || 'Anonymous',
          rating: Math.max(1, Math.min(5, review.rating || 1)),
          date: review.date || new Date().toISOString().split('T')[0],
          text: (review.text || '').substring(0, 200)
        }))
      })).filter(s => s.rating > 0); // Only include sources with valid ratings
    } else {
      // Fallback: convert old format to new format
      sources = [{
        source: 'Google',
      rating: Math.max(0, Math.min(5, data.rating || 0)),
      totalReviews: Math.max(0, data.totalReviews || 0),
      recentReviews: (data.recentReviews || []).slice(0, 3).map(review => ({
        author: review.author || 'Anonymous',
        rating: Math.max(1, Math.min(5, review.rating || 1)),
        date: review.date || new Date().toISOString().split('T')[0],
        text: (review.text || '').substring(0, 200)
      }))
      }].filter(s => s.rating > 0);
    }
    
    // Parse summary
    const summary = data.summary || {
      pros: [],
      cons: []
    };
    
    // Ensure we have the required fields
    return {
      hotelName: data.hotelName || originalHotelName,
      googleMapsUrl: data.googleMapsUrl || null,
      googleReviewsLink: data.googleReviewsLink || `https://www.google.com/search?q=${encodeURIComponent(originalHotelName)}+hotels+reviews`,
      sources: sources,
      summary: {
        pros: Array.isArray(summary.pros) ? summary.pros.slice(0, 5) : [],
        cons: Array.isArray(summary.cons) ? summary.cons.slice(0, 4) : []
      }
    };
    
  } catch (error) {
    console.error('Error parsing Gemini response:', error);
    
    // Return a fallback response
    return {
      hotelName: originalHotelName,
      googleMapsUrl: null,
      googleReviewsLink: `https://www.google.com/search?q=${encodeURIComponent(originalHotelName)}+hotels+reviews`,
      sources: [],
      summary: {
        pros: [],
        cons: []
      }
    };
  }
}

// Handle extension installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Hotel Rating Fetcher extension installed');
    
    // Set default settings
    chrome.storage.sync.set({
      hotelRatingMode: 'off',
      geminiApiKey: ''
    });
  }
});
