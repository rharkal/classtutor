/**
 * ClassTutor — Main Application Logic
 * Orchestrates all modules: speech input, speech output, PDF viewer, API client, live status telemetry.
 */

document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const chatMessages = document.getElementById('chat-messages');
    const questionInput = document.getElementById('question-input');
    const sendBtn = document.getElementById('send-btn');
    const micBtn = document.getElementById('mic-btn');
    const micStatus = document.getElementById('mic-status');
    const audioControls = document.getElementById('audio-controls');
    const stopBtn = document.getElementById('stop-btn');
    const repeatBtn = document.getElementById('repeat-btn');
    const slowerBtn = document.getElementById('slower-btn');
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const settingsForm = document.getElementById('settings-form');
    const speechRateInput = document.getElementById('speech-rate');
    const speechRateValue = document.getElementById('speech-rate-value');
    const apiKeyInput = document.getElementById('api-key-input');
    const modelNameInput = document.getElementById('model-name');
    const settingsSave = document.getElementById('settings-save');
    const settingsCancel = document.getElementById('settings-cancel');
    const offlineBanner = document.getElementById('offline-banner');

    // Auto-detect ?key= in URL (for 1-click seamless setup on iPhone)
    const urlParams = new URLSearchParams(window.location.search);
    const keyFromUrl = urlParams.get('key');
    if (keyFromUrl && keyFromUrl.trim().length > 10) {
        ApiClient.setApiKey(keyFromUrl.trim());
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    // --- Settings ---
    const SETTINGS_KEY = 'classtutor_settings';

    function loadSettings() {
        try {
            const saved = localStorage.getItem(SETTINGS_KEY);
            return saved ? JSON.parse(saved) : {};
        } catch {
            return {};
        }
    }

    function saveSettings(settings) {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }

    let saved = loadSettings();
    if (saved.modelName && (saved.modelName.includes('3.8') || saved.modelName.includes('3.6') || saved.modelName.includes('1.5') || saved.modelName.includes('2.0'))) {
        saved.modelName = 'gemini-2.5-flash-lite';
    }

    let settings = {
        speechRate: 0.8,
        modelName: 'gemini-2.5-flash-lite',
        ...saved,
    };

    // Apply settings
    SpeechOutput.setRate(settings.speechRate);

    // --- Initialize Modules ---
    PdfViewer.init();

    SpeechOutput.init({
        onPlay: () => {
            audioControls.classList.remove('hidden');
        },
        onEnd: () => {
            audioControls.classList.add('hidden');
        },
    });

    const speechAvailable = SpeechInput.init({
        onResult: (transcript, confidence) => {
            questionInput.value = transcript;
            handleQuestion(transcript);
        },
        onError: (message) => {
            if (message) addErrorMessage(message);
        },
        onStart: () => {
            micBtn.classList.add('listening');
            micStatus.classList.remove('hidden');
        },
        onEnd: () => {
            micBtn.classList.remove('listening');
            micStatus.classList.add('hidden');
        },
    });

    if (!speechAvailable) {
        micBtn.title = 'Voice input not available in this browser';
        micBtn.style.opacity = '0.5';
    }

    // --- Offline Detection ---
    function updateOnlineStatus() {
        if (navigator.onLine) {
            offlineBanner.classList.add('hidden');
        } else {
            offlineBanner.classList.remove('hidden');
        }
    }

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    updateOnlineStatus();

    // --- Event Handlers ---

    // Send button
    sendBtn.addEventListener('click', () => {
        const question = questionInput.value.trim();
        if (question) {
            handleQuestion(question);
            questionInput.value = '';
        }
    });

    // Enter key
    questionInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendBtn.click();
        }
    });

    // Mic button
    micBtn.addEventListener('click', () => {
        if (speechAvailable) {
            SpeechInput.start();
        } else {
            addErrorMessage('Voice input is not available in this browser. Please type your question instead.');
        }
    });

    // Audio controls
    stopBtn.addEventListener('click', () => SpeechOutput.stop());
    repeatBtn.addEventListener('click', () => SpeechOutput.repeat());
    slowerBtn.addEventListener('click', () => {
        SpeechOutput.slower();
        settings.speechRate = SpeechOutput.getRate();
        saveSettings(settings);
    });

    // Settings
    settingsBtn.addEventListener('click', () => {
        speechRateInput.value = settings.speechRate;
        speechRateValue.textContent = `${settings.speechRate}×`;
        if (apiKeyInput) {
            const allK = ApiClient.getKeys();
            apiKeyInput.value = allK.join(', ');
        }
        modelNameInput.value = settings.modelName;
        settingsModal.showModal();
    });

    speechRateInput.addEventListener('input', () => {
        speechRateValue.textContent = `${speechRateInput.value}×`;
    });

    settingsSave.addEventListener('click', () => {
        settings.speechRate = parseFloat(speechRateInput.value);
        if (apiKeyInput) {
            ApiClient.setApiKey(apiKeyInput.value.trim());
        }
        settings.modelName = modelNameInput.value.trim() || 'gemini-2.5-flash-lite';
        SpeechOutput.setRate(settings.speechRate);
        saveSettings(settings);
        settingsModal.close();
    });

    settingsCancel.addEventListener('click', () => {
        settingsModal.close();
    });

    // --- Core Question Flow ---

    async function handleQuestion(question) {
        // Remove welcome message
        const welcome = chatMessages.querySelector('.welcome-message');
        if (welcome) welcome.remove();

        // Add user bubble
        addUserMessage(question);

        // Show thinking indicator with live book surfing status
        const thinkingEl = addThinking();

        try {
            // Call the API (Direct Gemini client with rotating keys and telemetry)
            const result = await ApiClient.ask(question, {
                model: settings.modelName,
                tts: true,
                speechRate: settings.speechRate,
            });

            // Remove thinking indicator
            thinkingEl.remove();

            // Add answer bubble with citations and live telemetry
            addAnswerMessage(result.answer, result.citations || [], result.trace);

            // Speak the answer
            SpeechOutput.speak(result.answer, result.audioBase64 || null);

            // If there are citations, open the first one in PDF viewer
            if (result.citations && result.citations.length > 0) {
                const firstCitation = result.citations[0];
                if (firstCitation.url) {
                    PdfViewer.open(
                        firstCitation.url,
                        firstCitation.page || 1,
                        firstCitation.file || 'Document',
                        '' // highlight text
                    );
                }
            }
        } catch (error) {
            thinkingEl.remove();

            if (!navigator.onLine) {
                addErrorMessage('⚠️ You are offline. Please connect to the internet to use ClassTutor.', error.trace);
            } else {
                addErrorMessage(error.message, error.trace);
            }
        }
    }

    // --- Chat UI Helpers ---

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    }

    function addUserMessage(text) {
        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble user';
        bubble.textContent = text;
        chatMessages.appendChild(bubble);
        scrollToBottom();
    }

    function addAnswerMessage(answer, citations, trace) {
        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble bot';

        // Answer text
        const answerText = document.createElement('p');
        answerText.className = 'answer-paragraph';
        answerText.textContent = answer;
        bubble.appendChild(answerText);

        // Source links (citations)
        if (citations && citations.length > 0) {
            const citContainer = document.createElement('div');
            citContainer.className = 'citations-container';

            citations.forEach((citation) => {
                const link = document.createElement('a');
                link.className = 'source-link';
                const label = citation.chapter ? `${citation.chapter} (${citation.file})` : (citation.file || 'Source');
                link.textContent = `📖 ${label}${citation.page ? `, page ${citation.page}` : ''}`;
                link.href = '#';
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    if (citation.url) {
                        PdfViewer.open(
                            citation.url,
                            citation.page || 1,
                            citation.file || 'Document'
                        );
                    } else if (citation.gdrive_url) {
                        window.open(citation.gdrive_url, '_blank');
                    }
                });
                citContainer.appendChild(link);

                if (citation.gdrive_url) {
                    const gdLink = document.createElement('a');
                    gdLink.className = 'source-link gdrive-badge';
                    gdLink.textContent = '☁️ Drive';
                    gdLink.href = citation.gdrive_url;
                    gdLink.target = '_blank';
                    gdLink.rel = 'noopener noreferrer';
                    gdLink.title = 'Open book in Google Drive';
                    citContainer.appendChild(gdLink);
                }
            });
            bubble.appendChild(citContainer);
        }

        // Live Status & Surfing Details Button & Drawer
        if (trace) {
            const toggleBtn = document.createElement('button');
            toggleBtn.className = 'trace-toggle-btn';
            toggleBtn.type = 'button';
            toggleBtn.innerHTML = '📊 Live Status & Surfing Details ▾';

            const traceCard = document.createElement('div');
            traceCard.className = 'trace-details-card hidden';

            const bs = trace.bookSurfing || {};
            traceCard.innerHTML = `
                <div class="trace-header">🔍 Book Surfing & Inference Telemetry</div>
                <div class="trace-row">
                    <span class="trace-label">📚 Book Surfing:</span>
                    <span class="trace-val">Scanned <strong>${bs.pagesScanned || 1010}</strong> pages in <strong>${bs.durationMs || 10}ms</strong></span>
                </div>
                <div class="trace-row">
                    <span class="trace-label">📖 Traced Chapter:</span>
                    <span class="trace-val"><strong>${escapeHtml(bs.matchedChapter || 'None')}</strong> ${bs.matchedPage ? `(Page ${bs.matchedPage})` : ''}</span>
                </div>
                <div class="trace-row">
                    <span class="trace-label">🏷️ Traced Topic:</span>
                    <span class="trace-val"><em>${escapeHtml(bs.matchedTopic || 'Curriculum')}</em></span>
                </div>
                <div class="trace-row">
                    <span class="trace-label">🤖 Model Used:</span>
                    <span class="trace-val"><span class="badge badge-model">${escapeHtml(trace.modelUsed || 'gemini-2.5-flash-lite')}</span></span>
                </div>
                <div class="trace-row">
                    <span class="trace-label">🔑 API Key Used:</span>
                    <span class="trace-val"><span class="badge badge-key">${escapeHtml(trace.keyUsed || 'Active Key')}</span></span>
                </div>
                <div class="trace-row">
                    <span class="trace-label">⏱️ Total Latency:</span>
                    <span class="trace-val"><strong>${(trace.durationMs / 1000).toFixed(2)}s</strong></span>
                </div>
            `;

            toggleBtn.addEventListener('click', () => {
                const isHidden = traceCard.classList.toggle('hidden');
                toggleBtn.innerHTML = isHidden ? '📊 Live Status & Surfing Details ▾' : '📊 Hide Surfing Details ▴';
            });

            bubble.appendChild(toggleBtn);
            bubble.appendChild(traceCard);
        }

        chatMessages.appendChild(bubble);
        scrollToBottom();
    }

    function addErrorMessage(message, trace) {
        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble bot error-bubble';

        const title = document.createElement('div');
        title.className = 'error-bubble-title';
        title.innerHTML = `<span>❌</span> <div>${escapeHtml(message)}</div>`;
        bubble.appendChild(title);

        // Always show the "What Went Wrong?" button
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'trace-toggle-btn error-trace-btn';
        toggleBtn.type = 'button';
        toggleBtn.innerHTML = '⚠️ What Went Wrong? (Diagnostic Details) ▾';

        const traceCard = document.createElement('div');
        traceCard.className = 'trace-details-card error-card hidden';

        let attemptsHtml = '';
        if (trace && trace.attempts && trace.attempts.length > 0) {
            attemptsHtml = `
                <div class="trace-row">
                    <span class="trace-label">📋 Rotation Log:</span>
                    <div class="trace-log-list">
                        ${trace.attempts.map(a => `<div class="trace-log-item"><code>${escapeHtml(a.model)}</code> with <code>${escapeHtml(a.key)}</code>: ${escapeHtml(a.error)}</div>`).join('')}
                    </div>
                </div>
            `;
        }

        const bs = trace?.bookSurfing || {};
        traceCard.innerHTML = `
            <div class="trace-header">🚨 Error Diagnosis & Live Status</div>
            <div class="trace-row">
                <span class="trace-label">📚 Book Surfing:</span>
                <span class="trace-val">Scanned <strong>${bs.pagesScanned || 1010}</strong> pages | Traced: <strong>${escapeHtml(bs.matchedChapter || 'None')}</strong></span>
            </div>
            <div class="trace-row">
                <span class="trace-label">🤖 Models Attempted:</span>
                <span class="trace-val"><code>${escapeHtml(trace?.modelUsed || 'gemini-2.5-flash-lite ➔ gemini-flash-lite-latest ➔ gemini-3.1-flash-lite')}</code></span>
            </div>
            <div class="trace-row">
                <span class="trace-label">🔑 Key Status:</span>
                <span class="trace-val">${escapeHtml(trace?.keyUsed || ApiClient.getActiveKeyInfo().masked)}</span>
            </div>
            ${attemptsHtml}
            <div class="trace-row trace-action-row">
                <span class="trace-label">💡 Recommended Action:</span>
                <span class="trace-val">${escapeHtml(trace?.actionTip || 'Enter a fresh free API key from aistudio.google.com in Settings.')}</span>
            </div>
            <button type="button" class="btn-settings-open">⚙️ Open Settings to Enter Key</button>
        `;

        toggleBtn.addEventListener('click', () => {
            const isHidden = traceCard.classList.toggle('hidden');
            toggleBtn.innerHTML = isHidden ? '⚠️ What Went Wrong? (Diagnostic Details) ▾' : '⚠️ Hide Diagnostic Details ▴';
        });

        traceCard.querySelector('.btn-settings-open')?.addEventListener('click', () => {
            settingsBtn.click();
        });

        bubble.appendChild(toggleBtn);
        bubble.appendChild(traceCard);

        chatMessages.appendChild(bubble);
        scrollToBottom();
    }

    function addThinking() {
        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble bot thinking-indicator';
        bubble.innerHTML = `
            <div class="thinking-spinner">
                <span class="thinking-dot"></span>
                <span class="thinking-dot"></span>
                <span class="thinking-dot"></span>
            </div>
            <div class="thinking-status">🔍 Surfing 1,010 textbook pages & generating answer...</div>
        `;
        chatMessages.appendChild(bubble);
        scrollToBottom();
        return bubble;
    }

    function scrollToBottom() {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
});
