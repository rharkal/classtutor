/**
 * ClassTutor — Admin Dashboard Logic
 * Handles admin authentication, Drive sync triggers, file list viewing/deletion,
 * and endpoint configuration.
 */

document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements - Login
    const loginSection = document.getElementById('login-section');
    const adminDashboard = document.getElementById('admin-dashboard');
    const adminPasswordInput = document.getElementById('admin-password');
    const loginBtn = document.getElementById('login-btn');
    const loginError = document.getElementById('login-error');

    // DOM Elements - Drive Sync
    const driveUrlInput = document.getElementById('drive-url');
    const syncBtn = document.getElementById('sync-btn');
    const syncProgress = document.getElementById('sync-progress');
    const syncBar = document.getElementById('sync-bar');
    const syncStatus = document.getElementById('sync-status');

    // DOM Elements - Files List
    const filesList = document.getElementById('files-list');
    const refreshFilesBtn = document.getElementById('refresh-files-btn');

    // DOM Elements - Backend Settings
    const apiEndpointInput = document.getElementById('api-endpoint');
    const adminModelNameInput = document.getElementById('admin-model-name');
    const saveSettingsBtn = document.getElementById('save-settings-btn');

    // DOM Elements - Danger Zone
    const reindexBtn = document.getElementById('reindex-btn');
    const clearBtn = document.getElementById('clear-btn');

    // Initialize API Endpoint input from existing storage
    apiEndpointInput.value = ApiClient.getEndpoint();

    // Check if we already have an active admin session
    if (ApiClient.getAdminPassword()) {
        tryUnlockDashboard();
    }

    // --- Authentication ---
    loginBtn.addEventListener('click', handleLogin);
    adminPasswordInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleLogin();
    });

    async function handleLogin() {
        const password = adminPasswordInput.value.trim();
        if (!password) return;

        loginError.classList.add('hidden');
        loginBtn.disabled = true;
        loginBtn.textContent = 'Verifying...';

        try {
            await ApiClient.adminLogin(password);
            showDashboard();
            await loadFiles();
        } catch (err) {
            loginError.textContent = err.message || 'Login failed. Please check endpoint and password.';
            loginError.classList.remove('hidden');
            ApiClient.clearAdminPassword();
        } finally {
            loginBtn.disabled = false;
            loginBtn.textContent = 'Login';
        }
    }

    async function tryUnlockDashboard() {
        try {
            await ApiClient.listFiles();
            showDashboard();
            await loadFiles();
        } catch (err) {
            ApiClient.clearAdminPassword();
            showLogin();
        }
    }

    function showDashboard() {
        loginSection.classList.add('hidden');
        adminDashboard.classList.remove('hidden');
    }

    function showLogin() {
        loginSection.classList.remove('hidden');
        adminDashboard.classList.add('hidden');
    }

    // --- Google Drive Sync ---
    syncBtn.addEventListener('click', async () => {
        const driveUrl = driveUrlInput.value.trim();
        if (!driveUrl) {
            alert('Please provide a valid Google Drive folder link.');
            return;
        }

        syncBtn.disabled = true;
        syncProgress.classList.remove('hidden');
        syncBar.style.width = '20%';
        syncStatus.textContent = 'Connecting to Google Drive and scanning folder...';

        try {
            syncBar.style.width = '50%';
            syncStatus.textContent = 'Submitting folder to Gemini indexing engine...';
            
            const res = await ApiClient.syncDrive(driveUrl);
            
            syncBar.style.width = '100%';
            syncStatus.textContent = res.message || 'Sync initiated successfully!';
            
            setTimeout(() => {
                syncProgress.classList.add('hidden');
                syncBar.style.width = '0%';
                loadFiles();
            }, 3000);
        } catch (err) {
            syncBar.style.width = '100%';
            syncBar.style.backgroundColor = 'var(--danger)';
            syncStatus.textContent = `Sync failed: ${err.message}`;
        } finally {
            syncBtn.disabled = false;
        }
    });

    // --- File List Management ---
    refreshFilesBtn.addEventListener('click', loadFiles);

    async function loadFiles() {
        filesList.innerHTML = '<p class="muted-text">Fetching file list...</p>';
        try {
            const data = await ApiClient.listFiles();
            const files = data.files || [];

            if (files.length === 0) {
                filesList.innerHTML = '<p class="muted-text">No indexed files found. Sync your Google Drive folder above.</p>';
                return;
            }

            filesList.innerHTML = '';
            files.forEach((file) => {
                const item = document.createElement('div');
                item.className = 'file-item';

                const nameSpan = document.createElement('span');
                nameSpan.className = 'file-name';
                nameSpan.textContent = `📄 ${file.name || file.id} (${file.pages || '?'} pages)`;

                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'file-delete-btn';
                deleteBtn.innerHTML = '🗑️';
                deleteBtn.title = 'Remove file';
                deleteBtn.addEventListener('click', async () => {
                    if (confirm(`Remove "${file.name || file.id}" from the index?`)) {
                        deleteBtn.disabled = true;
                        try {
                            await ApiClient.deleteFile(file.id);
                            await loadFiles();
                        } catch (e) {
                            alert(`Failed to delete: ${e.message}`);
                        }
                    }
                });

                item.appendChild(nameSpan);
                item.appendChild(deleteBtn);
                filesList.appendChild(item);
            });
        } catch (err) {
            filesList.innerHTML = `<p class="error-text">Failed to load files: ${err.message}</p>`;
        }
    }

    // --- Backend Settings ---
    saveSettingsBtn.addEventListener('click', () => {
        const endpoint = apiEndpointInput.value.trim();
        const modelName = adminModelNameInput.value.trim();

        if (endpoint) {
            ApiClient.setEndpoint(endpoint);
        }

        if (modelName) {
            const currentSettings = JSON.parse(localStorage.getItem('classtutor_settings') || '{}');
            currentSettings.modelName = modelName;
            localStorage.setItem('classtutor_settings', JSON.stringify(currentSettings));
        }

        alert('Settings saved successfully!');
    });

    // --- Danger Zone Actions ---
    reindexBtn.addEventListener('click', async () => {
        if (confirm('Are you sure you want to re-index all files? This may take several minutes.')) {
            reindexBtn.disabled = true;
            reindexBtn.textContent = 'Re-indexing...';
            try {
                await ApiClient.reindex();
                alert('Re-indexing job started.');
                await loadFiles();
            } catch (err) {
                alert(`Re-index failed: ${err.message}`);
            } finally {
                reindexBtn.disabled = false;
                reindexBtn.textContent = '🔄 Re-index All Files';
            }
        }
    });

    clearBtn.addEventListener('click', async () => {
        const confirmMsg = prompt('Type "DELETE" to confirm wiping all indexed documents and history:');
        if (confirmMsg === 'DELETE') {
            try {
                // Remove stored tokens/files
                localStorage.removeItem('classtutor_settings');
                ApiClient.clearAdminPassword();
                alert('All data cleared. Reloading page...');
                window.location.reload();
            } catch (err) {
                alert(`Error: ${err.message}`);
            }
        }
    });
});
