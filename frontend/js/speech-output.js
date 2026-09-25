/**
 * ClassTutor — Speech Output (Dual TTS)
 * Primary: Gemini TTS audio (base64) played via HTML5 Audio element.
 * Fallback: Browser SpeechSynthesis API.
 */

const SpeechOutput = (() => {
    let currentAudio = null; // HTML5 Audio element for Gemini TTS
    let currentUtterance = null; // SpeechSynthesis utterance
    let speechRate = 0.8; // Default: slow
    let lastText = ''; // For repeat
    let lastAudioBase64 = null; // For repeat
    let onPlayCallback = () => {};
    let onEndCallback = () => {};

    /** Set speech rate */
    function setRate(rate) {
        speechRate = Math.max(0.5, Math.min(1.5, rate));
    }

    function getRate() {
        return speechRate;
    }

    /** Initialize with callbacks */
    function init(callbacks = {}) {
        onPlayCallback = callbacks.onPlay || (() => {});
        onEndCallback = callbacks.onEnd || (() => {});
    }

    /**
     * Speak text — tries Gemini TTS audio first, falls back to browser TTS.
     * @param {string} text - Text to speak
     * @param {string|null} audioBase64 - Base64-encoded audio from Gemini TTS (optional)
     */
    function speak(text, audioBase64 = null) {
        stop(); // Stop any current playback
        lastText = text;
        lastAudioBase64 = audioBase64;

        if (audioBase64) {
            playGeminiAudio(audioBase64);
        } else {
            playBrowserTTS(text);
        }
    }

    /** Play Gemini TTS audio from base64 */
    function playGeminiAudio(base64Audio) {
        try {
            // Determine audio format (assume mp3 or wav)
            const mimeType = base64Audio.startsWith('UklGR') ? 'audio/wav' : 'audio/mp3';
            const dataUrl = `data:${mimeType};base64,${base64Audio}`;

            currentAudio = new Audio(dataUrl);
            currentAudio.playbackRate = speechRate;

            currentAudio.addEventListener('play', () => onPlayCallback());
            currentAudio.addEventListener('ended', () => {
                currentAudio = null;
                onEndCallback();
            });
            currentAudio.addEventListener('error', (e) => {
                console.warn('Gemini audio playback failed, falling back to browser TTS:', e);
                currentAudio = null;
                playBrowserTTS(lastText);
            });

            currentAudio.play().catch((e) => {
                console.warn('Audio play() failed (user gesture may be required):', e);
                // Fallback to browser TTS
                playBrowserTTS(lastText);
            });
        } catch (e) {
            console.warn('Failed to create audio from base64:', e);
            playBrowserTTS(lastText);
        }
    }

    /** Play using browser SpeechSynthesis API */
    function playBrowserTTS(text) {
        if (!('speechSynthesis' in window)) {
            console.warn('Browser SpeechSynthesis not available.');
            onEndCallback();
            return;
        }

        const synth = window.speechSynthesis;

        // Cancel any pending speech
        synth.cancel();

        currentUtterance = new SpeechSynthesisUtterance(text);
        currentUtterance.lang = 'en-US';
        currentUtterance.rate = speechRate;
        currentUtterance.pitch = 1.0;

        // Try to find a good English voice
        const voices = synth.getVoices();
        const englishVoice = voices.find(v => v.lang.startsWith('en') && v.localService) ||
                            voices.find(v => v.lang.startsWith('en')) ||
                            voices[0];
        if (englishVoice) {
            currentUtterance.voice = englishVoice;
        }

        currentUtterance.addEventListener('start', () => onPlayCallback());
        currentUtterance.addEventListener('end', () => {
            currentUtterance = null;
            onEndCallback();
        });
        currentUtterance.addEventListener('error', (e) => {
            console.warn('Browser TTS error:', e);
            currentUtterance = null;
            onEndCallback();
        });

        synth.speak(currentUtterance);
    }

    /** Stop all playback */
    function stop() {
        if (currentAudio) {
            currentAudio.pause();
            currentAudio.currentTime = 0;
            currentAudio = null;
        }
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }
        currentUtterance = null;
        onEndCallback();
    }

    /** Repeat the last spoken text */
    function repeat() {
        if (lastText) {
            speak(lastText, lastAudioBase64);
        }
    }

    /** Decrease rate by 0.1 */
    function slower() {
        setRate(speechRate - 0.1);
        // If currently playing, restart at new rate
        if (lastText && (currentAudio || currentUtterance)) {
            speak(lastText, lastAudioBase64);
        }
    }

    /** Check if currently playing */
    function isPlaying() {
        if (currentAudio && !currentAudio.paused) return true;
        if ('speechSynthesis' in window && window.speechSynthesis.speaking) return true;
        return false;
    }

    return {
        init,
        speak,
        stop,
        repeat,
        slower,
        setRate,
        getRate,
        isPlaying,
    };
})();
