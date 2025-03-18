const admin = require('firebase-admin');
const serviceAccount = require('./firebaseServiceAccount');

// Initialize Firebase Admin SDK with multiple fallback methods
try {
  // Check if Firebase Admin is already initialized
  if (!admin.apps.length) {
    // Try to initialize with service account first
    try {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: 'storiaapp-a1bd8',
        databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`
      });
      console.log('Firebase Admin SDK initialized with service account');
    } catch (certError) {
      console.warn('Failed to initialize with cert, trying alternative method:', certError.message);
      
      // Try with application default credentials as fallback
      try {
        admin.initializeApp({
          projectId: 'storiaapp-a1bd8'
          // No credential specified - will try to use application default credentials
        });
        console.log('Firebase Admin SDK initialized with application default credentials');
      } catch (adcError) {
        console.warn('Failed to initialize with ADC, using anonymous auth:', adcError.message);
        
        // Last resort - initialize with minimal config
        // This won't allow admin features but at least the app will start
        admin.initializeApp({
          projectId: 'storiaapp-a1bd8',
          apiKey: process.env.FIREBASE_API_KEY
        });
        console.log('Firebase Admin SDK initialized with minimal config (limited functionality)');
      }
    }
  } else {
    console.log('Firebase Admin SDK already initialized');
  }
} catch (error) {
  console.error('Firebase Admin initialization error:', error);
}

module.exports = admin; 