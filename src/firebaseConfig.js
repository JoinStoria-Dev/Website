const { initializeApp } = require('firebase/app');
const { getAuth } = require('firebase/auth');

// Firebase configuration from environment variables
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: 'storiaapp-a1bd8', // This is fixed in Firebase and doesn't need to be in .env
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
  measurementId: process.env.FIREBASE_MESUREMENT_ID
};

// Log Firebase configuration to ensure it's properly loaded
console.log('Initializing Firebase with config:');
console.log(`  - API Key: ${firebaseConfig.apiKey ? firebaseConfig.apiKey.substring(0, 5) + '...' : 'undefined'}`);
console.log(`  - Auth Domain: ${firebaseConfig.authDomain || 'undefined'}`);
console.log(`  - Project ID: ${firebaseConfig.projectId || 'undefined'}`);
console.log(`  - Storage Bucket: ${firebaseConfig.storageBucket || 'undefined'}`);

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

console.log('Firebase Auth initialized successfully');

module.exports = { app, auth }; 