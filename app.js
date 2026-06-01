// регистрация воркера
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js')
    .then(reg => console.log('service-worker заругистрирован', reg))
    .catch(err => console.error('ошибка регистрации service-worker', err));
}

const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const captureBtn = document.getElementById('capture-btn');
const resultsDiv = document.getElementById('results');

// доступ к камер
async function initCamera() {
    try{
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {facingMode: 'environment'}
        });
        video.srcObject = stream;
        await video.play();
        console.log('camera = OK')
    } catch (err) {
        console.error('Ошибка камеры', err);
        resultsDiv.textContent = 'Не удалось получить доступ к камере'
    }
}

// трансляция потока с камеры
function captureFrame() {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    return new Promise((resolve) =>{
        canvas.toBlob(resolve, 'image/jpeg', 0.95);
    });
}

//нажатие на кнопку (тригер события)
captureBtn.addEventListener('click', async () => {
    try{
        resultsDiv.textContent = 'Подождите...';
        const imageBlob =await captureFrame();
        console.log('Снимок сделан, размер:', imageBlob.size);

        const [text,barcodes] = await Promise.all([
            recognizeText(imageBlob),
            detectQR(imageBlob)
        ])
        
        let resultHTML = '<h3>Распознанный текст</h3>';
        resultHTML +=`<pre>${text || 'Текст не найден'}</pre>`
        
        if (barcodes.length > 0) {
            resultHTML += '<h3>Найденные QR:</h3><ul>';
            barcodes.foreach((barcode,index) =>{
                resultHTML += `<li><strong>Код ${index + 1}: </strong> ${barcode.rawValue}</li>`;
            });
            resultHTML += '</ul>';
        }
        
        resultsDiv.innerHTML = resultHTML;

        await dbHelper.addReceipt({
            date: new Date(),
            text: text || '',
            barcodes: barcodes.map(b => b.rawValue),
            image: imageBlob
        });
        console.log('Сохранено');

        displayHistory();


    } catch (err) {
        console.error("Ошибка при захвате кадра", err);
        resultsDiv.textContent = 'Ошибка обработки';
    }
});

// Расознавание текста с изображения
async function recognizeText(imageBlob) {
    resultsDiv.textContent = 'Идет распознавание...'

    try{
        const {data: {text}} = await Tesseract.recognize(
            imageBlob,
            'rus+eng'
        );
        return text;
    } catch (err) {
        console.error('Ошибка Распознания текста', err )
        throw new Error('Распознание не удалось')
    }
}

// Распознавание QR
let useBarcodeDetectorAPI = ('BarcodeDetector' in window);
if (!useBarcodeDetectorAPI) {
    console.warn('BarcodeDetector API не найден. Будет использован jsQR.');
    window.addEventListener('DOMContentLoaded', () => {
        const warning = document.createElement('p');
        warning.style.color = '#856404';
        warning.style.backgroundColor = '#fff3cd';
        warning.style.padding = '0.5rem';
        warning.textContent = 'BarcodeDetector API не поддерживается браузером. Для распознавания QR-кодов используется встроенная библиотека jsQR.';
        const output = document.getElementById('output');
        if (output) {
            output.prepend(warning);
        }
    });
}
async function detectQR(imageBlob) {
    if (useBarcodeDetectorAPI) {

    try {
        const imageBitmap = await createImageBitmap(imageBlob);
        const detector = new BarcodeDetector({ formats: ['qr_code']});
        const barcodes = await detector.detect(imageBitmap);
        imageBitmap.close();
        return barcodes;
    } catch (err) {
        console.error('Ошибка QR', err);
        return [];
    }
}
    try {
        const img = new Image();
        const url = URL.createObjectURL(imageBlob);
        img.src = url;
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
        });

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = img.width;
        tempCanvas.height = img.height;
        const ctx = tempCanvas.getContext('2d');
        ctx.drawImage(img, 0, 0, img.width, img.height);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);

        const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'dontInvert',
        });
        URL.revokeObjectURL(url);

        if (code) {
            return [{ rawValue: code.data, format: 'qr_code' }];
        }
    } catch (err) {
        console.warn('jsQR ошибка:', err);
    }
    return [];
}

// Модуль indexDB
const dbHelper = {
    _db: null,

    async open() {
        return new Promise((resolve,reject) =>{
            const request = indexedDB.open('ReceiptScannerDB', 1);

            request.onupgradeneeded = event = (event) => {
                const db = event.target.result;

                if (!db.objectStoreNames.contains('receipts')) {
                    const store = db.createObjectStore('receipts', {
                    keyPath: 'id',
                    autoIncrement: true
                    });
                    store.createIndex('date','date', {unique: false});
                }
            };
            request.onsuccess = (event) => {
                this._db = event.target.result;
                resolve(this._db);
            }

            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    },

    async addReceipt(record) {
        const db = this._db || await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('receipts', 'readwrite');
            const store = transaction.objectStore('receipts');
            const request = store.add(record);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    async getAllReceipts() {
        const db = this._db || await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('receipts', 'readonly');
            const store = tx.objectStore('receipts');
            const index = store.index('date');
            const request = index.openCursor(null, 'prev');
            const results = [];
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    results.push(cursor.value);
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }
}

// История сканов
async function displayHistory() {
    const historyList = document.getElementById('history-list');
    try{
        const receipts = await dbHelper.getAllReceipts();
        if (receipts.length === 0) {
            historyList.innerHTML = '<p>История пуста</p>';
            return;
        }
        let html = '<ul>';
        for (const r of receipts) {
            const dateStr = new Date(r.date).toLocaleString();
            html += `<li>
            <strong>${dateStr}</strong><br>
            <pre>${r.text.substring(0,200)}${r.text.length >200 ? '...' : ''}</pre>
            ${r.barcodes.length ? '<p>QR: ' + r.barcodes.join(', ') + '</p>' : ''}
            </li>`;
        }
        html += '</ul>';
        historyList.innerHTML = html;
    } catch (err) {
        console.error('Ошибка загрузки истории: ', err);
        historyList.textContent = 'Не удалось загрузить историю';
    }
}

document.getElementById('refresh-history-btn').addEventListener('click', displayHistory);

// Инициализация
window.addEventListener('DOMContentLoaded',  async () =>{
    await dbHelper.open();
    displayHistory();
    initCamera();
} )