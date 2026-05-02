"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowLeft, UserCheck, BarChart3, Calendar, Camera, X, CheckCircle, AlertCircle, AlertTriangle, TrendingDown, GraduationCap, BookOpen } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const API = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

type MarkRes = {
  session_id: string;
  module_code: string;
  module_name: string;
  remaining_slots: number;
  pin_expires_at: string;
  marked_at?: string;
  max_students?: number;
};

type ModuleStats = {
  module_code: string;
  module_name: string;
  total_sessions: number;
  attended_sessions: number;
  attendance_percentage: number;
  below_threshold: boolean;
  sessions_needed_for_80: number;
  is_enrolled: boolean;
};

type AttendanceStatistics = {
  student_id: string;
  overall_attendance_percentage: number;
  total_sessions: number;
  total_attended: number;
  modules_below_threshold: number;
  has_attendance_alert: boolean;
  enrolled_modules_count: number;
  module_statistics: ModuleStats[];
  message?: string;
};

type NotificationMessage = {
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
};

export default function StudentAttendancePage() {
  const { user } = useAuth();
  const [studentId, setStudentId] = useState("");
  const [pin, setPin] = useState("");

  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState<NotificationMessage | null>(null);
  const [data, setData] = useState<MarkRes | null>(null);
  const [attendanceCompleted, setAttendanceCompleted] = useState(false);

  // Camera states
  const [showCamera, setShowCamera] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<{
    success: boolean;
    message: string;
    confidence?: number;
  } | null>(null);

  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [showSurveyPasswordModal, setShowSurveyPasswordModal] = useState(false);
  const [surveyPassword, setSurveyPassword] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Attendance statistics
  const [attendanceStats, setAttendanceStats] = useState<AttendanceStatistics | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  const [history, setHistory] = useState<
    { module_code: string; module_name: string; marked_at: string }[]
  >([]);

  // Auto-fill student ID from auth context
  useEffect(() => {
    if (user?.student_profile?.student_id) {
      setStudentId(user.student_profile.student_id);
    }
  }, [user]);

  // Fetch attendance statistics
  useEffect(() => {
    if (studentId) {
      fetchAttendanceStatistics();
    }
  }, [studentId]);

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [cameraStream]);

  useEffect(() => {
    if (cameraStream && videoRef.current) {
      videoRef.current.srcObject = cameraStream;
      videoRef.current.play().catch(err => {
        console.error("Error playing video:", err);
        showNotification('error', 'Unable to start video preview. Please check your camera permissions and try again.');
        stopCamera();
      });
    }
  }, [cameraStream]);

  const showNotification = (type: NotificationMessage['type'], message: string) => {
    setNotification({ type, message });
  };

  const clearNotification = () => {
    setNotification(null);
  };

  async function fetchAttendanceStatistics() {
    if (!studentId.trim()) return;

    setLoadingStats(true);
    try {
      const token = localStorage.getItem("token");
      if (!token) return;

      const res = await fetch(`${API}/api/attendance/student/${studentId}/statistics`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        console.error("Failed to fetch attendance statistics");
        return;
      }

      const json = await res.json();
      setAttendanceStats(json);
    } catch (err) {
      console.error("Error fetching attendance statistics:", err);
    } finally {
      setLoadingStats(false);
    }
  }

  async function startCamera() {
    try {
      if (!user?.id) {
        showNotification('error', 'User authentication required. Please log in again.');
        setShowPermissionModal(false);
        return;
      }

      const token = localStorage.getItem("token");
      if (!token) {
        showNotification('error', 'Authentication token not found. Please log in again.');
        setShowPermissionModal(false);
        return;
      }

      try {
        const profileCheckResponse = await fetch(`${API}/api/auth/users/${user.id}/profile-picture-base64`, {
          headers: { Authorization: `Bearer ${token}` }
        });

        if (!profileCheckResponse.ok) {
          showNotification('error', 'Profile picture not found. Please upload a profile picture in your account settings before using face verification.');
          setShowPermissionModal(false);
          return;
        }
      } catch (err) {
        showNotification('error', 'Unable to verify profile picture. Please ensure you have uploaded a profile picture.');
        setShowPermissionModal(false);
        return;
      }

      if (typeof window !== 'undefined') {
        const isSecure = window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        if (!isSecure) {
          showNotification('error', 'Camera access requires a secure HTTPS connection. Please use a secure connection to enable face verification.');
          setShowPermissionModal(false);
          return;
        }
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });

      setCameraStream(stream);
      setShowCamera(true);
      setVerificationResult(null);
      clearNotification();
      setShowPermissionModal(false);

      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.muted = true;
          videoRef.current.play().catch(err => {
            console.error("Video play error:", err);
            showNotification('error', 'Failed to start camera preview. Please check your camera permissions.');
            stopCamera();
          });
        }
      }, 100);

    } catch (err: any) {
      console.error("Camera error:", err);
      let errorMsg = "Unable to access camera. ";

      if (err.name === 'NotAllowedError') {
        errorMsg = "Camera access was denied. Please allow camera permissions in your browser settings and try again.";
      } else if (err.name === 'NotFoundError') {
        errorMsg = "No camera detected on this device. Please connect a camera or use a device with a camera.";
      } else if (err.name === 'NotReadableError') {
        errorMsg = "Camera is currently being used by another application. Please close other applications using the camera and try again.";
      } else if (err.name === 'OverconstrainedError') {
        errorMsg = "Your camera does not meet the required specifications. Please try using a different camera.";
      } else if (err.name === 'SecurityError') {
        errorMsg = "Camera access blocked due to security settings. Please check your browser security settings.";
      } else {
        errorMsg = "An unexpected error occurred while accessing the camera. Please check your device settings and try again.";
      }

      showNotification('error', errorMsg);
      stopCamera();
      setShowPermissionModal(false);
    }
  }

  function requestCameraAccess() {
    setShowPermissionModal(true);
  }

  function openSurveyPasswordModal() {
    setShowSurveyPasswordModal(true);
    setSurveyPassword("");
  }

  function handleSurveyPasswordSubmit() {
    if (surveyPassword === "0000") {
      setShowSurveyPasswordModal(false);
      setSurveyPassword("");
      window.location.href = "/student/dashboard/attendance/survey";
    } else {
      showNotification('error', 'Incorrect password. Please try again.');
      setSurveyPassword("");
    }
  }

  function closeSurveyPasswordModal() {
    setShowSurveyPasswordModal(false);
    setSurveyPassword("");
  }

  function stopCamera() {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => {
        track.stop();
      });
      setCameraStream(null);
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.pause();
    }

    setShowCamera(false);
    setVerificationResult(null);
  }

  function capturePhoto() {
    if (!videoRef.current || !canvasRef.current) {
      showNotification('error', 'Camera preview is not ready. Please wait a moment and try again.');
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");

    if (!context) {
      showNotification('error', 'Unable to process camera image. Please refresh the page and try again.');
      return;
    }

    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      showNotification('warning', 'Camera is still loading. Please wait a moment and try again.');
      return;
    }

    try {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      const imageData = canvas.toDataURL("image/jpeg", 0.92);
      setCapturedImage(imageData);

      setTimeout(() => {
        stopCamera();
      }, 100);

      showNotification('success', 'Photo captured successfully. Please verify your face to continue.');
    } catch (err) {
      console.error("Capture failed:", err);
      showNotification('error', 'Failed to capture photo. Please try again.');
    }
  }

  function retakePhoto() {
    setCapturedImage(null);
    setVerificationResult(null);
    clearNotification();
    startCamera();
  }

  async function verifyFace() {
    if (!capturedImage || !user?.id) {
      showNotification('error', 'Photo not captured or user not authenticated. Please try again.');
      return;
    }

    setVerifying(true);
    setVerificationResult(null);
    clearNotification();

    try {
      const token = localStorage.getItem("token");
      if (!token) {
        throw new Error("Authentication token not found. Please log in again.");
      }

      const profilePicResponse = await fetch(`${API}/api/auth/users/${user.id}/profile-picture-base64`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!profilePicResponse.ok) {
        throw new Error("Unable to retrieve your profile picture. Please ensure you have uploaded a profile picture in your account settings.");
      }

      const { profile_picture_base64 } = await profilePicResponse.json();

      const verifyResponse = await fetch(`${API}/api/attendance/verify-face`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          profile_picture_base64,
          selfie_base64: capturedImage,
        }),
      });

      const result = await verifyResponse.json();

      if (!verifyResponse.ok) {
        throw new Error(result.detail || "Face verification failed");
      }

      setVerificationResult({
        success: result.is_match,
        message: result.message,
        confidence: result.confidence,
      });

      if (result.is_match) {
        showNotification('success', 'Face verification successful. You can now mark your attendance.');
      } else {
        showNotification('error', 'Face verification failed. The captured image does not match your profile picture. Please ensure you are in a well-lit area, face the camera directly, and try again.');
      }
    } catch (err: any) {
      const errorMessage = err.message || "Face verification failed due to an unexpected error. Please try again.";
      setVerificationResult({
        success: false,
        message: errorMessage,
      });
      showNotification('error', errorMessage);
    } finally {
      setVerifying(false);
    }
  }

  async function submitAttendance() {
    setLoading(true);
    clearNotification();

    try {
      if (!studentId.trim()) {
        throw new Error("Student ID is required to mark attendance.");
      }

      if (!/^\d{6}$/.test(pin.trim())) {
        throw new Error("Please enter a valid 6-digit PIN.");
      }

      if (!capturedImage) {
        throw new Error("Face verification photo is required. Please capture your photo and verify your face.");
      }

      if (!verificationResult?.success) {
        throw new Error("Face verification must be completed successfully before marking attendance.");
      }

      const token = localStorage.getItem("token");
      if (!token) {
        throw new Error("Authentication session expired. Please log in again.");
      }

      const profilePicResponse = await fetch(`${API}/api/auth/users/${user?.id}/profile-picture-base64`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!profilePicResponse.ok) {
        throw new Error("Unable to retrieve profile picture. Please try again.");
      }

      const { profile_picture_base64 } = await profilePicResponse.json();

      const res = await fetch(`${API}/api/attendance/checkin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          student_id: studentId.trim(),
          pin: pin.trim(),
          selfie_base64: capturedImage,
          profile_picture_base64,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const errorMsg = errorData.message || errorData.detail || "";

        // Handle "already marked" gracefully — not an error, just info
        if (errorMsg.toLowerCase().includes("already marked")) {
          showNotification('info', 'Your attendance for this session has already been recorded.');
          setPin("");
          setCapturedImage(null);
          setVerificationResult(null);
          setAttendanceCompleted(true);
          setData({
            session_id: "",
            module_code: "",
            module_name: "this session",
            remaining_slots: 0,
            pin_expires_at: "",
            marked_at: new Date().toISOString(),
          });
          setLoading(false);
          return;
        }

        throw new Error(errorMsg || "Failed to mark attendance. Please verify your PIN and try again.");
      }

      const json = (await res.json()) as MarkRes;

      showNotification('success', `Attendance marked successfully for ${json.module_code} - ${json.module_name}`);
      setData(json);
      setPin("");
      setCapturedImage(null);
      setVerificationResult(null);
      setAttendanceCompleted(true);

      if (json.module_code && json.module_name) {
        setHistory((prev) => [
          {
            module_code: json.module_code,
            module_name: json.module_name,
            marked_at: json.marked_at || new Date().toISOString(),
          },
          ...prev,
        ]);
      }

      setTimeout(() => fetchAttendanceStatistics(), 1000);
    } catch (err: any) {
      showNotification('error', err?.message || "An unexpected error occurred. Please try again.");
      console.error("Attendance error:", err);
    } finally {
      setLoading(false);
    }
  }

  const maxStudents = data?.max_students ?? undefined;
  const remaining = typeof data?.remaining_slots === "number" ? data.remaining_slots : undefined;
  const markedCount = useMemo(() => {
    if (typeof maxStudents === "number" && typeof remaining === "number") {
      return Math.max(0, maxStudents - remaining);
    }
    return undefined;
  }, [maxStudents, remaining]);

  const progressPct = useMemo(() => {
    if (typeof maxStudents === "number" && typeof markedCount === "number" && maxStudents > 0) {
      return Math.min(100, Math.round((markedCount / maxStudents) * 100));
    }
    return undefined;
  }, [maxStudents, markedCount]);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <header className="h-16 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-6 md:px-8 sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <Link
            href="/student/dashboard"
            className="text-gray-400 hover:text-white transition-colors p-2 rounded-full hover:bg-gray-800"
            title="Back to Dashboard"
          >
            <ArrowLeft size={20} />
          </Link>
          <h2 className="text-lg font-semibold text-gray-200">Student Attendance</h2>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={openSurveyPasswordModal}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors"
          >
            Take a survey
          </button>
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span className="text-sm text-emerald-400 hidden sm:inline">System Online</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-6 md:p-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold mb-2 flex items-center gap-3">
            <UserCheck className="text-emerald-600" size={32} />
            Mark Attendance
          </h1>
          <p className="text-gray-400">
            Enter the 6-digit PIN and verify your identity using face recognition.
          </p>
        </header>

        {/* ATTENDANCE ALERT BANNER - Only show for enrolled modules */}
        {attendanceStats?.has_attendance_alert && attendanceStats.enrolled_modules_count > 0 && (
          <div className="mb-6 rounded-xl border border-red-700/30 bg-red-950/50 p-5">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-full bg-red-600/20 flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={24} className="text-red-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-red-300 mb-2 flex items-center gap-2">
                  <TrendingDown size={20} />
                  Attendance Alert: Action Required
                </h3>
                <p className="text-red-200 text-sm mb-3">
                  Your overall attendance is <span className="font-bold">{attendanceStats.overall_attendance_percentage.toFixed(1)}%</span>.
                  {attendanceStats.overall_attendance_percentage < 80 && " You are below the required 80% threshold."}
                  {attendanceStats.modules_below_threshold > 0 && (
                    <> You have <span className="font-bold">{attendanceStats.modules_below_threshold}</span> module(s) below 80% attendance.</>
                  )}
                </p>
                <div className="bg-red-900/30 rounded-lg p-3 text-xs text-red-200">
                  <p className="font-semibold mb-1">⚠️ Warning:</p>
                  <p>Falling below 80% attendance may result in academic penalties or ineligibility for exams. Please attend classes regularly to maintain the minimum requirement.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* INFO BANNER - No attendance records yet */}
        {attendanceStats?.message && attendanceStats.enrolled_modules_count === 0 && (
          <div className="mb-6 rounded-xl border border-blue-700/30 bg-blue-950/50 p-5">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-full bg-blue-600/20 flex items-center justify-center flex-shrink-0">
                <BookOpen size={24} className="text-blue-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-blue-300 mb-2 flex items-center gap-2">
                  <GraduationCap size={20} />
                  Start Your Attendance Journey
                </h3>
                <p className="text-blue-200 text-sm mb-2">
                  You haven't attended any lectures yet. Once you attend your first lecture for a module, we'll start tracking your attendance for that course.
                </p>
                <p className="text-blue-300 text-xs">
                  💡 Tip: Attend at least one lecture per module to enable attendance tracking and monitoring.
                </p>
              </div>
            </div>
          </div>
        )}

        {notification && (
          <div
            className={`mb-6 rounded-lg border px-4 py-3.5 text-sm flex items-start gap-3 ${notification.type === 'success'
              ? "border-emerald-700/30 bg-emerald-950/50 text-emerald-300"
              : notification.type === 'error'
                ? "border-red-700/30 bg-red-950/50 text-red-300"
                : notification.type === 'warning'
                  ? "border-yellow-700/30 bg-yellow-950/50 text-yellow-300"
                  : "border-blue-700/30 bg-blue-950/50 text-blue-300"
              }`}
          >
            {notification.type === 'success' && <CheckCircle size={20} className="flex-shrink-0 mt-0.5" />}
            {notification.type === 'error' && <AlertCircle size={20} className="flex-shrink-0 mt-0.5" />}
            {notification.type === 'warning' && <AlertCircle size={20} className="flex-shrink-0 mt-0.5" />}
            {notification.type === 'info' && <AlertCircle size={20} className="flex-shrink-0 mt-0.5" />}
            <div className="flex-1">
              {notification.message}
            </div>
            <button
              onClick={clearNotification}
              className="text-current hover:opacity-70 transition-opacity"
            >
              <X size={18} />
            </button>
          </div>
        )}

        {attendanceCompleted ? (
          <div className="bg-gray-800/70 rounded-xl border border-emerald-700/30 shadow-sm p-6 md:p-8">
            <div className="text-center mb-6">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-600/20 flex items-center justify-center">
                <CheckCircle size={36} className="text-emerald-400" />
              </div>
              <h3 className="text-xl font-bold text-emerald-300">
                {data?.module_code ? "Attendance Marked Successfully" : "Attendance Already Recorded"}
              </h3>
              {!data?.module_code && (
                <p className="text-sm text-gray-400 mt-2">Your attendance for this session has already been recorded.</p>
              )}
            </div>

            {data?.module_code && (
              <div className="p-5 rounded-lg bg-gray-700/40 border border-gray-600">
                <div className="text-sm text-gray-300">
                  Marked for:{" "}
                  <span className="font-semibold text-white">
                    {data.module_code} — {data.module_name}
                  </span>
                </div>

                {data.marked_at && (
                  <div className="text-sm text-gray-300 mt-1.5">
                    Time:{" "}
                    <span className="text-white">
                      {new Date(data.marked_at).toLocaleString()}
                    </span>
                  </div>
                )}

                {typeof data.remaining_slots === "number" && data.remaining_slots > 0 && (
                  <div className="text-sm text-gray-300 mt-1.5">
                    Remaining slots:{" "}
                    <span className="font-medium text-white">{data.remaining_slots}</span>
                  </div>
                )}
              </div>
            )}

            <button
              onClick={() => {
                setAttendanceCompleted(false);
                setData(null);
                setPin("");
                setCapturedImage(null);
                setVerificationResult(null);
                clearNotification();
              }}
              className="mt-6 w-full rounded-xl bg-gray-600 px-4 py-3 font-semibold text-white hover:bg-gray-700 transition-all flex items-center justify-center gap-2"
            >
              Mark Another Attendance
            </button>
          </div>
        ) : (
          <div className="bg-gray-800/70 rounded-xl border border-gray-700 shadow-sm p-6 md:p-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <label className="text-sm font-medium text-gray-300">
                Student ID
                <div className="relative mt-1.5">
                  <input
                    className="w-full rounded-lg border border-gray-600 bg-gray-700/50 px-4 py-2.5 outline-none text-white cursor-not-allowed opacity-80"
                    value={studentId || "Loading..."}
                    readOnly
                    disabled
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">
                    Auto-filled
                  </div>
                </div>
              </label>

              <label className="text-sm font-medium text-gray-300">
                PIN (6 digits)
                <input
                  className="mt-1.5 w-full rounded-lg border border-gray-600 bg-gray-700 px-4 py-2.5 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 tracking-widest text-white placeholder-gray-500"
                  placeholder="123456"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  maxLength={6}
                  disabled={!studentId || loading}
                />
              </label>
            </div>

            {/* Face Verification Section */}
            <div className="mt-6 p-5 rounded-lg bg-gray-700/40 border border-gray-600">
              <h3 className="text-sm font-semibold text-gray-200 mb-3 flex items-center gap-2">
                <Camera size={18} className="text-blue-400" />
                Face Verification {verificationResult?.success && <CheckCircle size={16} className="text-emerald-400" />}
              </h3>

              {!capturedImage && !showCamera && (
                <button
                  onClick={requestCameraAccess}
                  disabled={!studentId || loading}
                  className="w-full rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                >
                  <Camera size={20} />
                  Open Camera
                </button>
              )}

              {showCamera && !capturedImage && (
                <div className="relative">
                  <video
                    ref={videoRef}
                    autoPlay
                    muted
                    playsInline
                    className="w-full rounded-lg bg-black"
                    style={{ transform: "scaleX(-1)" }}
                  />
                  <div className="mt-3 flex gap-3">
                    <button
                      onClick={capturePhoto}
                      disabled={loading}
                      className="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition-all"
                    >
                      Capture Photo
                    </button>
                    <button
                      onClick={stopCamera}
                      className="rounded-xl bg-red-600 px-4 py-2.5 font-semibold text-white hover:bg-red-700 transition-all"
                    >
                      <X size={20} />
                    </button>
                  </div>
                </div>
              )}

              {capturedImage && (
                <div className="space-y-3">
                  <img
                    src={capturedImage}
                    alt="Captured"
                    className="w-full rounded-lg border border-gray-600"
                    style={{ transform: "scaleX(-1)" }}
                  />

                  {verificationResult && (
                    <div className={`p-3 rounded-lg border ${verificationResult.success
                      ? "border-emerald-700/30 bg-emerald-950/50 text-emerald-300"
                      : "border-red-700/30 bg-red-950/50 text-red-300"
                      }`}>
                      <div className="flex items-start gap-2">
                        {verificationResult.success ? (
                          <CheckCircle size={20} className="flex-shrink-0 mt-0.5" />
                        ) : (
                          <AlertCircle size={20} className="flex-shrink-0 mt-0.5" />
                        )}
                        <div>
                          <p className="font-medium">{verificationResult.message}</p>
                          {verificationResult.confidence && (
                            <p className="text-sm mt-1">Confidence: {verificationResult.confidence.toFixed(1)}%</p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex gap-3">
                    {!verificationResult && (
                      <button
                        onClick={verifyFace}
                        disabled={verifying || loading}
                        className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-all"
                      >
                        {verifying ? "Verifying..." : "Verify Face"}
                      </button>
                    )}
                    <button
                      onClick={retakePhoto}
                      disabled={loading}
                      className="flex-1 rounded-xl bg-gray-600 px-4 py-2.5 font-semibold text-white hover:bg-gray-700 disabled:opacity-50 transition-all"
                    >
                      Retake Photo
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={submitAttendance}
              disabled={loading || !studentId || pin.length !== 6 || !verificationResult?.success || !capturedImage}
              className="mt-6 w-full rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <svg
                    className="animate-spin h-5 w-5 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v8z"
                    />
                  </svg>
                  Marking...
                </>
              ) : (
                "Mark Attendance"
              )}
            </button>
          </div>
        )}

        {/* Hidden canvas for photo capture */}
        <canvas ref={canvasRef} style={{ display: "none" }} />

        {/* Attendance Statistics - Only Enrolled Modules */}
        <div className="mt-10 grid grid-cols-1 gap-6">
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-gray-200 flex items-center gap-2">
                <Calendar size={18} className="text-gray-400" />
                My Attendance Progress
                {attendanceStats && attendanceStats.enrolled_modules_count > 0 && (
                  <span className="ml-2 text-xs bg-blue-600 text-white px-2 py-0.5 rounded-full">
                    {attendanceStats.enrolled_modules_count} {attendanceStats.enrolled_modules_count === 1 ? 'Module' : 'Modules'} Enrolled
                  </span>
                )}
              </h2>
              <button
                onClick={fetchAttendanceStatistics}
                disabled={loadingStats}
                className="text-xs text-gray-400 hover:text-gray-200 flex items-center gap-1 disabled:opacity-50"
              >
                {loadingStats ? "Loading..." : "Refresh"}
              </button>
            </div>

            {loadingStats ? (
              <div className="text-sm text-gray-500 py-6 text-center">
                Loading attendance statistics...
              </div>
            ) : !attendanceStats || attendanceStats.enrolled_modules_count === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-blue-500/10 flex items-center justify-center">
                  <GraduationCap size={32} className="text-blue-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-200 mb-2">No Attendance Data Yet</h3>
                <p className="text-sm text-gray-400 max-w-md mx-auto">
                  You haven't attended any lectures yet. Once you attend your first lecture for a module,
                  your attendance tracking will begin for that course.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Overall Progress */}
                <div className="bg-gray-700/40 rounded-lg p-5 border border-gray-600">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <div className="text-sm text-gray-400">Overall Attendance</div>
                      <div className="text-3xl font-bold text-white mt-1">
                        {attendanceStats.overall_attendance_percentage.toFixed(1)}%
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-gray-400">Sessions</div>
                      <div className="text-xl font-semibold text-white mt-1">
                        {attendanceStats.total_attended}/{attendanceStats.total_sessions}
                      </div>
                    </div>
                  </div>
                  <div className="h-4 rounded-full bg-gray-700 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 ${attendanceStats.overall_attendance_percentage >= 80
                        ? 'bg-emerald-500'
                        : attendanceStats.overall_attendance_percentage >= 70
                          ? 'bg-yellow-500'
                          : 'bg-red-500'
                        }`}
                      style={{ width: `${Math.min(100, attendanceStats.overall_attendance_percentage)}%` }}
                    />
                  </div>
                  {attendanceStats.overall_attendance_percentage < 80 && (
                    <div className="mt-3 text-xs text-yellow-400 flex items-center gap-2">
                      <AlertTriangle size={14} />
                      <span>You need to maintain at least 80% attendance</span>
                    </div>
                  )}
                </div>

                {/* Per-Module Statistics */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-300 mb-3">Module-wise Attendance (Enrolled Modules Only)</h3>
                  <div className="space-y-3">
                    {attendanceStats.module_statistics.map((module) => (
                      <div
                        key={module.module_code}
                        className={`rounded-lg p-4 border ${module.below_threshold
                          ? 'bg-red-950/30 border-red-700/30'
                          : 'bg-gray-700/40 border-gray-600'
                          }`}
                      >
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex-1">
                            <div className="font-medium text-gray-200 flex items-center gap-2">
                              {module.module_code}
                              {module.below_threshold && (
                                <span className="text-xs bg-red-600 text-white px-2 py-0.5 rounded-full">
                                  AT RISK
                                </span>
                              )}
                            </div>
                            <div className="text-sm text-gray-400 mt-0.5">
                              {module.module_name}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className={`text-2xl font-bold ${module.below_threshold ? 'text-red-400' : 'text-white'
                              }`}>
                              {module.attendance_percentage.toFixed(1)}%
                            </div>
                            <div className="text-xs text-gray-400">
                              {module.attended_sessions}/{module.total_sessions} sessions
                            </div>
                          </div>
                        </div>
                        <div className="h-3 rounded-full bg-gray-700 overflow-hidden">
                          <div
                            className={`h-full transition-all duration-400 ${module.attendance_percentage >= 80
                              ? 'bg-emerald-500'
                              : module.attendance_percentage >= 70
                                ? 'bg-yellow-500'
                                : 'bg-red-500'
                              }`}
                            style={{ width: `${Math.min(100, module.attendance_percentage)}%` }}
                          />
                        </div>
                        {module.below_threshold && (
                          <div className="mt-2 text-xs text-red-300 flex items-center gap-2">
                            <AlertTriangle size={12} />
                            <span>
                              Attend {module.sessions_needed_for_80} more session(s) to reach 80%
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Camera Permission Modal */}
      {showPermissionModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-2xl border border-gray-700 max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-start gap-4 mb-4">
              <div className="w-12 h-12 rounded-full bg-blue-600/20 flex items-center justify-center flex-shrink-0">
                <Camera size={24} className="text-blue-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-white mb-2">
                  Camera Access Required
                </h3>
                <p className="text-sm text-gray-300 leading-relaxed">
                  We need access to your camera to verify your identity and ensure secure attendance marking.
                </p>
              </div>
            </div>

            <div className="bg-gray-700/40 rounded-lg p-4 mb-5">
              <h4 className="text-sm font-semibold text-gray-200 mb-3">Why we need camera access:</h4>
              <ul className="space-y-2 text-sm text-gray-300">
                <li className="flex items-start gap-2">
                  <CheckCircle size={16} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                  <span>Verify your identity by comparing your live photo with your profile picture</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle size={16} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                  <span>Prevent unauthorized attendance marking by others</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle size={16} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                  <span>Ensure accurate attendance records for academic purposes</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle size={16} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                  <span>Your photo is used only for verification and is not stored permanently</span>
                </li>
              </ul>
            </div>

            <div className="bg-blue-950/30 border border-blue-700/30 rounded-lg p-3 mb-5">
              <p className="text-xs text-blue-300">
                <strong>Privacy Note:</strong> Your camera feed is processed locally in your browser.
                We only send the captured photo to our secure server for verification purposes.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowPermissionModal(false)}
                className="flex-1 rounded-xl bg-gray-700 px-4 py-2.5 font-semibold text-white hover:bg-gray-600 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={startCamera}
                className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 font-semibold text-white hover:bg-blue-700 transition-all flex items-center justify-center gap-2"
              >
                <Camera size={18} />
                Allow Camera
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Survey Password Modal */}
      {showSurveyPasswordModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-gray-800 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-white">Survey Access</h3>
              <button
                onClick={closeSurveyPasswordModal}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            <p className="text-gray-300 text-sm mb-5">
              Please enter the 4-digit password to access the survey.
            </p>

            <div className="mb-5">
              <label className="text-sm font-medium text-gray-300 mb-2 block">
                Password
              </label>
              <input
                type="password"
                className="w-full rounded-lg border border-gray-600 bg-gray-700 px-4 py-3 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 tracking-widest text-white text-center text-xl"
                value={surveyPassword}
                onChange={(e) => setSurveyPassword(e.target.value.replace(/\D/g, "").slice(0, 4))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && surveyPassword.length === 4) {
                    handleSurveyPasswordSubmit();
                  }
                }}
                inputMode="numeric"
                maxLength={4}
                autoFocus
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={closeSurveyPasswordModal}
                className="flex-1 rounded-xl bg-gray-700 px-4 py-2.5 font-semibold text-white hover:bg-gray-600 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleSurveyPasswordSubmit}
                disabled={surveyPassword.length !== 4}
                className="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}