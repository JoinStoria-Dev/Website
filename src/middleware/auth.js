const { auth } = require('../firebaseConfig');

// Middleware to check if user is authenticated via session
const isAuthenticated = (req, res, next) => {
  console.log("------------------------------------");
  console.log("isAuthenticated middleware called for path:", req.path);
  console.log("Session exists:", !!req.session);
  console.log("Session ID:", req.session?.id ? req.session.id.substring(0, 6) + '...' : 'None');
  
  // Important: Log the full content of the req.session to debug
  try {
    console.log("Full Session content:", JSON.stringify(req.session, null, 2));
    console.log("User in session:", !!req.session?.user);
    if (req.session?.user) {
      console.log("User data:", JSON.stringify(req.session.user, null, 2));
    }
  } catch (e) {
    console.log("Error stringifying session:", e.message);
  }
  
  // Debug session cookies
  console.log("Request cookies:", req.headers.cookie);
  console.log("------------------------------------");
  
  // Check for authenticated user
  if (req.session && req.session.user && req.session.user.uid) {
    console.log("User authenticated, continuing to requested route");
    console.log("User ID:", req.session.user.uid);
    return next();
  }
  
  // If we're requesting the login or signup page, don't redirect
  if (req.path === '/login' || req.path === '/signup') {
    return next();
  }
  
  // Store the original URL for redirection after login
  console.log("User not authenticated, redirecting to login");
  console.log("Original URL:", req.originalUrl);
  
  // Ensure session exists before setting returnTo
  if (req.session) {
    req.session.returnTo = req.originalUrl;
    
    // Save session explicitly before redirecting
    return req.session.save(function(err) {
      if (err) {
        console.error("Error saving returnTo in session:", err);
      }
      return res.redirect('/login');
    });
  } else {
    return res.redirect('/login');
  }
};

// Middleware to check Firebase authentication status
const checkAuthStatus = (req, res, next) => {
  // Get current Firebase user
  const currentUser = auth.currentUser;
  
  if (currentUser && (!req.session.user || req.session.user.uid !== currentUser.uid)) {
    // Update session with current Firebase user data
    req.session.user = {
      uid: currentUser.uid,
      email: currentUser.email,
      displayName: currentUser.displayName || currentUser.email.split('@')[0],
      provider: currentUser.providerData[0]?.providerId || 'password'
    };
  } else if (!currentUser && req.session.user) {
    // If Firebase session is gone but Express session remains, clear it
    delete req.session.user;
  }
  
  next();
};

module.exports = { 
  isAuthenticated,
  checkAuthStatus
}; 