export function speechSupported() {
  return Boolean(globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition);
}

/**
 * Start listening immediately. Call this inside a tap so Chrome still
 * treats it as a user gesture. Returns a stop function.
 */
export function startListening({ onText, onError, onEnd }) {
  const Ctor = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  if (!Ctor) {
    onError("unsupported");
    onEnd();
    return () => {};
  }
  const recognition = new Ctor();
  recognition.lang = navigator.language || "en-US";
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;
  recognition.onresult = (event) => {
    let text = "";
    for (let i = 0; i < event.results.length; i += 1) text += event.results[i][0].transcript;
    const latest = event.results[event.results.length - 1];
    onText(text.trim(), Boolean(latest?.isFinal));
  };
  recognition.onerror = (event) => onError(event.error || "error");
  recognition.onend = () => onEnd();
  try {
    recognition.start();
  } catch (error) {
    onError(error?.name || "start-failed");
    onEnd();
    return () => {};
  }
  return () => {
    recognition.onend = null;
    recognition.onerror = null;
    try {
      recognition.abort();
    } catch {
      /* already stopped */
    }
  };
}

export function voiceErrorCopy(code) {
  if (code === "not-allowed" || code === "service-not-allowed") {
    return "The microphone is blocked. You can allow it in the browser's site settings, or type the task.";
  }
  if (code === "network") {
    return "Voice couldn't reach the browser's speech service. The task can be typed instead.";
  }
  if (code === "no-speech") return "No speech came through. Try again, or type it.";
  if (code === "unsupported") return "This browser doesn't offer voice input. Typing works the same way.";
  return "Voice didn't catch that. You can try again or type the task.";
}
