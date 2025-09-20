// copy-models.js
const fs = require('fs-extra');
const path = require('path');

console.log('Copying models...');

try {
    const modelPath = path.resolve(__dirname, 'node_modules/@xenova/transformers/models/sentence-transformers/all-MiniLM-L6-v2');
    const destPath = path.resolve(__dirname, 'dist/models/all-MiniLM-L6-v2');

    if (fs.existsSync(modelPath)) {
        fs.copySync(modelPath, destPath);
        console.log(`Successfully copied ${modelPath} to ${destPath}`);
    } else {
        console.error(`Model path not found: ${modelPath}`);
        // This is not a critical error, as the library can download the models on demand.
        // However, for an extension, it's better to have them locally.
    }
} catch (err) {
    console.error('Error copying models:', err);
}
