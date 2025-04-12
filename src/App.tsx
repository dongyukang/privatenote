import React, { useState, useRef, DragEvent } from 'react';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, push, get, remove, update, query, orderByChild, equalTo } from 'firebase/database';

// Detailed: Firebase configuration uses environment variables to securely connect to your Firebase project and enable its services.
// Ensure that your .env file or environment settings provide all necessary keys.
// Firebase configuration
const firebaseConfig = {
    apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
    authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.REACT_APP_FIREBASE_DATABASE_URL,
    projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
    storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.REACT_APP_FIREBASE_APP_ID,
    measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);
const notesRef = ref(database, 'notes');

function App() {
  const [title, setTitle] = useState('');
  const [showTitle, setShowTitle] = useState(false);
  const [content, setContent] = useState('');
  const [loadMessage, setLoadMessage] = useState({ text: '', isError: false });
  const [saveMessage, setSaveMessage] = useState({ text: '', isError: false });
  const [isLocalMode, setIsLocalMode] = useState(false);
  const [localNotes, setLocalNotes] = useState<Record<string, { content: string, hashedTitle: string, timestamp: number }>>({});
  const [isLocalFileLoaded, setIsLocalFileLoaded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [fileHash, setFileHash] = useState('');
  const [isDarkMode, setIsDarkMode] = useState(true);
  const dropAreaRef = useRef<HTMLDivElement>(null);

  // Detailed: The showMessage function displays a temporary message for user feedback. It takes a state setter function, a message string, and an optional isError flag to determine error styling. The message clears automatically after 3 seconds.
  // Show temporary message
  const showMessage = (setMessageFunc: Function, message: string, isError = false) => {
    setMessageFunc({ text: message, isError });
    setTimeout(() => {
      setMessageFunc({ text: '', isError: false });
    }, 3000);
  };

  // Normalize input
  const normalizeInput = (input: string) => {
    return input.normalize('NFC'); // Normalize to NFC form
  };

  // Detailed: This function normalizes the input title to NFC form, encodes it to bytes, and computes its SHA-256 hash for a unique identifier.
  // Hash title using SHA-256
  const hashTitle = async (title: string) => {
    const normalizedTitle = normalizeInput(title);
    const encoder = new TextEncoder();
    const data = encoder.encode(normalizedTitle);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  // Derive encryption key from title
  const deriveKey = async (title: string) => {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(title),
      { name: 'PBKDF2' },
      false,
      ['deriveBits', 'deriveKey']
    );
    
    return await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: encoder.encode('fixed-salt'),
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  };

  // Encrypt content
  const encryptContent = async (content: string, title: string) => {
    const encoder = new TextEncoder();
    const key = await deriveKey(title);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    const encryptedContent = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      key,
      encoder.encode(content)
    );

    const encryptedArray = new Uint8Array(iv.length + encryptedContent.byteLength);
    encryptedArray.set(iv);
    encryptedArray.set(new Uint8Array(encryptedContent), iv.length);
    
    return btoa(String.fromCharCode(...encryptedArray));
  };

  // Decrypt content
  const decryptContent = async (encryptedContent: string, title: string) => {
    try {
      const decoder = new TextDecoder();
      const key = await deriveKey(title);
      
      const encryptedArray = new Uint8Array(
        atob(encryptedContent).split('').map(char => char.charCodeAt(0))
      );
      
      const iv = encryptedArray.slice(0, 12);
      const encryptedData = encryptedArray.slice(12);

      const decryptedContent = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: iv
        },
        key,
        encryptedData
      );

      return decoder.decode(decryptedContent);
    } catch (error) {
      console.error('Decryption error:', error);
      throw new Error('Failed to decrypt content');
    }
  };

  // Calculate SHA-256 hash of a string
  const calculateSHA256 = async (data: string): Promise<string> => {
    const encoder = new TextEncoder();
    const encodedData = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', encodedData);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  // Format hash to show first 5 and last 5 characters
  const formatHash = (hash: string): string => {
    if (hash.length <= 10) return hash;
    return `${hash.substring(0, 5)}...${hash.substring(hash.length - 5)}`;
  };

  // Import local database
  const importLocalDatabase = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (event) => {
      try {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (!file) return;

        processLocalFile(file);
      } catch (error) {
        console.error('File import error:', error);
        showMessage(setLoadMessage, 'Failed to import file', true);
      }
    };
    input.click();
  };

  // Process the local file
  const processLocalFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const fileContent = e.target?.result as string;
        const jsonData = JSON.parse(fileContent);
        
        // Calculate file hash
        const hash = await calculateSHA256(fileContent);
        setFileHash(hash);
        
        // Check if the imported data has the expected structure
        if (jsonData && jsonData.notes && typeof jsonData.notes === 'object') {
          setLocalNotes(jsonData.notes);
        } else {
          // If it's already in the flat format, use it directly
          setLocalNotes(jsonData);
        }
        setIsLocalFileLoaded(true);
        showMessage(setLoadMessage, 'Local database imported successfully');
      } catch (error) {
        console.error('JSON parsing error:', error);
        showMessage(setLoadMessage, 'Failed to parse JSON file', true);
      }
    };
    reader.readAsText(file);
  };

  // Handle drag events
  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (isLocalMode) {
      setIsDragging(true);
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (isLocalMode && !isDragging) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Only set isDragging to false if we're leaving the drop area
    if (dropAreaRef.current && !dropAreaRef.current.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    if (!isLocalMode) return;
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.type === 'application/json' || file.name.endsWith('.json')) {
        processLocalFile(file);
      } else {
        showMessage(setLoadMessage, 'Please drop a JSON file', true);
      }
    }
  };

  // Load note
  const loadNote = async () => {
    if (!validateInput(title)) {
      showMessage(setLoadMessage, 'Invalid title', true);
      return;
    }

    try {
      const hashedTitle = await hashTitle(title);
      
      if (isLocalMode) {
        if (!isLocalFileLoaded) {
          showMessage(setLoadMessage, 'No local database loaded. Please import a file first.', true);
          return;
        }

        // Find note in local database
        const noteFound = Object.entries(localNotes).find(([_, note]) => note.hashedTitle === hashedTitle);
        
        if (noteFound) {
          const decryptedContent = await decryptContent(noteFound[1].content, title);
          setContent(decryptedContent);
        } else {
          setContent('');
          showMessage(setLoadMessage, 'No note found with this title', true);
        }
      } else {
        // Firebase load
        const noteQuery = query(notesRef, orderByChild('hashedTitle'), equalTo(hashedTitle));
        const snapshot = await get(noteQuery);

        if (snapshot.exists()) {
          const note = Object.values(snapshot.val())[0] as any;
          const decryptedContent = await decryptContent(note.content, title);
          setContent(decryptedContent);
        } else {
          setContent('');
          showMessage(setLoadMessage, 'No note found with this title', true);
        }
      }
    } catch (error) {
      console.error('Error loading note:', error);
      showMessage(setLoadMessage, 'Failed to load note', true);
    }
  };

  // Save note
  const saveNote = async () => {
    if (isLocalMode) {
      showMessage(setSaveMessage, 'Cannot save in local mode - it is read-only', true);
      return;
    }

    if (!validateInput(title)) {
      showMessage(setSaveMessage, 'Invalid title', true);
      return;
    }

    try {
      const hashedTitle = await hashTitle(title);
      
      // Firebase save
      if (!content) {
        const noteQuery = query(notesRef, orderByChild('hashedTitle'), equalTo(hashedTitle));
        const snapshot = await get(noteQuery);

        if (snapshot.exists()) {
          const noteId = Object.keys(snapshot.val())[0];
          await remove(ref(database, `notes/${noteId}`));
          showMessage(setSaveMessage, 'Note deleted successfully');
        } else {
          showMessage(setSaveMessage, 'No note to delete', true);
        }
        return;
      }

      const encryptedContent = await encryptContent(content, title);
      
      const noteQuery = query(notesRef, orderByChild('hashedTitle'), equalTo(hashedTitle));
      const snapshot = await get(noteQuery);

      if (snapshot.exists()) {
        const noteId = Object.keys(snapshot.val())[0];
        await update(ref(database, `notes/${noteId}`), {
          content: encryptedContent,
          hashedTitle: hashedTitle,
          timestamp: Date.now()
        });
      } else {
        await push(notesRef, {
          content: encryptedContent,
          hashedTitle: hashedTitle,
          timestamp: Date.now()
        });
      }

      showMessage(setSaveMessage, 'Note saved successfully');
    } catch (error) {
      console.error('Error saving note:', error);
      showMessage(setSaveMessage, 'Failed to save note', true);
    }
  };

  // Clear note
  const clearNote = () => {
    setTitle('');
    setContent('');
    navigator.clipboard.writeText('');
    showMessage(setSaveMessage, 'Both the fields and the clipboard have been cleared.');
  };

  // Toggle local mode
  const toggleLocalMode = () => {
    setIsLocalMode(!isLocalMode);
    if (!isLocalMode) {
      // Switching to local mode
      setContent('');
    } else {
      // Switching back to Firebase mode
      setContent('');
      setFileHash(''); // Clear file hash when exiting local mode
    }
  };

  // Toggle dark/light mode
  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode);
  };

  // Utility functions
  const validateInput = (input: string) => {
    if (!input || input.trim() === '') {
      return false;
    }
    if (input.length > 1000) {
      return false;
    }
    return true;
  };

  return (
    <div className={`${isDarkMode ? 'bg-gray-900' : 'bg-gray-100'} min-h-screen p-4 transition-colors duration-200`}>
      <div className="mx-auto space-y-4 w-full max-w-none">
        <div className="flex justify-between items-center mb-4">
          <h1 className={`${isDarkMode ? 'text-white' : 'text-gray-900'} text-xl font-bold transition-colors duration-200`}>
            {/* {isDarkMode ? 'DarkPad' : 'LightPad'} */}
            Private Note
          </h1>
          <div className="flex items-center space-x-4">
            <div className="flex items-center">
              <span className={`${isDarkMode ? 'text-white' : 'text-gray-700'} mr-2 transition-colors duration-200`}>
                {isDarkMode ? 
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
                  </svg> : 
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
                  </svg>
                }
              </span>
              <button
                onClick={toggleDarkMode}
                className={`relative inline-flex items-center h-6 rounded-full w-11 ${isDarkMode ? 'bg-indigo-600' : 'bg-yellow-400'} transition-colors duration-200`}
                aria-label={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
              >
                <span
                  className={`inline-block w-4 h-4 transform transition bg-white rounded-full ${isDarkMode ? 'translate-x-6' : 'translate-x-1'} duration-200`}
                />
              </button>
            </div>
            <div className="flex items-center">
              <span className={`${isDarkMode ? 'text-white' : 'text-gray-700'} mr-2 transition-colors duration-200`}>Local Mode (Read-Only)</span>
              <button
                onClick={toggleLocalMode}
                className={`relative inline-flex items-center h-6 rounded-full w-11 ${isLocalMode ? 'bg-blue-600' : isDarkMode ? 'bg-gray-700' : 'bg-gray-300'} transition-colors duration-200`}
              >
                <span
                  className={`inline-block w-4 h-4 transform transition bg-white rounded-full ${isLocalMode ? 'translate-x-6' : 'translate-x-1'} duration-200`}
                />
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input 
                type={showTitle ? "text" : "password"}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={showTitle ? "Title" : "••••••"}
                className={`w-full ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'} px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-200`}
                onKeyDown={(e) => e.key === 'Enter' && loadNote()}
                style={{ 
                  color: showTitle ? (isDarkMode ? '#ffffff' : '#333333') : 'transparent', 
                  textShadow: showTitle ? 'none' : `0 0 8px ${isDarkMode ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)'}` 
                }}
              />
              <button
                onClick={() => setShowTitle(!showTitle)}
                className={`absolute right-2 top-1/2 transform -translate-y-1/2 ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'} focus:outline-none transition-colors duration-200`}
                title={showTitle ? "Hide title" : "Show title"}
              >
                {showTitle ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                    <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd" />
                    <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z" />
                  </svg>
                )}
              </button>
            </div>
            <button 
              onClick={loadNote}
              className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              Load
            </button>
          </div>
          {loadMessage.text && (
            <div className={`text-sm ml-1 ${loadMessage.isError ? 'text-red-500' : 'text-green-500'}`}>
              {loadMessage.text}
            </div>
          )}
        </div>

        <div 
          className="flex flex-col items-center justify-center space-y-4"
          ref={dropAreaRef}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {saveMessage.text && (
            <div className={`text-sm ${saveMessage.isError ? 'text-red-500' : 'text-green-500'}`}>
              {saveMessage.text}
            </div>
          )}
          <div className="flex items-center space-x-2">
            <button 
              onClick={saveNote}
              className={`bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 ${isLocalMode ? 'opacity-50 cursor-not-allowed' : ''}`}
              disabled={isLocalMode}
              title={isLocalMode ? "Saving is disabled in local mode" : "Save note"}
            >
              Save
            </button>
            {isLocalMode && (
              <>
                <button 
                  onClick={importLocalDatabase}
                  className={`bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 ${isDragging ? 'ring-2 ring-yellow-400 bg-purple-700' : ''}`}
                >
                  {isDragging ? 'Drop JSON File Here' : 'Import'}
                </button>
              </>
            )}
            <button 
              onClick={clearNote}
              className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              Clear
            </button>
            <button
              onClick={() => {
                navigator.clipboard.writeText(content);
                showMessage(setSaveMessage, 'Content copied to clipboard');
              }}
              className={`bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 ${!content ? 'opacity-50 cursor-not-allowed' : ''}`}
              disabled={!content}
              title={!content ? "No content to copy" : "Copy content"}
            >
              Copy
            </button>
          </div>
          {isLocalMode && (
            <div className={`text-sm ${isDragging ? 'text-yellow-400' : isDarkMode ? 'text-gray-400' : 'text-gray-500'} transition-colors duration-200`}>
              {isDragging 
                ? 'Drop your JSON file here'
                : isLocalFileLoaded 
                  ? `Local database loaded with ${Object.keys(localNotes).length} notes (read-only)`
                  : 'No local database loaded. Drag and drop a JSON file or click Import.'}
            </div>
          )}
          {isLocalMode && isLocalFileLoaded && fileHash && (
            <div className={`text-sm ${isDarkMode ? 'text-blue-400' : 'text-blue-600'} transition-colors duration-200`}>
              File Hash: {formatHash(fileHash)}
            </div>
          )}
        </div>
        
        <textarea 
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Note"
          className={`w-full h-[calc(100vh-12rem)] ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'} px-4 py-2 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-200`}
          readOnly={isLocalMode}
          style={{width: 'calc(100vw - 2rem)'}}
        />
      </div>
    </div>
  );
}

export default App;
