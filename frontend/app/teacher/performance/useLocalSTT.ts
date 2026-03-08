"use client";

import { useState, useRef, useCallback, useEffect } from "react";

const API_BASE_URL = "http://localhost:8000";

// How often to send audio chunks for transcription (ms)
const CHUNK_INTERVAL = 4000;

// Typewriter animation speed (ms per character)
const TYPEWRITER_SPEED = 20;

interface UseLocalSTTReturn {
    isRecording: boolean;
    transcript: string;
    displayedTranscript: string; // Typewriter-animated version
    interimText: string; // Currently being "typed"
    error: string | null;
    isTranscribing: boolean;
    start: () => Promise<void>;
    stop: () => void;
    clear: () => void;
}

/**
 * Custom React hook for real-time speech-to-text using local Faster Whisper.
 *
 * Records audio in 5-second chunks using MediaRecorder,
 * POSTs each chunk to the backend for local transcription,
 * and displays results with a typewriter animation.
 */
export function useLocalSTT(
    onFinalCallback?: (text: string) => void
): UseLocalSTTReturn {
    const [isRecording, setIsRecording] = useState(false);
    const [transcript, setTranscript] = useState(""); // Full transcript (all text)
    const [displayedTranscript, setDisplayedTranscript] = useState(""); // What's fully typed out
    const [interimText, setInterimText] = useState(""); // Currently being typed (typewriter)
    const [error, setError] = useState<string | null>(null);
    const [isTranscribing, setIsTranscribing] = useState(false);

    const mediaStreamRef = useRef<MediaStream | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const isRecordingRef = useRef(false);
    const onFinalCallbackRef = useRef(onFinalCallback);
    const typewriterQueueRef = useRef<string[]>([]);
    const isTypingRef = useRef(false);
    const pendingStopRef = useRef(false); // Guard against onstop firing during teardown

    onFinalCallbackRef.current = onFinalCallback;

    /**
     * Typewriter effect — processes queued text segments one at a time,
     * revealing characters gradually.
     */
    const processTypewriterQueue = useCallback(() => {
        if (isTypingRef.current || typewriterQueueRef.current.length === 0) return;

        isTypingRef.current = true;
        const text = typewriterQueueRef.current.shift()!;
        let charIndex = 0;

        const typeInterval = setInterval(() => {
            if (charIndex < text.length) {
                const currentSlice = text.slice(0, charIndex + 1);
                setInterimText(currentSlice);
                charIndex++;
            } else {
                clearInterval(typeInterval);
                // Move fully typed text into displayedTranscript
                setDisplayedTranscript((prev) => prev + text + " ");
                setInterimText("");
                isTypingRef.current = false;
                // Process next in queue
                if (typewriterQueueRef.current.length > 0) {
                    processTypewriterQueue();
                }
            }
        }, TYPEWRITER_SPEED);
    }, []);

    /**
     * Send the current audio chunk to the backend for transcription
     */
    const sendAudioChunk = useCallback(async (audioBlob: Blob) => {
        if (audioBlob.size < 100) return; // Skip tiny chunks

        setIsTranscribing(true);
        try {
            const formData = new FormData();
            formData.append("file", audioBlob, "audio.webm");

            const response = await fetch(`${API_BASE_URL}/api/performance/transcribe-audio`, {
                method: "POST",
                body: formData,
            });

            const data = await response.json();

            if (data.success && data.data?.transcript) {
                const newText = data.data.transcript;
                // Add to full transcript
                setTranscript((prev) => prev + newText + " ");
                // Queue for typewriter animation
                typewriterQueueRef.current.push(newText);
                processTypewriterQueue();
                // Notify callback (for auto-submit compatibility)
                if (onFinalCallbackRef.current) {
                    onFinalCallbackRef.current(newText);
                }
            }
        } catch (err: any) {
            console.error("Transcription request failed:", err);
            setError("Failed to transcribe audio chunk. Is the backend running?");
        } finally {
            setIsTranscribing(false);
        }
    }, [processTypewriterQueue]);

    /**
     * Start a fresh MediaRecorder segment
     */
    const startNewRecorderSegment = useCallback(() => {
        const stream = mediaStreamRef.current;
        // Don't start if we're not recording or stream is dead
        if (!stream || !isRecordingRef.current) return;

        // Check if stream tracks are still alive
        const audioTrack = stream.getAudioTracks()[0];
        if (!audioTrack || audioTrack.readyState === "ended") return;

        chunksRef.current = [];

        // Prefer webm/opus, fall back to whatever browser supports
        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
            ? "audio/webm;codecs=opus"
            : MediaRecorder.isTypeSupported("audio/webm")
                ? "audio/webm"
                : "audio/mp4";

        const recorder = new MediaRecorder(stream, { mimeType });
        mediaRecorderRef.current = recorder;

        recorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                chunksRef.current.push(event.data);
            }
        };

        recorder.onstop = () => {
            // Don't send if we're in the middle of a full teardown with no useful audio
            if (pendingStopRef.current) {
                pendingStopRef.current = false;
                return;
            }
            if (chunksRef.current.length > 0) {
                const audioBlob = new Blob(chunksRef.current, { type: mimeType });
                sendAudioChunk(audioBlob);
            }
        };

        recorder.start();
    }, [sendAudioChunk]);

    const start = useCallback(async () => {
        setError(null);

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                },
            });
            mediaStreamRef.current = stream;
            isRecordingRef.current = true;
            setIsRecording(true);

            // Start first recorder segment
            startNewRecorderSegment();

            // Set up interval to cycle recorder every CHUNK_INTERVAL
            intervalRef.current = setInterval(() => {
                if (!isRecordingRef.current) return;

                // Stop current recorder (triggers onstop → sends chunk)
                if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
                    mediaRecorderRef.current.stop();
                }

                // Start new segment immediately
                setTimeout(() => {
                    if (isRecordingRef.current) {
                        startNewRecorderSegment();
                    }
                }, 50);
            }, CHUNK_INTERVAL);
        } catch (err: any) {
            console.error("Failed to start recording:", err);
            if (err.name === "NotAllowedError") {
                setError("Microphone access was denied. Please allow mic access.");
            } else if (err.name === "NotFoundError") {
                setError("No microphone found. Please connect a microphone.");
            } else {
                setError(`Failed to start recording: ${err.message}`);
            }
        }
    }, [startNewRecorderSegment]);

    const stop = useCallback(() => {
        // Mark as not recording FIRST to prevent new segments starting
        isRecordingRef.current = false;
        setIsRecording(false);

        // Clear the chunk interval immediately
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }

        // Stop current recorder — send the final chunk
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
            mediaRecorderRef.current.stop(); // Will trigger onstop → send last chunk
        }
        mediaRecorderRef.current = null;

        // Stop all media stream tracks (releases mic)
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach((track) => track.stop());
            mediaStreamRef.current = null;
        }
    }, []);

    const clear = useCallback(() => {
        setTranscript("");
        setDisplayedTranscript("");
        setInterimText("");
        setError(null);
        typewriterQueueRef.current = [];
        isTypingRef.current = false;
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
            if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
                mediaRecorderRef.current.stop();
            }
            if (mediaStreamRef.current) {
                mediaStreamRef.current.getTracks().forEach((track) => track.stop());
            }
        };
    }, []);

    return {
        isRecording,
        transcript,
        displayedTranscript,
        interimText,
        error,
        isTranscribing,
        start,
        stop,
        clear,
    };
}
