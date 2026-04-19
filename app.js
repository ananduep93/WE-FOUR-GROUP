import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, deleteDoc, doc, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { firebaseConfig, imgbbApiKey } from "./config.js";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

console.log("✅ Firebase initialized.");

// --- Service Worker Registration ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('✅ SW Registered', reg.scope))
            .catch(err => console.log('❌ SW Registration Failed', err));
    });
}

// --- DOM Elements ---
const inspectionForm = document.getElementById('inspection-form');
const locationInput = document.getElementById('location');
const submitBtn = document.getElementById('submit-btn');

const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const viewDataBtn = document.getElementById('view-data-btn');
const passwordModal = document.getElementById('password-modal');
const adminPasswordInput = document.getElementById('admin-password');
const verifyPasswordBtn = document.getElementById('verify-password');
const passwordError = document.getElementById('password-error');
const installAppBtn = document.getElementById('install-app-btn');

const sourceModal = document.getElementById('source-modal');
const sourceCameraBtn = document.getElementById('source-camera');
const sourceGalleryBtn = document.getElementById('source-gallery');

const formSection = document.getElementById('form-section');
const adminSection = document.getElementById('admin-section');
const backToFormBtn = document.getElementById('back-to-form');
const dataContainer = document.getElementById('data-container');
const refreshDataBtn = document.getElementById('refresh-data');
const adminLoading = document.getElementById('admin-loading');
const adminEmpty = document.getElementById('admin-empty');

// --- PWA Installation State ---
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the mini-infobar from appearing on mobile
    e.preventDefault();
    // Stash the event so it can be triggered later.
    deferredPrompt = e;
    console.log('📥 beforeinstallprompt event captured');
});

// --- State ---
let isSubmitting = false;
let currentUploadCategory = null;
const photoState = {
    car: [],
    oil: [],
    cng: [],
    petrol: []
};

// --- Helper: Show Toast ---
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast toast-${type}`;
    toast.classList.remove('hidden');
    setTimeout(() => { toast.classList.add('hidden'); }, 4000);
}

// --- Photo Source Logic ---
const webcamModal = document.getElementById('webcam-modal');
const webcamVideo = document.getElementById('webcam-video');
const webcamCanvas = document.getElementById('webcam-canvas');
const webcamPreview = document.getElementById('webcam-preview');
const shutterBtn = document.getElementById('shutter-btn');
const retakeBtn = document.getElementById('retake-btn');
const usePhotoBtn = document.getElementById('use-photo-btn');
const webcamActionBtns = document.getElementById('webcam-action-btns');
const closeWebcamBtn = document.getElementById('close-webcam');

let webcamStream = null;

document.querySelectorAll('.upload-box').forEach(box => {
    box.addEventListener('click', () => {
        currentUploadCategory = box.dataset.category;
        sourceModal.classList.remove('hidden');
    });
});

document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', () => {
        settingsModal.classList.add('hidden');
        passwordModal.classList.add('hidden');
        sourceModal.classList.add('hidden');
        if (btn.id === 'close-webcam') stopWebcam();
    });
});

// Device detection helper
const isMobile = () => /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

sourceCameraBtn.addEventListener('click', async () => {
    sourceModal.classList.add('hidden');
    
    if (isMobile()) {
        // Direct mobile camera trigger
        const input = document.getElementById(`${currentUploadCategory}-camera`);
        if (input) input.click();
    } else {
        // Desktop/Webcam UI
        startWebcam();
    }
});

sourceGalleryBtn.addEventListener('click', () => {
    const input = document.getElementById(`${currentUploadCategory}-gallery`);
    if (input) input.click();
    sourceModal.classList.add('hidden');
});

// --- Webcam Logic ---
async function startWebcam() {
    try {
        webcamStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        webcamVideo.srcObject = webcamStream;
        webcamModal.classList.remove('hidden');
        
        // Reset UI
        webcamVideo.classList.remove('hidden');
        webcamPreview.classList.add('hidden');
        shutterBtn.classList.remove('hidden');
        webcamActionBtns.classList.add('hidden');
    } catch (err) {
        console.error("Webcam Error:", err);
        showToast("Webcam access denied or not available. Falling back to file upload.", "error");
        // Fallback for desktop: just open the file picker even if camera button was clicked
        const input = document.getElementById(`${currentUploadCategory}-camera`);
        if (input) input.click();
    }
}

function stopWebcam() {
    if (webcamStream) {
        webcamStream.getTracks().forEach(track => track.stop());
        webcamStream = null;
    }
    webcamModal.classList.add('hidden');
}

shutterBtn.addEventListener('click', () => {
    // Set canvas dimensions to match video
    webcamCanvas.width = webcamVideo.videoWidth;
    webcamCanvas.height = webcamVideo.videoHeight;
    
    // Draw current frame to canvas
    const ctx = webcamCanvas.getContext('2d');
    ctx.translate(webcamCanvas.width, 0);
    ctx.scale(-1, 1); // Maintain mirror effect
    ctx.drawImage(webcamVideo, 0, 0, webcamCanvas.width, webcamCanvas.height);
    
    // Show preview
    webcamPreview.src = webcamCanvas.toDataURL('image/jpeg');
    webcamVideo.classList.add('hidden');
    webcamPreview.classList.remove('hidden');
    shutterBtn.classList.add('hidden');
    webcamActionBtns.classList.remove('hidden');
});

retakeBtn.addEventListener('click', () => {
    webcamVideo.classList.remove('hidden');
    webcamPreview.classList.add('hidden');
    shutterBtn.classList.remove('hidden');
    webcamActionBtns.classList.add('hidden');
});

usePhotoBtn.addEventListener('click', () => {
    webcamCanvas.toBlob((blob) => {
        const file = new File([blob], `capture_${Date.now()}.jpg`, { type: 'image/jpeg' });
        handleFileSelection(currentUploadCategory, [file]);
        stopWebcam();
        showToast("Photo captured!", "success");
    }, 'image/jpeg', 0.9);
});

// Helper to handle file selection
function handleFileSelection(category, files) {
    const newFiles = Array.from(files);
    photoState[category] = [...photoState[category], ...newFiles];
    renderPreview(category);
}

// Attach listeners to all hidden inputs
['car', 'oil', 'cng', 'petrol'].forEach(cat => {
    const gallery = document.getElementById(`${cat}-gallery`);
    const camera = document.getElementById(`${cat}-camera`);
    
    if (gallery) gallery.addEventListener('change', (e) => handleFileSelection(cat, e.target.files));
    if (camera) camera.addEventListener('change', (e) => handleFileSelection(cat, e.target.files));
});

function renderPreview(category) {
    const container = document.getElementById(`${category}-photos-preview`) || document.getElementById(`${category}-photo-preview`);
    container.innerHTML = '';
    
    photoState[category].forEach((file, index) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const wrap = document.createElement('div');
            wrap.className = 'preview-item';
            
            const img = document.createElement('img');
            img.src = e.target.result;
            img.classList.add('preview-img');
            
            const del = document.createElement('button');
            del.innerHTML = '&times;';
            del.className = 'remove-btn';
            del.onclick = (event) => {
                event.stopPropagation();
                photoState[category].splice(index, 1);
                renderPreview(category);
            };
            
            wrap.appendChild(img);
            wrap.appendChild(del);
            container.appendChild(wrap);
            
            // Add Another button logic
            if (index === photoState[category].length - 1) {
                const addBtn = document.createElement('div');
                addBtn.className = 'add-another-btn';
                addBtn.innerHTML = '<i class="fas fa-plus"></i><span>Add Another</span>';
                addBtn.onclick = () => {
                    currentUploadCategory = category;
                    sourceModal.classList.remove('hidden');
                };
                container.appendChild(addBtn);
            }
        };
        reader.readAsDataURL(file);
    });
}

// --- Compress Image ---
function compressImage(file) {
    return new Promise((resolve) => {
        if (!file) return resolve(null);
        const maxWidth = 1200;
        const quality = 0.75;
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (e) => {
            const img = new Image();
            img.src = e.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let w = img.width, h = img.height;
                if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
                canvas.width = w;
                canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                canvas.toBlob((blob) => {
                    resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
                }, 'image/jpeg', quality);
            };
        };
        reader.onerror = () => resolve(file);
    });
}

// --- Upload to ImgBB ---
async function uploadToImgBB(file) {
    if (!file) return null;
    const formData = new FormData();
    formData.append('image', file);
    try {
        const response = await fetch(`https://api.imgbb.com/1/upload?key=${imgbbApiKey}`, {
            method: 'POST',
            body: formData
        });
        const result = await response.json();
        if (result.success) return result.data.display_url;
        throw new Error(result.error.message || "Upload failed");
    } catch (error) {
        console.error(`❌ ImgBB error:`, error);
        throw new Error(`Upload error: ${error.message}`);
    }
}

let uploadedCount = 0;
let totalCount = 0;
function updateProgress() {
    uploadedCount++;
    submitBtn.querySelector('.btn-text').textContent = `Uploading ${uploadedCount}/${totalCount}...`;
}

// --- Form Submission ---
inspectionForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    const allPhotos = [...photoState.car, ...photoState.oil, ...photoState.cng, ...photoState.petrol];
    if (allPhotos.length === 0) {
        showToast('Please add at least one photo', 'error');
        return;
    }

    try {
        isSubmitting = true;
        submitBtn.disabled = true;
        submitBtn.querySelector('.spinner').classList.remove('hidden');
        submitBtn.querySelector('.btn-text').textContent = 'Compressing...';

        totalCount = allPhotos.length;
        uploadedCount = 0;

        // Compress and upload by category
        const uploadCategory = async (files) => {
            const compressed = await Promise.all(files.map(f => compressImage(f)));
            return await Promise.all(compressed.map(f => uploadToImgBB(f).then(u => { updateProgress(); return u; })));
        };

        submitBtn.querySelector('.btn-text').textContent = `Uploading 0/${totalCount}...`;

        const carURLs = await uploadCategory(photoState.car);
        const oilURLs = await uploadCategory(photoState.oil);
        const cngURLs = await uploadCategory(photoState.cng);
        const petrolURLs = await uploadCategory(photoState.petrol);

        submitBtn.querySelector('.btn-text').textContent = 'Saving...';

        const formData = new FormData(inspectionForm);
        await addDoc(collection(db, 'inspections'), {
            idNumber: formData.get('idNumber').trim(),
            carNumber: formData.get('carNumber').trim(),
            kilometer: Number(formData.get('kilometer')),
            location: locationInput.value.trim(),
            complaint: formData.get('complaint') || '',
            note: formData.get('note') || '',
            carPhotoURLs: carURLs,
            oilPhotoURLs: oilURLs,
            cngPhotoURLs: cngURLs,
            petrolPhotoURLs: petrolURLs,
            timestamp: serverTimestamp()
        });

        showToast('Submitted successfully! ✅', 'success');
        inspectionForm.reset();
        Object.keys(photoState).forEach(k => {
            photoState[k] = [];
            const container = document.getElementById(`${k}-photo${k === 'car' ? 's' : ''}-preview`);
            if (container) container.innerHTML = '';
        });

    } catch (error) {
        showToast(`Error: ${error.message}`, 'error');
    } finally {
        isSubmitting = false;
        submitBtn.disabled = false;
        submitBtn.querySelector('.spinner').classList.add('hidden');
        submitBtn.querySelector('.btn-text').textContent = 'Submit Inspection';
    }
});

// --- Admin Panel ---
settingsBtn.addEventListener('click', () => settingsModal.classList.remove('hidden'));

viewDataBtn.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
    passwordModal.classList.remove('hidden');
    adminPasswordInput.value = '';
    passwordError.classList.add('hidden');
});

installAppBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
        // Show the install prompt
        deferredPrompt.prompt();
        // Wait for the user to respond to the prompt
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`User response to the install prompt: ${outcome}`);
        // We've used the prompt, and can't use it again, but we'll keep the button
        // as per user request. We'll null deferredPrompt until the next event.
        deferredPrompt = null;
    } else {
        // If the prompt isn't available, show a toast. 
        // This could be because it's already installed or the browser/OS doesn't support it.
        showToast("Installation prompt not available. You can also use browser settings to install.", "info");
    }
    settingsModal.classList.add('hidden');
});

window.addEventListener('appinstalled', (event) => {
    console.log('✅ App was installed.');
    showToast("App installed successfully! 🎉", "success");
});

verifyPasswordBtn.addEventListener('click', () => {
    if (adminPasswordInput.value === 'wefour27') {
        passwordModal.classList.add('hidden');
        showAdminPanel();
    } else {
        passwordError.classList.remove('hidden');
    }
});

function showAdminPanel() {
    formSection.classList.add('hidden');
    adminSection.classList.remove('hidden');
    fetchData();
}

backToFormBtn.addEventListener('click', () => {
    adminSection.classList.add('hidden');
    formSection.classList.remove('hidden');
});

// Helper for 12-hour format
function format12h(date) {
    return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
}

async function fetchData() {
    dataContainer.innerHTML = '';
    adminLoading.classList.remove('hidden');
    adminEmpty.classList.add('hidden');
    try {
        const q = query(collection(db, 'inspections'), orderBy('timestamp', 'desc'));
        const snap = await getDocs(q);
        if (snap.empty) {
            adminEmpty.classList.remove('hidden');
        } else {
            snap.forEach(doc => renderCard({ id: doc.id, ...doc.data() }));
        }
    } catch (err) {
        showToast('Failed to load records.', 'error');
    } finally {
        adminLoading.classList.add('hidden');
    }
}

refreshDataBtn.addEventListener('click', fetchData);

async function deleteEntry(id) {
    if (!confirm('Are you sure you want to delete this record?')) return;
    try {
        await deleteDoc(doc(db, 'inspections', id));
        showToast('Record deleted.', 'success');
        fetchData();
    } catch (err) {
        showToast('Delete failed.', 'error');
    }
}

function renderCard(data) {
    const card = document.createElement('div');
    card.className = 'data-card';
    const dateStr = data.timestamp ? format12h(data.timestamp.toDate()) : 'Just now';

    const renderPhotos = (urls, label) => {
        if (!urls || urls.length === 0) return '';
        return urls.map(url => `
            <div class="photo-item">
                <img src="${url}" onclick="window.open('${url}')" alt="${label}">
                <span class="photo-label">${label}</span>
            </div>
        `).join('');
    };

    card.innerHTML = `
        <div class="card-header">
            <div>
                <span class="id-badge">${data.idNumber}</span>
                <h3 style="margin-top:0.5rem">${data.carNumber}</h3>
                <p style="font-size:0.75rem;margin-top:0.2rem;color:var(--text-secondary)">${dateStr}</p>
            </div>
            <button class="btn-delete" onclick="window.deleteEntry('${data.id}')">
                <i class="fas fa-trash"></i> Delete
            </button>
        </div>
        <div class="card-body">
            <p><strong>KM:</strong> ${data.kilometer}</p>
            <p><strong>Location:</strong> ${data.location}</p>
            <p><strong>Complaint:</strong> ${data.complaint || 'None'}</p>
            <p><strong>Note:</strong> ${data.note || 'None'}</p>
            <div class="card-photos">
                ${renderPhotos(data.carPhotoURLs, 'Car Photo')}
                ${renderPhotos(data.oilPhotoURLs, 'Oil Level')}
                ${renderPhotos(data.cngPhotoURLs, 'CNG Level')}
                ${renderPhotos(data.petrolPhotoURLs, 'Petrol Level')}
            </div>
        </div>
    `;
    dataContainer.appendChild(card);
}

// Global exposure for onclick handlers
window.deleteEntry = deleteEntry;
