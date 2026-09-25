/**
 * ClassTutor — API Client (Direct Google Gemini Lite-First with Multi-Key Rotation & Telemetry)
 * Works 100% in the cloud on iPhone Safari / Chrome without relying on blocked workers.dev.
 */

const ApiClient = (() => {
    const STORAGE_KEY_ENDPOINT = 'classtutor_api_endpoint';
    const STORAGE_KEY_API_KEY = 'classtutor_gemini_api_key';

    function getKeys() {
        const stored = localStorage.getItem(STORAGE_KEY_API_KEY) || '';
        return stored.split(/[,;\s\n\r]+/).map(k => k.trim()).filter(k => k.length > 10);
    }

    let currentKeyIndex = 0;

    function maskKey(key) {
        if (!key || key.length < 8) return '(none)';
        return key.slice(0, 6) + '...' + key.slice(-4);
    }

    function getActiveKeyInfo() {
        const keys = getKeys();
        if (keys.length === 0) return { key: '', index: 0, total: 0, masked: '(No API Key Set)' };
        const safeIndex = currentKeyIndex % keys.length;
        const key = keys[safeIndex];
        return {
            key,
            index: safeIndex + 1,
            total: keys.length,
            masked: `Key #${safeIndex + 1} of ${keys.length} (${maskKey(key)})`
        };
    }

    function getApiKey() {
        return getActiveKeyInfo().key;
    }

    function rotateApiKey() {
        const keys = getKeys();
        if (keys.length > 1) {
            currentKeyIndex = (currentKeyIndex + 1) % keys.length;
        }
        return getActiveKeyInfo();
    }

    function setApiKey(key) {
        localStorage.setItem(STORAGE_KEY_API_KEY, key.trim());
    }

    function getEndpoint() {
        return localStorage.getItem(STORAGE_KEY_ENDPOINT) || '';
    }

    function setEndpoint(url) {
        localStorage.setItem(STORAGE_KEY_ENDPOINT, url.replace(/\/+$/, ''));
    }

    const SYSTEM_INSTRUCTION = `You are ClassTutor, an encouraging, patient, and friendly audio tutor for Rishit, a CBSE Standard 5 student.

CRITICAL RULES:
1. Answer the student's question ONLY using the verified CBSE Standard 5 syllabus information provided below.
2. If the user's question cannot be answered from the provided syllabus, you MUST respond EXACTLY with this single sentence:
"This is not found in the syllabus provided."
3. NEVER make up information. Never answer out-of-syllabus questions (e.g. quantum physics, general internet topics, coding, adult trivia).
4. Keep explanations simple, encouraging, warm, and easy to understand for a 10-year-old child.
5. In your answer, ALWAYS mention the Subject and Chapter name where this is taught.
6. If the question asks about a diagram, picture, or DIY project (like a water filter), describe the parts and steps clearly.`;

    /**
     * Ask a question — Direct Gemini API with multi-model fallback & zero-hallucination RAG
     */
    async function ask(question, options = {}) {
        const q = question.trim();
        if (!q) throw new Error("Question cannot be empty");
        const requestStartTime = Date.now();

        // 1. If worker endpoint is explicitly set and user doesn't force direct, try worker first
        const workerUrl = getEndpoint();
        if (workerUrl && !workerUrl.includes("workers.dev")) {
            try {
                const res = await fetch(`${workerUrl}/ask`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ question: q, model: options.model })
                });
                if (res.ok) return await res.json();
            } catch (e) {
                console.warn("Worker endpoint failed, falling back to direct Gemini API...", e);
            }
        }

        // 2. Client-side verified syllabus search (0 tokens wasted, strict zero-hallucination)
        const matches = typeof CurriculumData !== 'undefined' ? CurriculumData.search(q) : [];
        const surfingMeta = matches.surfingMeta || {
            pagesScanned: 1010,
            durationMs: 0,
            matchedSubject: matches[0]?.subject || "None",
            matchedChapter: matches[0]?.chapter || "Not Found",
            matchedPage: matches[0]?.page || 0,
            matchedTopic: q,
            score: 0,
            totalMatches: matches.length
        };

        if (matches.length === 0) {
            return {
                answer: "This is not found in the syllabus provided.",
                citations: [],
                trace: {
                    status: "Refused (Out of Syllabus)",
                    modelUsed: "Client Search (0 Tokens)",
                    keyUsed: "None Needed",
                    durationMs: Date.now() - requestStartTime,
                    bookSurfing: surfingMeta,
                    attempts: []
                }
            };
        }

        // Special queries (greetings, subject list) return instantly with 0 tokens wasted
        if (matches.length === 1 && matches[0].isSpecial) {
            return {
                answer: matches[0].summary,
                citations: [],
                trace: {
                    status: "Instant Help / Greeting",
                    modelUsed: "Client-Side Direct (0 Tokens)",
                    keyUsed: "None Needed",
                    durationMs: Date.now() - requestStartTime,
                    bookSurfing: surfingMeta,
                    attempts: []
                }
            };
        }

        // 3. Build verified source excerpts
        let sourceText = "";
        const citations = [];
        for (const m of matches) {
            sourceText += `\n---\n${m.summary}\n`;
            citations.push({
                subject: m.subject,
                chapter: m.chapter,
                file: m.file,
                page: m.page || 1,
                url: m.folder ? `books/${m.folder}/${m.file}` : `books/${m.file}`,
                gdrive_url: typeof CurriculumData !== 'undefined' ? CurriculumData.GDRIVE_FOLDER_URL : ""
            });
        }

        const promptText = `Verified Syllabus Excerpts for Rishit (Standard 5):
${sourceText}

Student's Question: "${q}"

Instructions: Explain the answer simply and warmly for Rishit. Mention the Subject and Chapter. If it is NOT in the excerpts, reply EXACTLY: "This is not found in the syllabus provided."`;

        const payload = {
            contents: [{ role: "user", parts: [{ text: promptText }] }],
            systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
            generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 500
            }
        };

        const initialKeyInfo = getActiveKeyInfo();
        if (!initialKeyInfo.key) {
            const err = new Error("Please enter your Gemini API Key in Settings ⚙️ (or open link with ?key=YOUR_KEY).");
            err.trace = {
                status: "Missing API Key",
                bookSurfing: surfingMeta,
                modelUsed: "None",
                keyUsed: "None (Please add in Settings)",
                durationMs: Date.now() - requestStartTime,
                errorDetails: "No active API key found in browser storage."
            };
            throw err;
        }

        // Start with Lite model of Gemini -> then fallback to next level
        const preferred = options.model ? [options.model] : [];
        const models = [...new Set([
            ...preferred,
            "gemini-2.5-flash-lite",      // 1. Lite model (Primary, fastest, highest quota)
            "gemini-flash-lite-latest",   // 2. Next level lite latest
            "gemini-3.1-flash-lite",      // 3. Next level lite 3.1
            "gemini-2.5-flash"            // 4. Standard flash fallback
        ])];

        const attemptLogs = [];
        const allKeys = getKeys();
        const maxKeyTries = Math.max(1, allKeys.length);

        for (const model of models) {
            for (let kTry = 0; kTry < maxKeyTries; kTry++) {
                const keyInfo = getActiveKeyInfo();
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${keyInfo.key}`;

                try {
                    const response = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });

                    if (response.ok) {
                        const data = await response.json();
                        const answerText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "This is not found in the syllabus provided.";
                        return {
                            answer: answerText,
                            citations: answerText.includes("This is not found in the syllabus provided.") ? [] : citations,
                            trace: {
                                status: "Success",
                                modelUsed: model,
                                keyUsed: keyInfo.masked,
                                durationMs: Date.now() - requestStartTime,
                                bookSurfing: surfingMeta,
                                attempts: attemptLogs
                            }
                        };
                    } else {
                        const err = await response.json().catch(() => ({}));
                        const rawMsg = err.error?.message || `HTTP ${response.status}`;
                        attemptLogs.push({
                            model,
                            key: keyInfo.masked,
                            status: response.status,
                            error: rawMsg
                        });

                        // Rotate to next key immediately on 403, 429, or 503
                        if (allKeys.length > 1) {
                            rotateApiKey();
                        }
                    }
                } catch (err) {
                    attemptLogs.push({
                        model,
                        key: keyInfo.masked,
                        status: "Network/CORS",
                        error: err.message
                    });
                    if (allKeys.length > 1) {
                        rotateApiKey();
                    }
                }
            }
        }

        // If all attempts failed, diagnose the problem clearly
        const lastErr = attemptLogs[attemptLogs.length - 1] || {};
        let explanation = lastErr.error || "Could not connect to Gemini API";
        let actionTip = "Please check your internet connection.";

        if (explanation.includes("reported as leaked")) {
            explanation = "Your Gemini API Key was revoked because it was exposed on a public GitHub repo.";
            actionTip = "Please create a fresh key at aistudio.google.com and paste it in Settings ⚙️ (or open ?key=YOUR_KEY).";
        } else if (explanation.includes("Quota") || lastErr.status === 429) {
            explanation = "API Rate limit or quota exhausted on this key.";
            actionTip = "Please wait 1 minute, or add a second key in Settings ⚙️ separated by a comma.";
        } else if (explanation.includes("API_KEY_INVALID") || lastErr.status === 400) {
            explanation = "The API key entered is invalid.";
            actionTip = "Please double-check your key in Settings ⚙️.";
        }

        const finalError = new Error(`${explanation} (${actionTip})`);
        finalError.trace = {
            status: "Failed",
            bookSurfing: surfingMeta,
            modelUsed: models.join(" ➔ "),
            keyUsed: getActiveKeyInfo().masked,
            durationMs: Date.now() - requestStartTime,
            errorDetails: explanation,
            actionTip: actionTip,
            attempts: attemptLogs
        };

        throw finalError;
    }

    return {
        ask,
        getEndpoint,
        setEndpoint,
        getApiKey,
        setApiKey,
        getKeys,
        getActiveKeyInfo,
        rotateApiKey
    };
})();
