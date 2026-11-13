import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/Button';
import { Field, inputClass } from '@/shared/ui/Field';
import { useAuth } from '@/features/auth/useAuth';
import {
  checkResetContext,
  completePasswordReset,
  getStoredResetKey,
  clearStoredResetKey,
} from '@/features/roster/rosterApi';
import { getBrowserFingerprint } from '@/shared/utils/browserFingerprint';

const PASSWORD_PATTERN = /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,12}$/;

const schema = z
  .object({
    password: z.string().regex(PASSWORD_PATTERN),
    confirm: z.string(),
  })
  .refine((values) => values.password === values.confirm, { path: ['confirm'] });

type ResetPasswordValues = z.infer<typeof schema>;

type ResetStatus = 'checking' | 'available' | 'unavailable' | 'submitting' | 'done' | 'error';

export function ResetPasswordForm() {
  const { t } = useTranslation();
  const { signIn } = useAuth();
  const [status, setStatus] = useState<ResetStatus>('checking');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirm: '' },
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const fp = getBrowserFingerprint();
        const { available } = await checkResetContext(fp);
        if (!cancelled) setStatus(available ? 'available' : 'unavailable');
      } catch {
        if (!cancelled) setStatus('unavailable');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const onSubmit = async (values: ResetPasswordValues) => {
    const resetKey = getStoredResetKey();
    if (!resetKey) {
      setStatus('error');
      setErrorMsg(t('auth.errors.generic'));
      return;
    }
    setStatus('submitting');
    setErrorMsg(null);
    try {
      const fp = getBrowserFingerprint();
      const { email } = await completePasswordReset(resetKey, fp, values.password);
      clearStoredResetKey();
      await signIn(email, values.password);
      setStatus('done');
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? (error as { code: string }).code : '';
      if (code === 'invalid_reset_token' || code === 'firebase_update_failed') {
        setErrorMsg(t(`auth.errors.${code === 'invalid_reset_token' ? 'invalidResetToken' : 'firebaseUpdateFailed'}`));
      } else {
        setErrorMsg(t('auth.errors.generic'));
      }
      setStatus('error');
    }
  };

  if (status === 'checking') {
    return (
      <p className="text-center text-sm text-neutral-600">{t('common.loading')}</p>
    );
  }

  if (status === 'unavailable' || status === 'done') {
    return null;
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
      <Field
        id="reset-new-password"
        label={t('auth.changePassword.newPassword')}
        hint={t('auth.changePassword.hint')}
        error={errors.password && t('auth.errors.passwordInvalid')}
      >
        <input
          id="reset-new-password"
          type="password"
          autoComplete="new-password"
          dir="ltr"
          className={inputClass}
          {...register('password')}
        />
      </Field>
      <Field
        id="reset-confirm-password"
        label={t('auth.changePassword.confirmPassword')}
        error={errors.confirm && t('auth.errors.passwordMismatch')}
      >
        <input
          id="reset-confirm-password"
          type="password"
          autoComplete="new-password"
          dir="ltr"
          className={inputClass}
          {...register('confirm')}
        />
      </Field>
      {errorMsg && (
        <p role="alert" className="rounded-lg bg-error-50 px-3 py-2 text-sm text-error-700">{errorMsg}</p>
      )}
      <Button type="submit" disabled={status === 'submitting'} className="w-full">
        {status === 'submitting' ? t('auth.changePassword.submitting') : t('auth.changePassword.submit')}
      </Button>
    </form>
  );
}
