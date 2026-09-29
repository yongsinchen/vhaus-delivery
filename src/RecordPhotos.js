import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./AuthContext";
import { useToast, useLoading } from "./UIComponents";

// Photos with an optional description each, attached to a sales order or a
// service case. Backend: GET/POST /<basePath>/:id/photos,
// PATCH/DELETE /<basePath>/:id/photos/:photoId (vhaus-bot, migration 109).
//   basePath  "sales-orders" | "service-cases"
//   canEdit   show add / edit / delete controls (the backend still authorizes)

const API = process.env.REACT_APP_BOT_API || "https://vhaus-bot-production.up.railway.app";
const MAX_PER_UPLOAD = 10;
const MAX_BYTES = 15 * 1024 * 1024;

const authHeaders = async () => {
  const { data } = await supabase.auth.getSession();
  const headers = { Authorization: `Bearer ${data?.session?.access_token || ""}` };
  const cid = localStorage.getItem("pulseActiveCompanyId");
  if (cid) headers["X-Company-ID"] = cid;
  return headers;
};
const readError = async (res, fallback) => {
  const d = await res.json().catch(() => ({}));
  return d.error || fallback;
};
const fmtWhen = v => { const d = v ? new Date(v) : null; return d && !isNaN(d) ? d.toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" }) : ""; };

// Photos picked but not uploaded yet: [{ key, file, preview, description }].
// Shared by the detail drawer (RecordPhotos) and forms that upload after the
// record is created (ServiceCaseFormModal). Previews are object URLs and are
// released whenever a photo is dropped and on unmount.
export function usePhotoStaging() {
  const toast = useToast();
  const [staged, setStaged] = useState([]);
  const stagedRef = useRef(staged);
  stagedRef.current = staged;

  const clear = useCallback(() => {
    stagedRef.current.forEach(s => URL.revokeObjectURL(s.preview));
    setStaged([]);
  }, []);
  const remove = (key) => setStaged(prev => prev.filter(x => {
    if (x.key === key) URL.revokeObjectURL(x.preview);
    return x.key !== key;
  }));
  const setDescription = (key, description) => setStaged(prev => prev.map(x => (x.key === key ? { ...x, description } : x)));
  const pick = (fileList) => {
    const files = Array.from(fileList || []);
    const images = files.filter(f => /^image\//.test(f.type));
    if (images.length < files.length) toast.error("Only image files can be added");
    const tooBig = images.filter(f => f.size > MAX_BYTES);
    if (tooBig.length) toast.error(`${tooBig.map(f => f.name).join(", ")} is larger than 15 MB`);
    const ok = images.filter(f => f.size <= MAX_BYTES);
    const room = Math.max(0, MAX_PER_UPLOAD - stagedRef.current.length);
    if (ok.length > room) toast.error(`Up to ${MAX_PER_UPLOAD} photos per upload`);
    const added = ok.slice(0, room).map(file => ({
      key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`,
      file, preview: URL.createObjectURL(file), description: "",
    }));
    if (added.length) setStaged(prev => [...prev, ...added]);
  };
  useEffect(() => clear, [clear]);

  return { staged, pick, remove, clear, setDescription, full: staged.length >= MAX_PER_UPLOAD };
}

// POST staged photos to a record. Returns the created photo rows; throws on failure.
export async function uploadStagedPhotos(basePath, recordId, staged) {
  const fd = new FormData();
  staged.forEach(s => fd.append("photos", s.file));
  fd.append("descriptions", JSON.stringify(staged.map(s => s.description.trim())));
  const res = await fetch(`${API}/${basePath}/${recordId}/photos`, { method: "POST", headers: await authHeaders(), body: fd });
  if (!res.ok) throw new Error(await readError(res, "Photo upload failed"));
  const d = await res.json();
  return d.photos || [];
}

// Thumbnail + optional description textarea per staged photo.
export function StagedPhotoList({ staging }) {
  return (
    <div className="space-y-2">
      {staging.staged.map(s => (
        <div key={s.key} className="flex gap-2 items-start">
          <img src={s.preview} alt="" className="w-16 h-16 object-cover rounded-lg border border-gray-200 shrink-0" />
          <textarea rows={2} value={s.description} maxLength={1000} placeholder="Description (optional)"
            onChange={e => staging.setDescription(s.key, e.target.value)}
            className="flex-1 min-w-0 text-xs px-2 py-1.5 rounded-lg border border-gray-200" />
          <button type="button" onClick={() => staging.remove(s.key)} title="Remove"
            className="w-7 h-7 shrink-0 flex items-center justify-center rounded-full text-gray-400 hover:bg-red-50 hover:text-red-500">×</button>
        </div>
      ))}
    </div>
  );
}

export default function RecordPhotos({ basePath, recordId, canEdit = false }) {
  const toast = useToast();
  const { withLoading } = useLoading();
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const staging = usePhotoStaging();
  const staged = staging.staged;
  const [editing, setEditing] = useState(null);  // { id, description }
  const [lightbox, setLightbox] = useState(null); // photo row
  const fileRef = useRef(null);
  const url = `${API}/${basePath}/${recordId}/photos`;

  const load = useCallback(async () => {
    if (!recordId) return;
    setLoading(true); setLoadError("");
    try {
      const res = await fetch(url, { headers: await authHeaders() });
      if (!res.ok) throw new Error(await readError(res, "Failed to load photos"));
      const d = await res.json();
      setPhotos(Array.isArray(d.photos) ? d.photos : []);
    } catch (e) { setLoadError(e.message); setPhotos([]); }
    finally { setLoading(false); }
  }, [url, recordId]);

  useEffect(() => { load(); }, [load]);
  // Parents mount this with key={recordId}, so a record switch remounts it and
  // the staging hook releases anything picked for the previous record.

  const uploadStaged = async () => {
    if (staged.length === 0) return;
    try {
      await withLoading(`Uploading ${staged.length} photo${staged.length > 1 ? "s" : ""}…`, async () => {
        const created = await uploadStagedPhotos(basePath, recordId, staged);
        setPhotos(prev => [...prev, ...created]);
        staging.clear();
        toast.success("Photos uploaded");
      });
    } catch (e) { toast.error(e.message); }
  };

  const saveDescription = async () => {
    if (!editing) return;
    try {
      await withLoading("Saving…", async () => {
        const res = await fetch(`${url}/${editing.id}`, {
          method: "PATCH",
          headers: { ...(await authHeaders()), "Content-Type": "application/json" },
          body: JSON.stringify({ description: editing.description }),
        });
        if (!res.ok) throw new Error(await readError(res, "Save failed"));
        const d = await res.json();
        setPhotos(prev => prev.map(p => (p.id === d.photo.id ? d.photo : p)));
        setLightbox(lb => (lb && lb.id === d.photo.id ? d.photo : lb));
        setEditing(null);
      });
    } catch (e) { toast.error(e.message); }
  };

  const deletePhoto = async (photo) => {
    if (!window.confirm("Delete this photo?")) return;
    try {
      await withLoading("Deleting photo…", async () => {
        const res = await fetch(`${url}/${photo.id}`, { method: "DELETE", headers: await authHeaders() });
        if (!res.ok) throw new Error(await readError(res, "Delete failed"));
        setPhotos(prev => prev.filter(p => p.id !== photo.id));
        setLightbox(lb => (lb && lb.id === photo.id ? null : lb));
        if (editing?.id === photo.id) setEditing(null);
      });
    } catch (e) { toast.error(e.message); }
  };

  // Plain render helper (not a component) so the textarea keeps focus while typing.
  const renderDescription = (p) => editing?.id === p.id ? (
    <div className="space-y-1" onClick={e => e.stopPropagation()}>
      <textarea rows={2} autoFocus value={editing.description} maxLength={1000}
        onChange={e => setEditing(ed => ({ ...ed, description: e.target.value }))}
        placeholder="Description (optional)"
        className="w-full text-xs px-2 py-1.5 rounded-lg border border-gray-200" />
      <div className="flex gap-1.5 justify-end">
        <button onClick={() => setEditing(null)} className="text-[11px] px-2 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">Cancel</button>
        <button onClick={saveDescription} className="text-[11px] px-2 py-1 rounded-lg bg-violet-600 text-white hover:bg-violet-700">Save</button>
      </div>
    </div>
  ) : (
    <p className={`text-xs whitespace-pre-wrap break-words ${p.description ? "text-gray-700" : "text-gray-300 italic"}`}>
      {p.description || "No description"}
    </p>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-bold text-gray-500">PHOTOS ({photos.length})</p>
        {canEdit && (
          <button onClick={() => fileRef.current?.click()} className="text-xs px-3 py-1 rounded-lg bg-violet-100 text-violet-700 hover:bg-violet-200">+ Add Photos</button>
        )}
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
          onChange={e => { staging.pick(e.target.files); e.target.value = ""; }} />
      </div>

      {/* Staged: preview + optional description per photo before upload */}
      {staged.length > 0 && (
        <div className="border border-violet-200 bg-violet-50/40 rounded-xl p-3 mb-2 space-y-2">
          <p className="text-xs font-bold text-violet-700">NEW PHOTOS ({staged.length})</p>
          <StagedPhotoList staging={staging} />
          <div className="flex items-center gap-2 justify-end">
            {!staging.full && (
              <button onClick={() => fileRef.current?.click()} className="text-xs px-3 py-1.5 rounded-lg border border-violet-200 text-violet-700 hover:bg-violet-50 mr-auto">+ More</button>
            )}
            <button onClick={staging.clear} className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">Cancel</button>
            <button onClick={uploadStaged} className="text-xs px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 font-medium">Upload {staged.length}</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-3 gap-2 animate-pulse">{[1, 2, 3].map(i => <div key={i} className="aspect-square bg-gray-100 rounded-xl" />)}</div>
      ) : loadError ? (
        <p className="text-xs text-red-500">{loadError} <button onClick={load} className="underline">Retry</button></p>
      ) : photos.length === 0 ? (
        staged.length === 0 && <p className="text-xs text-gray-400">No photos yet</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {photos.map(p => (
            <div key={p.id} className="border border-gray-200 rounded-xl overflow-hidden bg-white flex flex-col">
              <button onClick={() => setLightbox(p)} className="block aspect-square bg-gray-50">
                <img src={p.url} alt={p.description || "Photo"} loading="lazy" className="w-full h-full object-cover" />
              </button>
              <div className="p-2 space-y-1 flex-1 flex flex-col">
                {renderDescription(p)}
                <p className="text-[10px] text-gray-400 mt-auto">{[p.uploaded_by_name, fmtWhen(p.created_at)].filter(Boolean).join(" · ")}</p>
                {canEdit && editing?.id !== p.id && (
                  <div className="flex gap-2">
                    <button onClick={() => setEditing({ id: p.id, description: p.description || "" })} className="text-[11px] text-violet-600 hover:underline">Edit</button>
                    <button onClick={() => deletePhoto(p)} className="text-[11px] text-red-500 hover:underline ml-auto">Delete</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {lightbox && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[70] p-4" onClick={() => setLightbox(null)}>
          <div className="relative max-w-3xl w-full" onClick={e => e.stopPropagation()}>
            <img src={lightbox.url} alt={lightbox.description || "Photo"} className="w-full h-auto rounded-2xl shadow-2xl max-h-[75vh] object-contain" />
            {lightbox.description && <p className="mt-3 text-sm text-white whitespace-pre-wrap break-words text-center">{lightbox.description}</p>}
            <button onClick={() => setLightbox(null)} className="absolute top-3 right-3 w-10 h-10 flex items-center justify-center rounded-full bg-black/50 text-white text-xl hover:bg-black/70">×</button>
            <a href={lightbox.url} target="_blank" rel="noopener noreferrer" className="absolute top-3 left-3 bg-violet-600 text-white text-xs px-3 py-2 rounded-xl hover:bg-violet-700">Open full ↗</a>
          </div>
        </div>
      )}
    </div>
  );
}
