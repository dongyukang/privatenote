import React, { useState } from 'react';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, push, get, remove, update, query, orderByChild, equalTo } from 'firebase/database';

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

  // Load note
  const loadNote = async () => {
    if (!validateInput(title)) {
      showMessage(setLoadMessage, 'Invalid title', true);
      return;
    }

    try {
      const hashedTitle = await hashTitle(title);
      const noteQuery = query(notesRef, orderByChild('hashedTitle'), equalTo(hashedTitle));
      const snapshot = await get(noteQuery);

      if (snapshot.exists()) {
        const note = Object.values(snapshot.val())[0] as any;
        const decryptedContent = await decryptContent(note.content, title);
        setContent(decryptedContent);
        //showMessage(setLoadMessage, 'Note loaded successfully');
      } else {
        setContent('');
        //showMessage(setLoadMessage, 'No note found with this title', true);
      }
    } catch (error) {
      console.error('Error loading note:', error);
      showMessage(setLoadMessage, 'Failed to load note', true);
    }
  };

  // Save note
  const saveNote = async () => {
    if (!validateInput(title)) {
      showMessage(setSaveMessage, 'Invalid title', true);
      return;
    }

    try {
      if (!content) {
        const hashedTitle = await hashTitle(title);
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

      const hashedTitle = await hashTitle(title);
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
    <div className="bg-gray-900 min-h-screen p-4">
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="space-y-1">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input 
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={showTitle ? "Title" : "••••••"}
                className="w-full bg-gray-800 text-white px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                onKeyDown={(e) => e.key === 'Enter' && loadNote()}
                style={{ 
                  color: showTitle ? '#ffffff' : 'transparent', 
                  textShadow: showTitle ? 'none' : '0 0 8px rgba(255,255,255,0.9)' 
                }}
              />
              <button
                onClick={() => setShowTitle(!showTitle)}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white focus:outline-none"
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

        <div className="flex flex-col items-center justify-center space-y-4">
          {saveMessage.text && (
            <div className={`text-sm ${saveMessage.isError ? 'text-red-500' : 'text-green-500'}`}>
              {saveMessage.text}
            </div>
          )}
          <div className="flex items-center space-x-2">
            <button 
              onClick={saveNote}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Save
            </button>
            <button 
              onClick={clearNote}
              className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              Clear
            </button>
          </div>
        </div>
        
        <textarea 
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Note"
          className="w-full h-[calc(100vh-8rem)] bg-gray-800 text-white px-4 py-2 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
    </div>
  );
}

export default App; 