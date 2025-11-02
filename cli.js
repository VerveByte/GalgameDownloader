const zi0 = require('./config/zi0.js');
const readlineSync = require('readline-sync');
const downloadFiles = require('./downloader');
const fs = require('fs');
const path = require('path');

async function main() {
  const args = process.argv.slice(2);
  let keyword = args[0];
  if (!keyword) {
    keyword = readlineSync.question('Please enter a search keyword: ');
  }
  const results = await zi0.search(keyword);
  if (results && results.data && results.data.content) {
    console.log('Search results:');
    const files = results.data.content.filter(item => !item.is_dir);
    files.forEach((file, index) => {
      console.log(`${index + 1}. ${file.name}`);
    });

    const choice = args[1] || readlineSync.question('Enter the number of the file to download (or 0 to cancel): ');
    const selectedIndex = parseInt(choice, 10) - 1;

    if (selectedIndex >= 0 && selectedIndex < files.length) {
      const selectedFile = files[selectedIndex];
      const numThreads = parseInt(args[2], 10) || 16; // Default to 16 threads
      console.log(`Downloading: ${selectedFile.name} with ${numThreads} threads.`);
      const downloadsDir = path.join(__dirname, 'downloads');
      if (!fs.existsSync(downloadsDir)) {
        fs.mkdirSync(downloadsDir);
      }
      await downloadFiles([selectedFile], downloadsDir, numThreads);
      console.log('Download complete!');
    } else {
      console.log('Invalid selection or canceled.');
    }
  } else {
    console.log('No results found.');
  }
}

main();