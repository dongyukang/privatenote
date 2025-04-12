// Added detailed explanation for module imports
const express = require('express');
const path = require('path');
// The 'express' module is used to create a web server, and 'path' helps in building file system paths in a cross-platform way.

// Creating an instance of Express application to register middleware and routes.
const app = express();

// 빌드 파일을 정적 파일로 제공하도록 설정
// Serving static files from the 'build' directory allows our server to efficiently deliver CSS, JavaScript, images, and other files that the browser requests.
app.use(express.static(path.join(__dirname, 'build')));

// Detailed: This catch-all route serves index.html for any GET request. It is essential for Single Page Applications (SPAs) that rely on client-side routing.
app.get('*', (req, res) => {
  // This catch-all route handles all GET requests by returning index.html.
  // It enables client-side routing by ensuring every URL serves the main entry point of the SPA.
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

// Define the port number on which the server will listen for connections.
// Here, we explicitly set the port to 80, which is the default HTTP port.
// Note: Using port 80 may require elevated privileges on some operating systems; if you encounter permission issues, consider using a higher port such as 3000.
const PORT = 80;

// Start the server and listen on the specified port.
// Starting the server here ensures that the application is ready to handle incoming HTTP requests.
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

// Additional Note:
// When using port 80, be aware of potential permission issues; a standard non-admin user may need to choose a higher port, like 3000, for development purposes.
