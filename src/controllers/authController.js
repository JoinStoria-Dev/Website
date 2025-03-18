const { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut,
  GoogleAuthProvider,
  GithubAuthProvider
} = require('firebase/auth');
const { auth } = require('../firebaseConfig');

// Register a new user
const registerUser = async (req, res) => {
  const { email, password } = req.body;
  
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    // Store user info in session
    req.session.user = {
      uid: user.uid,
      email: user.email,
      provider: 'password'
    };
    
    res.redirect('/');
  } catch (error) {
    // Handle errors
    let errorMessage = "Registration failed";
    if (error.code === 'auth/email-already-in-use') {
      errorMessage = "This email is already registered";
    } else if (error.code === 'auth/weak-password') {
      errorMessage = "Password is too weak";
    }
    
    res.render('signup', { error: errorMessage, user: null });
  }
};

// Login user
const loginUser = async (req, res) => {
  const { email, password } = req.body;
  
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    // Store user info in session
    req.session.user = {
      uid: user.uid,
      email: user.email,
      provider: 'password'
    };
    
    res.redirect('/');
  } catch (error) {
    // Handle errors
    let errorMessage = "Login failed";
    if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
      errorMessage = "Invalid email or password";
    }
    
    res.render('login', { error: errorMessage, user: null });
  }
};

// Sign in with Google - just redirect to the OAuth handler
const signInWithGoogle = (req, res) => {
  res.redirect('/auth/google/redirect');
};

// Sign in with GitHub - redirect to OAuth flow 
const signInWithGithub = (req, res) => {
  res.redirect('/auth/github/redirect');
};

// Logout user
const logoutUser = async (req, res) => {
  try {
    await signOut(auth);
    req.session.destroy();
    res.redirect('/');
  } catch (error) {
    console.error("Logout error:", error);
    res.redirect('/');
  }
};

module.exports = {
  registerUser,
  loginUser,
  signInWithGoogle,
  signInWithGithub,
  logoutUser
}; 