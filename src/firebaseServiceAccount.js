/**
 * Firebase service account credentials for admin access
 * NOTE: For production, use the full JSON file downloaded from Firebase Console
 */

// Create a minimal service account structure with required fields
const serviceAccount = {
  type: 'service_account',
  project_id: 'storiaapp-a1bd8',
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID || '',
  // Convert the private key string format correctly (replace escaped newlines)
  private_key: process.env.FIREBASE_PRIVATE_KEY ? 
    process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : '',
  client_email: process.env.FIREBASE_CLIENT_EMAIL || '',
  client_id: process.env.FIREBASE_CLIENT_ID || '',
  auth_uri: 'https://accounts.google.com/o/oauth2/auth',
  token_uri: 'https://oauth2.googleapis.com/token',
  auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
  client_x509_cert_url: process.env.FIREBASE_CERT_URL || '',
  universe_domain: 'googleapis.com'
};

// Log minimal service account info for debugging
console.log('Service Account Configuration:');
console.log('- Project ID:', serviceAccount.project_id);
console.log('- Client Email Set:', !!serviceAccount.client_email);
console.log('- Private Key Set:', !!serviceAccount.private_key);

module.exports = serviceAccount; 