// This controller handles the authentication redirects for Firebase authentication
const { auth } = require('../firebaseConfig');
const admin = require('../firebaseAdmin');
const { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  sendPasswordResetEmail
} = require('firebase/auth');

// Handle login with email/password
const handleLogin = async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.render('login', { 
      error: 'Email and password are required',
      user: null
    });
  }
  
  try {
    // Sign in with Firebase
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    // Store user info in session
    req.session.user = {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName || email.split('@')[0],
      provider: 'password'
    };
    
    // Redirect to the originally requested URL if available
    const redirectUrl = req.session.returnTo || '/';
    delete req.session.returnTo;
    
    res.redirect(redirectUrl);
  } catch (error) {
    console.error('Login error:', error);
    
    let errorMessage = 'Invalid email or password';
    if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
      errorMessage = 'Invalid email or password';
    } else if (error.code === 'auth/invalid-credential') {
      errorMessage = 'Invalid credentials';
    } else if (error.code === 'auth/too-many-requests') {
      errorMessage = 'Too many failed login attempts. Please try again later.';
    }
    
    res.render('login', { error: errorMessage, user: null });
  }
};

// Handle signup with email/password
const handleSignup = async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.render('signup', { 
      error: 'Email and password are required',
      user: null
    });
  }
  
  // Validate password length
  if (password.length < 6) {
    return res.render('signup', { 
      error: 'Password must be at least 6 characters',
      user: null
    });
  }
  
  try {
    // Create user with Firebase
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    // Store user info in session
    req.session.user = {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName || email.split('@')[0],
      provider: 'password'
    };
    
    // Redirect to the originally requested URL if available
    const redirectUrl = req.session.returnTo || '/';
    delete req.session.returnTo;
    
    res.redirect(redirectUrl);
  } catch (error) {
    console.error('Signup error:', error);
    
    let errorMessage = 'Error creating account';
    if (error.code === 'auth/email-already-in-use') {
      errorMessage = 'Email already in use';
    } else if (error.code === 'auth/invalid-email') {
      errorMessage = 'Invalid email address';
    } else if (error.code === 'auth/weak-password') {
      errorMessage = 'Password is too weak';
    }
    
    res.render('signup', { error: errorMessage, user: null });
  }
};

// Handle logout
const handleLogout = async (req, res) => {
  try {
    await auth.signOut();
  } catch (error) {
    console.error('Error signing out from Firebase:', error);
  }
  
  // Clear the user session regardless of Firebase signout success
  req.session.destroy((err) => {
    if (err) {
      console.error('Error destroying session:', err);
    }
    res.redirect('/');
  });
};

// Handle password reset
const handlePasswordReset = async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.render('reset-password', { 
      error: 'Email is required',
      user: null,
      message: null
    });
  }
  
  try {
    await sendPasswordResetEmail(auth, email);
    res.render('reset-password', { 
      error: null,
      user: null,
      message: 'Password reset email sent. Please check your inbox.'
    });
  } catch (error) {
    console.error('Password reset error:', error);
    
    let errorMessage = 'Error sending password reset email';
    if (error.code === 'auth/user-not-found') {
      errorMessage = 'No account found with this email';
    } else if (error.code === 'auth/invalid-email') {
      errorMessage = 'Invalid email address';
    }
    
    res.render('reset-password', { 
      error: errorMessage,
      user: null,
      message: null
    });
  }
};

// Handle Firebase token verification
const verifyFirebaseToken = async (req, res) => {
  console.log('-------------------------------------');
  console.log('Firebase token verification request received');
  console.log('Current Session ID:', req.session?.id ? req.session.id.substring(0, 6) + '...' : 'None');
  console.log('Current Session Content:', JSON.stringify(req.session, null, 2));
  
  // Get token from either JSON or form data
  const idToken = req.body.idToken;
  
  if (!idToken) {
    console.error('Token verification failed: No ID token provided');
    return res.redirect('/login?error=' + encodeURIComponent('Authentication failed: No token provided'));
  }
  
  try {
    console.log('Starting token verification process');
    // Parse the JWT token directly without Admin SDK
    const tokenParts = idToken.split('.');
    
    if (tokenParts.length !== 3) {
      throw new Error('Invalid token format - Expected 3 parts in JWT token');
    }
    
    // Decode the payload (second part)
    console.log('Decoding token payload');
    const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
    console.log('Token payload decoded successfully');
    
    // Extract user info from payload
    const uid = payload.user_id || payload.sub;
    const email = payload.email;
    const displayName = payload.name;
    const provider = 'google.com';
    const photoURL = payload.picture;
    
    console.log(`Extracted user info from token - UID: ${uid}, Email: ${email}`);
    
    // Ensure we have a UID at minimum
    if (!uid) {
      console.error('Could not extract user ID from token');
      throw new Error('Could not extract user ID from token');
    }
    
    // Store user info in session
    req.session.user = {
      uid: uid,
      email: email || '',
      displayName: displayName || email?.split('@')[0] || 'User',
      provider: provider,
      photoURL: photoURL || ''
    };
    
    // Ensure we're setting the user in the session correctly
    console.log('User information stored in session:', JSON.stringify(req.session.user, null, 2));
    
    // Remove returnTo value to avoid confusion
    delete req.session.returnTo;
    
    // Ensure session cookie settings are correct
    req.session.cookie.maxAge = 24 * 60 * 60 * 1000; // 24 hours
    
    // Save the session and then do a direct redirect
    return req.session.save(err => {
      if (err) {
        console.error('Error saving session:', err);
        return res.redirect('/login?error=' + encodeURIComponent('Failed to save user session: ' + err.message));
      }
      
      console.log('Session saved successfully with user data');
      console.log('Session ID:', req.session.id?.substring(0, 6) + '...');
      console.log('User in session after save:', !!req.session.user);
      
      // Direct redirect to books page
      return res.redirect('/books');
    });
    
  } catch (error) {
    console.error('Error processing authentication token:', error);
    return res.redirect('/login?error=' + encodeURIComponent('Authentication failed: ' + error.message));
  }
};

module.exports = {
  handleLogin,
  handleSignup,
  handleLogout,
  handlePasswordReset,
  verifyFirebaseToken
}; 