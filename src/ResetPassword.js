import { useState } from "react";
import { supabase } from "./AuthContext";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const handleReset = async (e) => {
    e.preventDefault();
    setError("");
    if (password.length < 6) return setError("Password must be at least 6 characters.");
    if (password !== confirm) return setError("Passwords do not match.");
    setLoading(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    if (err) { setError(err.message); setLoading(false); return; }
    setDone(true);
    setLoading(false);
    setTimeout(() => { window.location.href = "/"; }, 2000);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-blue-600 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">⚡</div>
          <h1 className="text-white text-2xl font-bold tracking-wide">PulseOS</h1>
          <p className="text-blue-200 text-sm mt-1">Reset your password</p>
        </div>
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {done ? (
            <div className="text-center">
              <div className="text-4xl mb-3">✅</div>
              <p className="font-semibold text-gray-800">Password updated!</p>
              <p className="text-sm text-gray-500 mt-1">Redirecting to login...</p>
            </div>
          ) : (
            <>
              <h2 className="text-gray-800 text-lg font-bold mb-6">Set new password</h2>
              <form onSubmit={handleReset} className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">New Password</label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="Min 6 characters" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Confirm Password</label>
                  <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required placeholder="Repeat password" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
                {error && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-sm text-red-600">{error}</div>}
                <button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50">
                  {loading ? "Updating..." : "Update Password"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}