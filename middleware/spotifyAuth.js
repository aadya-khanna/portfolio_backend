import SpotifyTokens from '../models/SpotifyTokens.js';
import querystring from 'querystring';
import fetch from 'node-fetch';

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

// In-memory token cache
let tokenCache = {
  access_token: null,
  refresh_token: null,
  expires_at: null, // timestamp in milliseconds
  isRefreshing: false,
  refreshPromise: null
};

/**
 * Initialize token cache by loading tokens from MongoDB
 * Should be called once on server startup after MongoDB connection
 */
const initializeTokenCache = async () => {
  console.log('Backend: initializeTokenCache - Loading tokens from MongoDB into cache.');
  try {
    const tokens = await SpotifyTokens.findOne();
    
    if (tokens && tokens.access_token && tokens.refresh_token) {
      // Calculate expires_at from timestamp + expires_in
      const expires_at = tokens.timestamp + (tokens.expires_in * 1000);
      
      tokenCache = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: expires_at,
        isRefreshing: false,
        refreshPromise: null
      };
      
      console.log('Backend: Successfully loaded tokens into cache. Token expires at:', new Date(expires_at).toISOString());
      return true;
    } else {
      console.log('Backend: No tokens found in MongoDB. Cache not initialized.');
      return false;
    }
  } catch (error) {
    console.error('Backend: Error initializing token cache:', error.message);
    return false;
  }
};

/**
 * Update tokens in cache and database
 * Updates cache immediately (fast), then writes to database asynchronously (non-blocking)
 * @param {string} access_token - New access token
 * @param {string} refresh_token - New refresh token (may be null if not rotated)
 * @param {number} expires_in - Token expiration time in seconds
 */
const updateTokens = async (access_token, refresh_token, expires_in) => {
  console.log('Backend: updateTokens - Updating tokens in cache and database.');
  
  // Calculate expires_at timestamp
  const expires_at = Date.now() + (expires_in * 1000);
  
  // Update cache immediately (fast)
  tokenCache.access_token = access_token;
  if (refresh_token) {
    tokenCache.refresh_token = refresh_token;
  }
  tokenCache.expires_at = expires_at;
  tokenCache.isRefreshing = false;
  tokenCache.refreshPromise = null;
  
  console.log('Backend: Cache updated immediately. Token expires at:', new Date(expires_at).toISOString());
  
  // Update database asynchronously (non-blocking)
  const tokensToSave = {
    access_token: access_token,
    refresh_token: refresh_token || tokenCache.refresh_token, // Use existing refresh_token if not provided
    expires_in: expires_in,
    timestamp: Date.now()
  };
  
  // Fire and forget - don't await to avoid blocking
  SpotifyTokens.findOneAndUpdate({}, tokensToSave, { upsert: true, new: true })
    .then(() => {
      console.log('Backend: Successfully updated tokens in MongoDB (async).');
    })
    .catch((error) => {
      console.error('Backend: Error updating tokens in MongoDB (async):', error.message);
    });
};

/**
 * Refresh access token using cached refresh token
 * Prevents concurrent refresh attempts using a shared promise
 * Updates cache first, then database asynchronously
 */
const refreshAccessToken = async () => {
  // If already refreshing, return the existing promise
  if (tokenCache.isRefreshing && tokenCache.refreshPromise) {
    console.log('Backend: refreshAccessToken - Refresh already in progress, waiting for existing promise.');
    return await tokenCache.refreshPromise;
  }
  
  // Check if we have a refresh token
  if (!tokenCache.refresh_token) {
    console.error('Backend: refreshAccessToken - No refresh token available in cache.');
    return null;
  }
  
  // Start refresh operation
  tokenCache.isRefreshing = true;
  tokenCache.refreshPromise = (async () => {
    try {
      console.log('Backend: refreshAccessToken - Attempting to refresh access token using cached refresh token.');
      
      const authOptions = {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + (Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64')),
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: querystring.stringify({
          grant_type: 'refresh_token',
          refresh_token: tokenCache.refresh_token
        })
      };

      const response = await fetch('https://accounts.spotify.com/api/token', authOptions);
      const data = await response.json();

      if (response.ok) {
        console.log('Backend: refreshAccessToken - Token refresh successful.');
        
        // Update tokens (handles cache and async DB write)
        await updateTokens(
          data.access_token,
          data.refresh_token || null, // Spotify may or may not return a new refresh token
          data.expires_in
        );
        
        return data.access_token;
      } else {
        console.error('Backend: refreshAccessToken - Token refresh failed:', data);
        tokenCache.isRefreshing = false;
        tokenCache.refreshPromise = null;
        return null;
      }
    } catch (error) {
      console.error('Backend: refreshAccessToken - Error refreshing token:', error);
      tokenCache.isRefreshing = false;
      tokenCache.refreshPromise = null;
      return null;
    }
  })();
  
  return await tokenCache.refreshPromise;
};

/**
 * Get a valid access token from cache or refresh if needed
 * Returns token from cache if still valid (with 60-second buffer)
 * Refreshes token if expired
 * @returns {Promise<string|null>} Valid access token or null if refresh fails
 */
const getValidAccessToken = async () => {
  const now = Date.now();
  const buffer = 60000; // 60 seconds in milliseconds
  
  // Check if token exists and is still valid (with buffer)
  if (tokenCache.access_token && tokenCache.expires_at && tokenCache.expires_at > (now + buffer)) {
    console.log('Backend: getValidAccessToken - Using valid cached token.');
    return tokenCache.access_token;
  }
  
  // Token expired or doesn't exist, refresh it
  console.log('Backend: getValidAccessToken - Token expired or missing, refreshing.');
  return await refreshAccessToken();
};

/**
 * Spotify authentication middleware
 * Uses in-memory cache instead of database reads
 */
const spotifyAuthMiddleware = async (req, res, next) => {
  console.log('Backend: spotifyAuthMiddleware - Checking Spotify token from cache.');
  
  const access_token = await getValidAccessToken();
  
  if (!access_token) {
    console.error('Backend: spotifyAuthMiddleware - Failed to obtain valid access token. Authentication failed.');
    return res.status(401).send({ 
      error: 'Authentication failed', 
      message: 'Spotify token refresh failed. Please re-authenticate.' 
    });
  }
  
  // Attach the access token to the request object for use in route handlers
  req.spotifyAccessToken = access_token;
  console.log('Backend: spotifyAuthMiddleware - Valid access token attached to request.');
  next();
};

export default spotifyAuthMiddleware;
export { initializeTokenCache, updateTokens };
