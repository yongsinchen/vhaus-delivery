import { useState, useEffect } from "react";
import { useAuth } from "./AuthContext";
import { useLoading } from "./UIComponents";

export default function LoginPage() {
  const { signIn } = useAuth();
  const { showLoading, hideLoading } = useLoading();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // On success the page unmounts when the dashboard takes over — make sure
  // the global overlay never outlives the login flow.
  useEffect(() => () => hideLoading(), [hideLoading]);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (loading) return; // prevent double submit
    setError("");
    setLoading(true);
    showLoading("Signing you in…");
    const err = await signIn(email.trim(), password);
    if (err) {
      hideLoading();
      setError(err.message === "Invalid login credentials" ? "Incorrect email or password." : err.message);
      setLoading(false);
      return;
    }
    // Success: keep the overlay up — AuthContext flips to the boot screen
    // ("Loading PulseOS…") and this page unmounts, which hides the overlay.
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-blue-600 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">⚡</div>
          <h1 className="text-white text-2xl font-bold tracking-wide">PulseOS</h1>
          <p className="text-blue-200 text-sm mt-1">Operations Management System</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-gray-800 text-lg font-bold mb-6">Sign in to your account</h2>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoFocus
                disabled={loading}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent disabled:bg-gray-50"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                disabled={loading}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent disabled:bg-gray-50"
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-sm text-red-600">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              {loading ? "Signing in…" : "Sign In"}
            </button>
          </form>

          <p className="text-center text-xs text-gray-400 mt-6">
            Contact your manager to get access.
          </p>
        </div>
      </div>
    </div>
  );
}
