import { useState, useEffect, useCallback } from "react";
import { supabase, useAuth, roleLabel } from "./AuthContext";

const BACKEND = process.env.REACT_APP_BOT_API || "https://vhaus-bot-production.up.railway.app";
const EMPTY_FORM = { name: "", email: "", password: "", role: "salesman", company_id: "", telegram_id: "", salesman_name: "", is_active: true };

export default function UserManagement() {
  const { user: currentUser, activeCompanyId } = useAuth();
  const isMaster = currentUser?.role === "master";

  const [users, setUsers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [pwModal, setPwModal] = useState(null); // { id, name }
  const [newPw, setNewPw] = useState("");
  // Company access management
  const [accessRows, setAccessRows] = useState([]);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessError, setAccessError] = useState("");
  const [roles, setRoles] = useState([]);
  const [addAccess, setAddAccess] = useState({ company_id: "", role_id: "" });

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

    // Load users via backend
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${BACKEND}/admin/users/list`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setUsers(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("Load users error:", e);
      setError("Failed to load users: " + e.message);
      setUsers([]);
    }

    setLoading(false);
  }, [isMaster, activeCompanyId]); // eslint-disable-line

  useEffect(() => { loadData(); }, [loadData]);

  const getAuthHeaders = async () => {
    const token = (await supabase.auth.getSession()).data?.session?.access_token;
    const cid = localStorage.getItem("pulseActiveCompanyId");
    return { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(cid && { "X-Company-ID": cid }) };
  };

  const loadRoles = async () => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${BACKEND}/roles`, { headers });
      if (res.ok) { const d = await res.json(); setRoles(d.roles || []); }
    } catch (e) { console.error("loadRoles error:", e); }
  };

  const loadAccess = async (userId) => {
    setAccessLoading(true); setAccessError("");
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${BACKEND}/user-roles/${userId}`, { headers });
      if (res.ok) { const d = await res.json(); setAccessRows(d.companyRoles || []); }
      else { const d = await res.json(); setAccessError(d.error || "Failed to load access"); }
    } catch (e) { setAccessError(e.message); }
    setAccessLoading(false);
  };

  const handleAddAccess = async (userId) => {
    if (!addAccess.company_id || !addAccess.role_id) return setAccessError("Select company and role");
    setAccessError("");
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${BACKEND}/user-roles`, {
        method: "POST", headers,
        body: JSON.stringify({ user_id: userId, company_id: addAccess.company_id, role_id: addAccess.role_id }),
      });
      const d = await res.json();
      if (!res.ok) return setAccessError(d.error || "Failed to add access");
      setAddAccess({ company_id: "", role_id: "" });
      await loadAccess(userId);
    } catch (e) { setAccessError(e.message); }
  };

  const handleUpdateAccessRole = async (accessId, userId, newRoleId) => {
    setAccessError("");
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${BACKEND}/user-roles/${accessId}`, {
        method: "PATCH", headers,
        body: JSON.stringify({ role_id: newRoleId }),
      });
      if (!res.ok) { const d = await res.json(); return setAccessError(d.error || "Failed to update"); }
      await loadAccess(userId);
    } catch (e) { setAccessError(e.message); }
  };

  const handleToggleAccess = async (accessId, userId, currentActive) => {
    setAccessError("");
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${BACKEND}/user-roles/${accessId}`, {
        method: "PATCH", headers,
        body: JSON.stringify({ is_active: !currentActive }),
      });
      if (!res.ok) { const d = await res.json(); return setAccessError(d.error || "Failed to update"); }
      await loadAccess(userId);
    } catch (e) { setAccessError(e.message); }
  };

  const handleRevokeAccess = async (accessId, userId) => {
    if (!window.confirm("Revoke this company access?")) return;
    setAccessError("");
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${BACKEND}/user-roles/${accessId}`, { method: "DELETE", headers });
      if (!res.ok) { const d = await res.json(); return setAccessError(d.error || "Failed to revoke"); }
      await loadAccess(userId);
    } catch (e) { setAccessError(e.message); }
  };

  // Current user's role level for escalation prevention
  const myRoleLevel = currentUser?.role === "master" ? 100 : roles.find(r => r.role_key === (currentUser?.role || "").toUpperCase())?.level || 0;

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
    setAccessRows([]);
    setAccessError("");
    setAddAccess({ company_id: "", role_id: "" });
    setShowForm(true);
    loadRoles();
    loadAccess(u.id);
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
      const headers = await getAuthHeaders();
      const updateRes = await fetch(`${BACKEND}/admin/users/${editId}`, {
        method: "PATCH", headers,
        body: JSON.stringify({
          name: form.name.trim(),
          role: form.role,
          company_id: form.company_id || null,
          telegram_id: form.telegram_id.trim() || null,
          salesman_name: form.salesman_name.trim() || null,
          is_active: form.is_active,
        }),
      });
      const updateData = await updateRes.json();
      if (!updateRes.ok || !updateData.success) { setError("Update failed: " + (updateData.error || `HTTP ${updateRes.status}`)); setSaving(false); return; }

      // Update password if provided
      if (form.password.trim()) {
        const token = (await supabase.auth.getSession()).data?.session?.access_token;
        const res = await fetch(`${BACKEND}/admin/users/${editId}/password`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
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
      const token2 = (await supabase.auth.getSession()).data?.session?.access_token;
      const res = await fetch(`${BACKEND}/admin/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token2}` },
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
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${BACKEND}/admin/users/${u.id}`, {
        method: "PATCH", headers,
        body: JSON.stringify({ is_active: !u.is_active }),
      });
      const d = await res.json();
      if (!res.ok || !d.success) return alert("Failed: " + (d.error || `HTTP ${res.status}`));
      loadData();
    } catch (e) { alert("Failed: " + e.message); }
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
                {(isMaster || currentUser?.role === "manager") && (
                  <button onClick={() => { setPwModal({ id: u.id, name: u.name }); setNewPw(""); }}
                    className="text-xs px-3 py-1.5 rounded-xl border border-amber-200 text-amber-600 hover:bg-amber-50">🔑 Password</button>
                )}
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

              {/* Company Access — only on edit */}
              {editId && (
                <div className="border-t pt-4 mt-2">
                  <label className="text-xs font-semibold text-gray-700 block mb-2">Company Access</label>
                  {accessLoading ? (
                    <p className="text-xs text-gray-400 py-2">Loading access...</p>
                  ) : accessRows.length === 0 ? (
                    <p className="text-xs text-gray-400 py-2">No company access records. Primary company used as fallback.</p>
                  ) : (
                    <div className="space-y-2 mb-3">
                      {accessRows.map(a => (
                        <div key={a.id} className={`flex items-center gap-2 flex-wrap bg-gray-50 rounded-xl px-3 py-2 text-sm ${!a.is_active ? "opacity-50" : ""}`}>
                          <span className="font-medium text-gray-800 text-xs flex-1 min-w-[100px]">{a.companies?.name || "—"}</span>
                          <select value={a.role_id} onChange={e => handleUpdateAccessRole(a.id, editId, e.target.value)}
                            className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white">
                            {roles.filter(r => !r.company_id && r.role_key && (isMaster || r.level <= myRoleLevel)).map(r => (
                              <option key={r.id} value={r.id}>{r.role_name}</option>
                            ))}
                          </select>
                          {a.is_default && <span className="text-[10px] bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded-full">Default</span>}
                          <button onClick={() => handleToggleAccess(a.id, editId, a.is_active)}
                            className={`text-[10px] px-2 py-0.5 rounded-lg border ${a.is_active ? "border-amber-200 text-amber-600 hover:bg-amber-50" : "border-emerald-200 text-emerald-600 hover:bg-emerald-50"}`}>
                            {a.is_active ? "Deactivate" : "Activate"}
                          </button>
                          {(isMaster || currentUser?.role === "manager") && !a.is_default && (
                            <button onClick={() => handleRevokeAccess(a.id, editId)}
                              className="text-[10px] px-2 py-0.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50">Revoke</button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add new access */}
                  <div className="flex items-end gap-2 flex-wrap bg-blue-50/50 rounded-xl p-3">
                    <div className="flex-1 min-w-[120px]">
                      <label className="text-[10px] font-medium text-gray-500 block mb-0.5">Company</label>
                      <select value={addAccess.company_id} onChange={e => setAddAccess(p => ({ ...p, company_id: e.target.value }))}
                        className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
                        <option value="">Select...</option>
                        {companies.filter(c => !accessRows.find(a => a.company_id === c.id && !a.deleted_at)).map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex-1 min-w-[100px]">
                      <label className="text-[10px] font-medium text-gray-500 block mb-0.5">Role</label>
                      <select value={addAccess.role_id} onChange={e => setAddAccess(p => ({ ...p, role_id: e.target.value }))}
                        className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
                        <option value="">Select...</option>
                        {roles.filter(r => !r.company_id && r.role_key && (isMaster || r.level <= myRoleLevel)).map(r => (
                          <option key={r.id} value={r.id}>{r.role_name}</option>
                        ))}
                      </select>
                    </div>
                    <button onClick={() => handleAddAccess(editId)} disabled={!addAccess.company_id || !addAccess.role_id}
                      className="text-xs bg-violet-600 text-white px-3 py-1.5 rounded-lg hover:bg-violet-700 disabled:opacity-40 font-medium whitespace-nowrap">
                      + Add
                    </button>
                  </div>

                  {accessError && (
                    <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-600 mt-2">{accessError}</div>
                  )}
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

      {/* Reset Password Modal */}
      {pwModal && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm">
            <div className="px-6 py-4 border-b">
              <h3 className="font-bold text-gray-900">Reset Password</h3>
              <p className="text-xs text-gray-500 mt-0.5">Set a new password for <b>{pwModal.name}</b></p>
            </div>
            <div className="px-6 py-5 space-y-3">
              <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)}
                placeholder="New password (min 6 characters)" autoFocus
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                onKeyDown={e => e.key === "Enter" && newPw.length >= 6 && document.getElementById("pw-save-btn")?.click()} />
              {newPw && newPw.length < 6 && <p className="text-xs text-red-500">Minimum 6 characters</p>}
            </div>
            <div className="px-6 py-4 border-t flex gap-3 justify-end">
              <button onClick={() => setPwModal(null)} className="px-4 py-2 text-sm bg-gray-100 rounded-xl hover:bg-gray-200">Cancel</button>
              <button id="pw-save-btn" disabled={newPw.length < 6} onClick={async () => {
                const token = (await supabase.auth.getSession()).data?.session?.access_token;
                const res = await fetch(`${BACKEND}/admin/users/${pwModal.id}/password`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                  body: JSON.stringify({ password: newPw }),
                });
                const d = await res.json();
                if (d.success) { setPwModal(null); setSuccessMsg(`Password reset for ${pwModal.name}`); setTimeout(() => setSuccessMsg(""), 3000); }
                else alert(d.error || "Failed to reset password");
              }} className="px-5 py-2 text-sm bg-violet-600 text-white rounded-xl hover:bg-violet-700 disabled:opacity-50 font-medium">
                Reset Password
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}