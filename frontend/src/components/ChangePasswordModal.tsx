import { useState } from 'react';
import { api, ApiRequestError } from '../api';
import { Modal, useToast } from './ui';

export default function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (next !== confirm) return setError('New passwords do not match');
    if (next.length < 8) return setError('New password must be at least 8 characters');
    setBusy(true);
    setError('');
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: { current_password: current, new_password: next },
      });
      toast('Password changed — other sessions signed out');
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not change password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Change password" onClose={onClose}>
      <div className="field">
        <label>Current password</label>
        <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus autoComplete="current-password" />
      </div>
      <div className="field">
        <label>New password (min 8 characters)</label>
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
      </div>
      <div className="field">
        <label>Confirm new password</label>
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      </div>
      {error && <div className="error-text">{error}</div>}
      <div className="modal-actions">
        <button className="btn secondary" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={busy || !current || !next} onClick={submit}>
          {busy ? 'Saving…' : 'Change password'}
        </button>
      </div>
    </Modal>
  );
}
