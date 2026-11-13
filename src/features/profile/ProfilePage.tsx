import { useEffect, useState } from 'react';
import { KeyRound, Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/features/auth/useAuth';
import {
  checkPasswordRequest,
  updateProfile,
  checkResetContext,
  completePasswordReset,
  getStoredResetKey,
  clearStoredResetKey,
  generateResetKey,
  sha256Hex,
  storeResetKey,
  RosterError,
} from '@/features/roster/rosterApi';
import { useCreatePasswordRequest } from '@/features/roster/useRoster';
import { getBrowserFingerprint } from '@/shared/utils/browserFingerprint';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Field, inputClass } from '@/shared/ui/Field';
import { PageHeader } from '@/shared/ui/PageHeader';

const PASSWORD_PATTERN = /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,12}$/;

type ProfileStatus = 'idle' | 'saved' | 'resetSent' | 'requestSent' | 'pending' | 'error';
type SaveError = 'generic' | 'invalidPhone' | 'invalidName' | 'network';
type ResetError = 'invalidToken' | 'firebaseFailed' | 'firebaseNotConfigured' | 'generic';

function profileSaveError(error: unknown): SaveError {
  if (error instanceof RosterError) {
    if (error.code === 'invalid_phone') return 'invalidPhone';
    if (error.code === 'invalid_name') return 'invalidName';
    return 'generic';
  }
  return 'generic';
}

export function ProfilePage() {
  const { t } = useTranslation();
  const { state, sendPasswordReset, retry } = useAuth();
  const requestMutation = useCreatePasswordRequest();
  const member = state.status === 'ready' ? state.member : null;
  const [fullNameEn, setFullNameEn] = useState('');
  const [fullNameAr, setFullNameAr] = useState('');
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState<ProfileStatus>('idle');
  const [saveError, setSaveError] = useState<SaveError | null>(null);
  const [saving, setSaving] = useState(false);
  const [hasPending, setHasPending] = useState(false);
  const [resetAvailable, setResetAvailable] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<ResetError | null>(null);
  const [resetDone, setResetDone] = useState(false);

  useEffect(() => {
    if (!member) return;
    setFullNameEn(member.fullNameEn);
    setFullNameAr(member.fullNameAr ?? '');
    setPhone(member.phone ?? '');
  }, [member]);

  useEffect(() => {
    if (!member) return;
    const fp = getBrowserFingerprint();
    let cancelled = false;
    void (async () => {
      try {
        const [pendingRes, resetRes] = await Promise.all([
          checkPasswordRequest(fp),
          checkResetContext(fp),
        ]);
        if (!cancelled) {
          setHasPending(pendingRes.pending);
          setResetAvailable(resetRes.available);
        }
      } catch {
        // ignore — user can still use email option
      }
    })();
    return () => { cancelled = true; };
  }, [member]);

  if (!member) return null;

  const save = async () => {
    setSaving(true);
    setStatus('idle');
    setSaveError(null);
    try {
      await updateProfile({ fullNameEn: fullNameEn.trim(), fullNameAr: fullNameAr.trim() || null, phone: phone.trim() || null });
      await retry();
      setStatus('saved');
    } catch (error) {
      const err = profileSaveError(error);
      setSaveError(err);
      setStatus('error');
    } finally {
      setSaving(false);
    }
  };

  const sendReset = async () => {
    setStatus('idle');
    try {
      await sendPasswordReset(member.email);
      setStatus('resetSent');
    } catch (error) {
      setStatus('error');
    }
  };

  const requestReset = async () => {
    setStatus('idle');
    const fp = getBrowserFingerprint();
    try {
      const resetKey = generateResetKey();
      const resetKeyHash = await sha256Hex(resetKey);
      storeResetKey(resetKey);
      await requestMutation.mutateAsync({ browserFingerprint: fp, resetKeyHash });
      setHasPending(true);
      setStatus('requestSent');
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? (error as { code: string }).code : '';
      if (code === 'request_already_pending') {
        setHasPending(true);
        setStatus('pending');
      } else {
        setStatus('error');
      }
    }
  };

  const doResetPassword = async () => {
    if (!PASSWORD_PATTERN.test(newPassword)) {
      setResetError('generic');
      return;
    }
    if (newPassword !== confirmPassword) {
      setResetError('generic');
      return;
    }
    const resetKey = getStoredResetKey();
    if (!resetKey) {
      setResetError('invalidToken');
      return;
    }
    setResetting(true);
    setResetError(null);
    try {
      const fp = getBrowserFingerprint();
      await completePasswordReset(resetKey, fp, newPassword);
      clearStoredResetKey();
      setResetDone(true);
      setResetAvailable(false);
      await retry();
    } catch (error) {
      if (error instanceof RosterError) {
        if (error.code === 'invalid_reset_token') setResetError('invalidToken');
        else if (error.code === 'firebase_update_failed') setResetError('firebaseFailed');
        else if (error.code === 'firebase_not_configured') setResetError('firebaseNotConfigured');
        else setResetError('generic');
      } else {
        setResetError('generic');
      }
    } finally {
      setResetting(false);
    }
  };

  return (
    <>
      <PageHeader title={t('profile.title')} description={t('profile.description')} />
      <div className="mt-8 grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-primary-900">{t('profile.detailsTitle')}</h2>
          <div className="mt-6 grid gap-5">
            <Field id="profile-name-en" label={t('profile.nameEn')}>
              <input id="profile-name-en" value={fullNameEn} onChange={(event) => setFullNameEn(event.target.value)} className={inputClass} />
            </Field>
            <Field id="profile-name-ar" label={t('profile.nameAr')}>
              <input id="profile-name-ar" value={fullNameAr} onChange={(event) => setFullNameAr(event.target.value)} className={inputClass} dir="rtl" />
            </Field>
            <Field id="profile-phone" label={t('profile.phone')}>
              <input id="profile-phone" value={phone} onChange={(event) => setPhone(event.target.value)} className={inputClass} dir="ltr" inputMode="tel" />
            </Field>
            {status === 'saved' && <p role="status" className="rounded-lg bg-success-50 px-3 py-2 text-sm text-success-700">{t('profile.saved')}</p>}
            {status === 'error' && saveError && (
              <p role="alert" className="rounded-lg bg-error-50 px-3 py-2 text-sm text-error-700">
                {t(`profile.errors.${saveError}`)}
              </p>
            )}
            <Button onClick={() => void save()} disabled={saving} className="w-full sm:w-auto sm:self-start">
              <Save className="h-4 w-4" aria-hidden="true" />
              {saving ? t('profile.saving') : t('profile.save')}
            </Button>
          </div>
        </Card>

        <Card className="p-6">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-50 text-accent-700">
            <KeyRound className="h-5 w-5" aria-hidden="true" />
          </span>
          <h2 className="mt-5 text-lg font-semibold text-primary-900">{t('profile.passwordTitle')}</h2>
          <p className="mt-2 text-sm text-neutral-600">{t('profile.passwordDescription')}</p>

          {resetDone && (
            <p role="status" className="mt-4 rounded-lg bg-success-50 px-3 py-3 text-sm text-success-700">
              {t('profile.passwordChanged')}
            </p>
          )}

          {resetAvailable && !resetDone && (
            <div className="mt-4 flex flex-col gap-3">
              <p role="status" className="rounded-lg bg-success-50 px-3 py-2 text-sm text-success-700">
                {t('profile.resetApproved')}
              </p>
              <Field id="profile-new-password" label={t('auth.changePassword.newPassword')} hint={t('auth.changePassword.hint')}>
                <input
                  id="profile-new-password"
                  type="password"
                  autoComplete="new-password"
                  dir="ltr"
                  className={inputClass}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </Field>
              <Field id="profile-confirm-password" label={t('auth.changePassword.confirmPassword')}>
                <input
                  id="profile-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  dir="ltr"
                  className={inputClass}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </Field>
              {resetError && (
                <p role="alert" className="rounded-lg bg-error-50 px-3 py-2 text-sm text-error-700">
                  {t(`profile.resetErrors.${resetError}`)}
                </p>
              )}
              <Button onClick={() => void doResetPassword()} disabled={resetting} className="w-full">
                {resetting ? t('auth.changePassword.submitting') : t('auth.changePassword.submit')}
              </Button>
            </div>
          )}

          {!resetAvailable && (
            <>
              {hasPending && (
                <p role="status" className="mt-4 rounded-lg bg-warning-50 px-3 py-3 text-sm text-warning-700">
                  {t('profile.pendingRequest')}
                </p>
              )}
              {status === 'resetSent' && <p role="status" className="mt-4 rounded-lg bg-success-50 px-3 py-2 text-sm text-success-700">{t('profile.resetSent')}</p>}
              {status === 'requestSent' && <p role="status" className="mt-4 rounded-lg bg-success-50 px-3 py-2 text-sm text-success-700">{t('profile.requestSent')}</p>}
              {status === 'error' && <p role="alert" className="mt-4 rounded-lg bg-error-50 px-3 py-2 text-sm text-error-700">{t('profile.error')}</p>}
              <div className="mt-6 flex flex-col gap-3">
                <Button variant="secondary" onClick={() => void sendReset()} disabled={requestMutation.isPending} className="w-full">
                  {t('profile.sendReset')}
                </Button>
                {hasPending ? (
                  <p className="rounded-lg bg-neutral-50 px-3 py-3 text-center text-sm text-neutral-600">
                    {t('profile.pendingRequest')}
                  </p>
                ) : (
                  <Button onClick={() => void requestReset()} disabled={requestMutation.isPending} className="w-full">
                    {t('profile.requestReset')}
                  </Button>
                )}
              </div>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
