const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { ElevenLabsClient } = require('elevenlabs');
const pythonBridge = require('./python_bridge');

// Load appropriate environment variables
if (process.env.NODE_ENV === 'production') {
  require('dotenv').config({ path: '.env.production' });
} else {
  require('dotenv').config();
}

// Initialize Firebase (this will load environment variables)
require('./firebaseConfig');
// Initialize Firebase Admin for server-side operations
require('./firebaseAdmin');

// Verify that environment variables are loaded
console.log('Environment:', process.env.NODE_ENV || 'development');
console.log('ElevenLabs API Key present:', process.env.ELEVENLABS_API_KEY ? 'Yes' : 'No');
if (process.env.ELEVENLABS_API_KEY) {
  console.log('ElevenLabs API Key length:', process.env.ELEVENLABS_API_KEY.length);
  console.log('ElevenLabs API Key prefix:', process.env.ELEVENLABS_API_KEY.substring(0, 5) + '...');
} else {
  console.log('WARNING: ELEVENLABS_API_KEY is not set!');
  
  // Manually set the API key from .env.production
  try {
    const envFile = fs.readFileSync('.env.production', 'utf8');
    const apiKeyMatch = envFile.match(/ELEVENLABS_API_KEY=(.+)/);
    
    if (apiKeyMatch && apiKeyMatch[1]) {
      process.env.ELEVENLABS_API_KEY = apiKeyMatch[1].trim();
      console.log('Manually set ELEVENLABS_API_KEY from .env.production');
      console.log('ElevenLabs API Key length:', process.env.ELEVENLABS_API_KEY.length);
      console.log('ElevenLabs API Key prefix:', process.env.ELEVENLABS_API_KEY.substring(0, 5) + '...');
    } else {
      console.error('Could not find ELEVENLABS_API_KEY in .env.production');
    }
  } catch (error) {
    console.error('Error reading .env.production:', error.message);
  }
}

// Import Firebase auth controller and middleware
const { handleLogin, handleSignup, handleLogout, handlePasswordReset, verifyFirebaseToken } = require('./controllers/oauthController');
const { isAuthenticated, checkAuthStatus } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const cacheDuration = process.env.CACHE_DURATION || 3600000; // 1 hour default

// Add production optimizations
if (isProduction) {
  // Enable compression for faster page loads
  if (process.env.ENABLE_COMPRESSION === 'true') {
    const compression = require('compression');
    app.use(compression());
  }
  
  // Set cache headers for static assets
  app.use(express.static(path.join(__dirname, '../public'), {
    maxAge: cacheDuration
  }));
} else {
  // Development mode - no caching
  app.use(express.static(path.join(__dirname, '../public')));
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure session 
const sessionStore = new session.MemoryStore();

const sessionConfig = {
  name: 'storia.sid',  // Custom name for better security
  secret: process.env.SESSION_SECRET || 'storia-secret-key-change-in-production',
  resave: true,        // Force save session on each request
  saveUninitialized: true,  // Save new sessions
  rolling: true,       // Reset maxAge on every response
  store: sessionStore, // Use explicit MemoryStore
  cookie: {
    secure: isProduction,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    httpOnly: true,
    sameSite: 'lax',
    path: '/'
  }
};

console.log("Session configuration:", {
  name: sessionConfig.name,
  secure: sessionConfig.cookie.secure,
  maxAge: sessionConfig.cookie.maxAge,
  httpOnly: sessionConfig.cookie.httpOnly,
  sameSite: sessionConfig.cookie.sameSite,
  resave: sessionConfig.resave,
  saveUninitialized: sessionConfig.saveUninitialized,
  store: 'MemoryStore'
});

// Apply session middleware
app.use(session(sessionConfig));

// Add session debug middleware
app.use((req, res, next) => {
  const sessionId = req.session.id;
  console.log(`Request path: ${req.path}, Session ID: ${sessionId.substring(0, 6)}...`);
  next();
});

// Apply authentication check middleware
// const { isAuthenticated, checkAuthStatus } = require('./middleware/auth');

// Define public routes that don't require authentication
const publicRoutes = [
  '/',
  '/login',
  '/signup',
  '/reset-password',
  '/auth/verify-firebase-token',
  '/login-callback',
  '/signup-callback',
  '/api/healthcheck'
];

// Custom middleware to check if a route needs authentication
app.use((req, res, next) => {
  // Skip auth check for public routes
  if (publicRoutes.includes(req.path) || req.path.startsWith('/public/') || req.path.endsWith('.js') || req.path.endsWith('.css')) {
    return next();
  }
  
  // Protected route - check authentication
  isAuthenticated(req, res, next);
});

// Add CORS headers for music files
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Set EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Simple in-memory cache for API responses
const cache = {
  data: {},
  set: function(key, value, ttl) {
    const now = Date.now();
    this.data[key] = {
      value,
      expiry: now + ttl
    };
  },
  get: function(key) {
    const now = Date.now();
    const item = this.data[key];
    
    if (!item) return null;
    if (now > item.expiry) {
      delete this.data[key];
      return null;
    }
    
    return item.value;
  }
};

// Simple in-memory user store (replace with a database in production)
const users = new Map();
const userFavorites = new Map(); // Store user favorites

// Middleware to pass user object to all views
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  // Pass Firebase config to views
  res.locals.env = {
    FIREBASE_API_KEY: process.env.FIREBASE_API_KEY,
    FIREBASE_AUTH_DOMAIN: process.env.FIREBASE_AUTH_DOMAIN,
    FIREBASE_STORAGE_BUCKET: process.env.FIREBASE_STORAGE_BUCKET,
    FIREBASE_MESSAGING_SENDER_ID: process.env.FIREBASE_MESSAGING_SENDER_ID,
    FIREBASE_APP_ID: process.env.FIREBASE_APP_ID,
    FIREBASE_MESUREMENT_ID: process.env.FIREBASE_MESUREMENT_ID
  };
  next();
});

// Routes
app.get('/', async (req, res) => {
  res.render('index', { user: req.session.user });
});

// Auth routes
app.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect('/');
  }
  res.render('login', { error: null });
});

app.get('/signup', (req, res) => {
  if (req.session.user) {
    return res.redirect('/');
  }
  res.render('signup', { error: null });
});

app.get('/reset-password', (req, res) => {
  res.render('reset-password', { error: null, message: null });
});

// Firebase authentication routes
app.post('/auth/signup', handleSignup);
app.post('/auth/login', handleLogin);
app.get('/auth/logout', handleLogout);
app.post('/auth/reset-password', handlePasswordReset);
app.post('/auth/verify-firebase-token', verifyFirebaseToken);

// Protected routes
app.get('/books', async (req, res) => {
  try {
    console.log("Books route accessed with user:", req.session.user);
    const userId = req.session.user?.uid;
    const userFavoriteBooks = userId && userFavorites.has(userId) 
      ? userFavorites.get(userId)
      : new Map();
    
    // Get search parameters from query string
    const searchQuery = req.query.search || '';
    const language = req.query.language || '';
    const sort = req.query.sort || 'popular';
    const topic = req.query.topic || '';
    
    // Only use cache if no search parameters are provided
    const useCache = !searchQuery && !language && !topic && sort === 'popular';
    const cacheKey = 'books_list';
    const cachedData = useCache ? cache.get(cacheKey) : null;
    
    let books;
    if (cachedData) {
      books = cachedData;
    } else {
      // Build query parameters for Gutendex API
      const params = {
        page: 1,
        per_page: 32
      };
      
      // Add search parameters if provided
      if (searchQuery) {
        params.search = searchQuery;
      }
      
      if (language) {
        params.languages = language;
      }
      
      if (topic) {
        params.topic = topic;
      }
      
      // Handle sorting
      if (sort === 'popular') {
        // Default sorting in Gutendex is by popularity
      } else if (sort === 'title') {
        params.sort = 'title';
      } else if (sort === 'author') {
        params.sort = 'author';
      } else if (sort === 'recent') {
        params.sort = 'recent';
      }
      
      console.log('Fetching books with params:', params);
      
      const response = await axios.get('https://gutendex.com/books/', {
        params
      });
      
      books = response.data.results;
      
      // Only cache results if no search parameters were used
      if (useCache) {
        cache.set(cacheKey, books, cacheDuration);
      }
    }
    
    // Add isFavorite flag to each book
    books = books.map(book => ({
      ...book,
      isFavorite: userFavoriteBooks.has(book.id.toString())
    }));
    
    res.render('books', { 
      books, 
      user: req.session.user,
      error: null,
      searchQuery,
      language,
      sort,
      topic
    });
  } catch (error) {
    console.error('Error fetching books:', error);
    res.render('books', { 
      books: [], 
      error: 'Failed to fetch books. Please try again later.',
      user: req.session.user,
      searchQuery: req.query.search || '',
      language: req.query.language || '',
      sort: req.query.sort || 'popular',
      topic: req.query.topic || ''
    });
  }
});

// Book details route
app.get('/book/:id', async (req, res) => {
  try {
    const bookId = req.params.id;
    
    // Check if book is in user's favorites
    const userId = req.session.user?.uid;
    const userFavoriteBooks = userId && userFavorites.has(userId) 
      ? userFavorites.get(userId)
      : new Map();
    const isFavorite = userFavoriteBooks.has(bookId);
    
    // Dummy book data - replace with actual data in production
    const bookData = findBookById(bookId);
    
    if (!bookData) {
      return res.status(404).render('404', { 
        user: req.session.user || null, 
        message: 'Book not found'
      });
    }
    
    res.render('book-detail', { 
      user: req.session.user || null,
      book: bookData,
      isFavorite
    });
  } catch (error) {
    console.error('Error fetching book details:', error);
    res.status(500).render('error', { 
      user: req.session.user || null,
      error: 'Failed to load book details'
    });
  }
});

// Route for reading a book
app.get('/read/:id', async (req, res) => {
  try {
    const bookId = req.params.id;
    
    // Dummy book data - replace with actual data in production
    const bookData = findBookById(bookId);
    
    if (!bookData) {
      return res.status(404).render('404', { 
        user: req.session.user || null, 
        message: 'Book not found'
      });
    }
    
    res.render('reader', { 
      user: req.session.user || null,
      book: bookData
    });
  } catch (error) {
    console.error('Error fetching book for reading:', error);
    res.status(500).render('error', { 
      user: req.session.user || null,
      error: 'Failed to load book content'
    });
  }
});

// Profile route
app.get('/profile', isAuthenticated, (req, res) => {
  const userId = req.session.user.uid;
  const favorites = userFavorites.has(userId) 
    ? Array.from(userFavorites.get(userId).values())
    : [];

  res.render('profile', {
    user: req.session.user,
    title: 'Profile | Storia',
    favorites: favorites
  });
});

// Add favorite book
app.post('/api/favorites/add', isAuthenticated, (req, res) => {
  const { bookId, bookTitle, bookAuthor, bookCover } = req.body;
  const userId = req.session.user.uid;

  if (!userFavorites.has(userId)) {
    userFavorites.set(userId, new Map());
  }

  userFavorites.get(userId).set(bookId, {
    id: bookId,
    title: bookTitle,
    author: bookAuthor,
    cover: bookCover,
    addedAt: new Date()
  });

  res.json({ success: true });
});

// Remove favorite book
app.post('/api/favorites/remove', isAuthenticated, (req, res) => {
  const { bookId } = req.body;
  const userId = req.session.user.uid;

  if (userFavorites.has(userId)) {
    userFavorites.get(userId).delete(bookId);
  }

  res.json({ success: true });
});

// Get user favorites
app.get('/api/favorites', isAuthenticated, (req, res) => {
  const userId = req.session.user.uid;
  const favorites = userFavorites.has(userId) 
    ? Array.from(userFavorites.get(userId).values())
    : [];

  res.json(favorites);
});

// Search page route
app.get('/search', async (req, res) => {
  try {
    const userId = req.session.user?.uid;
    const userFavoriteBooks = userId && userFavorites.has(userId) 
      ? userFavorites.get(userId)
      : new Map();
    
    // Get search parameters from query string
    const searchQuery = req.query.q || '';
    const language = req.query.language || '';
    const sort = req.query.sort || 'popular';
    const topic = req.query.topic || '';
    const page = parseInt(req.query.page) || 1;
    
    // If no search query, just render the search page
    if (!searchQuery && page === 1) {
      return res.render('search', {
        books: [],
        user: req.session.user,
        error: null,
        searchQuery,
        language,
        sort,
        topic,
        page,
        totalPages: 0,
        hasNextPage: false,
        hasPrevPage: false,
        noResults: false
      });
    }
    
    // Build query parameters for Gutendex API
    const params = {
      page,
      per_page: 24
    };
    
    // Add search parameters if provided
    if (searchQuery) {
      params.search = searchQuery;
    }
    
    if (language) {
      params.languages = language;
    }
    
    if (topic) {
      params.topic = topic;
    }
    
    // Handle sorting
    if (sort === 'popular') {
      // Default sorting in Gutendex is by popularity
    } else if (sort === 'title') {
      params.sort = 'title';
    } else if (sort === 'author') {
      params.sort = 'author';
    } else if (sort === 'recent') {
      params.sort = 'recent';
    }
    
    console.log('Searching books with params:', params);
    
    const response = await axios.get('https://gutendex.com/books/', {
      params
    });
    
    const books = response.data.results;
    const totalCount = response.data.count || 0;
    const totalPages = Math.ceil(totalCount / 24);
    const hasNextPage = response.data.next !== null;
    const hasPrevPage = response.data.previous !== null;
    
    // Add isFavorite flag to each book
    const booksWithFavorites = books.map(book => ({
      ...book,
      isFavorite: userFavoriteBooks.has(book.id.toString())
    }));
    
    res.render('search', { 
      books: booksWithFavorites, 
      user: req.session.user,
      error: null,
      searchQuery,
      language,
      sort,
      topic,
      page,
      totalPages,
      hasNextPage,
      hasPrevPage,
      noResults: books.length === 0 && searchQuery
    });
  } catch (error) {
    console.error('Error searching books:', error);
    res.render('search', { 
      books: [], 
      error: 'Failed to search books. Please try again later.',
      user: req.session.user,
      searchQuery: req.query.q || '',
      language: req.query.language || '',
      sort: req.query.sort || 'popular',
      topic: req.query.topic || '',
      page: parseInt(req.query.page) || 1,
      totalPages: 0,
      hasNextPage: false,
      hasPrevPage: false,
      noResults: false
    });
  }
});

// Generate background music API endpoint
app.post('/api/music/generate', async (req, res) => {
  try {
    const { text } = req.body;
    
    console.log('===== MUSIC GENERATION REQUEST =====');
    console.log(`Received text of length: ${text ? text.length : 0}`);
    
    if (!text) {
      console.error('No text provided in request');
      return res.status(400).json({ error: 'Text content is required' });
    }
    
    // First, generate an ambiance prompt using the Python script
    console.log('Calling Python ambiance generator script...');
    console.log(`Text preview: "${text.substring(0, 100)}..."`);
    
    // Check Python availability before calling
    const isPythonAvailable = await pythonBridge.isPythonAvailable();
    console.log(`Python availability check: ${isPythonAvailable ? 'AVAILABLE' : 'NOT AVAILABLE'}`);
    
    if (!isPythonAvailable) {
      console.error('Python is not available on this system');
      return res.status(500).json({ 
        error: 'Python is not available on this system',
        details: 'The ambiance generator requires Python to be installed.'
      });
    }
    
    // Generate ambiance prompt
    console.log('Generating ambiance prompt for music...');
    const ambianceResult = await pythonBridge.generateAmbiancePrompt(text);
    
    console.log('Ambiance generation completed');
    console.log('Result structure:', Object.keys(ambianceResult));
    
    // Extract the ambiance prompt
    const ambiancePrompt = ambianceResult.ambiance_prompt;
    const mood = ambianceResult.mood || 'neutral';
    
    console.log(`Detected mood: "${mood}"`);
    console.log(`Ambiance prompt: "${ambiancePrompt}"`);
    
    // If there was an error in ambiance generation, log it but continue
    if (ambianceResult.error) {
      console.warn('Warning in ambiance generation:', ambianceResult.error);
    }
    
    // Get the API key directly from environment variables
    const apiKey = process.env.ELEVENLABS_API_KEY;
    
    if (!apiKey) {
      console.error('ELEVENLABS_API_KEY not found in environment variables');
      throw new Error('ELEVENLABS_API_KEY is not set in environment variables');
    }
    
    console.log('API Key length:', apiKey.length);
    console.log('API Key prefix:', apiKey.substring(0, 5) + '...');
    
    // Make a direct API call using axios instead of the client library
    try {
      console.log('Making direct API call to ElevenLabs...');
      
      const response = await axios({
        method: 'post',
        url: 'https://api.elevenlabs.io/v1/sound-generation',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': apiKey
        },
        data: {
          text: ambiancePrompt,
          duration_seconds: 15,
          prompt_influence: 0.5
        },
        responseType: 'arraybuffer',
        timeout: 30000
      });
      
      console.log('Direct API call successful');
      console.log('Response status:', response.status);
      console.log('Response data length:', response.data.length);
      
      // Send the detected mood in the response headers
      res.set('X-Detected-Mood', mood);
      res.set('X-Ambiance-Prompt', ambiancePrompt.substring(0, 100) + (ambiancePrompt.length > 100 ? '...' : ''));
      
      // Send the audio data back to the client
      res.set('Content-Type', 'audio/mpeg');
      res.send(Buffer.from(response.data));
    } catch (apiError) {
      console.error('ElevenLabs API error:', apiError.message);
      
      // Use fallback audio based on mood
      let fallbackAudioPath;
      
      // Select a fallback audio file based on the detected mood
      switch (mood.toLowerCase()) {
        case 'happy':
        case 'joyful':
        case 'cheerful':
          fallbackAudioPath = path.join(__dirname, '../public/audio/fallback-happy.mp3');
          break;
        case 'sad':
        case 'melancholic':
        case 'somber':
          fallbackAudioPath = path.join(__dirname, '../public/audio/fallback-sad.mp3');
          break;
        case 'tense':
        case 'suspenseful':
        case 'anxious':
          fallbackAudioPath = path.join(__dirname, '../public/audio/fallback-tense.mp3');
          break;
        case 'peaceful':
        case 'calm':
        case 'serene':
          fallbackAudioPath = path.join(__dirname, '../public/audio/fallback-peaceful.mp3');
          break;
        case 'exciting':
        case 'thrilling':
        case 'energetic':
          fallbackAudioPath = path.join(__dirname, '../public/audio/fallback-exciting.mp3');
          break;
        case 'romantic':
        case 'loving':
          fallbackAudioPath = path.join(__dirname, '../public/audio/fallback-romantic.mp3');
          break;
        case 'mysterious':
        case 'enigmatic':
          fallbackAudioPath = path.join(__dirname, '../public/audio/fallback-mysterious.mp3');
          break;
        default:
          fallbackAudioPath = path.join(__dirname, '../public/audio/fallback-neutral.mp3');
      }
      
      // Check if the fallback audio file exists
      try {
        if (fs.existsSync(fallbackAudioPath)) {
          // Read the fallback audio file
          const fallbackAudio = fs.readFileSync(fallbackAudioPath);
          
          // Send the fallback audio
          res.set('X-Detected-Mood', mood);
          res.set('X-Ambiance-Prompt', ambiancePrompt.substring(0, 100) + (ambiancePrompt.length > 100 ? '...' : ''));
          res.set('X-Fallback-Audio', 'true');
          res.set('Content-Type', 'audio/mpeg');
          res.send(fallbackAudio);
        } else {
          // If the specific mood fallback doesn't exist, try the neutral one
          const neutralFallbackPath = path.join(__dirname, '../public/audio/fallback-neutral.mp3');
          
          if (fs.existsSync(neutralFallbackPath)) {
            const neutralFallback = fs.readFileSync(neutralFallbackPath);
            res.set('X-Detected-Mood', 'neutral');
            res.set('X-Ambiance-Prompt', ambiancePrompt.substring(0, 100) + (ambiancePrompt.length > 100 ? '...' : ''));
            res.set('X-Fallback-Audio', 'true');
            res.set('Content-Type', 'audio/mpeg');
            res.send(neutralFallback);
          } else {
            // If no fallback exists, create a simple audio buffer
            console.log('No fallback audio files available, creating empty audio');
            const emptyAudio = Buffer.alloc(1024);
            res.set('X-Detected-Mood', 'neutral');
            res.set('X-Ambiance-Prompt', ambiancePrompt.substring(0, 100) + (ambiancePrompt.length > 100 ? '...' : ''));
            res.set('X-Fallback-Audio', 'true');
            res.set('Content-Type', 'audio/mpeg');
            res.send(emptyAudio);
          }
        }
      } catch (fallbackError) {
        console.error('Fallback audio error:', fallbackError.message);
        
        // Create a simple audio buffer as a last resort
        console.log('Creating empty audio as last resort');
        const emptyAudio = Buffer.alloc(1024);
        res.set('X-Detected-Mood', 'neutral');
        res.set('X-Ambiance-Prompt', ambiancePrompt.substring(0, 100) + (ambiancePrompt.length > 100 ? '...' : ''));
        res.set('X-Fallback-Audio', 'true');
        res.set('Content-Type', 'audio/mpeg');
        res.send(emptyAudio);
      }
    }
  } catch (error) {
    console.error('Error generating music:', error.message);
    
    // Provide more detailed error information
    let errorMessage = 'Failed to generate music';
    let statusCode = 500;
    
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      statusCode = error.response.status;
      console.error(`ElevenLabs API responded with status ${statusCode}`);
      console.error('Response headers:', JSON.stringify(error.response.headers));
      
      if (error.response.data) {
        try {
          // Try to parse the error data if it's in buffer format
          let errorData;
          if (error.response.data instanceof Buffer) {
            const dataString = error.response.data.toString();
            try {
              errorData = JSON.parse(dataString);
            } catch (e) {
              errorData = { message: dataString };
            }
          } else {
            errorData = error.response.data;
          }
          
          console.error('Error details:', errorData);
          errorMessage = `ElevenLabs API error: ${errorData.detail || errorData.message || 'Unknown error'}`;
        } catch (e) {
          console.error('Could not parse error response:', e.message);
        }
      }
    } else if (error.request) {
      // The request was made but no response was received
      console.error('No response received from ElevenLabs API');
      errorMessage = 'No response from ElevenLabs API';
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error('Error setting up request:', error.message);
      errorMessage = `Request setup error: ${error.message}`;
    }
    
    res.status(statusCode).json({ 
      error: errorMessage,
      details: error.message
    });
  }
});

// Generate ambiance prompt API endpoint
app.post('/api/ambiance/generate', async (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'Text content is required' });
    }
    
    console.log('Generating ambiance prompt for text of length:', text.length);
    
    // Call the Python script to generate an ambiance prompt
    const result = await pythonBridge.generateAmbiancePrompt(text);
    
    // Log the generated prompt
    console.log('Generated ambiance prompt:', result.ambiance_prompt);
    
    // Check if there was an error
    if (result.error) {
      console.warn('Warning in ambiance generation:', result.error);
    }
    
    // Send the result back to the client
    res.json(result);
  } catch (error) {
    console.error('Error generating ambiance prompt:', error.message);
    res.status(500).json({ 
      error: 'Failed to generate ambiance prompt',
      details: error.message
    });
  }
});

// Helper function to generate a music prompt based on text content
function generateMusicPrompt(text) {
  // Extract key themes, emotions, and setting from the text
  const cleanText = text.replace(/\n/g, ' ').trim();
  const excerpt = cleanText.substring(0, 1000); // Use first 1000 characters
  
  // Analyze text for mood and themes
  const moodKeywords = {
    happy: ['happy', 'joy', 'laugh', 'smile', 'delight', 'cheerful', 'merry'],
    sad: ['sad', 'sorrow', 'grief', 'weep', 'tear', 'mourn', 'melancholy'],
    tense: ['fear', 'danger', 'threat', 'worry', 'anxious', 'terror', 'horror'],
    peaceful: ['peace', 'calm', 'tranquil', 'serene', 'gentle', 'quiet', 'still'],
    exciting: ['adventure', 'thrill', 'exciting', 'action', 'rush', 'speed', 'chase'],
    romantic: ['love', 'romance', 'passion', 'embrace', 'kiss', 'tender', 'affection'],
    mysterious: ['mystery', 'secret', 'unknown', 'strange', 'curious', 'wonder', 'enigma']
  };
  
  // Count occurrences of mood keywords
  const moodCounts = {};
  for (const [mood, keywords] of Object.entries(moodKeywords)) {
    moodCounts[mood] = 0;
    keywords.forEach(keyword => {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      const matches = excerpt.match(regex);
      if (matches) {
        moodCounts[mood] += matches.length;
      }
    });
  }
  
  // Determine dominant mood
  let dominantMood = 'neutral';
  let maxCount = 0;
  for (const [mood, count] of Object.entries(moodCounts)) {
    if (count > maxCount) {
      maxCount = count;
      dominantMood = mood;
    }
  }
  
  // Create a concise prompt for the ElevenLabs sound effects API
  let prompt;
  
  switch (dominantMood) {
    case 'happy':
      prompt = "Uplifting, cheerful background music with major keys and a moderate tempo";
      break;
    case 'sad':
      prompt = "Melancholic, emotional background music with minor keys and a slow tempo";
      break;
    case 'tense':
      prompt = "Suspenseful, tense background music with dissonant chords and a building rhythm";
      break;
    case 'peaceful':
      prompt = "Calm, serene background music with soft instruments and a slow, flowing tempo";
      break;
    case 'exciting':
      prompt = "Energetic, adventurous background music with a fast tempo and strong rhythms";
      break;
    case 'romantic':
      prompt = "Tender, emotional background music with string instruments and a gentle melody";
      break;
    case 'mysterious':
      prompt = "Intriguing, enigmatic background music with unusual harmonies and a moderate tempo";
      break;
    default:
      prompt = "Balanced, subtle background music with a mix of instruments and a moderate tempo";
  }
  
  // Add that it should be suitable for reading
  prompt += " suitable for reading background music, instrumental without vocals";
  
  return { prompt, mood: dominantMood };
}

// Debug endpoint to check if environment variables are loaded correctly
app.get('/api/debug/env', (req, res) => {
  // Only enable in development mode for security
  if (process.env.NODE_ENV !== 'production') {
    res.json({
      nodeEnv: process.env.NODE_ENV,
      elevenlabsKeyLength: process.env.ELEVENLABS_API_KEY ? process.env.ELEVENLABS_API_KEY.length : 0,
      elevenlabsKeyPrefix: process.env.ELEVENLABS_API_KEY ? process.env.ELEVENLABS_API_KEY.substring(0, 5) + '...' : 'not set',
      port: process.env.PORT,
      cacheDuration: process.env.CACHE_DURATION,
      enableCompression: process.env.ENABLE_COMPRESSION
    });
  } else {
    res.status(403).json({ error: 'Debug endpoints are disabled in production mode' });
  }
});

// Test endpoint to check ElevenLabs API connectivity
app.get('/api/test/elevenlabs', async (req, res) => {
  try {
    // Only enable in development mode for security
    if (process.env.NODE_ENV !== 'production') {
      // Test connection to ElevenLabs API
      const response = await axios.get('https://api.elevenlabs.io/v1/models', {
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY
        }
      });
      
      res.json({
        status: 'success',
        message: 'Successfully connected to ElevenLabs API',
        models: response.data.models ? response.data.models.map(m => m.model_id) : []
      });
    } else {
      res.status(403).json({ error: 'Test endpoints are disabled in production mode' });
    }
  } catch (error) {
    console.error('Error testing ElevenLabs API:', error.message);
    
    let errorDetail = 'Unknown error';
    let statusCode = 500;
    
    if (error.response) {
      statusCode = error.response.status;
      errorDetail = error.response.data ? JSON.stringify(error.response.data) : error.response.statusText;
    } else if (error.request) {
      errorDetail = 'No response received from ElevenLabs API';
    } else {
      errorDetail = error.message;
    }
    
    res.status(statusCode).json({
      status: 'error',
      message: 'Failed to connect to ElevenLabs API',
      error: errorDetail
    });
  }
});

// Simple test endpoint
app.get('/api/test', (req, res) => {
  res.json({
    status: 'success',
    message: 'API server is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// API key check endpoint
app.get('/api/check-key-direct', async (req, res) => {
  try {
    // Get the API key directly from environment variables
    const apiKey = process.env.ELEVENLABS_API_KEY;
    
    if (!apiKey) {
      return res.status(400).json({
        status: 'error',
        message: 'ELEVENLABS_API_KEY is not set in environment variables',
        keyLength: 0,
        keyPrefix: 'none'
      });
    }
    
    console.log('Checking API key, length:', apiKey.length);
    console.log('API Key prefix:', apiKey.substring(0, 5) + '...');
    
    // Make a direct API call to check if the key is valid
    try {
      const response = await axios({
        method: 'get',
        url: 'https://api.elevenlabs.io/v1/voices',
        headers: {
          'Accept': 'application/json',
          'xi-api-key': apiKey
        },
        timeout: 10000
      });
      
      // If we get here, the API key is valid
      const voicesCount = response.data.voices ? response.data.voices.length : 0;
      
      return res.json({
        status: 'success',
        message: 'API key is valid',
        keyLength: apiKey.length,
        keyPrefix: apiKey.substring(0, 5) + '...',
        voicesCount: voicesCount
      });
    } catch (apiError) {
      console.error('API key validation error:', apiError.message);
      
      // Check if we got a response with status code
      if (apiError.response) {
        return res.status(apiError.response.status).json({
          status: 'error',
          message: `API key validation failed with status ${apiError.response.status}`,
          details: apiError.response.data || apiError.message,
          keyLength: apiKey.length,
          keyPrefix: apiKey.substring(0, 5) + '...'
        });
      } else if (apiError.request) {
        // The request was made but no response was received
        return res.status(500).json({
          status: 'error',
          message: 'No response received from ElevenLabs API',
          details: apiError.message,
          keyLength: apiKey.length,
          keyPrefix: apiKey.substring(0, 5) + '...'
        });
      } else {
        // Something happened in setting up the request
        return res.status(500).json({
          status: 'error',
          message: 'Error setting up request to ElevenLabs API',
          details: apiError.message,
          keyLength: apiKey.length,
          keyPrefix: apiKey.substring(0, 5) + '...'
        });
      }
    }
  } catch (error) {
    console.error('Error checking API key:', error.message);
    
    return res.status(500).json({
      status: 'error',
      message: 'Error checking API key',
      details: error.message
    });
  }
});

// Test audio endpoint
app.get('/api/test-audio', (req, res) => {
  const mood = req.query.mood || 'neutral';
  
  // Create a simple audio buffer (empty audio)
  const audioBuffer = Buffer.alloc(1024);
  
  res.set('X-Detected-Mood', mood);
  res.set('X-Test-Audio', 'true');
  res.set('Content-Type', 'audio/mpeg');
  res.send(audioBuffer);
});

// Debug endpoint for testing the ambiance generator directly
app.post('/api/debug/ambiance', async (req, res) => {
  try {
    const { text } = req.body;
    
    console.log('===== DEBUG AMBIANCE REQUEST =====');
    console.log(`Received text of length: ${text ? text.length : 0}`);
    
    if (!text) {
      console.error('No text provided in request');
      return res.status(400).json({ error: 'Text content is required' });
    }
    
    // Check Python availability before calling
    const isPythonAvailable = await pythonBridge.isPythonAvailable();
    console.log(`Python availability check: ${isPythonAvailable ? 'AVAILABLE' : 'NOT AVAILABLE'}`);
    
    if (!isPythonAvailable) {
      console.error('Python is not available on this system');
      return res.status(500).json({ 
        error: 'Python is not available on this system',
        details: 'The ambiance generator requires Python to be installed.'
      });
    }
    
    // Generate ambiance prompt directly
    console.log('Calling ambiance generator for debugging...');
    console.log(`Text preview: "${text.substring(0, 100)}..."`);
    
    const ambianceResult = await pythonBridge.generateAmbiancePrompt(text);
    
    console.log('Ambiance generation completed for debug request');
    console.log('Result:', JSON.stringify(ambianceResult, null, 2));
    
    // Return the complete result to the client
    res.json({
      success: true,
      result: ambianceResult,
      python_available: isPythonAvailable,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in debug ambiance endpoint:', error);
    res.status(500).json({ 
      error: 'Failed to generate ambiance prompt',
      details: error.message,
      stack: error.stack
    });
  }
});

// Generate music directly from text (one-step process)
app.post('/api/music/generate-from-text', async (req, res) => {
  try {
    const { text, duration, page } = req.body;
    
    console.log('===== DIRECT MUSIC GENERATION REQUEST =====');
    console.log(`Received text of length: ${text ? text.length : 0}`);
    console.log(`For page: ${page !== undefined ? page : 'not specified'}`);
    
    if (!text) {
      console.error('No text provided in request');
      return res.status(400).json({ error: 'Text content is required' });
    }
    
    // Check if we have cached music for this page
    if (page !== undefined) {
      const musicCacheKey = `music_page_${page}`;
      const cachedMusic = cache.get(musicCacheKey);
      
      if (cachedMusic) {
        console.log(`Using cached music for page ${page}`);
        
        // Set response headers with metadata from cache
        res.set('X-Detected-Mood', cachedMusic.mood);
        res.set('X-Ambiance-Prompt', cachedMusic.ambiance_prompt.substring(0, 100) + 
          (cachedMusic.ambiance_prompt.length > 100 ? '...' : ''));
        res.set('X-Cached', 'true');
        
        // Send the cached audio data
        res.set('Content-Type', 'audio/mpeg');
        res.send(cachedMusic.audio);
        return;
      }
    }
    
    // Use our integrated function that handles both ambiance generation and music creation
    console.log('Generating music directly from text...');
    const result = await pythonBridge.generateMusicFromText(
      text, 
      duration || 15.0
    );
    
    if (result.error || !result.audio) {
      console.error('Error generating music from text:', result.error);
      
      // Try to use fallback audio
      const fallbackAudioPath = path.join(__dirname, `../public/audio/fallback-${result.mood || 'neutral'}.mp3`);
      
      if (fs.existsSync(fallbackAudioPath)) {
        const fallbackAudio = fs.readFileSync(fallbackAudioPath);
        
        // Send the fallback audio
        res.set('X-Detected-Mood', result.mood || 'neutral');
        res.set('X-Ambiance-Prompt', result.ambiance_prompt.substring(0, 100) + 
          (result.ambiance_prompt.length > 100 ? '...' : ''));
        res.set('X-Fallback-Audio', 'true');
        res.set('X-Error', result.error || 'Failed to generate music');
        res.set('Content-Type', 'audio/mpeg');
        res.send(fallbackAudio);
        return;
      } else {
        return res.status(500).json({ 
          error: result.error || 'Failed to generate music',
          mood: result.mood,
          ambiance_prompt: result.ambiance_prompt
        });
      }
    }
    
    // Cache the music for this page if page is specified
    if (page !== undefined) {
      const musicCacheKey = `music_page_${page}`;
      cache.set(musicCacheKey, {
        audio: result.audio,
        mood: result.mood,
        ambiance_prompt: result.ambiance_prompt
      }, cacheDuration * 2); // Cache music for twice as long as other data
      
      console.log(`Cached music for page ${page}`);
    }
    
    // Set response headers with metadata
    res.set('X-Detected-Mood', result.mood);
    res.set('X-Ambiance-Prompt', result.ambiance_prompt.substring(0, 100) + 
      (result.ambiance_prompt.length > 100 ? '...' : ''));
    
    // Send the audio data
    res.set('Content-Type', 'audio/mpeg');
    res.send(result.audio);
    
  } catch (error) {
    console.error('Error in direct music generation:', error.message);
    res.status(500).json({ 
      error: 'Failed to generate music',
      details: error.message
    });
  }
});

// Function to get book details by ID
async function getBookById(bookId) {
  try {
    // Check cache for book details
    const bookCacheKey = `book_${bookId}`;
    let book = cache.get(bookCacheKey);
    
    if (!book) {
      // Fetch book details if not in cache
      const bookResponse = await axios.get(`https://gutendex.com/books/${bookId}`);
      book = bookResponse.data;
      cache.set(bookCacheKey, book, cacheDuration);
    }
    
    return book;
  } catch (error) {
    console.error(`Error fetching book ${bookId}:`, error.message);
    return null;
  }
}

// Error handling middleware
app.use((req, res, next) => {
  res.status(404).render('error', { 
    error: 'Page not found',
    message: 'The page you are looking for does not exist.',
    user: req.session.user
  });
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  
  // Check if the error is related to the read-book template
  if (err.path && err.path.includes('read-book.ejs')) {
    // If it's a read-book template error, render with the necessary variables
    return res.status(500).render('read-book', {
      book: null,
      error: 'An error occurred while rendering the book page.',
      page: 0,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
      currentPageContent: ''
    });
  }
  
  // For other errors, use the general error template
  res.status(500).render('error', { 
    error: 'Server Error',
    message: 'Something went wrong on our end. Please try again later.',
    user: req.session.user
  });
});

// Start the server
const server = app.listen(PORT, () => {
  console.log(`Server is running in ${process.env.NODE_ENV || 'development'} mode on http://localhost:${PORT}`);
});

// For Vercel serverless deployment
module.exports = app; 