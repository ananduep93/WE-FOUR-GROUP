import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { firebaseConfig, imgbbApiKey } from "./config.js";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

console.log("✅ Firebase initialized with Free Firestore.");

// --- DOM Elements ---
const inspectionForm = document.getElementById('inspection-form');
const carPhotosInput = document.getElementById('car-photos');
const oilPhotoInput = document.getElementById('oil-photo');
const cngPhotoInput = document.getElementById('cng-photo');
const petrolPhotoInput = document.getElementById('petrol-photo');
const getLocationBtn = document.getElementById('get-location');
const locationDisplay = document.getElementById('location-display');
const locationCoords = document.getElementById('location-coords');
const submitBtn = document.getElementById('submit-btn');
const manualLocationInput = document.getElementById('manual-location');

const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const viewDataBtn = document.getElementById('view-data-btn');
const passwordModal = document.getElementById('password-modal');
const adminPasswordInput = document.getElementById('admin-password');
const verifyPasswordBtn = document.getElementById('verify-password');
const passwordError = document.getElementById('password-error');

const formSection = document.getElementById('form-section');
const adminSection = document.getElementById('admin-section');
const backToFormBtn = document.getElementById('back-to-form');
const dataContainer = document.getElementById('data-container');
const refreshDataBtn = document.getElementById('refresh-data');
const adminLoading = document.getElementById('admin-loading');
const adminEmpty = document.getElementById('admin-empty');

// --- State ---
let isSubmitting = false;

// --- Helper: Show Toast ---
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast toast-${type}`;
    toast.classList.remove('hidden');
    setTimeout(() => { toast.classList.add('hidden'); }, 4000);
}

// --- Image Preview ---
function setupPreview(input, containerId) {
    input.addEventListener('change', () => {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        Array.from(input.files).forEach(file => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = document.createElement('img');
                img.src = e.target.result;
                img.classList.add('preview-img');
                container.appendChild(img);
            };
            reader.readAsDataURL(file);
        });
    });
}

setupPreview(carPhotosInput, 'car-photos-preview');
setupPreview(oilPhotoInput, 'oil-photo-preview');
setupPreview(cngPhotoInput, 'cng-photo-preview');
setupPreview(petrolPhotoInput, 'petrol-photo-preview');

// --- Geolocation ---
getLocationBtn.addEventListener('click', () => {
    if (!navigator.geolocation) {
        showToast('Geolocation not supported. Please type location manually.', 'error');
        return;
    }
    getLocationBtn.disabled = true;
    locationDisplay.textContent = 'Fetching location...';
    navigator.geolocation.getCurrentPosition(
        (position) => {
            const lat = position.coords.latitude.toFixed(6);
            const lng = position.coords.longitude.toFixed(6);
            const coords = `${lat}, ${lng}`;
            locationCoords.value = coords;
            locationDisplay.textContent = `📍 ${coords}`;
            getLocationBtn.disabled = false;
            showToast('Location fetched!', 'success');
        },
        (error) => {
            locationDisplay.textContent = 'GPS failed — use manual input below';
            getLocationBtn.disabled = false;
            showToast('GPS unavailable. Please type location manually.', 'error');
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
});

// --- Manual Location ---
manualLocationInput.addEventListener('input', () => {
    const val = manualLocationInput.value.trim();
    if (val) {
        locationCoords.value = val;
        locationDisplay.textContent = `📍 ${val}`;
    } else {
        locationCoords.value = '';
        locationDisplay.textContent = 'Not fetched yet';
    }
});

// --- Compress Image (simple, single-pass) ---
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
        reader.onerror = () => resolve(file); // fallback: use original
    });
}

// --- Upload Single File to ImgBB (Completely Free) ---
async function uploadToImgBB(file) {
    if (!file) return null;
    console.log(`⬆️ Starting ImgBB upload: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
    
    const formData = new FormData();
    formData.append('image', file);
    
    try {
        const response = await fetch(`https://api.imgbb.com/1/upload?key=${imgbbApiKey}`, {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        
        if (result.success) {
            console.log(`✅ Done: ${file.name} -> ${result.data.display_url}`);
            return result.data.display_url;
        } else {
            throw new Error(result.error.message || "ImgBB upload failed");
        }
    } catch (error) {
        console.error(`❌ ImgBB error:`, error);
        throw new Error(`Failed to upload image: ${error.message}. Please check your ImgBB API Key in config.js.`);
    }
}

// --- Update Button Progress Text ---
let uploadedCount = 0;
let totalCount = 0;
function updateProgress() {
    uploadedCount++;
    submitBtn.querySelector('.btn-text').textContent = `Uploading ${uploadedCount}/${totalCount} files...`;
}

// --- Form Submission ---
inspectionForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    const formData = new FormData(inspectionForm);
    const idNumber = formData.get('idNumber').trim();

    if (!locationCoords.value.trim()) {
        showToast('Please fetch GPS or type a location first', 'error');
        return;
    }

    try {
        isSubmitting = true;
        submitBtn.disabled = true;
        submitBtn.querySelector('.spinner').classList.remove('hidden');
        submitBtn.querySelector('.btn-text').textContent = 'Compressing images...';

        const ts = Date.now();
        const carFiles = Array.from(carPhotosInput.files);
        const oilFile = oilPhotoInput.files[0] || null;
        const cngFile = cngPhotoInput.files[0] || null;
        const petrolFile = petrolPhotoInput.files[0] || null;

        // Count total files to upload
        totalCount = carFiles.length + [oilFile, cngFile, petrolFile].filter(Boolean).length;
        uploadedCount = 0;

        // Compress all in parallel
        const [compressedOil, compressedCng, compressedPetrol, ...compressedCars] = await Promise.all([
            compressImage(oilFile),
            compressImage(cngFile),
            compressImage(petrolFile),
            ...carFiles.map(f => compressImage(f))
        ]);

        submitBtn.querySelector('.btn-text').textContent = `Uploading 0/${totalCount} files...`;

        // Upload all in parallel to ImgBB
        const [oilURL, cngURL, petrolURL, ...carURLs] = await Promise.all([
            compressedOil  ? uploadToImgBB(compressedOil).then(u => { updateProgress(); return u; })  : Promise.resolve(null),
            compressedCng  ? uploadToImgBB(compressedCng).then(u => { updateProgress(); return u; })  : Promise.resolve(null),
            compressedPetrol ? uploadToImgBB(compressedPetrol).then(u => { updateProgress(); return u; }) : Promise.resolve(null),
            ...compressedCars.map((f, i) =>
                f ? uploadToImgBB(f).then(u => { updateProgress(); return u; }) : Promise.resolve(null)
            )
        ]);

        const carPhotoURLs = carURLs.filter(Boolean);

        submitBtn.querySelector('.btn-text').textContent = 'Saving to database...';

        // Save to Firestore
        await addDoc(collection(db, 'inspections'), {
            idNumber,
            carNumber: formData.get('carNumber').trim(),
            kilometer: Number(formData.get('kilometer')),
            location: locationCoords.value.trim(),
            complaint: formData.get('complaint') || '',
            note: formData.get('note') || '',
            carPhotoURLs,
            oilPhotoURL: oilURL,
            cngPhotoURL: cngURL,
            petrolPhotoURL: petrolURL,
            timestamp: serverTimestamp()
        });

        console.log("✅ Firestore record saved!");
        showToast('Inspection submitted successfully! ✅', 'success');

        // Reset form
        inspectionForm.reset();
        manualLocationInput.value = '';
        document.querySelectorAll('.preview-container').forEach(c => c.innerHTML = '');
        locationDisplay.textContent = 'Not fetched yet';
        locationCoords.value = '';

    } catch (error) {
        console.error('❌ Submission error:', error);
        showToast(`Upload failed: ${error.message}`, 'error');
    } finally {
        isSubmitting = false;
        submitBtn.disabled = false;
        submitBtn.querySelector('.spinner').classList.add('hidden');
        submitBtn.querySelector('.btn-text').textContent = 'Submit Inspection';
    }
});

// --- Admin Panel ---
settingsBtn.addEventListener('click', () => settingsModal.classList.remove('hidden'));
document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', () => {
        settingsModal.classList.add('hidden');
        passwordModal.classList.add('hidden');
    });
});

viewDataBtn.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
    passwordModal.classList.remove('hidden');
    adminPasswordInput.value = '';
    passwordError.classList.add('hidden');
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

// Fetch from Firestore
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
        console.error('Fetch error:', err);
        showToast('Failed to load records.', 'error');
    } finally {
        adminLoading.classList.add('hidden');
    }
}

refreshDataBtn.addEventListener('click', fetchData);

function renderCard(data) {
    const card = document.createElement('div');
    card.className = 'data-card';
    const date = data.timestamp ? data.timestamp.toDate().toLocaleString() : 'Just now';
    const carPhotos = (data.carPhotoURLs || []).map(url =>
        `<img src="${url}" onclick="window.open('${url}')" alt="Car Photo">`
    ).join('');

    card.innerHTML = `
        <div class="card-header">
            <div>
                <span class="id-badge">${data.idNumber}</span>
                <h3 style="margin-top:0.5rem">${data.carNumber}</h3>
            </div>
            <span style="font-size:0.7rem;color:var(--text-secondary)">${date}</span>
        </div>
        <div class="card-body">
            <p><strong>KM:</strong> ${data.kilometer}</p>
            <p><strong>Location:</strong> ${data.location}</p>
            <p><strong>Complaint:</strong> ${data.complaint || 'None'}</p>
            <p><strong>Note:</strong> ${data.note || 'None'}</p>
            <div class="card-photos">
                ${carPhotos}
                ${data.oilPhotoURL    ? `<img src="${data.oilPhotoURL}"    onclick="window.open('${data.oilPhotoURL}')"    style="border:2px solid #ef4444" alt="Oil">` : ''}
                ${data.cngPhotoURL    ? `<img src="${data.cngPhotoURL}"    onclick="window.open('${data.cngPhotoURL}')"    style="border:2px solid #10b981" alt="CNG">` : ''}
                ${data.petrolPhotoURL ? `<img src="${data.petrolPhotoURL}" onclick="window.open('${data.petrolPhotoURL}')" style="border:2px solid #3b82f6" alt="Petrol">` : ''}
            </div>
        </div>
    `;
    dataContainer.appendChild(card);
}
