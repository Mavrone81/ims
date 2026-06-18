import { useState } from 'react';
import { api, ApiRequestError } from '../api';
import { Modal, useToast } from './ui';
import { useAuth } from '../auth';

// Self-service profile editing for any signed-in user (own name + email).
export default function ProfileModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const { user, refreshUser } = useAuth();
  const [fullName, setFullName] = useState(user?.full_name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!fullName.trim()) return setError('Full name is required');
    setBusy(true);
    setError('');
    try {
      await api('/auth/me', {
        method: 'PATCH',
        // empty email clears it (send null); otherwise send the trimmed value
        body: { full_name: fullName.trim(), email: email.trim() ? email.trim() : null },
      });
      await refreshUser();
      toast('Profile updated');
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not update profile');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Edit profile" onClose={onClose}>
      <div className="field">
        <label>Username</label>
        <input value={user?.username ?? ''} disabled />
      </div>
      <div className="field">
        <label>Full name</label>
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus maxLength={120} />
      </div>
      <div className="field">
        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" maxLength={200} />
      </div>
      {error && <div className="error-text">{error}</div>}
      <div className="modal-actions">
        <button className="btn secondary" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={busy || !fullName.trim()} onClick={submit}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </Modal>
  );
}
