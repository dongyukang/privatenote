# DarkPad

![DarkPad](https://i.imgur.com/kFESkZ3.png)

DarkPad is a free and open note-taking platform where anyone can create and access encrypted notes. It's a copycat of [publicnote.com](https://publicnote.com), but simpler to setup on your own.

## How It Works

1. Enter a title and content for your note
2. The note is encrypted using AES-256 encryption with the title as the encryption key
3. The title is hashed using SHA-256 before being stored
4. Only someone with the exact title can decrypt and read the content

## Security Features

- **Client-side Encryption**: All encryption/decryption happens in your browser
- **AES-256 Encryption**: Military-grade encryption algorithm
- **Title-based Access**: The title acts as both identifier and encryption key
- **Zero Knowledge**: Not even the server admin can read your notes without the title
- **SHA-256 Title Hashing**: Titles are stored as hashes, making them unreadable

## Privacy Tips

- Use complex titles that are hard to guess but easy for you to remember
- Longer titles provide better security
- Share the title only with people you want to have access
- Anyone with the exact title can read and modify the note
- Clear your browser history if you don't want titles to be saved locally

## Usage Examples

- Sharing information securely
- Temporary note storage
- Anonymous messaging
- Collaborative notes with trusted parties

## Technical Details

- Built with vanilla JavaScript
- Uses Firebase Realtime Database for storage
- Implements Web Crypto API for encryption
- Zero server-side processing of note contents

## Contributing

Feel free to contribute to this project by submitting issues or pull requests. The source code is available under the MIT license.

## Disclaimer

While DarkPad uses strong encryption, please don't store critically sensitive information. The security relies heavily on the complexity and privacy of your chosen titles.

## License

This project is open source and available under the MIT License. 