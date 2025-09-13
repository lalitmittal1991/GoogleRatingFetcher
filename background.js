// Hotel Rating Fetcher Background Script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchHotelRating') {
    fetchHotelRating(request.hotelName)
      .then(data => {
        sendResponse({ success: true, data });
      })
      .catch(error => {
        console.error('Error fetching hotel rating:', error);
        sendResponse({ success: false, error: error.message });
      });
    
    // Return true to indicate we will send a response asynchronously
    return true;
  }
});

async function fetchHotelRating(hotelName) {
  try {
    // Get API key from storage
    const result = await chrome.storage.sync.get(['geminiApiKey']);
    const apiKey = result.geminiApiKey;
    
    if (!apiKey) {
      throw new Error('Gemini API key not found. Please configure it in the extension popup.');
    }

    // Create the prompt for Gemini
    const prompt = createGeminiPrompt(hotelName);
    
    // Call Gemini API
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`, {
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
          maxOutputTokens: 2048,
        }
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`API Error: ${errorData.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
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

function createGeminiPrompt(hotelName) {
  return `You are a hotel rating assistant. I need you to find Google ratings and recent reviews for the hotel: "${hotelName}".

Please provide the information in the following JSON format:
{
  "hotelName": "exact hotel name as found",
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

Instructions:
1. Search for the exact hotel name "${hotelName}" on Google
2. Find the Google rating and total number of reviews
3. Provide the 3 most recent reviews (limit to 3)
4. If you cannot find the hotel, return rating as 0 and totalReviews as 0
5. Ensure all review text is properly escaped for JSON
6. Keep review text concise (max 200 characters per review)
7. Use realistic dates for recent reviews (within last 6 months)

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
    if (!data.hotelName || typeof data.rating !== 'number' || !Array.isArray(data.recentReviews)) {
      throw new Error('Invalid response structure from Gemini');
    }
    
    // Ensure we have the required fields
    return {
      hotelName: data.hotelName || originalHotelName,
      rating: Math.max(0, Math.min(5, data.rating || 0)),
      totalReviews: Math.max(0, data.totalReviews || 0),
      recentReviews: (data.recentReviews || []).slice(0, 3).map(review => ({
        author: review.author || 'Anonymous',
        rating: Math.max(1, Math.min(5, review.rating || 1)),
        date: review.date || new Date().toISOString().split('T')[0],
        text: (review.text || '').substring(0, 200)
      }))
    };
    
  } catch (error) {
    console.error('Error parsing Gemini response:', error);
    
    // Return a fallback response
    return {
      hotelName: originalHotelName,
      rating: 0,
      totalReviews: 0,
      recentReviews: [{
        author: 'System',
        rating: 0,
        date: new Date().toISOString().split('T')[0],
        text: 'Unable to fetch reviews at this time. Please try again later.'
      }]
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
