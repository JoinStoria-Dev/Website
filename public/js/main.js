document.addEventListener('DOMContentLoaded', function() {
  // Check for explore books button and redirect if clicked without authentication
  const exploreButton = document.querySelector('.hero-actions .btn-primary');
  if (exploreButton) {
    exploreButton.addEventListener('click', async function(e) {
      // We'll rely on the server-side redirection to the login page
      // No need to prevent default
    });
  }

  // Highlight active nav link
  const currentPath = window.location.pathname;
  const navLinks = document.querySelectorAll('.nav-links a');
  
  navLinks.forEach(link => {
    const linkPath = link.getAttribute('href');
    if (currentPath === linkPath || 
        (linkPath !== '/' && currentPath.startsWith(linkPath))) {
      link.classList.add('active');
    }
  });
}); 