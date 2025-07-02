import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import querystring from 'querystring';

import fs from 'fs';
import path from 'path';

dotenv.config();

const DELETE_SECRET = process.env.DELETE_SECRET; // Read the delete secret from environment variables

const app = express();
const port = process.env.PORT || 8888;

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const notesFilePath = path.join(__dirname, 'notes.json');

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
  origin: "https://portfolio-frontend-seven-ashy.vercel.app",
  credentials: true
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

      if (response.ok) {
        const access_token = data.access_token;
        const refresh_token = data.refresh_token;

        // Redirect to frontend with tokens
        res.redirect(FRONTEND_URI + '/about#' +
          querystring.stringify({
            access_token: access_token,
            refresh_token: refresh_token,
            state: state // Pass state back to frontend if needed
          }));
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

app.get('/refresh_token', async (req, res) => {
  const refresh_token = req.query.refresh_token;
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
    const response = await fetch('https://accounts.spotify.com/api/token', authOptions);
    const data = await response.json();

    if (response.ok) {
      const access_token = data.access_token;
      res.send({
        'access_token': access_token
      });
    } else {
      res.status(response.status).send(data);
    }
  } catch (error) {
    console.error('Error refreshing token:', error);
    res.status(500).send({ error: 'api_error' });
  }
});

app.get('/currently-playing', async (req, res) => {
  const access_token = req.query.access_token;
  
  if (!access_token) {
    return res.status(400).send({ error: 'Access token is required' });
  }

  const options = {
    headers: {
      'Authorization': 'Bearer ' + access_token
    }
  };

  try {
    const response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', options);
    
    if (response.status === 204) { // No content
      return res.status(200).send({ message: 'No currently playing track' });
    }
    
    const data = await response.json();

    if (response.ok) {
      res.send(data);
    } else {
      console.error('Spotify API Error:', data);
      res.status(response.status).send(data);
    }
  } catch (error) {
    console.error('Error fetching currently playing track:', error);
    res.status(500).send({ 
      error: 'api_error',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

app.get('/recently-played', async (req, res) => {
  const access_token = req.query.access_token;
  const options = {
    headers: {
      'Authorization': 'Bearer ' + access_token
    }
  };

  try {
    const response = await fetch('https://api.spotify.com/v1/me/player/recently-played', options);
    const data = await response.json();

    if (response.ok) {
      res.send(data);
    } else {
      res.status(response.status).send(data);
    }
  } catch (error) {
    console.error('Error fetching recently played tracks:', error);
    res.status(500).send({ error: 'api_error' });
  }
});

app.listen(port, () => {
  console.log(`Backend listening at http://localhost:${port}`);
});
