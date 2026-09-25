/**
 * ClassTutor — Speech Input (Web Speech API)
 * Tap-to-talk pattern: child taps mic, speaks, releases.
 * Uses webkitSpeechRecognition (Safari on iOS).
 */

const SpeechInput = (() => {
    let recognition = null;
    let isListening = false;
    let onResultCallback = null;
    let onErrorCallback = null;
    let onStartCallback = null;
    let onEndCallback = null;

    /** Check if speech recognition is available */
    function isAvailable() {
        return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    }

    /** Initialize the speech recognizer */
    function init(callbacks = {}) {
        onResultCallback = callbacks.onResult || (() => {});
        onErrorCallback = callbacks.onError || (() => {});
        onStartCallback = callbacks.onStart || (() => {});
        onEndCallback = callbacks.onEnd || (() => {});

        if (!isAvailable()) {
            console.warn('SpeechRecognition not available in this browser.');
            return false;
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();
        recognition.lang = 'en-US';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
        recognition.continuous = false; // Single utterance (more reliable on iOS)

        recognition.addEventListener('result', (event) => {
            const transcript = event.results[0][0].transcript;
            const confidence = event.results[0][0].confidence;
            onResultCallback(transcript, confidence);
        });

        recognition.addEventListener('error', (event) => {
            console.error('Speech recognition error:', event.error);
            isListening = false;

            let userMessage = '';
            switch (event.error) {
                case 'not-allowed':
                    userMessage = 'Microphone permission denied. Please allow microphone access in your browser settings.';
                    break;
                case 'no-speech':
                    userMessage = 'No speech detected. Please tap the mic and speak clearly.';
                    break;
                case 'network':
                    userMessage = 'Network error during speech recognition.';
                    break;
                case 'aborted':
                    userMessage = ''; // User cancelled, no message needed
                    break;
                default:
                    userMessage = `Speech recognition error: ${event.error}`;
            }

            if (userMessage) {
                onErrorCallback(userMessage);
            }
            onEndCallback();
        });

        recognition.addEventListener('start', () => {
            isListening = true;
            onStartCallback();
        });

        recognition.addEventListener('end', () => {
            isListening = false;
            onEndCallback();
        });

        return true;
    }

    /** Start listening (must be called from a user gesture handler) */
    function start() {
        if (!recognition) {
            onErrorCallback('Speech recognition is not available in this browser. Please type your question instead.');
            return;
        }

        if (isListening) {
            stop();
            return;
        }

        try {
            recognition.start();
        } catch (e) {
            // Already started or other error
            console.error('Failed to start speech recognition:', e);
            onErrorCallback('Could not start the microphone. Please try again.');
        }
    }

    /** Stop listening */
    function stop() {
        if (recognition && isListening) {
            recognition.stop();
        }
    }

    /** Get listening state */
    function getIsListening() {
        return isListening;
    }

    return {
        isAvailable,
        init,
        start,
        stop,
        getIsListening,
    };
})();
