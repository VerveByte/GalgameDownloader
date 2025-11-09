const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');



// Worker function to download a chunk of a file
async function downloadChunkInWorker({ downloadUrl, chunkPath, start, end, file }) {
    try {
        const writer = fs.createWriteStream(chunkPath);
        const response = await axios({
            url: downloadUrl,
            method: 'GET',
            responseType: 'stream',
            headers: { 'Range': `bytes=${start}-${end}` }
        });

        const totalLength = parseInt(response.headers['content-length'], 10);
        let downloadedLength = 0;
        const startTime = Date.now();

        response.data.on('data', (chunk) => {
            downloadedLength += chunk.length;
            const elapsedTime = (Date.now() - startTime) / 1000;
            const speed = downloadedLength / (elapsedTime || 1);
            parentPort.postMessage({
                type: 'progress',
                payload: {
                    file: file.name,
                    chunk: { start, end, downloaded: downloadedLength, total: totalLength },
                    speed
                }
            });
        });

        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', (err) => reject(new Error(`Chunk file write error: ${err.message}`)));
        });
    } catch (error) {
        throw new Error(`Chunk download request error: ${error.message}`);
    }
}

// Worker function to download a full file (fallback)
async function downloadFullFileInWorker({ file, downloadsDir }) {
    const downloadUrl = file.raw_url;
    if (!downloadUrl) {
        parentPort.postMessage({ type: 'error', payload: { file: file.name, message: 'Could not get download URL.' } });
        return;
    }

    const filePath = path.join(downloadsDir, file.name);
    const writer = fs.createWriteStream(filePath);

    try {
        const response = await axios({
            url: downloadUrl,
            method: 'GET',
            responseType: 'stream'
        });

        const totalLength = parseInt(response.headers['content-length'], 10);
        let downloadedLength = 0;
        const startTime = Date.now();

        response.data.on('data', (chunk) => {
            downloadedLength += chunk.length;
            const elapsedTime = (Date.now() - startTime) / 1000;
            const speed = downloadedLength / (elapsedTime || 1);
            const percentage = totalLength ? Math.floor((downloadedLength / totalLength) * 100) : 0;
            parentPort.postMessage({
                type: 'progress',
                payload: {
                    file: file.name,
                    percentage,
                    downloaded: downloadedLength,
                    total: totalLength,
                    speed
                }
            });
        });

        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                parentPort.postMessage({ type: 'progress', payload: { file: file.name, percentage: 100, downloaded: totalLength, total: totalLength, speed: 0 } });
                resolve();
            });
            writer.on('error', (err) => reject(new Error(`File write error: ${err.message}`)));
        });
    } catch (error) {
        throw new Error(`Download request error: ${error.message}`);
    }
}


// This is the logic for the worker thread.
if (!isMainThread) {
    const { type, ...data } = workerData;
    let promise;
    if (type === 'chunk') {
        promise = downloadChunkInWorker(data);
    } else { // 'full'
        promise = downloadFullFileInWorker(data);
    }

    promise
        .then(() => parentPort.postMessage({ type: 'done' }))
        .catch(err => {
            parentPort.postMessage({ type: 'error', payload: { file: data.file.name, message: err.message } });
        });
}


// This is the logic for the main thread.
if (isMainThread) {
    function formatBytes(bytes, decimals = 2) {
        if (!bytes || bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    async function assembleChunks(finalPath, chunkPaths, totalSize) {
        const writer = fs.createWriteStream(finalPath);
        return new Promise((resolve, reject) => {
            const streamNextChunk = (index) => {
                if (index >= chunkPaths.length) {
                    writer.end();
                    resolve();
                    return;
                }
                const reader = fs.createReadStream(chunkPaths[index]);
                reader.pipe(writer, { end: false });
                reader.on('end', () => {
                    fs.unlink(chunkPaths[index], () => {}); // delete chunk
                    streamNextChunk(index + 1);
                });
                reader.on('error', reject);
            };
            streamNextChunk(0);
        });
    }

    async function downloadFileWithChunks(file, downloadsDir, numThreads) {
        const downloadUrl = file.raw_url;
        if (!downloadUrl) {
            console.error(`\nCould not get download URL for ${file.name}. Skipping.`);
            return;
        }

        let totalLength = 0;
        let acceptRanges = false;

        try {
            // 尝试发送 HEAD 请求获取文件信息
            const headResponse = await axios.head(downloadUrl, { timeout: 5000 });
            totalLength = parseInt(headResponse.headers['content-length'], 10);
            acceptRanges = headResponse.headers['accept-ranges'] === 'bytes';
        } catch (headError) {
            // 如果 HEAD 请求失败，尝试发送 GET 请求获取文件信息} catch (headError) {
            try {                const getResponse = await axios.get(downloadUrl, {
                    responseType: 'stream',
                    timeout: 5000,
                    headers: { 'Range': 'bytes=0-0' } // 只请求第一个字节
                });
                totalLength = parseInt(getResponse.headers['content-length'], 10);
                acceptRanges = getResponse.headers['accept-ranges'] === 'bytes';
                // 关闭流，因为我们只关心头部信息
                getResponse.data.destroy();
            } catch (getError) {
                return downloadFileSingle(file, downloadsDir);
            }
        }

        const MIN_CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

        if (acceptRanges && totalLength > MIN_CHUNK_SIZE) {
            const effectiveThreads = Math.min(numThreads, Math.ceil(totalLength / MIN_CHUNK_SIZE));
            const chunkSize = Math.ceil(totalLength / effectiveThreads);
            
            console.log(`\nStarting chunked download for ${file.name} (${formatBytes(totalLength)}) in ${effectiveThreads} threads.`);

            const chunkPromises = [];
            const chunkPaths = [];
            const chunkProgress = {};

            let progressInterval = null;
            let progressLineCount = 0;

            const printProgress = () => {
                let totalDownloaded = 0;
                let totalSpeed = 0;
                Object.values(chunkProgress).forEach(p => {
                    totalDownloaded += p.downloaded;
                    totalSpeed += p.speed;
                });

                const percentage = totalLength ? Math.floor((totalDownloaded / totalLength) * 100) : 0;
                const barWidth = 20;
                const bar = '█'.repeat(Math.floor(percentage / (100/barWidth))) + ' '.repeat(barWidth - Math.floor(percentage / (100/barWidth)));
                const downloaded = formatBytes(totalDownloaded);
                const total = formatBytes(totalLength);
                const speed = formatBytes(totalSpeed) + '/s';
                
                const line = `${file.name}: [${bar}] ${percentage}% | ${downloaded} / ${total} | ${speed}`;
                
                process.stdout.cursorTo(0);
                process.stdout.clearLine(0);
                process.stdout.write(line + '\r');
            };

            for (let i = 0; i < effectiveThreads; i++) {
                const start = i * chunkSize;
                const end = Math.min(((i + 1) * chunkSize) - 1, totalLength - 1);

                if (start > end) continue;

                const chunkPath = path.join(downloadsDir, `${file.name}.part${i}`);
                chunkPaths.push(chunkPath);
                chunkProgress[i] = { downloaded: 0, total: end - start + 1, speed: 0 };

                const worker = new Worker(__filename, {
                    workerData: { type: 'chunk', downloadUrl, chunkPath, start, end, file }
                });

                const promise = new Promise((resolve, reject) => {
                    worker.on('message', (message) => {
                        if (message.type === 'progress') {
                            chunkProgress[i] = {
                                ...chunkProgress[i],
                                downloaded: message.payload.chunk.downloaded,
                                speed: message.payload.speed,
                            };
                        } else if (message.type === 'done') {
                            resolve();
                        } else if (message.type === 'error') {
                            reject(new Error(message.payload.message));
                        }
                    });
                    worker.on('error', reject);
                    worker.on('exit', (code) => {
                        if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
                    });
                });
                chunkPromises.push(promise);
            }
            
            progressInterval = setInterval(printProgress, 200);
            try {
                await Promise.all(chunkPromises);
                clearInterval(progressInterval);
                printProgress(); // final print
                console.log(`\nAssembling chunks for ${file.name}...`);
                const finalPath = path.join(downloadsDir, file.name);
                await assembleChunks(finalPath, chunkPaths, totalLength);
            } catch (error) {
                clearInterval(progressInterval);
                console.error(`\nFailed to download ${file.name}: ${error.message}`);
                // cleanup partial chunks
                chunkPaths.forEach(p => fs.unlink(p, () => {}));
            }

        } else {
            return downloadFileSingle(file, downloadsDir);
        }
    }

    async function downloadFileSingle(file, downloadsDir) {
        // This re-uses the old progress bar logic for a single file
        const downloadProgress = {};
        let progressInterval = null;

        const printProgress = () => {
            const progress = downloadProgress[file.name];
            if (!progress) return;
            const barWidth = 20;
            const bar = '█'.repeat(Math.floor(progress.percentage / (100/barWidth))) + ' '.repeat(barWidth - Math.floor(progress.percentage / (100/barWidth)));
            const downloaded = formatBytes(progress.downloaded);
            const total = formatBytes(progress.total);
            const speed = formatBytes(progress.speed) + '/s';
            const line = `${file.name}: [${bar}] ${progress.percentage}% | ${downloaded} / ${total} | ${speed}`;
            process.stdout.cursorTo(0);
            process.stdout.clearLine(0);
            process.stdout.write(line + '\r');
        };

        return new Promise((resolve, reject) => {
            const worker = new Worker(__filename, {
                workerData: { type: 'full', file, downloadsDir }
            });

            downloadProgress[file.name] = { percentage: 0, downloaded: 0, total: 0, speed: 0 };
            progressInterval = setInterval(printProgress, 200);

            worker.on('message', (message) => {
                if (message.type === 'progress') {
                    downloadProgress[file.name] = message.payload;
                } else if (message.type === 'done') {
                    clearInterval(progressInterval);
                    printProgress();
                    console.log(`\n${file.name} download complete.`);
                    resolve();
                } else if (message.type === 'error') {
                    clearInterval(progressInterval);
                    console.error(`\nError downloading ${file.name}: ${message.payload.message}`);
                    reject(new Error(message.payload.message));
                }
            });
            worker.on('error', (err) => {
                clearInterval(progressInterval);
                reject(err);
            });
            worker.on('exit', (code) => {
                if (code !== 0) {
                    clearInterval(progressInterval);
                    reject(new Error(`Worker stopped with exit code ${code}`));
                }
            });
        });
    }

    module.exports = async (files, downloadsDir, numThreads = 8) => {
        for (const file of files) {
            await downloadFileWithChunks(file, downloadsDir, numThreads);
        }
    };
}