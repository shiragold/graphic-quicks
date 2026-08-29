import {
    computeScaledSize,
    SUPPORTED_SCALE_FACTORS,
} from '../../packages/scale/dist/index.js';

// Browser canvas limits: exceeding them silently produces a blank canvas.
const MAX_CANVAS_DIMENSION = 16384;
const MAX_CANVAS_AREA = 268435456; // 16384 * 16384

const SCALE_LABELS = { 2: 'Double', 3: 'Triple', 4: 'Quadruple', 8: 'Extreme' };

const STATUS_LABELS = {
    pending: '⏳ Pending',
    processing: '⚙️ Processing',
    completed: '✓ Completed',
    error: '⚠️ Error',
};

const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const scaleSelect = document.getElementById('scaleSelect');
const imagesGrid = document.getElementById('imagesGrid');
const emptyState = document.getElementById('emptyState');
const stats = document.getElementById('stats');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const actionButtons = document.getElementById('actionButtons');
const upscaleAllBtn = document.getElementById('upscaleAllBtn');
const downloadAllBtn = document.getElementById('downloadAllBtn');
const clearAllBtn = document.getElementById('clearAllBtn');

let images = [];

// Incremented whenever a new run starts; an in-flight loop that no longer
// matches the current generation aborts silently.
let runGeneration = 0;
let running = false;

// Populate the scale dropdown from the package's supported factors
for (const factor of SUPPORTED_SCALE_FACTORS) {
    const option = document.createElement('option');
    option.value = String(factor);
    option.textContent = `${factor}x (${SCALE_LABELS[factor] ?? ''})`.trim();
    scaleSelect.appendChild(option);
}

// Upload area click
uploadArea.addEventListener('click', () => fileInput.click());

// Drag and drop
uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
});

uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('dragover');
});

uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length > 0) {
        handleFiles(files);
    }
});

// File input change
fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
        handleFiles(files);
    }
    fileInput.value = '';
});

// Handle multiple files
function handleFiles(files) {
    files.forEach(file => {
        const id = Date.now() + Math.random();
        const reader = new FileReader();

        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                images.push({
                    id: id,
                    name: file.name,
                    file: file,
                    original: img,
                    upscaled: null,
                    status: 'pending',
                    error: null,
                });
                renderImages();
                updateStats();
            };
            img.src = e.target.result;
        };

        reader.readAsDataURL(file);
    });
}

// Render images grid (DOM construction only — user-controlled strings such
// as file names must never be interpolated into HTML)
function renderImages() {
    if (images.length === 0) {
        emptyState.style.display = 'block';
        imagesGrid.style.display = 'none';
        actionButtons.style.display = 'none';
        return;
    }

    emptyState.style.display = 'none';
    imagesGrid.style.display = 'grid';
    actionButtons.style.display = 'flex';

    imagesGrid.textContent = '';

    for (const img of images) {
        const card = document.createElement('div');
        card.className = 'image-card';
        if (img.status === 'processing') card.classList.add('processing');
        if (img.status === 'completed') card.classList.add('completed');
        if (img.status === 'error') card.classList.add('error');
        card.dataset.id = String(img.id);

        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-btn';
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', () => removeImage(img.id));
        card.appendChild(removeBtn);

        const preview = document.createElement('img');
        preview.className = 'image-preview';
        preview.src = img.original.src;
        preview.alt = img.name;
        card.appendChild(preview);

        const nameEl = document.createElement('div');
        nameEl.className = 'image-name';
        nameEl.title = img.name;
        nameEl.textContent = img.name;
        card.appendChild(nameEl);

        const info = document.createElement('div');
        info.className = 'image-info';
        let infoText = `${img.original.width} × ${img.original.height}px`;
        if (img.upscaled) {
            infoText += ` → ${img.upscaled.width} × ${img.upscaled.height}px`;
        }
        info.textContent = infoText;
        card.appendChild(info);

        const statusEl = document.createElement('span');
        statusEl.className = `image-status status-${img.status}`;
        statusEl.textContent = STATUS_LABELS[img.status] ?? img.status;
        card.appendChild(statusEl);

        if (img.status === 'error' && img.error) {
            const errorEl = document.createElement('div');
            errorEl.className = 'image-error';
            errorEl.textContent = img.error;
            card.appendChild(errorEl);
        }

        imagesGrid.appendChild(card);
    }
}

// Remove image
function removeImage(id) {
    images = images.filter(img => img.id !== id);
    renderImages();
    updateStats();
}

// Update stats
function updateStats() {
    const completed = images.filter(img => img.status === 'completed').length;
    const failed = images.filter(img => img.status === 'error').length;
    const unfinished = images.filter(
        img => img.status === 'pending' || img.status === 'processing'
    ).length;
    const total = images.length;

    if (total === 0) {
        stats.classList.remove('active');
        downloadAllBtn.style.display = 'none';
        return;
    }

    stats.classList.add('active');
    // Interpolated values are all numbers or the numeric select value —
    // no user-controlled strings.
    stats.innerHTML = `
        <strong>Images:</strong> ${total} uploaded |
        <strong>Completed:</strong> ${completed}/${total} |
        ${failed > 0 ? `<strong>Failed:</strong> ${failed} | ` : ''}
        <strong>Scale:</strong> ${Number(scaleSelect.value)}x
    `;

    if (completed > 0 && unfinished === 0) {
        downloadAllBtn.style.display = 'block';
    } else {
        downloadAllBtn.style.display = 'none';
    }
}

// Run the upscale loop over all pending images at the currently selected
// factor. A factor change mid-run bumps runGeneration, which makes this
// loop abort so a fresh run can take over.
async function runUpscale() {
    const generation = ++runGeneration;
    const factor = parseInt(scaleSelect.value, 10);
    const pending = images.filter(img => img.status === 'pending');

    if (pending.length === 0) {
        alert('All images are already upscaled!');
        return;
    }

    running = true;
    upscaleAllBtn.disabled = true;
    progressContainer.classList.add('active');

    for (let i = 0; i < pending.length; i++) {
        const img = pending[i];
        img.status = 'processing';
        renderImages();

        // Yield to the event loop so the UI can update (and so a factor
        // change gets a chance to abort us before we do the work).
        await new Promise(resolve => setTimeout(resolve, 50));
        if (generation !== runGeneration) return;

        try {
            upscaleImage(img, factor);
            img.status = 'completed';
            img.error = null;
        } catch (error) {
            img.status = 'error';
            img.error = error instanceof Error ? error.message : String(error);
            img.upscaled = null;
        }

        const progress = Math.round(((i + 1) / pending.length) * 100);
        progressFill.style.width = progress + '%';
        progressFill.textContent = progress + '%';

        renderImages();
        updateStats();
    }

    running = false;
    upscaleAllBtn.disabled = false;
    progressContainer.classList.remove('active');
    progressFill.style.width = '0%';
}

// Upscale all button
upscaleAllBtn.addEventListener('click', () => {
    runUpscale();
});

// Upscale single image. Throws RangeError for zero/non-finite source
// dimensions (via computeScaledSize) or when the target exceeds browser
// canvas limits — callers surface these as a per-item error state.
function upscaleImage(imageObj, factor) {
    const { width, height } = computeScaledSize(
        { width: imageObj.original.width, height: imageObj.original.height },
        factor
    );

    if (width > MAX_CANVAS_DIMENSION || height > MAX_CANVAS_DIMENSION) {
        throw new RangeError(
            `Target size ${width} × ${height}px exceeds the ${MAX_CANVAS_DIMENSION}px canvas dimension limit`
        );
    }
    if (width * height > MAX_CANVAS_AREA) {
        throw new RangeError(
            `Target area ${width} × ${height}px exceeds the browser canvas area limit`
        );
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    canvas.width = width;
    canvas.height = height;

    ctx.drawImage(imageObj.original, 0, 0, width, height);

    imageObj.upscaled = canvas;
}

// Download all button — sequential per-file downloads
downloadAllBtn.addEventListener('click', async () => {
    const completed = images.filter(img => img.status === 'completed');

    if (completed.length === 0) {
        alert('No images to download!');
        return;
    }

    downloadAllBtn.disabled = true;
    downloadAllBtn.textContent = 'Downloading...';

    try {
        for (const img of completed) {
            const blob = await new Promise((resolve, reject) => {
                img.upscaled.toBlob(
                    b => (b ? resolve(b) : reject(new Error(`Could not encode ${img.name}`))),
                    'image/png'
                );
            });

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const baseName = img.name.replace(/\.[^/.]+$/, '');
            a.download = `${baseName}_upscaled_${scaleSelect.value}x.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();

            // Gap between files so the browser registers each download;
            // revoke only after the download has had time to start.
            await new Promise(resolve => setTimeout(resolve, 250));
            URL.revokeObjectURL(url);
        }
    } catch (error) {
        console.error('Error downloading images:', error);
        alert('Error downloading images. Please try again.');
    }

    downloadAllBtn.textContent = 'Download All';
    downloadAllBtn.disabled = false;
});

// Clear all button
clearAllBtn.addEventListener('click', () => {
    if (images.length === 0) return;

    if (confirm(`Clear all ${images.length} images?`)) {
        runGeneration++; // abort any in-flight run
        running = false;
        images = [];
        renderImages();
        updateStats();
        upscaleAllBtn.disabled = false;
        progressContainer.classList.remove('active');
        progressFill.style.width = '0%';
    }
});

// Scale factor change: reset results, and if a run is in flight, abort it
// and restart at the new factor.
scaleSelect.addEventListener('change', () => {
    images.forEach(img => {
        img.status = 'pending';
        img.upscaled = null;
        img.error = null;
    });
    renderImages();
    updateStats();

    if (running) {
        runUpscale();
    }
});
