import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js";
import { getFirestore, collection, addDoc, getDocs, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

// --- Firebase Configuration ---
const firebaseConfig = {
  apiKey: "AIzaSyA2eDFWysL2EgzyhbgzbOPupqPgi3KCk3Y",
  authDomain: "we-four-group.firebaseapp.com",
  projectId: "we-four-group",
  storageBucket: "we-four-group.firebasestorage.app",
  messagingSenderId: "859067628360",
  appId: "1:859067628360:web:8c178f024d83ac3c0c117d",
  measurementId: "G-6W7DYWFKP4"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db = getFirestore(app);
const storage = getStorage(app);

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
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 4000);
}

// --- Image Preview Logic ---
function setupPreview(input, containerId) {
    input.addEventListener('change', () => {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        const files = Array.from(input.files);
        
        files.forEach(file => {
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
        showToast('Geolocation is not supported by your browser', 'error');
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
            showToast('Location fetched successfully!', 'success');
        },
        (error) => {
            console.error('Error fetching location:', error);
            locationDisplay.textContent = 'Error fetching location';
            getLocationBtn.disabled = false;
            showToast('Unable to retrieve location. Please check permissions.', 'error');
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );
});

// --- Helpers: Image Compression & Firebase Upload ---
async function compressImage(file, maxWidth = 1200, quality = 0.7) {
    return new Promise((resolve) => {
        if (!file) return resolve(null);
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height *= maxWidth / width;
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                canvas.toBlob((blob) => {
                    resolve(new File([blob], file.name, { type: 'image/jpeg' }));
                }, 'image/jpeg', quality);
            };
        };
    });
}

async function uploadFile(file, folder, idNumber, onProgress) {
    if (!file) return null;
    
    // Auto-compress before upload
    const processedFile = await compressImage(file);
    const fileName = `${Date.now()}_${file.name}`;
    const storageRef = ref(storage, `inspections/${idNumber}/${folder}/${fileName}`);
    
    const uploadTask = uploadBytesResumable(storageRef, processedFile);

    return new Promise((resolve, reject) => {
        uploadTask.on('state_changed', 
            (snapshot) => {
                if (onProgress) onProgress(snapshot.bytesTransferred, processedFile.size);
            }, 
            (error) => reject(error), 
            async () => {
                const url = await getDownloadURL(uploadTask.snapshot.ref);
                resolve(url);
            }
        );
    });
}

// --- Form Submission (Firebase Version) ---
inspectionForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    const formData = new FormData(inspectionForm);
    const idNumber = formData.get('idNumber');

    if (!locationCoords.value) {
        showToast('Please fetch GPS location first', 'error');
        return;
    }

    try {
        isSubmitting = true;
        submitBtn.disabled = true;
        submitBtn.querySelector('.spinner').classList.remove('hidden');
        submitBtn.querySelector('.btn-text').textContent = 'Optimizing...';

        // 1. Pre-process and compress all files first to get total upload size
        const carFiles = Array.from(carPhotosInput.files);
        const otherFiles = [oilPhotoInput.files[0], cngPhotoInput.files[0], petrolPhotoInput.files[0]];
        const allFiles = [...carFiles, ...otherFiles].filter(f => !!f);

        // Compress all files first
        const compressedFiles = await Promise.all(allFiles.map(f => compressImage(f)));
        const totalSize = compressedFiles.reduce((sum, f) => sum + (f ? f.size : 0), 0);
        const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(1);

        // Track progress for each file
        const fileProgress = new Map();
        const updateProgressUI = () => {
            const uploadedBytes = Array.from(fileProgress.values()).reduce((sum, val) => sum + val, 0);
            const uploadedMB = (uploadedBytes / (1024 * 1024)).toFixed(1);
            submitBtn.querySelector('.btn-text').textContent = `Uploading: ${uploadedMB} / ${totalSizeMB} MB`;
        };

        // 2. Parallel Upload with Progress
        const uploadPromises = [];
        
        // Helper to wrap upload with progress tracking
        const uploadWithProgress = async (file, folder, index) => {
            if (!file) return null;
            return await uploadFile(file, folder, idNumber, (transferred) => {
                fileProgress.set(index, transferred);
                updateProgressUI();
            });
        };

        // Start uploads
        let resultIndex = 0;
        const carPromises = carFiles.map((f, i) => uploadWithProgress(f, 'car_photos', resultIndex++));
        const oilPromise = uploadWithProgress(oilPhotoInput.files[0], 'oil', resultIndex++);
        const cngPromise = uploadWithProgress(cngPhotoInput.files[0], 'cng', resultIndex++);
        const petrolPromise = uploadWithProgress(petrolPhotoInput.files[0], 'petrol', resultIndex++);

        const results = await Promise.all([...carPromises, oilPromise, cngPromise, petrolPromise]);
        
        // Distribute results back
        const carPhotoURLs = results.slice(0, carFiles.length).filter(url => url !== null);
        const [oilURL, cngURL, petrolURL] = results.slice(carFiles.length);

        submitBtn.querySelector('.btn-text').textContent = 'Saving Record...';

        // 2. Save Data to Firestore
        const docData = {
            idNumber,
            carNumber: formData.get('carNumber'),
            kilometer: Number(formData.get('kilometer')),
            location: locationCoords.value,
            complaint: formData.get('complaint'),
            note: formData.get('note'),
            carPhotoURLs,
            oilPhotoURL: oilURL,
            cngPhotoURL: cngURL,
            petrolPhotoURL: petrolURL,
            timestamp: serverTimestamp()
        };

        await addDoc(collection(db, 'inspections'), docData);

        showToast('Inspection submitted successfully!', 'success');
        inspectionForm.reset();
        document.querySelectorAll('.preview-container').forEach(c => c.innerHTML = '');
        locationDisplay.textContent = 'Not fetched yet';
        locationCoords.value = '';

    } catch (error) {
        console.error('Error saving data:', error);
        showToast('Failed to submit. Please check your connection.', 'error');
    } finally {
        isSubmitting = false;
        submitBtn.disabled = false;
        submitBtn.querySelector('.spinner').classList.add('hidden');
        submitBtn.querySelector('.btn-text').textContent = 'Submit Inspection';
    }
});

// --- Admin Panel Logic ---

// Modal Controls
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
    const password = adminPasswordInput.value;
    if (password === 'wefour27') {
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

// Fetch Data from Firestore
async function fetchData() {
    dataContainer.innerHTML = '';
    adminLoading.classList.remove('hidden');
    adminEmpty.classList.add('hidden');

    try {
        const q = query(collection(db, 'inspections'), orderBy('timestamp', 'desc'));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            adminEmpty.classList.remove('hidden');
        } else {
            querySnapshot.forEach((doc) => {
                renderCard({ id: doc.id, ...doc.data() });
            });
        }
    } catch (error) {
        console.error('Error fetching data:', error);
        showToast('Failed to load records from cloud.', 'error');
    } finally {
        adminLoading.classList.add('hidden');
    }
}

refreshDataBtn.addEventListener('click', fetchData);

function renderCard(data) {
    const card = document.createElement('div');
    card.className = 'data-card';
    
    // Handle Firestore Timestamp
    const date = data.timestamp ? data.timestamp.toDate().toLocaleString() : 'Just now';

    card.innerHTML = `
        <div class="card-header">
            <div>
                <span class="id-badge">${data.idNumber}</span>
                <h3 style="margin-top: 0.5rem">${data.carNumber}</h3>
            </div>
            <span style="font-size: 0.7rem; color: var(--text-secondary)">${date}</span>
        </div>
        <div class="card-body">
            <p><strong>KM:</strong> ${data.kilometer}</p>
            <p><strong>Location:</strong> ${data.location}</p>
            <p><strong>Complaint:</strong> ${data.complaint || 'None'}</p>
            <p><strong>Note:</strong> ${data.note || 'None'}</p>
            
            <div class="card-photos">
                ${data.carPhotoURLs.map(url => `<img src="${url}" onclick="window.open().document.write('<img src=\\'${url}\\'>')" alt="Car Photo">`).join('')}
                ${data.oilPhotoURL ? `<img src="${data.oilPhotoURL}" onclick="window.open().document.write('<img src=\\'${data.oilPhotoURL}\\'>')" style="border: 2px solid #ef4444" alt="Oil">` : ''}
                ${data.cngPhotoURL ? `<img src="${data.cngPhotoURL}" onclick="window.open().document.write('<img src=\\'${data.cngPhotoURL}\\'>')" style="border: 2px solid #10b981" alt="CNG">` : ''}
                ${data.petrolPhotoURL ? `<img src="${data.petrolPhotoURL}" onclick="window.open().document.write('<img src=\\'${data.petrolPhotoURL}\\'>')" style="border: 2px solid #3b82f6" alt="Petrol">` : ''}
            </div>
        </div>
    `;
    dataContainer.appendChild(card);
}
