import path from 'path';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import querystring from 'querystring';


dotenv.config();

const DELETE_SECRET = process.env.DELETE_SECRET; // Read the delete secret from environment variables

const app = express();
const port = process.env.PORT || 8888;

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const notesFilePath = path.join(__dirname, 'notes.json');
// Removed spotifyTokensFilePath as tokens will be stored in environment variables

// Helper functions for reading/writing notes
const readNotes = () => {
  try {
    console.log(`Backend: Attempting to read notes from: ${notesFilePath}`);
    const data = fs.readFileSync(notesFilePath, 'utf8');
    console.log('Backend: Successfully read notes data.');
    // Ensure the parsed data is an array, default to empty array if not
    const parsedData = JSON.parse(data);
    return Array.isArray(parsedData) ? parsedData : [];
  } catch (error) {
    console.error(`Backend: Error reading notes file ${notesFilePath}:`, error.message);
    // If file doesn't exist or is invalid JSON, return empty array
    return [];
  }
};

const writeNotes = (notes) => {
  console.log(`Backend: Attempting to write notes to: ${notesFilePath}`);
  console.log('Backend: Writing notes data:', notes);
  try {
    fs.writeFileSync(notesFilePath, JSON.stringify(notes, null, 2), 'utf8');
    console.log('Backend: Successfully wrote notes.');
  } catch (error) {
    console.error(`Backend: Error writing notes file ${notesFilePath}:`, error.message);
  }
};

// Helper functions for reading/writing Spotify tokens using environment variables
const readSpotifyTokens = () => {
  console.log('Backend: Attempting to read Spotify tokens from environment variables.');
  const access_token = process.env.SPOTIFY_ACCESS_TOKEN;
  const refresh_token = process.env.SPOTIFY_REFRESH_TOKEN;
  const expires_in = parseInt(process.env.SPOTIFY_TOKEN_EXPIRY, 10);
  const timestamp = parseInt(process.env.SPOTIFY_TOKEN_TIMESTAMP, 10);

  if (access_token && refresh_token && !isNaN(expires_in) && !isNaN(timestamp)) {
    console.log('Backend: Successfully read Spotify tokens from environment variables.');
    return { access_token, refresh_token, expires_in, timestamp };
  } else {
    console.log('Backend: Spotify tokens not found or incomplete in environment variables.');
    return {};
  }
};

const writeSpotifyTokens = (tokens) => {
  console.log('Backend: Attempting to write Spotify tokens to environment variables.');
  if (tokens.access_token) {
    process.env.SPOTIFY_ACCESS_TOKEN = tokens.access_token;
  }
  if (tokens.refresh_token) {
    process.env.SPOTIFY_REFRESH_TOKEN = tokens.refresh_token;
  }
  if (tokens.expires_in) {
    process.env.SPOTIFY_TOKEN_EXPIRY = tokens.expires_in.toString();
  }
  if (tokens.timestamp) {
    process.env.SPOTIFY_TOKEN_TIMESTAMP = tokens.timestamp.toString();
  }
  console.log('Backend: Spotify tokens written to environment variables.');
};

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI  || "http://127.0.0.1:8888/callback";
const FRONTEND_URI = process.env.FRONTEND_URI;

// Helper function to generate random string for state
const generateRandomString = (length) => {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
};

app.use(cors({
  origin: [
    "https://portfolio-frontend-seven-ashy.vercel.app", 
    "http://localhost:5173"
  ],
  credentials: true,
}));

app.use(express.json()); // Add middleware to parse JSON request bodies
import cookieParser from 'cookie-parser';
app.use(cookieParser());

// Sticky notes API endpoints
app.get('/api/notes', (req, res) => {
  console.log('Backend: GET /api/notes endpoint hit');
  const notes = readNotes();
  console.log('Backend: Sending notes:', notes);
  res.json(notes);
});

app.post('/api/notes', (req, res) => {
  console.log('Backend: POST /api/notes endpoint hit');
  const newNoteText = req.body.text;
  console.log('Backend: Received new note text:', newNoteText);
  if (!newNoteText) {
    console.error('Backend: Note text is missing in POST request.');
    return res.status(400).json({ error: 'Note text is required' });
  }

  const notes = readNotes();
  console.log('Backend: Existing notes before adding new:', notes);
  // Assign a simple unique ID (timestamp)
  const newNote = {
    id: Date.now(),
    text: newNoteText
  };
  notes.push(newNote);
  console.log('Backend: Notes array after adding new:', notes);
  writeNotes(notes);

  console.log('Backend: Note added successfully. Sending 201 response.');
  res.status(201).json({ message: 'Note added successfully', note: newNote });
});

// Sticky notes DELETE endpoint
app.delete('/api/notes/:id', (req, res) => {
  const noteId = parseInt(req.params.id, 10);
  const receivedSecret = req.body.deleteSecret; // Get the secret from the request body

  console.log('Received secret:',receivedSecret);

  console.log(`Backend: DELETE /api/notes/${noteId} endpoint hit`);

  // Check if the received secret matches the configured secret
  if (!DELETE_SECRET || receivedSecret !== DELETE_SECRET) {
    console.warn('Backend: Unauthorized delete attempt.');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const notes = readNotes();
  const initialLength = notes.length;
  const updatedNotes = notes.filter(note => note.id !== noteId);

  if (updatedNotes.length < initialLength) {
    writeNotes(updatedNotes);
    res.json({ message: 'Note deleted successfully' });
  } else {
    res.status(404).json({ error: 'Note not found' });
  }
});


app.get('/login', (req, res) => {
  const state = generateRandomString(16);
  // Pass state as a separate query parameter in the authorization URL
  const scope = 'user-read-currently-playing user-read-recently-played';
  const authUrl = 'https://accounts.spotify.com/authorize?' +
    querystring.stringify({
      response_type: 'code',
      client_id: CLIENT_ID,
      scope: scope,
      redirect_uri: REDIRECT_URI, // Use the base REDIRECT_URI
      state: state // Send state as a separate parameter
    });

  console.log(`Backend: Setting state and redirecting to Spotify auth URL: ${authUrl}`);
  res.redirect(authUrl);
});

app.get('/callback', async (req, res) => {
  const code = req.query.code || null;
  const state = req.query.state || null; // Get state from query parameter

  console.log(`Backend: Callback received - code: ${code}, state: ${state}`);

  // In this simplified flow, we trust the state received from Spotify
  // In a more secure implementation, you might store the state server-side
  // before redirecting to Spotify and verify it here.
  // For this portfolio project, relying on the state from Spotify is acceptable.

  if (state === null) {
    console.error('Backend: State parameter missing in callback.');
    res.redirect('/#' +
      querystring.stringify({
        error: 'state_missing'
      }));
  } else {
    console.log('Backend: State received. Proceeding with token exchange.');
    const authOptions = {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + (new Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64')),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: querystring.stringify({
        code: code,
        redirect_uri: REDIRECT_URI, // Use the base REDIRECT_URI for the token exchange
        grant_type: 'authorization_code'
      })
    };

    try {
      const response = await fetch('https://accounts.spotify.com/api/token', authOptions);
      const data = await response.json();
      console.log('Backend: Spotify token exchange response data:', data);
 
      if (response.ok) {
        const access_token = data.access_token;
        const refresh_token = data.refresh_token;
 
        // Save tokens to environment variables for current runtime
        writeSpotifyTokens({ access_token, refresh_token, expires_in: data.expires_in, timestamp: Date.now() });
        console.log('Backend: Spotify tokens saved to environment variables for current runtime.');
        console.log('Backend: >>> IMPORTANT: Your Spotify Refresh Token is: <<<', refresh_token); // Clear log for refresh token
 
        // Redirect to frontend (optional, can redirect to a success page)
        res.redirect(FRONTEND_URI + '/about'); // Redirect without tokens in URL
      } else {
        console.error('Backend: Token exchange failed:', data);
        res.redirect('/#' +
          querystring.stringify({
            error: 'invalid_token',
            details: data.error_description || data.error
          }));
      }
    } catch (error) {
      console.error('Backend: Error exchanging code for token:', error);
      res.redirect('/#' +
        querystring.stringify({
          error: 'api_error',
          message: error.message
        }));
    }
  }
});

// Helper function to refresh access token using stored refresh token
const refreshStoredAccessToken = async () => {
  const tokens = readSpotifyTokens();
  const refresh_token = tokens.refresh_token;

  if (!refresh_token) {
    console.error('Backend: No refresh token available to refresh.');
    return null;
  }

  const authOptions = {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + (new Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64')),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: querystring.stringify({
      grant_type: 'refresh_token',
      refresh_token: refresh_token
    })
  };

  try {
    console.log('Backend: Attempting to refresh access token using stored refresh token.');
    const response = await fetch('https://accounts.spotify.com/api/token', authOptions);
    const data = await response.json();

    if (response.ok) {
      console.log('Backend: Token refresh successful.');
      console.log('Backend: Token refresh successful.');
      // Update ONLY access token and expiry in process.env for current runtime
      process.env.SPOTIFY_ACCESS_TOKEN = data.access_token;
      process.env.SPOTIFY_TOKEN_EXPIRY = data.expires_in.toString();
      process.env.SPOTIFY_TOKEN_TIMESTAMP = Date.now().toString();
      // Note: The persistent refresh token must be set externally in environment configuration.
      return data.access_token;
    } else {
      console.error('Backend: Token refresh failed:', data);
      // Clear tokens if refresh fails
      writeSpotifyTokens({}); // This will effectively clear the environment variables
      return null;
    }
  } catch (error) {
    console.error('Backend: Error refreshing token:', error);
    writeSpotifyTokens({}); // Clear tokens on error
    return null;
  }
};


// Endpoint to get currently playing track using stored tokens
app.get('/currently-playing', async (req, res) => {
  console.log('Backend: GET /currently-playing endpoint hit');
  let tokens = readSpotifyTokens();
  let access_token = tokens.access_token;
  const expires_in = tokens.expires_in;
  const timestamp = tokens.timestamp;

  // Check if access token is expired (consider a small buffer)
  const isExpired = !access_token || (Date.now() - timestamp) / 1000 > expires_in - 60; // 60 sec buffer

  if (isExpired) {
    console.log('Backend: Access token expired or not available. Attempting to refresh.');
    access_token = await refreshStoredAccessToken();
    if (!access_token) {
      console.error('Backend: Failed to obtain valid access token after refresh attempt.');
      return res.status(401).send({ error: 'Authentication failed' });
    }
  } else {
    console.log('Backend: Using valid access token.');
  }
 
  console.log('Backend: Access token being used for Spotify API call:', access_token ? 'Token available' : 'No token');
 
  const options = {
    headers: {
      'Authorization': 'Bearer ' + access_token
    }
  };

  try {
    const response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', options);

    if (response.status === 204) { // No content
      console.log('Backend: Spotify API returned 204 (No Content).');
      return res.status(200).send({ item: null, is_playing: false, message: 'No currently playing track' });
    }

    const data = await response.json();
    console.log('Backend: Spotify API /currently-playing response data:', data);
    console.log('Backend: Raw data received from Spotify API:', JSON.stringify(data, null, 2));
 
    if (response.ok) {
      res.send(data);
    } else {
      console.error('Backend: Spotify API Error:', data);
      res.status(response.status).send(data);
    }
  } catch (error) {
    console.error('Backend: Error fetching currently playing track:', error);
    res.status(500).send({
      error: 'api_error',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Endpoint to get recently played tracks using stored tokens
app.get('/recently-played', async (req, res) => {
  console.log('Backend: GET /recently-played endpoint hit');
  let tokens = readSpotifyTokens();
  let access_token = tokens.access_token;
  const expires_in = tokens.expires_in;
  const timestamp = tokens.timestamp;

  // Check if access token is expired (consider a small buffer)
  const isExpired = !access_token || (Date.now() - timestamp) / 1000 > expires_in - 60; // 60 sec buffer

  if (isExpired) {
    console.log('Backend: Access token expired or not available. Attempting to refresh.');
    access_token = await refreshStoredAccessToken();
    if (!access_token) {
      console.error('Backend: Failed to obtain valid access token after refresh attempt.');
      return res.status(401).send({ error: 'Authentication failed' });
    }
  } else {
    console.log('Backend: Using valid access token.');
  }

  const options = {
    headers: {
      'Authorization': 'Bearer ' + access_token
    }
  };

  try {
    const response = await fetch('https://api.spotify.com/v1/me/player/recently-played', options);
    const data = await response.json();
    console.log('Backend: Spotify API /recently-played response data:', data);

    if (response.ok) {
      res.send(data);
    } else {
      console.error('Backend: Spotify API Error:', data);
      res.status(response.status).send(data);
    }
  } catch (error) {
    console.error('Backend: Error fetching recently played tracks:', error);
    res.status(500).send({ error: 'api_error' });
  }
});

app.listen(port, () => {
  console.log(`Backend listening at http://localhost:${port}`);
});
