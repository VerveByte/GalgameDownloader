#!/usr/bin/env node
const lzacg = require('./config/lzacg.js');
const zi0 = require('./config/zi0.js');
const readlineSync = require('readline-sync');
const downloadFiles = require('./downloader');
const fs = require('fs');
const path = require('path');

async function main() {
  const args = process.argv.slice(2);
  let keyword = args[0];
  if (!keyword) {
    keyword = readlineSync.question('请输入搜索关键词: ');
  }

  let allResults = [];

  const lzacgResults = await lzacg.search(keyword);
  if (lzacgResults && lzacgResults.data && lzacgResults.data.content) {
    const files = lzacgResults.data.content.filter(item => !item.is_dir);
    allResults = allResults.concat(files.map(file => ({ ...file, source: 'lzacg' })));
  }

  const zi0Files = await zi0.search(keyword);
  if (zi0Files && zi0Files.length > 0) {
    allResults = allResults.concat(zi0Files.map(file => ({ ...file, source: 'zi0' })));
  }

  if (allResults.length > 0) {
    allResults.forEach((file, index) => {
      console.log(`${index + 1}. [${file.source}] ${file.name}`);
    });

    const choice = args[1] || readlineSync.question('请输入要下载的文件编号 (取消请输入 0): ');
    const selectedIndex = parseInt(choice, 10) - 1;

    if (selectedIndex >= 0 && selectedIndex < allResults.length) {
      const selectedFile = allResults[selectedIndex];
      const numThreads = parseInt(args[2], 10) || 16; // Default to 16 threads
      const downloadsDir = path.join(__dirname, 'downloads');
      if (!fs.existsSync(downloadsDir)) {
        fs.mkdirSync(downloadsDir);
      }

      let downloadLinks = [];
      if (selectedFile.source === 'lzacg') {
        const lzacgDownloadResult = await lzacg.getDownloadUrl(selectedFile);
        if (lzacgDownloadResult && lzacgDownloadResult.length > 0) {
          downloadLinks = lzacgDownloadResult.map(link => ({
            name: link.name,
            raw_url: link.url
          }));
        }
      } else if (selectedFile.source === 'zi0') {
        const zi0DownloadUrl = await zi0.getDownloadUrl(selectedFile);
        if (zi0DownloadUrl) {
          downloadLinks.push({
            name: selectedFile.name,
            raw_url: zi0DownloadUrl
          });
        }
      }

      if (downloadLinks.length > 0) {
        await downloadFiles(downloadLinks, downloadsDir, numThreads);
      } else {
        console.log('未获取到下载链接。');
      }
    } else {
      console.log('选择无效，下载已取消。');
    }
  } else {
    console.log('未找到相关结果。');
  }
}

main();