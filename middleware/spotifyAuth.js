import SpotifyTokens from '../models/SpotifyTokens.js';
import querystring from 'querystring';
import fetch from 'node-fetch';

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

// Helper function to refresh access token using stored refresh token
const refreshStoredAccessToken = async () => {
  console.log('Backend: refreshStoredAccessToken - Attempting to refresh access token using stored refresh token.');
  try {
    const tokens = await SpotifyTokens.findOne();
    const refresh_token = tokens?.refresh_token;

    if (!refresh_token) {
      console.error('Backend: No refresh token available to refresh.');
      return null;
    }

    const authOptions = {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + (Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64')),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: querystring.stringify({
        grant_type: 'refresh_token',
        refresh_token: refresh_token
      })
    };

    const response = await fetch('https://accounts.spotify.com/api/token', authOptions);
    const data = await response.json();

    if (response.ok) {
      console.log('Backend: Token refresh successful.');
      // Update tokens in MongoDB
      const updatedTokens = {
        access_token: data.access_token,
        expires_in: data.expires_in,
        timestamp: Date.now(),
      };

      // If Spotify returns a new refresh token, update it
      if (data.refresh_token) {
        console.log('Backend: Spotify returned a new refresh token. Updating stored token.');
        updatedTokens.refresh_token = data.refresh_token;
      }

      await SpotifyTokens.findOneAndUpdate({}, updatedTokens, { upsert: true, new: true });

      console.log('Backend: Successfully refreshed and updated stored tokens in MongoDB.');
      return data.access_token;
    } else {
      console.error('Backend: refreshStoredAccessToken - Token refresh failed:', data);
      // Depending on the error, you might want to clear tokens or require re-auth
      return null;
    }
  } catch (error) {
    console.error('Backend: refreshStoredAccessToken - Error refreshing token:', error);
    return null;
  }
};


const spotifyAuthMiddleware = async (req, res, next) => {
  console.log('Backend: spotifyAuthMiddleware - Checking Spotify token.');
  const tokens = await SpotifyTokens.findOne();
  let access_token = tokens?.access_token;
  const expires_in = tokens?.expires_in;
  const timestamp = tokens?.timestamp;

  // Check if access token is expired (consider a small buffer)
  const isExpired = !access_token || !timestamp || (Date.now() - timestamp) / 1000 > expires_in - 60; // 60 sec buffer

  if (isExpired) {
    console.log('Backend: Access token expired or not available. Attempting to refresh.');
    access_token = await refreshStoredAccessToken();
    if (!access_token) {
      console.error('Backend: Failed to obtain valid access token after refresh attempt. Authentication failed.');
      return res.status(401).send({ error: 'Authentication failed', message: 'Spotify token refresh failed. Please re-authenticate.' });
    }
    console.log('Backend: Token refreshed successfully by middleware.');
  } else {
    console.log('Backend: Using valid access token.');
  }

  // Attach the access token to the request object for use in route handlers
  req.spotifyAccessToken = access_token;
  next();
};

export default spotifyAuthMiddleware;