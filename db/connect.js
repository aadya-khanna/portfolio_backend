import mongoose from 'mongoose';
import 'dotenv/config'; // Ensure environment variables are available if this file is imported first

const MONGODB_URI = process.env.MONGODB_URI;

// 1. Singleton Cache: Store the connection object here
let cachedDb = null;

export async function connectToDatabase() {
  if (cachedDb) {
    console.log('Backend: Using existing MongoDB connection from cache.');
    return cachedDb;
  }

  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI environment variable is not set.');
  }
  
  try {
    // 2. Establish connection with pooling options
    const connection = await mongoose.connect(MONGODB_URI, {
      // Optional: Explicitly limit the pool size for a portfolio/basic cluster
      maxPoolSize: 5, 
      minPoolSize: 1, 
      serverSelectionTimeoutMS: 5000, 
    });
    
    console.log('Backend: New MongoDB connection established and cached.');
    
    // 3. Cache the new connection
    cachedDb = connection;
    return cachedDb;
    
  } catch (error) {
    console.error('Backend: FATAL MongoDB connection error:', error);
    throw error;
  }
}