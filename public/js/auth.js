// Authentication helper functions
document.addEventListener('DOMContentLoaded', () => {
  // Form validation for email/password
  const authForm = document.querySelector('.auth-form');
  if (authForm) {
    authForm.addEventListener('submit', (e) => {
      const passwordInput = authForm.querySelector('input[type="password"]');
      if (passwordInput && passwordInput.value.length < 6) {
        e.preventDefault();
        displayError('Password must be at least 6 characters');
      }
      
      // If it's a signup form, check if terms are accepted
      const termsCheckbox = authForm.querySelector('input[name="terms"]');
      if (termsCheckbox && !termsCheckbox.checked) {
        e.preventDefault();
        displayError('You must accept the Terms and Privacy Policy');
      }
    });
  }
  
  // Google Sign-in - Using form submission for more reliable redirect
  const googleBtn = document.getElementById('btn-google');
  if (googleBtn) {
    googleBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      
      try {
        // Create Google provider with required scopes
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.addScope('profile');
        provider.addScope('email');
        
        console.log("Attempting Google sign-in with popup");
        console.log("Auth domain being used:", firebase.app().options.authDomain);
        
        // Use popup for direct sign-in
        const result = await firebase.auth().signInWithPopup(provider);
        console.log("Google sign-in successful", result.user.uid);
        
        // Get the ID token
        const idToken = await result.user.getIdToken();
        
        // Create a form to submit the token
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = '/auth/verify-firebase-token';
        
        // Create token input field
        const tokenInput = document.createElement('input');
        tokenInput.type = 'hidden';
        tokenInput.name = 'idToken';
        tokenInput.value = idToken;
        
        // Add the input to the form
        form.appendChild(tokenInput);
        
        // Add the form to the document and submit it
        document.body.appendChild(form);
        console.log("Submitting token via form for redirect");
        form.submit();
        
      } catch (error) {
        console.error('Google sign-in error:', error);
        
        // Display user-friendly error message
        let errorMessage = 'Google sign-in failed';
        
        if (error.code === 'auth/popup-blocked') {
          errorMessage = 'Popup was blocked by your browser. Please allow popups for this site.';
        } else if (error.code === 'auth/popup-closed-by-user') {
          errorMessage = 'The sign-in popup was closed before completing authentication.';
        } else if (error.code === 'auth/unauthorized-domain') {
          errorMessage = 'This domain is not authorized for OAuth operations. Please add ' + 
                        window.location.hostname + ' to the authorized domains in the Firebase Console.';
        } else {
          errorMessage = `Google sign-in failed: ${error.message}`;
        }
        
        displayError(errorMessage);
      }
    });
  }
  
  // Apple Sign-in
  const appleBtn = document.getElementById('btn-apple');
  if (appleBtn) {
    appleBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      
      try {
        const provider = new firebase.auth.OAuthProvider('apple.com');
        // Use redirect method instead of popup to avoid CORS issues
        await firebase.auth().signInWithRedirect(provider);
      } catch (error) {
        console.error('Apple sign-in error:', error);
        displayError(`Apple sign-in failed: ${error.message}`);
      }
    });
  }
  
  // Phone Sign-in
  const phoneBtn = document.getElementById('btn-phone');
  if (phoneBtn) {
    phoneBtn.addEventListener('click', (e) => {
      e.preventDefault();
      
      // Show phone number input modal
      showPhoneSignInModal();
    });
  }
  
  // Check for redirect result when the page loads
  checkRedirectResult();
  
  // Check if there's an error param in URL
  const urlParams = new URLSearchParams(window.location.search);
  const errorParam = urlParams.get('error');
  if (errorParam) {
    displayError(decodeURIComponent(errorParam));
  }
});

// Check for redirect result
async function checkRedirectResult() {
  try {
    // Get redirect result
    const result = await firebase.auth().getRedirectResult();
    
    // If we have a user, they signed in successfully
    if (result.user) {
      console.log('Successfully signed in with redirect');
      await sendAuthTokenToServer(result.user);
    }
  } catch (error) {
    console.error('Redirect sign-in error:', error);
    displayError(`Authentication failed: ${error.message}`);
  }
}

// Show phone sign in modal
function showPhoneSignInModal() {
  // Create modal
  const modal = document.createElement('div');
  modal.className = 'phone-auth-modal';
  
  // Create modal content
  modal.innerHTML = `
    <div class="phone-auth-content">
      <h3><i class="fas fa-phone"></i> Phone Sign In</h3>
      <p>Enter your phone number to receive a verification code.</p>
      <div id="phone-error" class="error-message" style="display: none;"></div>
      
      <div class="phone-input-container">
        <select id="country-code">
          <option value="+1">+1 (US)</option>
          <option value="+44">+44 (UK)</option>
          <option value="+91">+91 (India)</option>
          <option value="+61">+61 (Australia)</option>
          <option value="+86">+86 (China)</option>
          <option value="+49">+49 (Germany)</option>
          <option value="+33">+33 (France)</option>
          <option value="+81">+81 (Japan)</option>
          <option value="+55">+55 (Brazil)</option>
          <option value="+52">+52 (Mexico)</option>
        </select>
        <input type="tel" id="phone-number" placeholder="Phone number" />
      </div>
      
      <div id="recaptcha-container"></div>
      
      <div class="verification-code-container" style="display: none;">
        <input type="text" id="verification-code" placeholder="Enter verification code" />
      </div>
      
      <div class="phone-auth-buttons">
        <button id="send-code-btn" class="btn btn-primary">Send Code</button>
        <button id="verify-code-btn" class="btn btn-primary" style="display: none;">Verify Code</button>
        <button id="cancel-phone-auth" class="btn btn-secondary">Cancel</button>
      </div>
    </div>
  `;
  
  // Add modal to body
  document.body.appendChild(modal);
  
  // Initialize reCAPTCHA
  const recaptchaContainer = document.getElementById('recaptcha-container');
  const recaptchaVerifier = new firebase.auth.RecaptchaVerifier(recaptchaContainer, {
    'size': 'normal',
    'callback': function(response) {
      // reCAPTCHA solved, allow the user to send verification code
      document.getElementById('send-code-btn').disabled = false;
    },
    'expired-callback': function() {
      // Response expired. Ask user to solve reCAPTCHA again.
      document.getElementById('send-code-btn').disabled = true;
    }
  });
  recaptchaVerifier.render();
  
  // Event listeners
  const cancelBtn = document.getElementById('cancel-phone-auth');
  cancelBtn.addEventListener('click', () => {
    document.body.removeChild(modal);
  });
  
  const sendCodeBtn = document.getElementById('send-code-btn');
  sendCodeBtn.addEventListener('click', async () => {
    const phoneNumberInput = document.getElementById('phone-number');
    const countryCode = document.getElementById('country-code').value;
    const phoneNumber = countryCode + phoneNumberInput.value.trim();
    
    if (!phoneNumberInput.value.trim()) {
      displayPhoneError('Please enter a valid phone number');
      return;
    }
    
    try {
      sendCodeBtn.disabled = true;
      sendCodeBtn.textContent = 'Sending...';
      
      // Send verification code
      const confirmationResult = await firebase.auth().signInWithPhoneNumber(phoneNumber, recaptchaVerifier);
      window.confirmationResult = confirmationResult;
      
      // Show verification code input
      document.querySelector('.verification-code-container').style.display = 'block';
      document.getElementById('verify-code-btn').style.display = 'inline-block';
      sendCodeBtn.style.display = 'none';
      
      // Hide phone input
      document.querySelector('.phone-input-container').style.display = 'none';
      document.getElementById('recaptcha-container').style.display = 'none';
      
    } catch (error) {
      console.error('Error sending verification code:', error);
      displayPhoneError(`Error: ${error.message}`);
      sendCodeBtn.disabled = false;
      sendCodeBtn.textContent = 'Send Code';
    }
  });
  
  const verifyCodeBtn = document.getElementById('verify-code-btn');
  verifyCodeBtn.addEventListener('click', async () => {
    const verificationCode = document.getElementById('verification-code').value.trim();
    
    if (!verificationCode) {
      displayPhoneError('Please enter the verification code');
      return;
    }
    
    try {
      verifyCodeBtn.disabled = true;
      verifyCodeBtn.textContent = 'Verifying...';
      
      // Verify code
      const result = await window.confirmationResult.confirm(verificationCode);
      
      // User signed in successfully
      await sendAuthTokenToServer(result.user);
      
      // Clean up and close modal
      document.body.removeChild(modal);
      
    } catch (error) {
      console.error('Error verifying code:', error);
      displayPhoneError(`Error: ${error.message}`);
      verifyCodeBtn.disabled = false;
      verifyCodeBtn.textContent = 'Verify Code';
    }
  });
}

// Display phone error
function displayPhoneError(message) {
  const errorElement = document.getElementById('phone-error');
  errorElement.textContent = message;
  errorElement.style.display = 'block';
}

// Send authentication token to server
async function sendAuthTokenToServer(user) {
  try {
    console.log("Attempting to get ID token for user:", user.uid);
    
    // Get ID token
    const idToken = await user.getIdToken();
    console.log("Successfully retrieved ID token");
    
    // Create form for direct server-side redirection
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/auth/verify-firebase-token';
    
    // Add token as hidden input
    const tokenInput = document.createElement('input');
    tokenInput.type = 'hidden';
    tokenInput.name = 'idToken';
    tokenInput.value = idToken;
    form.appendChild(tokenInput);
    
    // Add form to document body
    document.body.appendChild(form);
    
    console.log("Submitting token via form for server-side redirect");
    form.submit();
    
  } catch (error) {
    console.error('Error in authentication process:', error);
    if (error.name === 'TypeError' && error.message.includes('NetworkError')) {
      displayError('Network error while communicating with the server. Please check your internet connection.');
    } else if (error.name === 'SyntaxError') {
      displayError('The server returned an invalid response. Please try again later.');
    } else {
      displayError(`Authentication failed: ${error.message}`);
    }
  }
}

// Display error message
function displayError(message) {
  // Check if error message element already exists
  let errorElement = document.querySelector('.error-message');
  
  // If not, create a new one
  if (!errorElement) {
    errorElement = document.createElement('div');
    errorElement.className = 'error-message';
    const form = document.querySelector('.auth-form');
    if (form) {
      form.parentNode.insertBefore(errorElement, form);
    } else {
      // If form doesn't exist, add to auth-card
      const authCard = document.querySelector('.auth-card');
      if (authCard) {
        const authHeader = authCard.querySelector('.auth-header');
        if (authHeader) {
          authHeader.insertAdjacentElement('afterend', errorElement);
        } else {
          authCard.prepend(errorElement);
        }
      }
    }
  }
  
  // Set the error message
  errorElement.textContent = message;
} 