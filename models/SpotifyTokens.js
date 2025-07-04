import mongoose from 'mongoose';

const spotifyTokensSchema = new mongoose.Schema({
  access_token: {
    type: String,
    required: true,
  },
  refresh_token: {
    type: String,
    required: true,
  },
  expires_in: {
    type: Number,
    required: true,
  },
  timestamp: {
    type: Number, // Store as Unix timestamp (milliseconds)
    required: true,
  },
});

const SpotifyTokens = mongoose.model('SpotifyTokens', spotifyTokensSchema);

export default SpotifyTokens;