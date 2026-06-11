import { useState, useEffect, useCallback } from "react";
import { supabase, useAuth, roleLabel } from "./AuthContext";

const BACKEND = "https://vhaus-bot-production.up.railway.app";
const EMPTY_FORM = { name: "", email: "", password: "", role: "salesman", company_id: "", telegram_id: "", salesman_name: "", is_active: true };

export default function UserManagement() {
  const { user: currentUser } = useAuth();
  const isMaster = currentUser?.role === "master";
  const isManager = currentUser?.role === "manager";

  const [users, setUsers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const availableRoles = isMaster
    ? ["master", "manager", "company_admin", "salesman", "finance"]
    : ["company_admin", "salesman", "finance"];

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");

    // Load companies
    const { data: comps, error: compErr } = await supabase
      .from("companies").select("*").order("name");
    if (compErr) console.error("Load companies error:", compErr);
    setCompanies(comps || []);

    // Load users via backend (service role bypasses RLS)
    try {
      const params = new URLSearchParams();
      if (!isMaster && currentUser?.company_id) {
        params.set("company_id", currentUser.company_id);
      }
      const res = await fetch(`${BACKEND}/admin/users/list?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setUsers(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("Load users error:", e);
      // Fallback: try direct Supabase query
      let q = supabase.from("users").select("*, companies(name, code)").order("name");
      if (!isMaster && currentUser?.company_id) q = q.eq("company_id", currentUser.company_id);
      const { data, error: uErr } = await q;
      if (uErr) { setError("Failed to load users: " + uErr.message); }
      else setUsers(data || []);
    }

    setLoading(false);
  }, [isMaster, currentUser?.company_id]); // eslint-disable-line

  useEffect(() => { loadData(); }, [loadData]);

  const openCreate = () => {
    setForm({
      ...EMPTY_FORM,
      company_id: isMaster ? "" : (currentUser?.company_id || ""),
    });
    setEditId(null);
    setError("");
    setSuccessMsg("");
    setShowForm(true);
  };

  const openEdit = u => {
    setForm({
      name: u.name || "",
      email: u.email || "",
      password: "",
      role: u.role || "salesman",
      company_id: u.company_id || "",
      telegram_id: u.telegram_id || "",
      salesman_name: u.salesman_name || "",
      is_active: u.is_active !== false,
    });
    setEditId(u.id);
    setError("");
    setSuccessMsg("");
    setShowForm(true);
  };

  const handleSave = async () => {
    setError("");
    setSuccessMsg("");

    if (!form.name.trim()) return setError("Name is required.");
    if (!form.email.trim()) return setError("Email is required.");
    if (!form.role) return setError("Role is required.");
    if (!editId && !form.password.trim()) return setError("Password is required for new users.");
    if (form.role !== "master" && !form.company_id && !isMaster) {
      form.company_id = currentUser?.company_id || "";
    }

    setSaving(true);

    if (editId) {
      // Update profile only
      const { error: updateErr } = await supabase.from("users").update({
        name: form.name.trim(),
        role: form.role,
        company_id: form.company_id || null,
        telegram_id: form.telegram_id.trim() || null,
        salesman_name: form.salesman_name.trim() || null,
        is_active: form.is_active,
      }).eq("id", editId);

      if (updateErr) { setError("Update failed: " + updateErr.message); setSaving(false); return; }

      // Update password if provided
      if (form.password.trim()) {
        const res = await fetch(`${BACKEND}/admin/users/${editId}/password`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: form.password.trim() }),
        });
        const d = await res.json();
        if (!d.success) { setError("Profile saved but password failed: " + (d.error || "unknown")); setSaving(false); return; }
      }

      setSuccessMsg("User updated successfully.");
      await loadData();
      setShowForm(false);

    } else {
      // Create new user via backend
      const res = await fetch(`${BACKEND}/admin/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          password: form.password.trim(),
          role: form.role,
          company_id: form.company_id || null,
          telegram_id: form.telegram_id.trim() || null,
          salesman_name: form.salesman_name.trim() || null,
        }),
      });

      const d = await res.json();
      if (!d.success) { setError(d.error || "Failed to create user."); setSaving(false); return; }

      setSuccessMsg(`User ${form.name} created successfully.`);
      setShowForm(false);
      // Reload after short delay to let Supabase propagate
      setTimeout(() => loadData(), 800);
    }

    setSaving(false);
  };

  const toggleActive = async u => {
    const { error } = await supabase.from("users").update({ is_active: !u.is_active }).eq("id", u.id);
    if (error) alert("Failed: " + error.message);
    else loadData();
  };

  const roleBadge = role => ({
    master: "bg-red-100 text-red-700",
    manager: "bg-purple-100 text-purple-700",
    company_admin: "bg-blue-100 text-blue-700",
    salesman: "bg-emerald-100 text-emerald-700",
    finance: "bg-amber-100 text-amber-700",
  }[role] || "bg-gray-100 text-gray-600");

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <p className="text-sm text-gray-400">{isMaster ? "All companies" : "Your company"} · {users.length} users</p>
        </div>
        <div className="flex gap-2">
          {successMsg && <span className="text-xs text-emerald-600 font-medium self-center">{successMsg}</span>}
          <button onClick={loadData} className="text-xs border border-gray-200 bg-white px-3 py-1.5 rounded-xl hover:bg-gray-50">🔄 Refresh</button>
          <button onClick={openCreate} className="text-sm bg-violet-600 text-white px-4 py-2 rounded-xl hover:bg-violet-700 font-medium">+ Add User</button>
        </div>
      </div>

      {error && !showForm && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 text-sm text-red-600">{error}</div>
      )}

      {/* User list */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading users...</div>
      ) : users.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">👥</div>
          <p className="font-medium">No users yet</p>
          <p className="text-sm mt-1">Click "Add User" to create the first one</p>
        </div>
      ) : (
        <div className="space-y-2">
          {users.map(u => (
            <div key={u.id} className={`bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center justify-between gap-3 flex-wrap transition-opacity ${!u.is_active ? "opacity-50" : ""}`}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-violet-100 flex items-center justify-center text-violet-700 font-bold text-sm flex-shrink-0">
                  {(u.name || "?").charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900 text-sm">{u.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleBadge(u.role)}`}>{roleLabel(u.role)}</span>
                    {!u.is_active && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Inactive</span>}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {u.email}
                    {u.companies?.name && <span className="ml-2 text-gray-300">· {u.companies.name}</span>}
                    {u.telegram_id && <span className="ml-2 text-blue-400">· TG: {u.telegram_id}</span>}
                    {u.salesman_name && <span className="ml-2 text-emerald-500">· {u.salesman_name}</span>}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => toggleActive(u)}
                  className={`text-xs px-3 py-1.5 rounded-xl border transition-colors ${u.is_active ? "border-gray-200 text-gray-500 hover:bg-gray-50" : "border-emerald-200 text-emerald-600 hover:bg-emerald-50"}`}>
                  {u.is_active ? "Deactivate" : "Activate"}
                </button>
                <button onClick={() => openEdit(u)} className="text-xs bg-violet-600 text-white px-3 py-1.5 rounded-xl hover:bg-violet-700">Edit</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-white rounded-t-3xl">
              <h3 className="font-bold text-gray-900">{editId ? "Edit User" : "Add New User"}</h3>
              <button onClick={() => setShowForm(false)} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 font-bold">×</button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {/* Name */}
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Full Name <span className="text-red-500">*</span></label>
                <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Ahmad bin Ali"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
              </div>

              {/* Email — readonly on edit */}
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Email <span className="text-red-500">*</span></label>
                <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                  disabled={!!editId} placeholder="user@example.com"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:bg-gray-50 disabled:text-gray-400" />
              </div>

              {/* Password */}
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">
                  Password {!editId && <span className="text-red-500">*</span>}
                  {editId && <span className="text-gray-400 font-normal"> (leave blank to keep current)</span>}
                </label>
                <input type="password" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                  placeholder={editId ? "Leave blank to keep current" : "Min 6 characters"}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
              </div>

              {/* Role */}
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Role <span className="text-red-500">*</span></label>
                <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white">
                  {availableRoles.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
                </select>
              </div>

              {/* Company */}
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">
                  Company {form.role !== "master" && <span className="text-red-500">*</span>}
                </label>
                <select value={form.company_id} onChange={e => setForm(p => ({ ...p, company_id: e.target.value }))}
                  disabled={!isMaster}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white disabled:bg-gray-50">
                  <option value="">-- Select company --</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              {/* Salesman name */}
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Salesman Name</label>
                <input value={form.salesman_name} onChange={e => setForm(p => ({ ...p, salesman_name: e.target.value }))}
                  placeholder="As it appears on orders (e.g. Lynn)"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
                <p className="text-xs text-gray-400 mt-0.5">Must match exactly how salesman signs orders</p>
              </div>

              {/* Telegram ID */}
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Telegram ID</label>
                <input value={form.telegram_id} onChange={e => setForm(p => ({ ...p, telegram_id: e.target.value }))}
                  placeholder="Numeric ID only (e.g. 1234567890)"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
                <p className="text-xs text-gray-400 mt-0.5">Required for bot access. Get it from @userinfobot on Telegram.</p>
              </div>

              {/* Active toggle on edit */}
              {editId && (
                <div className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3">
                  <input type="checkbox" id="is_active" checked={form.is_active}
                    onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))}
                    className="w-4 h-4 accent-violet-600" />
                  <label htmlFor="is_active" className="text-sm text-gray-700">Active account — can log in</label>
                </div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">{error}</div>
              )}
            </div>

            <div className="px-6 py-4 border-t flex gap-3 justify-end sticky bottom-0 bg-white rounded-b-3xl">
              <button onClick={() => setShowForm(false)} disabled={saving}
                className="px-4 py-2 text-sm bg-gray-100 rounded-xl hover:bg-gray-200 disabled:opacity-50">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="px-5 py-2 text-sm bg-violet-600 text-white rounded-xl hover:bg-violet-700 disabled:opacity-50 font-medium">
                {saving ? "Saving..." : editId ? "Update User" : "Create User"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}