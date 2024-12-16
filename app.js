// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyAcrSVSrvnK4xqK4zBeUyR4EjEtL9oqTTA",
    authDomain: "privatenote-52dfa.firebaseapp.com",
    databaseURL: "https://privatenote-52dfa-default-rtdb.firebaseio.com",
    projectId: "privatenote-52dfa",
    storageBucket: "privatenote-52dfa.firebasestorage.app",
    messagingSenderId: "574277257432",
    appId: "1:574277257432:web:6451ee79c8d4293a03afad",
    measurementId: "G-C17B99QTQ6"
  };

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const database = firebase.database();
const notesRef = database.ref('notes');

// Get DOM elements
const titleInput = document.getElementById('title');
const contentInput = document.getElementById('content');
const loadMessage = document.getElementById('loadMessage');
const saveMessage = document.getElementById('saveMessage');

// Function to hash title using SHA-256
async function hashTitle(title) {
    const encoder = new TextEncoder();
    const data = encoder.encode(title);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
}

// Function to show temporary message
function showMessage(element, message, isError = false) {
    element.textContent = message;
    element.className = `text-sm ${isError ? 'text-red-500' : 'text-green-500'}`;
    element.classList.remove('hidden');
    
    setTimeout(() => {
        element.classList.add('hidden');
    }, 3000); // Hide after 3 seconds
}

// Derive encryption key from title
async function deriveKey(title) {
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
}

// Encrypt content
async function encryptContent(content, title) {
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

    // Combine IV and encrypted content
    const encryptedArray = new Uint8Array(iv.length + encryptedContent.byteLength);
    encryptedArray.set(iv);
    encryptedArray.set(new Uint8Array(encryptedContent), iv.length);
    
    // Convert to base64 for storage
    return btoa(String.fromCharCode(...encryptedArray));
}

// Decrypt content
async function decryptContent(encryptedContent, title) {
    try {
        const decoder = new TextDecoder();
        const key = await deriveKey(title);
        
        // Convert from base64 and separate IV and content
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
}

// Load note function
async function loadNote() {
    if (!titleInput.value.trim()) {
        showMessage(loadMessage, 'Please enter a title to load', true);
        return;
    }

    try {
        const title = titleInput.value.trim();
        const hashedTitle = await hashTitle(title);
        const snapshot = await notesRef.orderByChild('hashedTitle')
            .equalTo(hashedTitle)
            .once('value');

        if (snapshot.exists()) {
            const note = Object.values(snapshot.val())[0];
            // Decrypt the content
            const decryptedContent = await decryptContent(note.content, title);
            contentInput.value = decryptedContent;
            showMessage(loadMessage, 'Note loaded successfully');
        } else {
            contentInput.value = '';
            showMessage(loadMessage, 'No note found with this title', true);
        }
    } catch (error) {
        console.error('Error loading note:', error);
        showMessage(loadMessage, 'Failed to load note', true);
    }
}

// Save note to Firebase
async function saveNote() {
    if (!titleInput.value.trim()) {
        showMessage(saveMessage, 'Please enter a title to save', true);
        return;
    }

    try {
        const title = titleInput.value.trim();
        const content = contentInput.value;
        const hashedTitle = await hashTitle(title);
        
        // Check if content is empty
        if (!content.trim()) {
            // Find and delete the note if it exists
            const snapshot = await notesRef.orderByChild('hashedTitle')
                .equalTo(hashedTitle)
                .once('value');

            if (snapshot.exists()) {
                const noteId = Object.keys(snapshot.val())[0];
                await notesRef.child(noteId).remove();
                showMessage(saveMessage, 'Note deleted successfully');
            } else {
                showMessage(saveMessage, 'No note to delete', true);
            }
            return;
        }

        // If content is not empty, proceed with normal save
        const encryptedContent = await encryptContent(content, title);
        const snapshot = await notesRef.orderByChild('hashedTitle')
            .equalTo(hashedTitle)
            .once('value');

        if (snapshot.exists()) {
            const noteId = Object.keys(snapshot.val())[0];
            await notesRef.child(noteId).update({
                content: encryptedContent,
                hashedTitle: hashedTitle,
                timestamp: firebase.database.ServerValue.TIMESTAMP
            });
        } else {
            await notesRef.push({
                content: encryptedContent,
                hashedTitle: hashedTitle,
                timestamp: firebase.database.ServerValue.TIMESTAMP
            });
        }

        showMessage(saveMessage, 'Note saved successfully');
    } catch (error) {
        console.error('Error saving note:', error);
        showMessage(saveMessage, 'Failed to save note', true);
    }
}

// Clear note
function clearNote() {
    titleInput.value = '';
    contentInput.value = '';
} 