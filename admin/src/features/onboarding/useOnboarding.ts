import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { validateOnboarding } from '../../../../packages/ops/src/onboarding/rules';
import { ApiError, post } from '../../api/client';
import type { EnvId, Letterhead, OnboardingResult } from '../../api/types';
import { emptyForm, toInput, type OnboardingForm } from './formState';

/** The form, its errors, and the submit. Errors are worked out on every
 *  keystroke but shown only once a submit was attempted — a form that is red
 *  before you have typed anything is shouting at you for nothing. */
export function useOnboarding() {
  const { t } = useTranslation();
  const [form, setForm] = useState<OnboardingForm>(() => emptyForm());
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<OnboardingResult | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverFields, setServerFields] = useState<Record<string, string>>({});

  const input = useMemo(() => toInput(form), [form]);
  const errors = useMemo(() => ({ ...validateOnboarding(input), ...serverFields }), [input, serverFields]);
  const valid = Object.keys(errors).length === 0;

  const update = useCallback(<K extends keyof OnboardingForm>(key: K, value: OnboardingForm[K]) => {
    setServerFields({});
    setForm((f) => {
      const next = { ...f, [key]: value };
      /* Changing the environment voids the typed confirmation: it was typed
         for the other one. */
      if (key === 'env') next.confirmEnv = '';
      return next;
    });
  }, []);

  const updateLetterhead = useCallback((key: keyof Letterhead, value: string) => {
    setForm((f) => ({ ...f, letterhead: { ...f.letterhead, [key]: value } }));
  }, []);

  /** The message for a field, once errors are being shown. */
  const errorFor = useCallback(
    (path: string): string | undefined => {
      const code = errors[path];
      return attempted && code ? t(`console.errors.${code}`) : undefined;
    },
    [attempted, errors, t],
  );

  const submit = useCallback(async () => {
    setAttempted(true);
    setServerError(null);
    if (!valid) return;
    setSubmitting(true);
    try {
      setResult(await post<OnboardingResult>('/api/onboard', input));
    } catch (e) {
      if (e instanceof ApiError && e.fields) setServerFields(e.fields);
      setServerError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }, [input, valid]);

  const reset = useCallback((env?: EnvId) => {
    setForm(emptyForm(env));
    setAttempted(false);
    setResult(null);
    setServerError(null);
    setServerFields({});
  }, []);

  return {
    form, input, errors, valid, attempted, submitting, result, serverError,
    update, updateLetterhead, errorFor, submit, reset,
  };
}

export type OnboardingApi = ReturnType<typeof useOnboarding>;
