import path from 'path';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import querystring from 'querystring';
import fs from 'fs'; 
import mongoose from 'mongoose'; 
import SpotifyTokens from './models/SpotifyTokens.js'; 
import spotifyAuthMiddleware from './middleware/spotifyAuth.js'; 


dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;

mongoose.connect(MONGODB_URI)
  .then(() => console.log('Backend: MongoDB connected successfully.'))
  .catch(err => console.error('Backend: MongoDB connection error:', err));

const DELETE_SECRET = process.env.DELETE_SECRET;

const app = express();
const port = process.env.PORT || 8888;

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define Note Schema
const noteSchema = new mongoose.Schema({
  text: {
    type: String,
    required: true
  },
});

const Note = mongoose.model('Note', noteSchema);

const readSpotifyTokens = async () => {
  console.log('Backend: readSpotifyTokens - Attempting to read Spotify tokens from MongoDB.');
  try {
    const tokens = await SpotifyTokens.findOne(); 
    if (tokens) {
      console.log('Backend: Successfully read Spotify tokens from MongoDB.');
      return tokens;
    } else {
      console.log('Backend: No Spotify tokens found in MongoDB.');
      return null; 
    }
  } catch (error) {
    console.error('Backend: Error reading Spotify tokens from MongoDB:', error.message);
    return null;
  }
};

const writeSpotifyTokens = async (tokens) => {
  console.log('Backend: writeSpotifyTokens - Attempting to write Spotify tokens to MongoDB.');
  try {
    // Find and update the existing tokens, or create a new document if none exists
    await SpotifyTokens.findOneAndUpdate({}, tokens, { upsert: true, new: true });
    console.log('Backend: Successfully wrote Spotify tokens to MongoDB.');
  } catch (error) {
    console.error('Backend: Error writing Spotify tokens to MongoDB:', error.message);
  }
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
    "https://aadyakhanna.com",
    "https://www.aadyakhanna.com",
    "http://localhost:5173"
  ],
  credentials: true,
}));

app.use(express.json()); // Add middleware to parse JSON request bodies
import cookieParser from 'cookie-parser';
app.use(cookieParser());

// Sticky notes API endpoints
app.get('/api/notes', async (req, res) => {
  console.log('Backend: GET /api/notes endpoint hit');
  try {
    const notes = await Note.find(); // Fetch all notes from MongoDB
    console.log('Backend: Sending notes:', notes);
    res.json(notes);
  } catch (error) {
    console.error('Backend: Error fetching notes from MongoDB:', error);
    res.status(500).json({ error: 'Error fetching notes' });
  }
});

app.post('/api/notes', async (req, res) => {
  console.log('Backend: POST /api/notes endpoint hit');
  const newNoteText = req.body.text;
  console.log('Backend: Received new note text:', newNoteText);
  if (!newNoteText) {
    console.error('Backend: Note text is missing in POST request.');
    return res.status(400).json({ error: 'Note text is required' });
  }

  try {
    const newNote = new Note({ text: newNoteText }); // Create a new Note instance
    await newNote.save(); // Save the new note to MongoDB
    console.log('Backend: Note added successfully to MongoDB.');
    res.status(201).json({ message: 'Note added successfully', note: newNote });
  } catch (error) {
    console.error('Backend: Error adding note to MongoDB:', error);
    res.status(500).json({ error: 'Error adding note' });
  }
});

// Sticky notes DELETE endpoint
app.delete('/api/notes/:id', async (req, res) => {
  const noteId = req.params.id; // Get the note ID from the URL
  const receivedSecret = req.body.deleteSecret; // Get the secret from the request body

  console.log('Received secret:', receivedSecret);
  console.log(`Backend: DELETE /api/notes/${noteId} endpoint hit`);

  // Check if the received secret matches the configured secret
  if (!DELETE_SECRET || receivedSecret !== DELETE_SECRET) {
    console.warn('Backend: Unauthorized delete attempt.');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Find and delete the note by its MongoDB _id
    const result = await Note.findByIdAndDelete(noteId);

    if (result) {
      console.log(`Backend: Note with ID ${noteId} deleted successfully from MongoDB.`);
      res.json({ message: 'Note deleted successfully' });
    } else {
      console.warn(`Backend: Note with ID ${noteId} not found.`);
      res.status(404).json({ error: 'Note not found' });
    }
  } catch (error) {
    console.error(`Backend: Error deleting note with ID ${noteId} from MongoDB:`, error);
    res.status(500).json({ error: 'Error deleting note' });
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
      redirect_uri: REDIRECT_URI, 
      state: state 
    });

  console.log(`Backend: Setting state and redirecting to Spotify auth URL: ${authUrl}`);
  res.redirect(authUrl);
});

app.get('/callback', async (req, res) => {
  const code = req.query.code || null;
  const state = req.query.state || null; // Get state from query parameter

  console.log(`Backend: Callback received - code: ${code}, state: ${state}`);

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
 
        // Save tokens using writeSpotifyTokens (writes to MongoDB)
        console.log('Backend: /callback - Calling writeSpotifyTokens after successful token exchange.'); // Added log
        await writeSpotifyTokens({ access_token, refresh_token, expires_in: data.expires_in, timestamp: Date.now() });
        console.log('Backend: /callback - writeSpotifyTokens called.'); // Added log
        console.log('Backend: >>> IMPORTANT: Your Spotify Refresh Token is: <<<', refresh_token); // Clear log for refresh token

        // Redirect to frontend 
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
      // Read current tokens from file to preserve the refresh token if not rotated
      const currentTokens = readSpotifyTokens();
      const updatedTokens = {
        ...currentTokens, // Keep existing tokens, including the refresh token
        access_token: data.access_token,
        expires_in: data.expires_in,
        timestamp: Date.now(),
      };

      // If Spotify returns a new refresh token, update it in the stored tokens
      if (data.refresh_token) {
        console.log('Backend: Spotify returned a new refresh token. Updating stored token.');
        updatedTokens.refresh_token = data.refresh_token;
      }

      // updated tokens back to the file
      writeSpotifyTokens(updatedTokens);

      console.log('Backend: Successfully refreshed and updated stored tokens.');
      return data.access_token;
    } else {
      console.error('Backend: refreshStoredAccessToken - Token refresh failed:', data);
      return null;
    }
  } catch (error) {
    console.error('Backend: refreshStoredAccessToken - Error refreshing token:', error);
    return null;
  }
};


// Endpoint to get currently playing track using stored tokens
app.get('/currently-playing', spotifyAuthMiddleware, async (req, res) => {
  console.log('Backend: GET /currently-playing endpoint hit');

  const access_token = req.spotifyAccessToken;

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
app.get('/recently-played', spotifyAuthMiddleware, async (req, res) => {
  console.log('Backend: GET /recently-played endpoint hit');

  const access_token = req.spotifyAccessToken;

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
