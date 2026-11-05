package app.still.tasks;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;

@CapacitorPlugin(
    name = "StillNative",
    permissions = { @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone") }
)
public class StillNativePlugin extends Plugin {
    private SpeechRecognizer recognizer;
    private PluginCall pending;
    private boolean stopping;

    @PluginMethod
    public void updateWidget(PluginCall call) {
        Context context = getContext();
        context
            .getSharedPreferences(StillWidgetProvider.PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(StillWidgetProvider.KEY_LINE, call.getString("line", "Nothing is waiting"))
            .putString(StillWidgetProvider.KEY_DETAIL, call.getString("detail", "Add a task"))
            .apply();
        StillWidgetProvider.updateAll(context);
        call.resolve();
    }

    @PluginMethod
    public void listen(PluginCall call) {
        if (getActivity() == null) {
            call.reject("unsupported");
            return;
        }
        getActivity().runOnUiThread(() -> {
            if (getPermissionState("microphone") != PermissionState.GRANTED) {
                requestPermissionForAlias("microphone", call, "onMicPermission");
                return;
            }
            startListening(call);
        });
    }

    @PermissionCallback
    private void onMicPermission(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) startListening(call);
        else call.reject("not-allowed");
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (getActivity() == null) {
            call.resolve();
            return;
        }
        getActivity().runOnUiThread(() -> {
            stopping = true;
            if (recognizer != null) {
                try {
                    recognizer.stopListening();
                } catch (Exception ignored) {
                    /* already stopped */
                }
            }
            if (pending != null) {
                pending.reject("aborted");
                pending = null;
            }
            call.resolve();
        });
    }

    private void startListening(PluginCall call) {
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            call.reject("unsupported");
            return;
        }
        stopping = false;
        if (recognizer != null) {
            recognizer.destroy();
            recognizer = null;
        }
        pending = call;
        recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
        recognizer.setRecognitionListener(
            new RecognitionListener() {
                @Override
                public void onReadyForSpeech(Bundle params) {}

                @Override
                public void onBeginningOfSpeech() {}

                @Override
                public void onRmsChanged(float rmsdB) {}

                @Override
                public void onBufferReceived(byte[] buffer) {}

                @Override
                public void onEndOfSpeech() {}

                @Override
                public void onError(int error) {
                    if (pending == null) return;
                    PluginCall current = pending;
                    pending = null;
                    if (stopping || error == SpeechRecognizer.ERROR_CLIENT) {
                        current.reject("aborted");
                        return;
                    }
                    if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) current.reject("not-allowed");
                    else if (error == SpeechRecognizer.ERROR_NETWORK || error == SpeechRecognizer.ERROR_NETWORK_TIMEOUT) current.reject("network");
                    else if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) current.reject("no-speech");
                    else current.reject("error");
                }

                @Override
                public void onResults(Bundle results) {
                    deliver(results, true);
                }

                @Override
                public void onPartialResults(Bundle partialResults) {
                    deliver(partialResults, false);
                }

                @Override
                public void onEvent(int eventType, Bundle params) {}
            }
        );
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, java.util.Locale.getDefault().toLanguageTag());
        recognizer.startListening(intent);
    }

    private void deliver(Bundle results, boolean isFinal) {
        ArrayList<String> matches = results == null ? null : results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        String text = matches != null && !matches.isEmpty() ? matches.get(0) : "";
        if (!isFinal) {
            if (text.isEmpty()) return;
            JSObject data = new JSObject();
            data.put("text", text);
            data.put("final", false);
            notifyListeners("speech", data);
            return;
        }
        if (pending == null) return;
        JSObject data = new JSObject();
        data.put("text", text);
        data.put("final", true);
        pending.resolve(data);
        pending = null;
    }
}
